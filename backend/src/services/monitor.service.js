// monitor.service.js: محرك المراقبة — جدولة فحص دوري كل 10 ثوانٍ، عدّاد فشل متتالٍ، تحديث الحالة، فتح/إغلاق أحداث الانقطاع، وإطلاق الإشعارات.
const cron = require('node-cron');
const db = require('../db');
const { checkPing, checkPort, checkHttp, checkHttps } = require('./checkers');
// MON-01 (SpaceKit Phase 1) — حالات المراقبة كدوال نقية (online/offline/unknown + الاستمرارية).
const { decideHostTransition, isStale } = require('./health-state.service');
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
// PERF/MON-01 — إحصاءات آخر دورة فحص (تُعرَض في /api/health: تأجيل/تخطٍّ/قديم).
let lastTickStats = null;
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
    d.current_status, d.port, d.web_port,
    d.check_protocol,
    d.host_status, d.overall_health, d.last_checked_at
  FROM devices d
  LEFT JOIN device_types dt ON dt.id = d.device_type_id
  LEFT JOIN locations l ON l.id = d.location_id
  WHERE d.is_active = 1
`;

// ═══════════════════════════════════════════════════════════════════════════
// MON-01 (SpaceKit Phase 1) — الفحص الأساسي يُحترم كما هو مُعرَّف في الجهاز:
//   • check_protocol = 'ping'  ⇒ ICMP هو الفيصل في حالة المضيف.
//   • check_protocol = 'port'  ⇒ نجاح/فشل TCP على المنفذ المخصّص هو الفيصل
//     (لا معنى لقول «متصل» لأن Ping نجح بينما الخدمة المفحوصة مغلقة).
//   • 'http' / 'https'        ⇒ فحص الويب (بمنفذ الجهاز المخصّص أو web_port أو الافتراضي).
// فحوصات اكتشاف واجهات الويب (HTTP/HTTPS على 80/443) تبقى **لاكتشاف** http_accessible/
// https_accessible في الواجهة فقط — ولا تغيّر الحالة أبدًا (مواصفة MON: «الاكتشاف لا يعلو
// على حالة الفحص الأساسي»). سجلّ الحالة (status_logs) يُكتب للحالات المعلومة فقط؛
// الفترات المجهولة تُترك فجوات صريحة (تُعالج في HIST-01 بدلالة تغطية).
// ═══════════════════════════════════════════════════════════════════════════

// الفحوصات الافتراضية — قابلة للاستبدال (اختبارات/محاكاة) عبر تمرير probes.
const DEFAULT_PROBES = { ping: checkPing, port: checkPort, http: checkHttp, https: checkHttps };

// حارسان للموثوقية: فحص واحد فقط لكل جهاز في نفس اللحظة + تجاهل النتائج المتأخرة.
const inflightDevices = new Set();     // device_id → فحص قيد التنفيذ الآن
const deviceGeneration = new Map();    // device_id → رقم الجيل (نتيجة قديمة = تُهمَل)

// حد التزامن العام (PERF): لا نطلق فحوصات أكثر من هذا العدد في أي لحظة.
function maxConcurrentChecks() {
  return Math.max(1, parseInt(process.env.NM_MAX_CONCURRENT_CHECKS, 10) || 10);
}
let activeChecks = 0;

// تشغيل الفحص الأساسي وفق البروتوكول المختار للجهاز.
async function probePrimary(device, probes) {
  const proto = String(device.check_protocol || 'ping').toLowerCase();
  if (proto === 'port') {
    const r = await probes.port(device.ip, device.port);
    return { ok: !!r.isOnline, responseTimeMs: r.responseTimeMs, protocol: 'port' };
  }
  if (proto === 'http') {
    const r = await probes.http(device.ip, device.port || device.web_port || 80);
    return { ok: !!r.isOnline, responseTimeMs: r.responseTimeMs, protocol: 'http' };
  }
  if (proto === 'https') {
    const r = await probes.https(device.ip, device.port || device.web_port || 443);
    return { ok: !!r.isOnline, responseTimeMs: r.responseTimeMs, protocol: 'https' };
  }
  const r = await probes.ping(device.ip);
  return { ok: !!r.isOnline, responseTimeMs: r.responseTimeMs, protocol: 'ping' };
}

// checkDevice(device, opts): فحص واحد للجهاز يطبّق منطق الحالة الكامل للمضيف.
// opts.probes يُستخدم في الاختبارات/المحاكاة بدل الفحوصات الحقيقية.
// يُرجع { hostStatus, event, skipped? } — وskipped=true عند تجاوز الفحص (inflight/stale/حد التزامن).
async function checkDevice(device, opts = {}) {
  const probes = opts.probes || DEFAULT_PROBES;

  // فحص جارٍ لنفس الجهاز ⇒ لا نكرّره (يمنع تداخل الفحوصات ويحمي من الكتابات المتأخرة).
  if (inflightDevices.has(device.id)) return { skipped: true, reason: 'inflight' };

  inflightDevices.add(device.id);
  activeChecks += 1;
  const gen = (deviceGeneration.get(device.id) || 0) + 1;
  deviceGeneration.set(device.id, gen);

  const nowIso = new Date().toISOString();
  const threshold = Math.max(1, Number(device.failure_threshold) || 2);

  try {
    const primary = await probePrimary(device, probes);

    // نتيجة من جيل قديم (أُطلق فحص أحدث) ⇒ تُهمَل ولا تكتب فوق الأحدث.
    if (deviceGeneration.get(device.id) !== gen) return { skipped: true, reason: 'stale' };

    // اكتشاف واجهات الويب (لا يؤثر في الحالة) — للأجهزة المفحوصة بـ Ping فقط.
    let httpFlag = null;
    let httpsFlag = null;
    if (primary.protocol === 'ping') {
      const [h, hs] = await Promise.all([
        Promise.resolve(probes.http(device.ip, 80)).catch(() => ({ isOnline: false })),
        Promise.resolve(probes.https(device.ip, 443)).catch(() => ({ isOnline: false })),
      ]);
      if (deviceGeneration.get(device.id) !== gen) return { skipped: true, reason: 'stale' };
      httpFlag = h && h.isOnline ? 1 : 0;
      httpsFlag = hs && hs.isOnline ? 1 : 0;
    }

    // الحالة السابقة تُقرأ **من القاعدة** لا من الكائن المارَّر: قد يكون الكائن لقطة قديمة
    // (دورة سابقة) فيؤدي لقرار خاطئ (مثال: نسيان «عودة» لأن الكائن ما زال unknown).
    const fresh = db.prepare('SELECT host_status, current_status FROM devices WHERE id = ?').get(device.id);
    const prevHost = (fresh && (fresh.host_status || fresh.current_status)) || device.host_status || device.current_status || 'unknown';
    const transition = decideHostTransition({
      hostStatus: prevHost,
      consecutiveFailures: consecutiveFailures.get(device.id) || 0,
      failureThreshold: threshold,
      probeOk: primary.ok,
    });
    consecutiveFailures.set(device.id, transition.consecutiveFailures);

    // سجل الحالة: online/offline فقط (الحالات المجهولة تُترك فجوة صريحة بلا قيمة مضلِّلة).
    if (transition.hostStatus !== 'unknown') {
      db.prepare(
        `INSERT INTO status_logs (device_id, status, response_time_ms, checked_at)
         VALUES (?, ?, ?, ?)`
      ).run(
        device.id,
        transition.hostStatus === 'offline' ? 'offline' : 'online',
        primary.ok ? primary.responseTimeMs : null,
        nowIso
      );
    }

    if (transition.event === 'down') {
      downtimeService.openDowntimeEvent(device.id);
      console.log(`[DOWN] device ${device.id} (primary=${primary.protocol})`);
      try {
        await notifier.notifyDeviceDown(device);
      } catch (e) {
        console.error('[notify down]', e);
      }
    } else if (transition.event === 'recovered') {
      const durationSeconds = downtimeService.closeDowntimeEvent(device.id);
      console.log(`[RECOVERED] device ${device.id} (primary=${primary.protocol})`);
      try {
        await notifier.notifyDeviceRecovered(device, durationSeconds);
      } catch (e) {
        console.error('[notify recovered]', e);
      }
    }

    const stateChanged = prevHost !== transition.hostStatus ? 1 : 0;
    db.prepare(
      `UPDATE devices SET
         current_status = ?,              -- توافق خلفي: مرآةٌ لحالة المضيف
         host_status = ?,
         last_response_time_ms = ?,
         http_accessible = COALESCE(?, http_accessible),
         https_accessible = COALESCE(?, https_accessible),
         last_checked_at = ?,
         last_probe_protocol = ?,
         host_last_ok_at = CASE WHEN ? = 1 THEN ? ELSE host_last_ok_at END,
         host_state_changed_at = CASE WHEN ? = 1 THEN ? ELSE host_state_changed_at END
       WHERE id = ?`
    ).run(
      transition.hostStatus,
      transition.hostStatus,
      primary.ok ? primary.responseTimeMs : null,
      httpFlag,
      httpsFlag,
      nowIso,
      primary.protocol,
      primary.ok ? 1 : 0, nowIso,
      stateChanged, nowIso,
      device.id
    );

    // MON-02 — الحالة العامة = مضيف + خدمات (مصدر واحد للحقيقة، يمنع الأخضر الكاذب).
    require('./monitored-services.service').recomputeOverallHealth(device.id);
    live.scheduleRefresh();   // v2.8.7 — بثّ فوري لتغيّر الحالة.
    return { hostStatus: transition.hostStatus, event: transition.event, protocol: primary.protocol };
  } finally {
    inflightDevices.delete(device.id);
    activeChecks -= 1;
  }
}

// مسح البيانات القديمة (MON-01): جهاز توقّف وصول فحوصه (أوقف/تعطّل مجدول) ⇒ حالته unknown
// بدل عرض حالة قديمة مضلِّلة. يُنفَّذ داخل دورة الفحص (خفيف: مقارنة زمنية فقط).
function sweepStaleDevices(devices, nowMs = Date.now()) {
  const factor = Math.max(2, parseInt(process.env.NM_STALE_FACTOR, 10) || 3);
  let changed = 0;
  const upd = db.prepare(
    `UPDATE devices SET host_status = 'unknown', current_status = 'unknown',
       overall_health = 'unknown', host_state_changed_at = ?
     WHERE id = ?`
  );
  for (const d of devices) {
    const known = (d.host_status || d.current_status) !== 'unknown';
    if (!known) continue;
    if (isStale(d.last_checked_at, d.check_interval_seconds, nowMs, factor)) {
      upd.run(new Date(nowMs).toISOString(), d.id);
      changed += 1;
    }
  }
  if (changed) live.scheduleRefresh();
  return changed;
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

      // MON-01 — مسح البيانات القديمة: جهاز توقّفت فحوصه ⇒ unknown بدل حالة قديمة مضلِّلة.
      const staleMarked = sweepStaleDevices(devices, now);

      // PERF — التزامن المحدود: لا نُطلق أكثر من الحد في اللحظة نفسها؛ الزائد يُؤجَّل للدورة القادمة.
      const cap = maxConcurrentChecks();
      let due = 0;
      let started = 0;
      let inflightSkipped = 0;
      let deferredConcurrency = 0;
      for (const device of devices) {
        const last = lastCheckTime.get(device.id) || 0;
        if (now - last < device.check_interval_seconds * 1000) continue;
        due += 1;
        if (activeChecks >= cap) { deferredConcurrency += 1; continue; }
        if (inflightDevices.has(device.id)) { inflightSkipped += 1; continue; }
        lastCheckTime.set(device.id, now);
        started += 1;
        // v2.11.9 — تتبّع الفحص الجاري (لاكتشاف العالق منه في حلقة الحراسة).
        const entry = { deviceId: device.id, deviceName: device.name, startedAt: Date.now() };
        inflightChecks.add(entry);
        checkDevice(device)
          .catch((e) => console.error('checkDevice error', e))
          .finally(() => inflightChecks.delete(entry));
      }
      // MON-02 — الخدمات المراقَبة: لكل خدمة فاصلها الخاص (لا تتبع دورة الـ 10 ثوانٍ).
      let servicesStats = null;
      try {
        servicesStats = require('./monitored-services.service').checkDueServices({ notifier });
      } catch (e) {
        console.error('[services] dispatch error:', e.message);
      }
      lastTickStats = { due, started, inflightSkipped, deferredConcurrency, staleMarked, maxConcurrent: cap, services: servicesStats };
      // v2.8.7 — شبكة أمان: تحديث الحالة الحيّة مرة كل دورة (لو تغير شيء خارج مسار الفحص).
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

  // ═══ HIST-02 — تجميعات ساعية/يومية **قبل** التقليم (وإلا فُقد ما لم يُجمَّع) ═══
  // كل ساعة (دقيقة 5): تحديث دلاء آخر 3 ساعات (رخيص).
  cron.schedule('5 * * * *', () => {
    try {
      const r = require('./rollup.service').runRollupMaintenance({ hoursBack: 3, daysBack: 2 });
      console.log(`[rollup] hourly: hourBuckets=${r.hours} dayBuckets=${r.days} deletedOld=${r.deletedOld}`);
    } catch (e) {
      console.error('[rollup] hourly error:', e.message);
    }
  });
  // يوميًّا 02:50 (قبل تقليم السجلات 03:00): بناء الدلاء + حذف الأقدم من مدة الاحتفاظ (90 يومًا).
  cron.schedule('50 2 * * *', () => {
    try {
      const r = require('./rollup.service').runRollupMaintenance();
      console.log(`[rollup] daily: hourBuckets=${r.hours} dayBuckets=${r.days} deletedOld=${r.deletedOld} retention=${r.retentionDays}d`);
    } catch (e) {
      console.error('[rollup] daily error:', e.message);
    }
  });
  console.log('Rollup maintenance scheduled (hourly @:05 · daily 02:50 before raw-log cleanup).');

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
    // PERF — إحصاءات آخر دورة: كم فحصًا استحق، وكم بدأ، وكم أُجّل/تُخطّي، وكم جهازًا صار unknown.
    tickStats: snap.tickStats || null,
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
    { lastTickAt, activeDevices: lastActiveCount, inflight: [...inflightChecks], tickStats: lastTickStats },
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

module.exports = {
  startMonitoring,
  getEngineHealth,
  evaluateEngineHealth,
  // MON-01 — للاختبارات والاستخدام الداخلي (فحص جهاز واحد بفحوصات قابلة للاستبدال).
  checkDevice,
  probePrimary,
};