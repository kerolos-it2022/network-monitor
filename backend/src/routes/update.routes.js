// update.routes.js: API للتحقق من التحديثات وتنفيذها
const express = require('express');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const REPO_DIR = path.join(__dirname, '../../../'); // Project root (../../../ from backend/src/routes)
const PACKAGE_JSON_PATH = path.join(REPO_DIR, 'backend', 'package.json');

// ─────────────────────────────────────────────────────────────
// إعدادات GitHub (قابلة للتهيئة عبر .env لدعم الـ forks والمستودعات الخاصة)
// ─────────────────────────────────────────────────────────────
// GITHUB_REPO_URL: رابط المستودع (مثال: https://github.com/owner/repo.git)
// GITHUB_TOKEN: رمز وصول شخصي (اختياري — مطلوب للمستودعات الخاصة ويُرفع حد API)
const GITHUB_REPO_URL = process.env.GITHUB_REPO_URL || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

// تفكيك owner/repo من رابط المستودع أو القيمة الافتراضية العامة
function getRepoConfig() {
  const DEFAULT = { owner: 'kerolos-it2022', repo: 'network-monitor' };
  if (!GITHUB_REPO_URL) return DEFAULT;
  // أنماط مدعومة: https://github.com/owner/repo(.git)?  أو  owner/repo
  const match = GITHUB_REPO_URL.match(/github\.com[/:]([^/]+)\/([^/\.?#]+?)(?:\.git)?(?:[?#].*)?$/i)
             || GITHUB_REPO_URL.match(/^([^/]+)\/([^/\.]+)$/);
  if (match && match[1] && match[2]) {
    return { owner: match[1], repo: match[2] };
  }
  return DEFAULT;
}

// رؤوس HTTP الموحّدة لطلبات GitHub API (مع مصادقة عند توفر التوكن)
function githubApiHeaders() {
  const headers = {
    'User-Agent': 'Network-Monitor-Updater',
    'Accept': 'application/vnd.github.v3+json'
  };
  if (GITHUB_TOKEN) headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
  return headers;
}

// رابط نسخة الأرشيف لـ tag (للتحميل البديل عند غياب assets)
function getArchiveUrl(tag) {
  const { owner, repo } = getRepoConfig();
  return `https://github.com/${owner}/${repo}/archive/refs/tags/${tag}.zip`;
}

// قراءة الإصدار من package.json (في مجلد backend)
function getCurrentVersion() {
  try {
    const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
    const version = packageJson.version || 'unknown';
    console.log('[UPDATE] Current version from package.json:', version);
    return version;
  } catch (error) {
    console.error('[UPDATE] Error reading package.json:', error.message);
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
async function getLatestVersionFromTags() {
  try {
    // الحصول على أحدث tag يتوافق مع نمط semver (بدون الحاجة لجلب الفرع)
    return new Promise((resolve) => {
      exec('git tag -l "v*" --sort=-v:refname', { cwd: REPO_DIR }, (err, stdout) => {
        if (err || !stdout.trim()) {
          console.log('[UPDATE] No tags found or error:', err?.message);
          resolve(null);
          return;
        }
        // أول tag هو الأحدث (مرتب تنازلياً)
        const latestTag = stdout.trim().split('\n')[0];
        // إزالة 'v' من البداية إذا وجدت
        const version = latestTag.replace(/^v/, '');
        console.log('[UPDATE] Latest tag found:', latestTag, '-> version:', version);
        resolve(version);
      });
    });
  } catch (error) {
    console.error('[UPDATE] getLatestVersionFromTags error:', error.message);
    return null;
  }
}

// التحقق من وجود الفرع على المستودع البعيد
async function checkBranchExists(branch) {
  try {
    const { stdout } = await new Promise((resolve, reject) => {
      exec(`git ls-remote --heads origin ${branch}`, { cwd: REPO_DIR }, (err, stdout, stderr) => {
        if (err) {
          console.error('[UPDATE] checkBranchExists error:', err.message);
          reject(err);
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
    const exists = stdout.trim() !== '';
    console.log(`[UPDATE] Branch "${branch}" exists on remote:`, exists);
    return exists;
  } catch (error) {
    console.error('[UPDATE] checkBranchExists failed:', error.message);
    return false;
  }
}

// الحصول على الفرع الافتراضي للمستودع البعيد
// fallback: GITHUB_BRANCH إن ضُبط في .env، وإلا 'main'
const DEFAULT_BRANCH_FALLBACK = process.env.GITHUB_BRANCH || 'main';
async function getDefaultBranch() {
  try {
    return new Promise((resolve) => {
      exec('git remote show origin | grep "HEAD branch" | cut -d" " -f5', { cwd: REPO_DIR }, (err, stdout) => {
        if (err || !stdout.trim()) {
          resolve(DEFAULT_BRANCH_FALLBACK);
        } else {
          resolve(stdout.trim());
        }
      });
    });
  } catch (error) {
    return DEFAULT_BRANCH_FALLBACK;
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
        success: false, 
        error: `الفرع "${branch}" غير موجود على المستودع البعيد. الفرع الافتراضي هو: ${defaultBranch}`,
        currentVersion: getCurrentVersion(),
        latestVersion: getCurrentVersion(),
        branch,
        changelog: `الفرع "${branch}" غير موجود. الفرع الافتراضي: ${defaultBranch}`,
        updateAvailable: false
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
    
    // الحصول على أحدث إصدار من التاجات (بدون حاجة للفرع)
    const latestVersion = await getLatestVersionFromTags();
    
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
      { name: 'تحديث التبعيات', cmd: 'npm ci --omit=dev', cwd: path.join(__dirname, '../../backend') }
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

// GET /api/update/status - التحقق من حالة التحديث (🔒 يتطلب تسجيل دخول — يكشف إصدارات النظام)
router.get('/status', requireAuth, async (req, res) => {
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

// POST /api/update/check - التحقق من وجود تحديث (🔒)
router.post('/check', requireAuth, async (req, res) => {
  try {
    const branch = req.body.branch || 'main';
    const result = await checkForUpdates(branch);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/update/perform - تنفيذ التحديث (🔒 يعدّل النظام)
router.post('/perform', requireAuth, async (req, res) => {
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

// GET /api/update/history - سجل التحديثات (🔒 يكشف git log)
router.get('/history', requireAuth, async (req, res) => {
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

// GET /api/update/branches - جلب الفروع المتاحة من المستودع البعيد (🔒)
router.get('/branches', requireAuth, async (req, res) => {
  try {
    // جلب الفروع من البعيد
    exec('git ls-remote --heads origin', { cwd: REPO_DIR }, (err, stdout, stderr) => {
      if (err) {
        console.error('[UPDATE] Failed to fetch branches:', err.message);
        // إرجاع الفرع الافتراضي ك fallback
        return res.json({ success: true, branches: ['main'], defaultBranch: 'main' });
      }
      
      const branches = stdout.trim().split('\n')
        .filter(line => line.trim())
        .map(line => {
          const match = line.match(/refs\/heads\/(.+)$/);
          return match ? match[1] : null;
        })
        .filter(Boolean);
      
      // الحصول على الفرع الافتراضي
      exec('git remote show origin | grep "HEAD branch" | cut -d" " -f5', { cwd: REPO_DIR }, (err2, stdout2) => {
        const defaultBranch = (err2 || !stdout2.trim()) ? 'main' : stdout2.trim();
        
        // التأكد من وجود الفرع الافتراضي في القائمة
        if (!branches.includes(defaultBranch) && branches.length > 0) {
          branches.unshift(defaultBranch);
        }
        
        res.json({ 
          success: true, 
          branches: branches.length > 0 ? branches : ['main'],
          defaultBranch: defaultBranch
        });
      });
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/update/download - تحميل أحدث إصدار من GitHub (مع بث تقدم SSE) (🔒)
router.get('/download', requireAuth, async (req, res) => {
  try {
    const branch = req.query.branch || 'main';
    
    // إعداد SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    
    const sendEvent = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    
    const sendError = (message) => {
      sendEvent('error', { message });
      res.end();
    };
    
    sendEvent('start', { message: 'جاري التحضير لتحميل التحديث...' });
    
    // التحقق من وجود تحديث
    const check = await checkForUpdates(branch);
    if (!check.success) {
      sendError(check.error || 'فشل في فحص التحديثات');
      return;
    }
    
    if (!check.updateAvailable) {
      sendEvent('line', { message: '✅ أنت بالفعل على أحدث إصدار (' + check.currentVersion + ')' });
      sendEvent('done', { message: 'لا يوجد تحديث متاح' });
      return;
    }
    
    sendEvent('line', { message: `📦 إصدار جديد متاح: ${check.latestVersion} (الحالي: ${check.currentVersion})` });
    
    // جلب معلومات الإصدار من GitHub API
    sendEvent('line', { message: '🔍 جاري جلب معلومات الإصدار من GitHub...' });
    
    try {
      const https = require('https');
      const { owner: repoOwner, repo: repoName } = getRepoConfig();
      
      // استخدام GitHub API لجلب أحدث إصدار
      const githubApiUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/releases/latest`;
      
      const releaseData = await new Promise((resolve, reject) => {
        https.get(githubApiUrl, { 
          headers: githubApiHeaders()
        }, (response) => {
          let data = '';
          response.on('data', chunk => data += chunk);
          response.on('end', () => {
            try {
              if (response.statusCode === 200) {
                resolve(JSON.parse(data));
              } else {
                reject(new Error(`GitHub API error: ${response.statusCode} - ${data}`));
              }
            } catch (e) {
              reject(e);
            }
          });
        }).on('error', reject);
      });
      
      if (releaseData) {
        sendEvent('line', { message: `📋 الإصدار: ${releaseData.tag_name || releaseData.name}` });
        sendEvent('line', { message: `📅 تاريخ النشر: ${releaseData.published_at ? new Date(releaseData.published_at).toLocaleString('ar-EG') : 'غير معروف'}` });
        
        if (releaseData.body) {
          const shortBody = releaseData.body.substring(0, 500);
          sendEvent('line', { message: `📝 ملاحظات الإصدار:\n${shortBody}${releaseData.body.length > 500 ? '...' : ''}` });
        }
        
        // عرض الأصول المتاحة للتحميل
        if (releaseData.assets && releaseData.assets.length > 0) {
          sendEvent('line', { message: `📎 الأصول المتاحة (${releaseData.assets.length}):` });
          releaseData.assets.forEach(asset => {
            const sizeMB = (asset.size / 1024 / 1024).toFixed(2);
            sendEvent('line', { message: `  - ${asset.name} (${sizeMB} MB) - ${asset.download_count} تحميل` });
          });
          
          // تحميل أول أصل (عادة الكود المصدري)
          const sourceAsset = releaseData.assets.find(a => a.name.includes('source') || a.name.endsWith('.zip') || a.name.endsWith('.tar.gz'));
          const assetToDownload = sourceAsset || releaseData.assets[0];
          
          sendEvent('line', { message: `⬇️ جاري تحميل: ${assetToDownload.name} (${(assetToDownload.size / 1024 / 1024).toFixed(2)} MB)...` });
          
          // تحميل الملف مع عرض التقدم
          await downloadWithProgress(assetToDownload.browser_download_url, assetToDownload.name, sendEvent);
          
          sendEvent('line', { message: `✅ تم تحميل ${assetToDownload.name} بنجاح` });
          sendEvent('line', { message: '💡 لتطبيق التحديث، اضغط زر "🚀 تطبيق التحديث"' });
        } else {
          // لا توجد أصول، استخدم كود المصدر
          const sourceUrl = getArchiveUrl(check.latestVersion);
          sendEvent('line', { message: `⬇️ جاري تحميل الكود المصدري من: ${sourceUrl}` });
          await downloadWithProgress(sourceUrl, `network-monitor-${check.latestVersion}.zip`, sendEvent);
          sendEvent('line', { message: '✅ تم تحميل الكود المصدري بنجاح' });
        }
      }
      
      sendEvent('done', { message: 'اكتمل التحميل', latestVersion: check.latestVersion });
      
    } catch (githubError) {
      sendEvent('line', { message: `⚠️ لا يوجد إصدار منشور على GitHub، جاري تحميل الكود المصدري من الـ tag...` });
      
      // تحميل الكود المصدري مباشرة من الـ tag
      const { owner: repoOwner, repo: repoName } = getRepoConfig();
      const sourceUrl = `https://github.com/${repoOwner}/${repoName}/archive/refs/tags/v${check.latestVersion}.zip`;
      
      sendEvent('line', { message: `⬇️ جاري تحميل الكود المصدري: network-monitor-v${check.latestVersion}.zip` });
      
      try {
        await downloadWithProgress(sourceUrl, `network-monitor-v${check.latestVersion}.zip`, sendEvent);
        sendEvent('line', { message: '✅ تم تحميل الكود المصدري بنجاح' });
        sendEvent('line', { message: '💡 لتطبيق التحديث، اضغط زر "🚀 تطبيق التحديث"' });
        sendEvent('done', { message: 'اكتمل التحميل', latestVersion: check.latestVersion });
      } catch (downloadError) {
        sendEvent('line', { message: `❌ فشل التحميل: ${downloadError.message}` });
        sendEvent('line', { message: '🔗 فتح صفحة الإصدارات في المتصفح...' });
        sendEvent('done', { message: `افتح الرابط يدوياً: https://github.com/${repoOwner}/${repoName}/releases` });
      }
    }
    
  } catch (error) {
    sendError(error.message);
  }
});

// دالة تحميل مع عرض التقدم
function downloadWithProgress(url, filename, sendEvent) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    
    // حفظ في مجلد مؤقت
    const tempDir = os.tmpdir();
    const filePath = path.join(tempDir, filename);
    
    const request = https.get(url, { 
      headers: { 'User-Agent': 'Network-Monitor-Updater' },
      // متابعة التحويلات
      maxRedirects: 10
    }, (response) => {
      // التعامل مع التحويلات
      if (response.statusCode === 302 || response.statusCode === 301) {
        const redirectUrl = response.headers.location;
        sendEvent('line', { message: `🔄 تحويل إلى: ${redirectUrl}` });
        downloadWithProgress(redirectUrl, filename, sendEvent).then(resolve).catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }
      
      const totalSize = parseInt(response.headers['content-length'] || '0', 10);
      let downloaded = 0;
      let lastPercent = -1;
      
      const fileStream = fs.createWriteStream(filePath);
      
      response.on('data', (chunk) => {
        downloaded += chunk.length;
        if (totalSize > 0) {
          const percent = Math.round((downloaded / totalSize) * 100);
          if (percent !== lastPercent && percent % 10 === 0) {
            sendEvent('progress', { 
              percent, 
              downloaded: `${(downloaded / 1024 / 1024).toFixed(2)} MB`,
              total: `${(totalSize / 1024 / 1024).toFixed(2)} MB`
            });
            lastPercent = percent;
          }
        }
      });
      
      response.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        sendEvent('line', { message: `💾 تم الحفظ في: ${filePath}` });
        resolve(filePath);
      });
      
      fileStream.on('error', (err) => {
        fs.unlink(filePath, () => {});
        reject(err);
      });
    });
    
    request.on('error', (err) => {
      reject(err);
    });
    
    // مهلة 5 دقائق
    request.setTimeout(300000, () => {
      request.destroy();
      reject(new Error('انتهت مهلة التحميل (5 دقائق)'));
    });
  });
}

module.exports = router;