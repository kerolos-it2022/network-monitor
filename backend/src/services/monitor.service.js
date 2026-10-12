// monitor.service.js: محرك المراقبة — جدولة فحص دوري كل 10 ثوانٍ، عدّاد فشل متتالٍ، تحديث الحالة، فتح/إغلاق أحداث الانقطاع، وإطلاق الإشعارات.
const cron = require('node-cron');
const db = require('../db');
const { checkPing, checkPort, checkHttp, checkHttps, checkAllProtocols } = require('./checkers');
const downtimeService = require('./downtime.service');
const notifier = require('./notifier.service');
// v2.8.7 — ناقل البثّ الحيّ (SSE): يُبثّ تغيّر حالة أي جهاز لحظيًا لشاشات العرض (NOC/العامة).
const live = require('./live.service');

// عدّاد فشل متتالٍ لكل جهاز (device_id → عدد).
const consecutiveFailures = new Map();
// آخر وقت تم فيه فحص الجهاز فعلياً (device_id → ms timestamp).
const lastCheckTime = new Map();

// ═══ v2.11.9 — مراقب المحرك (Engine Watchdog) ═══
// نبضة الدورة: وقت انتهاء آخر دورة فحص (ms). تُسجَّل دائمًا — حتى لو فشلت الدورة نفسها
// (فشل دورة ≠ موت المحرك؛ موت المحرك = توقّف الدورات نفسها).
let lastTickAt = null;
// عدد الأجهزة النشطة في آخر دورة (للعرض في /api/health).
let lastActiveCount = 0;
// حلقة الحراسة: تُنشأ مرة واحدة مع startMonitoring.
let watchdogTimer = null;
// حالة الحراسة (لمنع تكرار إشعارات التعطّل): 'ok' | 'stalled'.
let watchdogState = 'ok';
// الفحوصات الجارية الآن — لاكتشاف الفحوصات العالقة (Promise لا ينتهي أبدًا).
const inflightChecks = new Set();
// حارس التداخل: دورة جديدة لا تبدأ أثناء دورة سابقة لم تنته.
let tickRunning = false;

// استعلام جلب الأجهزة النشطة مع أسماء النوع والموقع.
const ACTIVE_DEVICES_SQL = `
  SELECT
    d.id, d.name, d.ip, d.device_type_id,
    dt.name AS device_type_name,
    d.location_id,
    l.name AS location_name,
    d.check_interval_seconds, d.failure_threshold,
    d.current_status, d.port
  FROM devices d
  LEFT JOIN device_types dt ON dt.id = d.device_type_id
  LEFT JOIN locations l ON l.id = d.location_id
  WHERE d.is_active = 1
`;

