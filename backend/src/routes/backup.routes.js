// backup.routes.js: API للنسخ الاحتياطي واستعادة قاعدة بيانات SQLite.
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const Database = require('better-sqlite3');

const router = express.Router();
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

// multer: رفع الملفات في الذاكرة (النمط المعتمد في devices.routes.js) مع حد حجمي.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB كحد أقصى
});

// ===== مسار قاعدة البيانات الحالية (مطلق) =====
// db.js يفتحها بمسار نسبي نسبة لـ CWD، نعيد بناءه بنفس الطريقة.
const DB_PATH = path.resolve(process.cwd(), process.env.DB_PATH || '../database/monitoring.db');
const DB_DIR = path.dirname(DB_PATH);
const BACKUPS_DIR = path.join(DB_DIR, 'backups');

// القائمة المتوقعة للجداول (للتحقق من سلامة ملفات الاستعادة).
const EXPECTED_TABLES = [
  'device_types', 'locations', 'users', 'devices', 'status_logs',
  'downtime_events', 'notification_settings', 'mobile_registrations', 'notification_logs',
];

// دالة لتنظيف اسم الملف من path traversal
function sanitizeFilename(filename) {
  if (!filename || typeof filename !== 'string') return null;
  // نرفض أي مسار نسبي أو مطلق أو أحرف خطيرة
  if (/[\/\\]/.test(filename) || filename.includes('..') || filename.includes('\0')) {
    return null;
  }
  // نسمح بالأحرف والأرقام والأمان فقط في اسم بسيط
  if (!/^[A-Za-z0-9_.-]+$/.test(filename)) {
    return null;
  }
  return filename;
}

// دالة للتأكد من أن الملف SQLite صالح (التحقق من magic bytes).
function isValidSqliteFile(buffer) {
  if (!buffer || buffer.length < 16) return false;
  // أول 16 بايت من ملف SQLite هي: "SQLite format 3\0"
  const magic = 'SQLite format 3\0';
  for (let i = 0; i < 16; i++) {
    if (buffer[i] !== magic.charCodeAt(i)) return false;
  }
  return true;
}

// دالة لفتح قاعدة مؤقتة من buffer والتحقق من جداولها
function validateBackupBuffer(buffer) {
  let tmpFile = null;
  let tmpDb = null;
  try {
    // نكتب الـ buffer في ملف مؤقت
    tmpFile = path.join(os.tmpdir(), `nm-verify-${Date.now()}.db`);
    fs.writeFileSync(tmpFile, buffer);
    tmpDb = new Database(tmpFile, { readonly: true });
    const tables = tmpDb.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all().map((r) => r.name);
    const missing = EXPECTED_TABLES.filter((t) => !tables.includes(t));
    return { ok: missing.length === 0, tables, missing };
  } finally {
    if (tmpDb) try { tmpDb.close(); } catch (e) {}
    if (tmpFile) try { fs.unlinkSync(tmpFile); } catch (e) {}
  }
}

