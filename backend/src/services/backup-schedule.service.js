// backup-schedule.service.js (v2.19.0) — نسخ احتياطي مجدول تلقائي للقاعدة.
// ─────────────────────────────────────────────────────────────
// الإعدادات: <DB_DIR>/backup-schedule.json — { enabled:bool, hour:'HH:MM', keep:N }
//   الافتراضي: enabled=true, hour='03:30', keep=7 (حراسة بعد تنظيف status_logs).
// السلوك: حلقة دقيقة واحدة — عند تطابق الساعة (مرة/يوم) تُنشأ نسخة متسقة عبر
//   better-sqlite3 db.backup() (بلا تعطيل الخدمة) في مجلد backups القياسي أو
//   svc-backups البديل (نفس منطق backup.routes)، باسم auto-db-YYYYMMDD-HHMMSS.db
//   (بادئة auto- تميّزها للمسح véchrom اللاحق — لا نحذف نسخ المستخدم اليدوية).
// ثم: الاحتفاظ بآخر N نسخة auto فقط (حذف ما زاد) — وحماية اليوم من التكرار في الذاكرة.
const fs = require('fs');
const path = require('path');
const db = require('../db');

let lastRunDay = '';
let ticking = false;

// البيانات/المسارات — نفس منطق backup.routes (DB_DIR + مجلدا النسخ)
const DB_PATH_RESOLVED = path.resolve(process.cwd(), process.env.DB_PATH || '../database/monitoring.db');
const DB_DIR = path.dirname(DB_PATH_RESOLVED);
const DIRS = [path.join(DB_DIR, 'backups'), path.join(DB_DIR, 'svc-backups')];

function schedulePath() { return path.join(DB_DIR, 'backup-schedule.json'); }

function readSchedule() {
  try { return JSON.parse(fs.readFileSync(schedulePath(), 'utf8')); } catch (e) { return { enabled: true, hour: '03:30', keep: 7 }; }
}
function writeSchedule(cfg) {
  fs.writeFileSync(schedulePath(), JSON.stringify(cfg, null, 2));
}

// pickWritableDir(): أول مجلد نسخ يقبل الكتابة (نفس منطق backup.routes).
function pickWritableDir() {
  for (const dir of DIRS) {
    try { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); return dir; } catch (e) {}
  }
  return null;
}

// createAutoBackup(): إنشاء النسخة (تُعيد {dir, file} أو يرمي) — منسوخ من نمط /create.
async function createAutoBackup() {
  const dir = pickWritableDir();
  if (!dir) throw new Error('لا يوجد مجلد نسخ قابل للكتابة');
  const d = new Date();
  const p2 = (n, l = 2) => String(n).padStart(l, '0');
  const name = `auto-db-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.db`;
  const dest = path.join(dir, name);
  await db.backup(dest);
  return { dir, file: name };
}

// pruneAuto(keep): حذف أقدم نسخ auto فوق الحد (فقط بادئة auto-db- — لا نلمس يدويًّا).
function pruneAuto(keep) {
  const names = [];
  for (const dir of DIRS) {
    try {
      for (const f of fs.readdirSync(dir)) {
        if (/^auto-db-\d{8}-\d{6}\.db$/.test(f)) names.push(path.join(dir, f));
      }
    } catch (e) {}
  }
  const withTime = names.map((f) => ({ f, m: fs.statSync(f).mtimeMs })).sort((a, b) => b.m - a.m);
  let removed = 0;
  for (let i = keep; i < withTime.length; i++) {
    try { fs.unlinkSync(withTime[i].f); removed++; } catch (e) {}
  }
  if (removed) console.log('[BK-SCHEDULE] حذف', removed, 'نسخة auto قديمة — الاحتفاظ بآخر', keep);
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const cfg = readSchedule();
    const now = new Date();
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const today = now.toDateString();
    if (!cfg.enabled || cfg.hour !== hm || lastRunDay === today) return;
    lastRunDay = today;
    const keep = Number(cfg.keep) || 7;
    const { dir, file } = await createAutoBackup();
    pruneAuto(keep);
    console.log(`[BK-SCHEDULE] نسخة احتياطية تلقائية ✓ ${path.join(dir, file)}`);
  } catch (e) {
    console.error('[BK-SCHEDULE] خطأ النسخ التلقائي:', e.message);
  } finally {
    ticking = false;
  }
}

function startBackupSchedule() {
  setInterval(() => { tick().catch(() => {}); }, 60000).unref();
  console.log('[BK-SCHEDULE] النسخ الاحتياطي المجدول بدأ (يفحص كل دقيقة — الإعداد من لوحة النسخ الاحتياطي)');
}

module.exports = { startBackupSchedule, readSchedule, writeSchedule, schedulePath, createAutoBackup };