// checkDevice(device): تنفذ فحصاً واحداً للجهاز وتطبق منطق الحالة الكامل.
// يتم فحص جميع البروتوكولات (Ping, HTTP, HTTPS) لكل جهاز تلقائياً.
// إذا كان للجهاز منفذ مخصص (port)، يتم فحصه أيضاً.
// الجهاز "متصل" إذا نجح أي فحص.
async function checkDevice(device) {
  const nowIso = new Date().toISOString();

  // 1) تنفيذ فحص جميع البروتوكولات بالتوازي لكل جهاز
  const allResults = await checkAllProtocols(device.ip);

  // إذا كان للجهاز منفذ مخصص (port)، نضيف فحص المنفذ
  let portResult = { isOnline: false, responseTimeMs: null };
  if (device.port) {
    portResult = await checkPort(device.ip, device.port);
  }

  // الجهاز متصل إذا نجح أي فحص (ping أو http أو https أو port المخصص)
  const isOnline = allResults.isOnline || portResult.isOnline;

  // وقت الاستجابة = أقل وقت استجابة بين الفحوصات الناجحة
  let responseTimeMs = null;
  if (isOnline) {
    const times = [];
    if (allResults.protocols.ping.isOnline) times.push(allResults.protocols.ping.responseTimeMs);
    if (allResults.protocols.http.isOnline) times.push(allResults.protocols.http.responseTimeMs);
    if (allResults.protocols.https.isOnline) times.push(allResults.protocols.https.responseTimeMs);
    if (portResult.isOnline) times.push(portResult.responseTimeMs);
    responseTimeMs = times.length > 0 ? Math.min(...times.filter(t => t !== null)) : null;
  }

  // 2) تسجيل نتيجة الفحص دائماً (نخزن الحالة العامة).
  db.prepare(
    `INSERT INTO status_logs (device_id, status, response_time_ms, checked_at)
     VALUES (?, ?, ?, ?)`
  ).run(device.id, isOnline ? 'online' : 'offline', responseTimeMs, nowIso);

  if (isOnline) {
    consecutiveFailures.set(device.id, 0);
    if (device.current_status !== 'online') {
      const durationSeconds = downtimeService.closeDowntimeEvent(device.id);
      if (device.current_status === 'offline') {
        try {
          await notifier.notifyDeviceRecovered(device, durationSeconds);
        } catch (e) {
          console.error('[notify recovered]', e);
        }
      }
      console.log(`[RECOVERED] device ${device.id}`);
    }
    db.prepare(
      `UPDATE devices SET current_status='online', last_response_time_ms=?, 
       http_accessible=?, https_accessible=?, last_checked_at=? WHERE id=?`
    ).run(
      responseTimeMs, 
      allResults.protocols.http.isOnline ? 1 : 0,
      allResults.protocols.https.isOnline ? 1 : 0,
      nowIso, 
      device.id
    );
    live.scheduleRefresh();   // v2.8.7 — بثّ فوري لتغيّر الحالة (عاد / استقرّ).
  } else {
    const failCount = (consecutiveFailures.get(device.id) || 0) + 1;
    consecutiveFailures.set(device.id, failCount);

    if (failCount >= device.failure_threshold) {
      if (device.current_status !== 'offline') {
        downtimeService.openDowntimeEvent(device.id);
        console.log(`[DOWN] device ${device.id}`);
        try {
          await notifier.notifyDeviceDown(device);
        } catch (e) {
          console.error('[notify down]', e);
        }
      }
      db.prepare(
        `UPDATE devices SET current_status='offline', last_response_time_ms=NULL, 
         http_accessible=?, https_accessible=?, last_checked_at=? WHERE id=?`
      ).run(
        allResults.protocols.http.isOnline ? 1 : 0,
        allResults.protocols.https.isOnline ? 1 : 0,
        nowIso, 
        device.id
      );
      live.scheduleRefresh();   // v2.8.7 — بثّ فوري لتغيّر الحالة (انقطع).
    } else {
      // لم يصل الحد بعد — فقط تحديث وقت آخر فحص دون تغيير current_status.
      db.prepare('UPDATE devices SET last_checked_at=?, http_accessible=?, https_accessible=? WHERE id=?').run(
        nowIso,
        allResults.protocols.http.isOnline ? 1 : 0,
        allResults.protocols.https.isOnline ? 1 : 0,
        device.id
      );
    }
  }
}

// startMonitoring(): جدولة فحص كل 10 ثوانٍ، تمر على كل الأجهزة النشطة وتختبر من حان وقته.
function startMonitoring() {
  cron.schedule('*/10 * * * * *', () => {
    // v2.11.9 — حارس التداخل: نرفض دورة جديدة أثناء تعليق دورة سابقة (DB مقفولة/IO بطيء).
    if (tickRunning) {
      console.warn('[engine] tick skipped — previous tick still running');
      return;
    }
    tickRunning = true;
    try {
      const devices = db.prepare(ACTIVE_DEVICES_SQL).all();
      lastActiveCount = devices.length;
      const now = Date.now();
      for (const device of devices) {
        const last = lastCheckTime.get(device.id) || 0;
        if (now - last >= device.check_interval_seconds * 1000) {
          lastCheckTime.set(device.id, now);
          // v2.11.9 — تتبّع الفحص الجاري (لاكتشاف العالق منه في حلقة الحراسة).
          const entry = { deviceId: device.id, deviceName: device.name, startedAt: Date.now() };
          inflightChecks.add(entry);
          checkDevice(device)
            .catch((e) => console.error('checkDevice error', e))
            .finally(() => inflightChecks.delete(entry));
        }
      }
      // v2.8.7 — شبكة أمان: تحديث الحالة الحيّة مرة كل دورة (لو تغيّر شيء خارج مسار الفحص).
      live.scheduleRefresh();
    } catch (e) {
      console.error('monitoring tick error', e);
    } finally {
      // v2.11.9 — النبضة: تُسجَّل في كل الأحوال (نجاح أو فشل الدورة).
      lastTickAt = Date.now();
      tickRunning = false;
    }
  });
  console.log('Monitoring engine started (every 10s tick).');
  // v2.11.9 — تشغيل حلقة حراسة المحرك (نبضة متوقفة/فحوصات عالقة → تحذير تلجرام).
  startWatchdog();

  // v2.7.x — مَسح آلِي يَوْمِي لِـ status_logs (الجَدول الَّذِي يَنمو بِـ ~354 أَلْف صَف/يَوم).
  // الاحتفاظ بِـ آخر STATUS_LOGS_RETENTION_DAYS أَيام (افتراضِيّاً 7) لِـ الرسوم البيانية/Uptime.
  // يَعمل عِند 03:00 مَحلِيّاً يَوْمياً. busy_timeout=5000 (db.js) يَتَكَفَّل تَزاحُم كِتاَبٍ وَراء كَوال
  // مَع cron الـ 10 ثَوانٍ. لَا يُشَغِّل VACUUM (ضَرُورِي بِشَكْل يَوْمِي فَقَط عِند تَفْرِيغ الكُلّ).
  cron.schedule('0 3 * * *', () => {
    try {
      const retentionDays = parseInt(process.env.STATUS_LOGS_RETENTION_DAYS, 10) || 7;
      const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
      const info = db.prepare('DELETE FROM status_logs WHERE checked_at < ?').run(cutoff);
      console.log(`[auto-cleanup] status_logs: deleted ${info.changes} rows older than ${retentionDays} day(s) (cutoff ${cutoff}).`);
    } catch (e) {
      console.error('[auto-cleanup] status_logs cleanup error:', e);
    }
  });
  console.log('Daily status_logs auto-cleanup scheduled (03:00 local, retention = ' + (parseInt(process.env.STATUS_LOGS_RETENTION_DAYS, 10) || 7) + ' days).');
}