// دالة لإنشاء نسخة أمنية تلقائية من القاعدة الحالية قبل الاستبدال
async function createSafetyBackup() {
  // نتأكد من وجود مجلد النسخ (recursive يتجاهل الوجود المسبق)
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const backupFile = `backup-before-restore-${ts}.db`;
  const backupPath = path.join(BACKUPS_DIR, backupFile);

  // better-sqlite3 backup: نسخة transaction-consistent دون إيقاف الكتابة
  // على Windows قد لا يكون الملف ظاهراً لـ stat في نفس الـ tick؛ ننتظر نسخياً.
  const result = await db.backup(backupPath);

  // ننتظر ظهور الملف على القرص (poll بسيط لتفادي ENOENT العابر)
  let size = 0;
  for (let i = 0; i < 50; i++) {
    try {
      const stat = fs.statSync(backupPath);
      size = stat.size;
      if (size > 0) break;
    } catch (e) {
      // الملف لم يظهر بعد — تابع
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (size === 0) {
    // fallback: نعتمد على totalPages من better-sqlite3 (4096 bytes/page تقريباً)
    size = (result && result.totalPages) ? result.totalPages * 4096 : 0;
  }

  return { filename: backupFile, path: backupPath, size };
}

// ============================================================
// GET /api/backup/info  🔒 — معلومات القاعدة الحالية
// ============================================================
router.get('/info', requireAuth, (req, res) => {
  try {
    const stat = fs.statSync(DB_PATH);
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all().map((r) => r.name);

    // عدد الصفوف في كل جدول (مفيد للعرض)
    const tableCounts = {};
    for (const t of tables) {
      try {
        tableCounts[t] = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c;
      } catch (e) {
        tableCounts[t] = -1;
      }
    }

    res.json({
      success: true,
      dbPath: path.basename(DB_PATH),
      sizeBytes: stat.size,
      sizeMB: (stat.size / 1024 / 1024).toFixed(2),
      tableCount: tables.length,
      tables: tableCounts,
      lastModified: stat.mtime.toISOString(),
      backupsDir: path.basename(BACKUPS_DIR),
    });
  } catch (error) {
    console.error('[BACKUP] info error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// GET /api/backup/download  🔒 — تنزيل نسخة احتياطية (.db) كاملة
// ============================================================
router.get('/download', requireAuth, async (req, res) => {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const filename = `network-monitor-backup-${ts}.db`;
  const tmpPath = path.join(os.tmpdir(), filename);

  try {
    // better-sqlite3 online backup — آمن أثناء نشاط الكتابة
    await db.backup(tmpPath);

    const stat = fs.statSync(tmpPath);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', stat.size);

    // نقله كملف ثم حذفه بعد الانتهاء
    const stream = fs.createReadStream(tmpPath);
    stream.on('error', (err) => {
      console.error('[BACKUP] stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: 'فشل قراءة ملف النسخة' });
      }
    });
    stream.on('end', () => {
      try { fs.unlinkSync(tmpPath); } catch (e) {}
    });
    stream.pipe(res);
  } catch (error) {
    console.error('[BACKUP] download error:', error);
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e) {}
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'فشل إنشاء نسخة احتياطية: ' + error.message });
    }
  }
});

// ============================================================
// GET /api/backup/list  🔒 — قائمة النسخ الأمنية الموجودة
// ============================================================
router.get('/list', requireAuth, (req, res) => {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) {
      return res.json({ success: true, backups: [] });
    }
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter((f) => f.endsWith('.db'))
      .map((f) => {
        const fpath = path.join(BACKUPS_DIR, f);
        const stat = fs.statSync(fpath);
        return {
          filename: f,
          sizeBytes: stat.size,
          sizeMB: (stat.size / 1024 / 1024).toFixed(2),
          createdAt: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, backups: files });
  } catch (error) {
    console.error('[BACKUP] list error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// POST /api/backup/restore  🔒 — استعادة من ملف مرفوع (.db)
// ============================================================
router.post('/restore', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'لم يتم رفع ملف' });
    }

    // 1. التحقق من magic bytes لـ SQLite
    if (!isValidSqliteFile(req.file.buffer)) {
      return res.status(400).json({
        success: false,
        error: 'الملف المرفوع ليس ملف SQLite صالح',
      });
    }

    // 2. التحقق من البنية: الجداول المتوقعة موجودة
    const validation = validateBackupBuffer(req.file.buffer);
    if (!validation.ok) {
      return res.status(400).json({
        success: false,
        error: `الملف غير متوافق مع القاعدة. جداول ناقصة: ${validation.missing.join(', ')}`,
      });
    }

    // 3. إنشاء نسخة أمنية تلقائية من القاعدة الحالية
    let safetyBackup;
    try {
      safetyBackup = await createSafetyBackup();
      console.log('[BACKUP] Safety backup created:', safetyBackup.filename);
    } catch (e) {
      return res.status(500).json({
        success: false,
        error: 'فشل إنشاء نسخة أمنية قبل الاستعادة: ' + e.message,
      });
    }

    // 4. الكتابة فوق ملف القاعدة الحالي
    // ملاحظة: better-sqlite3 يمسك مؤشر الملف؛ نكتب فوقه لكن التغييرات تُلتقط عند إعادة التشغيل.
    try {
      fs.writeFileSync(DB_PATH, req.file.buffer);
    } catch (e) {
      return res.status(500).json({
        success: false,
        error: `فشل الكتابة فوق القاعدة: ${e.message}. النسخة الأمنية محفوظة: ${safetyBackup.filename}`,
      });
    }

    // 5. إرجاع النجاح ثم إعادة التشغيل (process.exit) ليلتقط الاتصال الجديد
    res.json({
      success: true,
      message: 'تمت استعادة النسخة بنجاح. جاري إعادة تشغيل الخادم...',
      backupFile: safetyBackup.filename,
      tables: validation.tables.length,
    });

    // نترك رسالة استجابة أولاً ثم نخرج. PM2 (إن كان) سيعيد التشغيل تلقائياً.
    console.log('[BACKUP] Restore successful. Scheduling process exit for restart...');
    setTimeout(() => {
      console.log('[BACKUP] Exiting process for restart...');
      process.exit(0);
    }, 800);
  } catch (error) {
    console.error('[BACKUP] restore error:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// ============================================================
// POST /api/backup/restore-existing  🔒 — استعادة نسخة موجودة في backups/
// Body JSON: { filename: "backup-before-restore-..." }
// ============================================================
router.post('/restore-existing', requireAuth, async (req, res) => {
  try {
    const filename = sanitizeFilename(req.body && req.body.filename);
    if (!filename) {
      return res.status(400).json({ success: false, error: 'اسم ملف غير صالح' });
    }
    if (!filename.endsWith('.db')) {
      return res.status(400).json({ success: false, error: 'الملف должен أنتهي بـ .db' });
    }

    const srcPath = path.join(BACKUPS_DIR, filename);
    if (!fs.existsSync(srcPath)) {
      return res.status(404).json({ success: false, error: 'النسخة المطلوبة غير موجودة' });
    }

    // قراءة محتوى النسخة الموجودة
    const buffer = fs.readFileSync(srcPath);
    if (!isValidSqliteFile(buffer)) {
      return res.status(400).json({ success: false, error: 'النسخة الموجودة تالفة (ليست SQLite صالح)' });
    }

    const validation = validateBackupBuffer(buffer);
    if (!validation.ok) {
      return res.status(400).json({
        success: false,
        error: `النسخة غير متوافقة. جداول ناقصة: ${validation.missing.join(', ')}`,
      });
    }

    // إنشاء نسخة أمنية من القاعدة الحالية قبل استبدالها
    let safetyBackup;
    try {
      safetyBackup = await createSafetyBackup();
    } catch (e) {
      return res.status(500).json({
        success: false,
        error: 'فشل إنشاء نسخة أمنية قبل الاستعادة: ' + e.message,
      });
    }

    // الكتابة فوق القاعدة الحالية
    try {
      fs.writeFileSync(DB_PATH, buffer);
    } catch (e) {
      return res.status(500).json({
        success: false,
        error: `فشل الكتابة فوق القاعدة: ${e.message}. النسخة الأمنية: ${safetyBackup.filename}`,
      });
    }

    res.json({
      success: true,
      message: `تمت استعادة النسخة "${filename}" بنجاح. جاري إعادة تشغيل الخادم...`,
      restoredFrom: filename,
      backupFile: safetyBackup.filename,
    });

    console.log(`[BACKUP] Restored from existing: ${filename}. Scheduling exit...`);
    setTimeout(() => {
      console.log('[BACKUP] Exiting process for restart...');
      process.exit(0);
    }, 800);
  } catch (error) {
    console.error('[BACKUP] restore-existing error:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// ============================================================
// DELETE /api/backup/:filename  🔒 — حذف نسخة أمنية محددة
// ============================================================
router.delete('/:filename', requireAuth, (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    if (!filename) {
      return res.status(400).json({ success: false, error: 'اسم ملف غير صالح' });
    }
    if (!filename.endsWith('.db')) {
      return res.status(400).json({ success: false, error: 'الملف يجب أن ينتهي بـ .db' });
    }

    const filePath = path.join(BACKUPS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'النسخة غير موجودة' });
    }

    // نمنع حذف الملف الرئيسي للقاعدة (حماية إضافية ضد سوء الاستخدام)
    const realBackupsDir = fs.realpathSync(BACKUPS_DIR);
    const realTarget = fs.realpathSync(filePath);
    const realDb = fs.realpathSync(DB_PATH);
    if (realTarget === realDb) {
      return res.status(400).json({ success: false, error: 'لا يمكن حذف ملف القاعدة الرئيسية' });
    }

    fs.unlinkSync(filePath);
    res.json({ success: true, message: `تم حذف النسخة "${filename}"` });
  } catch (error) {
    console.error('[BACKUP] delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
