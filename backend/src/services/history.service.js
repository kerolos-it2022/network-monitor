// history.service.js (SpaceKit HIST-01) — سجل الجهاز بحساب **زمني** حقيقي مع تغطية.
// ═══════════════════════════════════════════════════════════════════════════
// القاعدة (المواصفة): لا نحوّل البيانات الناقصة إلى 0% ولا إلى 100%.
//   • كل عيّنة (status_logs) تمثّل حالتها حتى العيّنة التالية، وبحدٍّ أقصى = TTL
//     (3× فترة فحص الجهاز افتراضيًّا) — ما بعد TTL بلا دليل ⇒ unknown.
//   • أحداث الانقطاع (downtime_events) تُدمج كفترات offline موثوقة (تبقى بعد حذف العيّنات
//     الخام عبر سياسة الاحتفاظ 7 أيام، فتتحسّن تغطية نوافذ 30 يومًا).
//   • توافقية: تُعاد نفس حقول الحمولة القديمة (uptime_percentage/status_points/downtime_events).
//   • الجديد: window_start/end · coverage_percentage · known_seconds · data_quality
//     (complete|partial|insufficient) · calculation_method · unknown_seconds.
// الدوال النقية (mergeIntervals/computeAvailability) قابلة للاختبار مباشرة.
'use strict';
const db = require('../db');

const RANGE_HOURS = { '24h': 24, '7d': 168, '30d': 720 };
const CALCULATION_METHOD = 'time_weighted_v1';

// دمج فترات متقاطعة/متلاصقة ⇒ قائمة فترات موحّدة مرتّبة.
function mergeIntervals(intervals) {
  const list = (intervals || [])
    .filter((iv) => iv && iv.end > iv.start)
    .sort((a, b) => a.start - b.start);
  const out = [];
  for (const iv of list) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else out.push({ start: iv.start, end: iv.end });
  }
  return out;
}

function totalMs(intervals) {
  return intervals.reduce((acc, iv) => acc + (iv.end - iv.start), 0);
}

// قصّ فترات الدمج على نافذة، ثم إرجاع المجموع بالميلي ثانية.
function clippedTotalMs(intervals, windowStart, windowEnd) {
  const clipped = mergeIntervals(intervals).map((iv) => ({
    start: Math.max(iv.start, windowStart),
    end: Math.min(iv.end, windowEnd),
  }));
  return totalMs(mergeIntervals(clipped));
}

// computeAvailability: الحساب الزمني الكامل (نقي).
//   samples: [{ at: ms, status: 'online'|'offline' }] مرتّبة أو غير مرتّبة (نُرتّبها)
//   events : [{ started_at: ms, ended_at: ms|null }] (null = مستمر حتى الآن)
//   ttlMs  : أقصى مدة يُعتمد فيها على العيّنة قبل اعتبار الزمن مجهولًا
function computeAvailability({ windowStart, windowEnd, samples = [], events = [], ttlMs = 30000, nowMs = Date.now() }) {
  const start = Number(windowStart);
  const end = Number(windowEnd);
  const windowMs = Math.max(0, end - start);
  if (!(windowMs > 0)) {
    return {
      onlineMs: 0, offlineMs: 0, unknownMs: 0, knownMs: 0,
      availability: null, coveragePercentage: 0, dataQuality: 'insufficient',
      expectedSampleTtlMs: ttlMs,
    };
  }

  const ttl = Math.max(1000, Number(ttlMs) || 30000);
  const sorted = [...samples]
    .map((s) => ({ at: Number(s.at), status: s.status }))
    .filter((s) => Number.isFinite(s.at))
    .sort((a, b) => a.at - b.at);

  // 1) فترات من العيّنات: حالة العيّنة تسري حتى العيّنة التالية بحد أقصى TTL.
  const onlineFromSamples = [];
  const offlineFromSamples = [];
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    const nextAt = i + 1 < sorted.length ? sorted[i + 1].at : Math.min(nowMs, s.at + ttl);
    const from = s.at;
    const to = Math.min(s.at + ttl, nextAt);
    if (to > from) {
      (s.status === 'online' ? onlineFromSamples : offlineFromSamples).push({ start: from, end: to });
    }
  }

  // 2) فترات الانقطاع الموثّقة (أحداث حقيقية — تسبق أي استنتاج من العيّنات).
  const offlineFromEvents = (events || []).map((e) => ({
    start: Number(e.started_at),
    end: e.ended_at == null ? nowMs : Number(e.ended_at),
  })).filter((iv) => Number.isFinite(iv.start) && Number.isFinite(iv.end));

  const offlineMs = clippedTotalMs(offlineFromEvents.concat(offlineFromSamples), start, end);
  const onlineRawMs = clippedTotalMs(onlineFromSamples, start, end);
  // الانقطاع الموثّق يتقدّم: نطرح تقاطعه مع الأزمنة التي بدت «متصل» في العيّنات.
  const overlapMs = clippedTotalMs(
    mergeIntervals(offlineFromEvents).flatMap((off) =>
      mergeIntervals(onlineFromSamples)
        .filter((on) => on.start < off.end && on.end > off.start)
        .map((on) => ({ start: Math.max(on.start, off.start), end: Math.min(on.end, off.end) }))
    ),
    start, end
  );
  const onlineMs = Math.max(0, onlineRawMs - overlapMs);
  const knownMs = Math.min(windowMs, onlineMs + offlineMs);
  const unknownMs = Math.max(0, windowMs - knownMs);

  const availability = knownMs > 0 ? onlineMs / knownMs : null;
  return {
    onlineMs,
    offlineMs,
    unknownMs,
    knownMs,
    availability,                                   // 0..1 أو null عند انعدام الدليل
    coveragePercentage: (knownMs / windowMs) * 100,
    dataQuality: dataQualityFor({ windowMs, unknownMs, knownMs, ttlMs: ttl }),
    expectedSampleTtlMs: ttl,
  };
}

