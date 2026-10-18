// auto-update.service.js (v2.25.0) — ⏰ تحديث تلقائي مجدول اختياري: بعد تفعيله من
// اللوحة، يُكتب ملف طلب تحديث (tag=latest) عند تطابق الساعة مرة يوميًا — والتنفيذ
// عبر مسار الجذر المجرَّب (nm-update) نفسه كزر «تحديث الآن»؛ وقفل التزامن
// (recentActiveUpdate) يمنع التداخل مع أي عملية قائمة.
// الإعدادات: <dataDir>/auto-update.json — { enabled:bool, hour:'HH:MM' }
// الافتراضي: معطّل تمامًا — لا شيء يحدث دون إذن صريح من المدير.
const fs = require('fs');
const path = require('path');

let lastRunDay = '';

function dataDir() {
  return path.dirname(path.resolve(process.cwd(), process.env.DB_PATH || '../database/monitoring.db'));
}
function settingsPath() { return path.join(dataDir(), 'auto-update.json'); }
function readSchedule() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); }
  catch (e) { return { enabled: false, hour: '03:30' }; }
}
function writeSchedule(cfg) {
  fs.writeFileSync(settingsPath(), JSON.stringify({ enabled: !!cfg.enabled, hour: String(cfg.hour || '03:30') }, null, 2));
}

function isAppliance() {
  try { return fs.existsSync(process.env.APPLIANCE_HELPER_PATH || '/usr/local/sbin/nm-update'); } catch (e) { return false; }
}

// runIfDue(): فحص الدقيقة — يُعاد استخدامه للاختبار.
async function runIfDue() {
  const cfg = readSchedule();
  if (!cfg.enabled || !isAppliance()) { lastRunDay = ''; return null; }
  const now = new Date();
  const hm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const today = now.toDateString();
  if (hm !== String(cfg.hour || '03:30') || lastRunDay === today) return null;

  // قفل التزامن: عملية تحديث قائمة حديثًا (أي مسار) ⇒ لا نُطلق ثانيًا ونحاول غدًا.
  let guard = null;
  try {
    const routes = require('../routes/appliance-update.routes');
    guard = typeof routes.recentActiveUpdate === 'function' ? routes.recentActiveUpdate() : null;
  } catch (e) { guard = null; }
  lastRunDay = today;
  if (guard) {
    console.log('[auto-update] تحديث جارٍ بالفعل — تأجيل الجدولة إلى الغد');
    return null;
  }

  const base = dataDir();
  const reqFile = path.join(base, 'update-request.json');
  try { fs.unlinkSync(reqFile); } catch (e) { /* لا يوجد ملف سابق */ }
  fs.writeFileSync(reqFile, JSON.stringify({ tag: 'latest', requestedAt: new Date().toISOString(), via: 'auto-schedule' }) + '\n', 'utf8');
  console.log('[auto-update] طلب تحديث تلقائي كُتب (latest) — nm-update سيتولى الباقي');
  return true;
}

function startAutoUpdate() {
  setInterval(() => { runIfDue().catch(() => {}); }, 60000).unref();
  setTimeout(() => { runIfDue().catch(() => {}); }, 20000).unref();
}

module.exports = { startAutoUpdate, runIfDue, readSchedule, writeSchedule };
