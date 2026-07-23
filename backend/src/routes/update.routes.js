// update.routes.js: API للتحقق من التحديثات وتنفيذها
const express = require('express');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const router = express.Router();
const REPO_DIR = path.join(__dirname, '../../');
const PACKAGE_JSON_PATH = path.join(REPO_DIR, 'package.json');

// قراءة الإصدار من package.json
function getCurrentVersion() {
  try {
    const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
    return packageJson.version || 'unknown';
  } catch (error) {
    return 'unknown';
  }
}

// الحصول على الفرع الحالي
function getCurrentBranch() {
  return new Promise((resolve) => {
    exec('git branch --show-current', { cwd: REPO_DIR }, (err, stdout) => {
      resolve(err ? 'unknown' : stdout.trim());
    });
  });
}

// التحقق من أننا في مستودع Git
function isGitRepo() {
  return new Promise((resolve) => {
    exec('git rev-parse --is-inside-work-tree', { cwd: REPO_DIR }, (err, stdout) => {
      resolve(!err && stdout.trim() === 'true');
    });
  });
}

// الحصول على أحدث إصدار من git tags
async function getLatestVersionFromTags(branch = 'main') {
  try {
    // جلب التاجات من المستودع البعيد
    await new Promise((resolve, reject) => {
      exec(`git fetch origin ${branch} --tags`, { cwd: REPO_DIR }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // الحصول على أحدث tag يتوافق مع نمط semver
    return new Promise((resolve) => {
      exec('git tag -l "v*" --sort=-v:refname', { cwd: REPO_DIR }, (err, stdout) => {
        if (err || !stdout.trim()) {
          resolve(null);
          return;
        }
        // أول tag هو الأحدث (مرتب تنازلياً)
        const latestTag = stdout.trim().split('\n')[0];
        // إزالة 'v' من البداية إذا وجدت
        resolve(latestTag.replace(/^v/, ''));
      });
    });
  } catch (error) {
    return null;
  }
}

// التحقق من وجود الفرع على المستودع البعيد
async function checkBranchExists(branch) {
  try {
    const { stdout } = await new Promise((resolve, reject) => {
      exec(`git ls-remote --heads origin ${branch}`, { cwd: REPO_DIR }, (err, stdout, stderr) => {
        if (err) reject(err);
        else resolve({ stdout, stderr });
      });
    });
    return stdout.trim() !== '';
  } catch (error) {
    return false;
  }
}

// الحصول على الفرع الافتراضي للمستودع البعيد
async function getDefaultBranch() {
  try {
    return new Promise((resolve) => {
      exec('git remote show origin | grep "HEAD branch" | cut -d" " -f5', { cwd: REPO_DIR }, (err, stdout) => {
        if (err || !stdout.trim()) {
          resolve('main');
        } else {
          resolve(stdout.trim());
        }
      });
    });
  } catch (error) {
    return 'main';
  }
}

// التحقق من وجود تحديثات متاحة
async function checkForUpdates(branch = 'main') {
  try {
    // التحقق من وجود الفرع على المستودع البعيد
    const branchExists = await checkBranchExists(branch);
    
    if (!branchExists) {
      // محاولة الحصول على الفرع الافتراضي
      const defaultBranch = await getDefaultBranch();
      return { 
        success: true, 
        hasUpdate: false, 
        currentVersion: getCurrentVersion(), 
        latestVersion: getCurrentVersion(),
        branch,
        changelog: `الفرع "${branch}" غير موجود على المستودع البعيد. الفرع الافتراضي هو: ${defaultBranch}`,
        updateAvailable: false,
        error: `الفرع "${branch}" غير موجود. يرجى اختيار فرع موجود (مثل: ${defaultBranch})`
      };
    }

    // جلب أحدث التغييرات
    await new Promise((resolve, reject) => {
      exec(`git fetch origin ${branch}`, { cwd: REPO_DIR }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // الحصول على الإصدار الحالي من package.json
    const currentVersion = getCurrentVersion();
    
    // الحصول على أحدث إصدار من التاجات
    const latestVersion = await getLatestVersionFromTags(branch);
    
    if (!latestVersion) {
      return { 
        success: true, 
        hasUpdate: false, 
        currentVersion, 
        latestVersion: currentVersion,
        branch,
        changelog: 'لا توجد تاجات إصدارات',
        updateAvailable: false 
      };
    }

    const hasUpdate = currentVersion !== latestVersion;
    
    // الحصول على ملخص التغييرات
    let changelog = '';
    if (hasUpdate) {
      await new Promise((resolve) => {
        exec(`git log --oneline --graph --decorate v${currentVersion}..v${latestVersion}`, { cwd: REPO_DIR }, (err, stdout) => {
          changelog = err ? 'غير متاح' : stdout.trim();
          resolve();
        });
      });
    }

    return {
      success: true,
      hasUpdate,
      currentVersion,
      latestVersion,
      branch,
      changelog: changelog || 'لا توجد تغييرات',
      updateAvailable: hasUpdate
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// تنفيذ التحديث
async function performUpdate(branch = 'main') {
  return new Promise((resolve) => {
    const steps = [
      { name: 'جلب أحدث التغييرات', cmd: `git fetch origin ${branch}` },
      { name: 'سحب التغييرات', cmd: `git pull origin ${branch}` },
      { name: 'تحديث التبعيات', cmd: 'npm ci --production', cwd: path.join(__dirname, '../../backend') }
    ];

    let currentStep = 0;
    const results = [];

    function runNextStep() {
      if (currentStep >= steps.length) {
        // إعادة تشغيل PM2
        exec('pm2 restart network-monitor --update-env', (err) => {
          if (err) {
            resolve({ success: false, error: 'فشل إعادة تشغيل PM2: ' + err.message, steps: results });
          } else {
            resolve({ success: true, message: 'تم التحديث وإعادة التشغيل بنجاح', steps: results });
          }
        });
        return;
      }

      const step = steps[currentStep];
      const options = { cwd: step.cwd || path.join(__dirname, '../..') };
      
      exec(step.cmd, options, (err, stdout, stderr) => {
        if (err) {
          resolve({ 
            success: false, 
            error: `فشل في خطوة "${step.name}": ${err.message}\n${stderr}`, 
            steps: results 
          });
          return;
        }
        
        results.push({ step: step.name, output: stdout.trim() });
        currentStep++;
        runNextStep();
      });
    }

    runNextStep();
  });
}

// GET /api/update/status - التحقق من حالة التحديث
router.get('/status', async (req, res) => {
  try {
    const branch = req.query.branch || 'main';
    const isRepo = await isGitRepo();
    
    if (!isRepo) {
      return res.json({ 
        success: false, 
        error: 'ليس مستودع Git',
        isGitRepo: false 
      });
    }

    const [currentVersion, currentBranch, updateInfo] = await Promise.all([
      getCurrentVersion(),
      getCurrentBranch(),
      checkForUpdates('main')
    ]);

    res.json({
      success: true,
      isGitRepo: true,
      currentVersion,
      currentBranch,
      updateAvailable: updateInfo.updateAvailable || false,
      latestVersion: updateInfo.latestVersion,
      changelog: updateInfo.changelog,
      branch: updateInfo.branch
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/update/check - التحقق من وجود تحديث
router.post('/check', async (req, res) => {
  try {
    const branch = req.body.branch || 'main';
    const result = await checkForUpdates(branch);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/update/perform - تنفيذ التحديث
router.post('/perform', async (req, res) => {
  try {
    const branch = req.body.branch || 'main';
    
    // التحقق من وجود تحديث أولاً
    const check = await checkForUpdates(branch);
    if (!check.success) {
      return res.json({ success: false, error: check.error });
    }
    
    if (!check.updateAvailable) {
      return res.json({ success: true, message: 'أنت بالفعل على أحدث إصدار', alreadyUpdated: true });
    }

    // تنفيذ التحديث في الخلفية
    res.json({ 
      success: true, 
      message: 'بدأ التحديث...',
      updateId: Date.now()
    });

    // تنفيذ التحديث في الخلفية
    performUpdate(branch).then(result => {
      console.log('[UPDATE] Result:', result);
      // يمكن إضافة webhook أو event للإعلام بالنتيجة
    }).catch(err => {
      console.error('[UPDATE] Error:', err);
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/update/history - سجل التحديثات
router.get('/history', async (req, res) => {
  try {
    const { exec } = require('child_process');
    exec('git log --oneline -20', { cwd: path.join(__dirname, '../..') }, (err, stdout) => {
      if (err) {
        return res.json({ success: false, error: err.message });
      }
      
      const commits = stdout.trim().split('\n').filter(l => l).map(line => {
        const [hash, ...msgParts] = line.split(' ');
        return {
          hash: hash.substring(0, 8),
          message: msgParts.join(' '),
          shortHash: hash.substring(0, 8)
        };
      });
      
      res.json({ success: true, history: commits });
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;