// تصنيف جودة البيانات: insufficient (بلا دليل) · complete (تغطية شبه كاملة) · partial.
function dataQualityFor({ windowMs, unknownMs, knownMs, ttlMs }) {
  if (knownMs <= 0) return 'insufficient';
  const tolerance = Math.max(2 * ttlMs, windowMs * 0.02);
  if (unknownMs <= tolerance) return 'complete';
  return 'partial';
}

// بيانات الجهاز + TTL (فترة الفحص × عامل القديم) — TTL لا يقل عن 30 ثانية.
function deviceTtlMs(device) {
  const factor = Math.max(2, parseInt(process.env.NM_STALE_FACTOR, 10) || 3);
  const intervalMs = Math.max(10, Number(device && device.check_interval_seconds) || 10) * 1000;
  return Math.max(30000, intervalMs * factor);
}

// getDeviceHistory(deviceId, rangeKey) ⇒ الحمولة الكاملة (قديمة + تغطية) أو null.
function getDeviceHistory(deviceId, rangeKey) {
  const device = db.prepare(
    'SELECT id, check_interval_seconds FROM devices WHERE id = ?'
  ).get(deviceId);
  if (!device) return null;

  const range = RANGE_HOURS[rangeKey] ? rangeKey : '24h';
  const hours = RANGE_HOURS[range];
  const nowMs = Date.now();
  const windowEnd = nowMs;
  const windowStart = nowMs - hours * 3600 * 1000;
  const startIso = new Date(windowStart).toISOString();
  const ttlMs = deviceTtlMs(device);

  // العيّنات: نضم عيّنة واحدة سبقت النافذة (لاستمرار الحالة عند حدّ البداية).
  const prevSample = db.prepare(
    `SELECT checked_at, status, response_time_ms FROM status_logs
      WHERE device_id = ? AND checked_at < ? ORDER BY checked_at DESC LIMIT 1`
  ).get(deviceId, startIso);
  const statusPoints = db.prepare(
    `SELECT checked_at, status, response_time_ms FROM status_logs
      WHERE device_id = ? AND checked_at >= ? AND checked_at <= ?
      ORDER BY checked_at ASC`
  ).all(deviceId, startIso, new Date(windowEnd).toISOString());
  const allSamples = (prevSample ? [prevSample, ...statusPoints] : statusPoints);

  // الأحداث: كل ما تقاطع مع النافذة — بما فيها ما بدأ قبلها وانتهى داخلها (T06).
  const events = db.prepare(
    `SELECT started_at, ended_at, duration_seconds FROM downtime_events
      WHERE device_id = ?
        AND (ended_at IS NULL OR ended_at >= ?)
        AND started_at <= ?
      ORDER BY started_at ASC`
  ).all(deviceId, startIso, new Date(windowEnd).toISOString());

  const calc = computeAvailability({
    windowStart,
    windowEnd,
    samples: allSamples.map((s) => ({ at: new Date(s.checked_at).getTime(), status: s.status })),
    events: events.map((e) => ({
      started_at: new Date(e.started_at).getTime(),
      ended_at: e.ended_at ? new Date(e.ended_at).getTime() : null,
    })),
    ttlMs,
    nowMs,
  });

  const downtimeEvents = events.map((e) => {
    let durationSeconds = e.duration_seconds;
    if (e.ended_at == null) {
      durationSeconds = Math.floor((nowMs - new Date(e.started_at).getTime()) / 1000);
      if (durationSeconds < 0) durationSeconds = 0;
    }
    return { started_at: e.started_at, ended_at: e.ended_at, duration_seconds: durationSeconds };
  });

  // ── HIST-02: دمج التجميعات (rollups) للفترة الأقدم من نطاق البيانات الخام (~7 أيام) ──
  // تُحسب التجميعات قبل تقليم السجلات الخام، فيبقى تقرير 30/90 يومًا ذا دلالة بتغطية صريحة.
  const firstInWindowMs = statusPoints.length ? new Date(statusPoints[0].checked_at).getTime() : windowEnd;
  const rollupBucket = hours > 8 * 24 ? 'day' : 'hour';   // نوافذ طويلة ⇒ دلاء يومية (نفس الدقة)
  let rollupOnlineMs = 0;
  let rollupOfflineMs = 0;
  let rollupUnknownMs = 0;
  let rollupBuckets = 0;
  try {
    // require متأخر لكسر دورة الاستيراد (rollup.service يستورد computeAvailability من هنا).
    const rollupSvc = require('./rollup.service');
    const cutoffMs = Math.min(firstInWindowMs, windowEnd);
    if (cutoffMs > windowStart) {
      for (const r of rollupSvc.getRollups(device.id, rollupBucket, windowStart, cutoffMs)) {
        const bStart = new Date(r.bucket_start).getTime();
        const bEnd = rollupSvc.bucketEndFor(bStart, rollupBucket);
        const clipStart = Math.max(bStart, windowStart);
        const clipEnd = Math.min(bEnd, cutoffMs);
        const span = Math.max(0, clipEnd - clipStart);
        const bucketSpan = bEnd - bStart;
        if (!span || !bucketSpan) continue;
        const ratio = span / bucketSpan;   // دلو جزئي عند حدود النافذة ⇒ قصّ نسبي
        rollupOnlineMs += r.online_seconds * 1000 * ratio;
        rollupOfflineMs += r.offline_seconds * 1000 * ratio;
        rollupUnknownMs += r.unknown_seconds * 1000 * ratio;
        rollupBuckets += 1;
      }
    }
  } catch (e) {
    // التجميعات إضافة تحسينية: لو الجدول غير موجود (قاعدة قديمة) نكمل بالبيانات الخام وحدها.
  }

  const windowMs = windowEnd - windowStart;
  const mergedOnlineMs = calc.onlineMs + rollupOnlineMs;
  const mergedOfflineMs = calc.offlineMs + rollupOfflineMs;
  const mergedKnownMs = Math.min(windowMs, mergedOnlineMs + mergedOfflineMs);
  const mergedUnknownMs = Math.max(0, windowMs - mergedKnownMs);
  const mergedAvailability = mergedKnownMs > 0 ? mergedOnlineMs / mergedKnownMs : null;
  const mergedQuality = dataQualityFor({ windowMs, unknownMs: mergedUnknownMs, knownMs: mergedKnownMs, ttlMs });
  const mergedCoverage = (mergedKnownMs / windowMs) * 100;

  const round2 = (n) => Math.round(n * 100) / 100;
  return {
    range,
    hours,
    since: startIso,
    // ── توافق خلفي (نفس الحقول القديمة) ──
    uptime_percentage: mergedAvailability == null ? null : round2(mergedAvailability * 100),
    status_points: statusPoints,
    downtime_events: downtimeEvents,
    // ── HIST-01: التغطية والحساب الزمني (بعد دمج التجميعات من HIST-02) ──
    window_start: startIso,
    window_end: new Date(windowEnd).toISOString(),
    coverage_percentage: round2(Math.min(100, mergedCoverage)),
    known_seconds: Math.round(mergedKnownMs / 1000),
    online_seconds: Math.round(mergedOnlineMs / 1000),
    offline_seconds: Math.round(mergedOfflineMs / 1000),
    unknown_seconds: Math.round(mergedUnknownMs / 1000),
    data_quality: mergedQuality,
    calculation_method: CALCULATION_METHOD,
    expected_sample_ttl_seconds: Math.round(calc.expectedSampleTtlMs / 1000),
    // ── HIST-02: مصدر التغطية الأقدم ──
    rollup_granularity: rollupBuckets > 0 ? rollupBucket : null,
    rollup_buckets: rollupBuckets,
    rollup_seconds: Math.round((rollupOnlineMs + rollupOfflineMs + rollupUnknownMs) / 1000),
  };
}

module.exports = {
  getDeviceHistory,
  computeAvailability,
  mergeIntervals,
  dataQualityFor,
  deviceTtlMs,
  RANGE_HOURS,
  CALCULATION_METHOD,
};
