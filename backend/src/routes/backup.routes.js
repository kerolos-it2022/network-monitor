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
  // v2.8.7 — رُفع الحد من 100MB إلى 300MB: حجم القاعدة ينمو (status_logs) وقد يتجاوز 100MB
  // فكانت استعادة نسخة قديمة/كبيرة تفشل. الحدّ يجب أن يكون متطابقًا مع client_max_body_size في nginx.
  limits: { fileSize: 300 * 1024 * 1024 },
});

// ===== مسار قاعدة البيانات الحالية (مطلق) =====
// db.js يفتحها بمسار نسبي نسبة لـ CWD، نعيد بناءه بنفس الطريقة.
const DB_PATH = path.resolve(process.cwd(), process.env.DB_PATH || '../database/monitoring.db');
const DB_DIR = path.dirname(DB_PATH);
const BACKUPS_DIR = path.join(DB_DIR, 'backups');
// v2.10.3 — مجلد نسخ بديل **قابل للكتابة من خدمة الويب (netmon)**:
// على الأجهزة الحقيقية قد يُنشئ كونسول الجهاز (root) مجلد <DB_DIR>/backups بملكية root،
// فتفشل خدمة netmon في الكتابة داخله (EACCES) ويظهر «تعذّر إنشاء النسخة الاحتياطية».
// الحل الأوتوماتيكي: نجرّب المجلد القياسي أولًا، وإن تعذّرت الكتابة نستخدم <DB_DIR>/svc-backups
// (ينشئه netmon بنفسه داخل المسار المسموح له) ⇒ زر «نسخة احتياطية + تحديث» يعمل بلا أي تدخّل يدوي.
const FALLBACK_BACKUPS_DIR = path.join(DB_DIR, 'svc-backups');
const WRITE_DIRS = [BACKUPS_DIR, FALLBACK_BACKUPS_DIR];

// يختار أول مجلد قابل للكتابة فعلًا (اختبار كتابة/حذف حقيقي) — وإلا يعيد سبب الفشل.
function pickWritableBackupDir() {
  let lastErr = null;
  for (const dir of WRITE_DIRS) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, '.write-probe');
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      return { dir: dir, err: null };
    } catch (e) {
      lastErr = e;
    }
  }
  return { dir: null, err: lastErr };
}
// كل المجلدات الموجودة فعليًّا (للقائمة والحذف).
function readableBackupDirs() {
  return WRITE_DIRS.filter((d) => { try { return fs.existsSync(d); } catch (e) { return false; } });
}

// v2.8.7 — مجلد مؤقّت **قابل للكتابة** بدل os.tmpdir():
// خدمة الأبلاينس تعمل بـ ProtectSystem=strict مع ReadWritePaths=/var/lib/network-monitor فقط،
// وحسب توثيق systemd فإن /tmp يبقى للقراءة فقط في هذه الحالة إن لم يُفعّل PrivateTmp ⇒
// أي كتابة في os.tmpdir() تفشل بـ EROFS (وهو السبب الفعلي لفشل النسخ الاحتياطي على الأبلاينس).
// الحل: نكتب داخل مجلد القاعدة نفسه (ضمن المسار المسموح)، مع os.tmpdir() كاحتياط أخير.
const TMP_DIR = path.join(DB_DIR, '.tmp');
function tempPath(name) {
  try {
    fs.mkdirSync(TMP_DIR, { recursive: true });
    return path.join(TMP_DIR, name);
  } catch (e) {
    return path.join(os.tmpdir(), name);
  }
}

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
    // نكتب الـ buffer في ملف مؤقت (داخل مجلد القاعدة القابل للكتابة)
    tmpFile = tempPath(`nm-verify-${Date.now()}.db`);
    fs.writeFileSync(tmpFile, buffer);
    tmpDb = new Database(tmpFile, { readonly: true });
    const tables = tmpDb.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all().map((r) => r.name);
    const missing = EXPECTED_TABLES.filter((t) => !tables.includes(t));
    return { ok: missing.length === 0, tables, missing };
  } finally {
    if (tmpDb) try { tmpDb.close(); } catch (e) {}
    if (tmpFile) {
      // تنظيف الملف المؤقّت + ملفات WAL المرافقة (-shm/-wal) حتى لا تتراكم في مجلد القاعدة.
      for (const f of [tmpFile, tmpFile + '-shm', tmpFile + '-wal']) {
        try { fs.unlinkSync(f); } catch (e) {}
      }
    }
  }
}

