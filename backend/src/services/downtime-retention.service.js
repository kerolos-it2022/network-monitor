// downtime-retention.service.js (v2.26.0) — 🧹 تنظيف تلقائي لسجل الانقطاعات:
// كل يوم 03:10 (بعد تنظيف status_logs له 03:00) تُحذف الانقطاعات الأقدم من
// DOWNTIME_RETENTION_DAYS (افتراضي 90 يومًا) — **بعد أرشفتها CSV** في
// <dataDir>/archive/downtime-YYYYMM.csv (حسب شهر started_at، مع BOM UTF-8
// ورؤوس عربية مطابقة لتصدير الانقطاعات) حتى لا يفقد الأدمن أي تاريخ.
// لا إعدادات واجهة — قيمة الأيام عبر متغير البيئة لو احتاج تغييرها.
const fs = require('fs');
const path = require('path');
const db = require('../db');
// TZ-01 — ساعة التنظيف (03:10) تُقارَن بوقت الحائط في منطقة اللوحة (notification_settings.timezone)
// لا بتوقيت الخادم؛ NULL = توقيت الخادم المحلي كما كان بالحرف.
const schedulerTime = require('./scheduler-time.service');

const RETENTION_DAYS = Math.max(7, Number(process.env.DOWNTIME_RETENTION_DAYS) || 90);
let lastRunDay = '';

// csvEscapeCell(cell): اقتباس خلية CSV (نمط تصدير الانقطاعات: اقتباس دائم + مضاعفة الاقتباس).
function csvEscapeCell(v) {
  const s = String(v == null ? '' : v);
  return '"' + s.replace(/"/g, '""') + '"';
}

function archiveCsv(outPath, rows) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const header = '\uFEFFاسم الجهاز,IP,بداية الانقطاع,نهاية الانقطاع,المدة\n';
  let firstWrite = !fs.existsSync(outPath);
  const fh = fs.openSync(outPath, 'a');
  try {
    if (firstWrite) fs.writeSync(fh, header);
    for (const r of rows) {
      const line = [r.name, r.ip, r.started_at, r.ended_at,
        (r.duration_seconds ? Math.round(r.duration_seconds / 60) + ' دقيقة' : 'مستمر')]
        .map(csvEscapeCell).join(',') + '\n';
      fs.writeSync(fh, line);
    }
  } finally {
    fs.closeSync(fh);
  }
}

// runRetention(): تُعاد للاختبار — تعيد عدد المحذوف أو 0.
function runRetention() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString();
  const old = db.prepare(`
    SELECT de.id, de.started_at, de.ended_at, de.duration_seconds,
           d.name AS name, d.ip AS ip
    FROM downtime_events de
    LEFT JOIN devices d ON d.id = de.device_id
    WHERE de.started_at < ?
    ORDER BY de.started_at ASC
  `).all(cutoff);
  if (old.length === 0) return 0;

  // أرشفة بحسب شهر البداية (ملف لكل شهر — لا يتضخم ملف واحد).
  const archiveDir = path.join(path.resolve(process.cwd(), process.env.DB_PATH || '../database/monitoring.db'), '..', 'archive');
  const byMonth = {};
  for (const r of old) {
    const ym = String(r.started_at).slice(0, 7) || 'unknown';
    (byMonth[ym] = byMonth[ym] || []).push(r);
  }
  for (const [ym, rows] of Object.entries(byMonth)) {
    archiveCsv(path.join(archiveDir, 'downtime-' + ym + '.csv'), rows);
  }

  const ids = old.map((r) => r.id);
  const del = db.prepare('DELETE FROM downtime_events WHERE id IN (' + ids.map(() => '?').join(',') + ')').run(...ids);
  console.log('[downtime-retention] أُرشفت وحُذفت ' + del.changes + ' انقطاعًا أقدم من ' + RETENTION_DAYS + ' يومًا → ' + archiveDir);
  return del.changes;
}

function startDowntimeRetention() {
  setInterval(() => {
    const wc = schedulerTime.wallClockIn(schedulerTime.schedulerTimezone());
    const hm = wc.hm;
    const today = wc.dayKey;
    if (hm !== '03:10' || lastRunDay === today) return;
    lastRunDay = today;
    try { runRetention(); } catch (e) {
      console.error('[downtime-retention] فشل التنظيف:', e.message);
    }
  }, 60000).unref();
  // أول فحص بعد 30 ثانية (يعالج التراكم فور الإقلاع إن حُدث).
  setTimeout(() => { try { runRetention(); } catch (e) {} }, 30000).unref();
}

module.exports = { startDowntimeRetention, runRetention, RETENTION_DAYS };