// ═══ v2.11.9 — صحّة المحرك (Engine Health) + حلقة الحراسة ═══
// دالة نقية قابلة للاختبار بلا DB/زمن حقيقي: تُقيّم النبضة + الفحوصات العالقة.
function evaluateEngineHealth(snap, now, cfg) {
  const tickAgeMs = snap.lastTickAt == null ? null : (now - snap.lastTickAt);
  const notStarted = snap.lastTickAt == null;
  const stalled = !notStarted && tickAgeMs > cfg.stallMs;
  const stuck = (snap.inflight || []).filter((c) => (now - c.startedAt) > cfg.checkStuckMs);
  return {
    lastTickAt: snap.lastTickAt,
    lastTickAgeMs: tickAgeMs,
    notStarted,
    stalled,
    stuckChecks: stuck.length,
    stuckDevices: stuck.slice(0, 5).map((c) => c.deviceName || c.deviceId),
    inflightChecks: (snap.inflight || []).length,
    activeDevices: snap.activeDevices || 0,
  };
}

function engineConfig() {
  return {
    stallMs: parseInt(process.env.NM_ENGINE_STALL_MS, 10) || 90000,
    checkStuckMs: parseInt(process.env.NM_CHECK_STUCK_MS, 10) || 180000,
  };
}

// لقطة صحّة حالية — تُخدَم عبر /api/health وتُستعمل في حلقة الحراسة.
function getEngineHealth() {
  return evaluateEngineHealth(
    { lastTickAt, activeDevices: lastActiveCount, inflight: [...inflightChecks] },
    Date.now(),
    engineConfig()
  );
}

// حلقة الحراسة: كل 30 ثانية. عند انتقال سليم→متعطّل تُرسَل رسالة تلجرام واحدة،
// وعند العودة رسالة عودة — بلا تكرار أثناء نفس الحالة (منع الإزعاج).
function startWatchdog() {
  if (watchdogTimer) return;
  const everyMs = parseInt(process.env.NM_WATCHDOG_INTERVAL_MS, 10) || 30000;
  watchdogTimer = setInterval(async () => {
    try {
      const h = getEngineHealth();
      const stalledReason = h.stalled
        ? `لا نبضة من محرك الفحص منذ ${Math.round((h.lastTickAgeMs || 0) / 1000)} ثانية`
        : null;
      const stuckReason = h.stuckChecks > 0
        ? `${h.stuckChecks} فحص عالق منذ أكثر من ${Math.round(engineConfig().checkStuckMs / 1000)} ثانية (${h.stuckDevices.join('، ')})`
        : null;
      const reason = stalledReason || stuckReason;
      if (reason && watchdogState !== 'stalled') {
        watchdogState = 'stalled';
        console.error('[WATCHDOG] محرك المراقبة متعطل —', reason);
        try {
          await notifier.sendTelegram(
            '⚠️ تحذير: محرك المراقبة متعطل!\n' + reason +
            '\nالبيانات المعروضة قد تكون قديمة — راجع حالة الجهاز.'
          );
        } catch (e) { /* فشل الإرسال لا يكسر الحراسة */ }
      } else if (!reason && watchdogState === 'stalled') {
        watchdogState = 'ok';
        console.log('[WATCHDOG] عاد محرك المراقبة للعمل طبيعيًا');
        try { await notifier.sendTelegram('✅ عاد محرك المراقبة للعمل طبيعيًا.'); } catch (e) { /* تجاهل */ }
      }
    } catch (e) {
      console.error('[WATCHDOG] error:', e.message);
    }
  }, everyMs);
  if (watchdogTimer.unref) watchdogTimer.unref();
}

module.exports = { startMonitoring, getEngineHealth, evaluateEngineHealth };