// دالة لإنشاء نسخة أمنية تلقائية من القاعدة الحالية قبل الاستبدال
async function createSafetyBackup() {
  // v2.10.3 — نختار مجلدًا قابلًا للكتابة فعلًا (قد يكون القياسي مملوكًا لـ root)
  const pick = pickWritableBackupDir();
  if (!pick.dir) {
    throw new Error('لا يوجد مجلد نسخ قابل للكتابة (' + WRITE_DIRS.join(' · ') + ')' + (pick.err ? ' — ' + pick.err.message : ''));
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const backupFile = `backup-before-restore-${ts}.db`;
  const backupPath = path.join(pick.dir, backupFile);

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
  const tmpPath = tempPath(filename);

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
    // v2.10.3 — ندمج المجلد القياسي + المجلد البديل (لو موجود) حتى تظهر كل النسخ في الواجهة.
    const files = [];
    for (const dir of readableBackupDirs()) {
      let names = [];
      try { names = fs.readdirSync(dir); } catch (e) { continue; }
      for (const f of names.filter((n) => n.endsWith('.db'))) {
        try {
          const fpath = path.join(dir, f);
          const stat = fs.statSync(fpath);
          files.push({
            filename: f,
            dir: dir,
            sizeBytes: stat.size,
            sizeMB: (stat.size / 1024 / 1024).toFixed(2),
            createdAt: stat.mtime.toISOString(),
          });
        } catch (e) { /* ملف غير قابل للقراءة — نتجاوزه */ }
      }
    }
    files.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, backups: files });
  } catch (error) {
    console.error('[BACKUP] list error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// POST /api/backup/restore  🔒 — استعادة من ملف مرفوع (.db)
// ============================================================
// v2.10.0 — إنشاء نسخة احتياطية على الخادم (خطوة «نسخة احتياطية + تحديث» في تبويب التحديثات).
// تُكتب في <DB_DIR>/backups بنفس نمط كونسول الجهاز (db-YYYYMMDD-HHMMSS.db) عبر واجهة db.backup()
// (نسخة متسقة من SQLite بلا تعطيل الخدمة — نفس الطريقة المستخدمة في كونسول الأبلاينس).
router.post('/create', requireAuth, async (req, res) => {
  try {
    const pick = pickWritableBackupDir();
    if (!pick.dir) {
      return res.status(500).json({
        success: false,
        error: 'تعذّر إنشاء النسخة الاحتياطية: لا يوجد مجلد نسخ قابل للكتابة (' + WRITE_DIRS.join(' · ') + ')',
      });
    }
    const d = new Date();
    const p2 = (n, l = 2) => String(n).padStart(l, '0');
    const name = `db-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.db`;
    const dest = path.join(pick.dir, name);
    await db.backup(dest);
    const sizeMB = +(fs.statSync(dest).size / (1024 * 1024)).toFixed(2);
    console.log('[BACKUP] create:', dest, sizeMB + 'MB');
    res.json({ success: true, file: name, dir: pick.dir, sizeMB, message: 'تم إنشاء نسخة احتياطية ✓ (' + sizeMB + ' MB)' });
  } catch (e) {
    console.error('[BACKUP] create error:', e.message);
    res.status(500).json({ success: false, error: 'تعذّر إنشاء النسخة الاحتياطية: ' + e.message });
  }
});

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
      return res.status(400).json({ success: false, error: 'الملف يجب أن ينتهي بـ .db' });
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

    // v2.10.3 — نبحث في المجلد القياسي ثم البديل
    let filePath = path.join(BACKUPS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      const alt = path.join(FALLBACK_BACKUPS_DIR, filename);
      if (fs.existsSync(alt)) filePath = alt;
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'النسخة غير موجودة' });
    }

    // نمنع حذف الملف الرئيسي للقاعدة (حماية إضافية ضد سوء الاستخدام)
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
