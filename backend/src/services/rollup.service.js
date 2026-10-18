// rollup.service.js ( HIST-02) — تجميعات ساعية/يومية قبل تقليم السجلات الخام.
// ═══════════════════════════════════════════════════════════════════════════
// المشكلة التي يحلّها: status_logs تُقلَّم بعد 7 أيام (STATUS_LOGS_RETENTION_DAYS)، فتقارير
// 30/90 يومًا كانت تُعاد كـ«بيانات غير كافية». الحل: نبني لكل جهاز — قبل الحذف — دلوًّا ساعيًّا
// ويوميًّا يحمل (online/offline/unknown seconds + إحصاءات زمن الاستجابة)، بحساب زمني بنفس
// منطق HIST-01 (سقف TTL للعيّنة)، ونحفظها ≥90 يومًا (NM_ROLLUP_RETENTION_DAYS).
// البناء **idempotent** (UNIQUE + upsert) فيمكن تشغيله أي عدد من المرات بلا ازدواج.
// الدوال النقية (bucketStartFor/bucketEndFor/computeRollup) قابلة للاختبار مباشرة.
'use strict';
const db = require('../db');
const { computeAvailability } = require('./history.service');

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

function bucketStartFor(ts, bucket) {
  if (bucket === 'day') return Math.floor(ts / DAY_MS) * DAY_MS;
  return Math.floor(ts / HOUR_MS) * HOUR_MS;
}
function bucketEndFor(startMs, bucket) {
  return startMs + (bucket === 'day' ? DAY_MS : HOUR_MS);
}

// إحصاءات زمن الاستجابة من العيّنات (نقي): min/avg/max/p95 — تتجاهل القيم الفارغة.
function latencyStats(samples) {
  const values = samples
    .map((s) => (s.response_time_ms == null ? null : Number(s.response_time_ms)))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (!values.length) return { min: null, avg: null, max: null, p95: null };
  const sum = values.reduce((a, b) => a + b, 0);
  const idx = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * 0.95) - 1));
  return {
    min: values[0],
    avg: Math.round((sum / values.length) * 100) / 100,
    max: values[values.length - 1],
    p95: values[idx],
  };
}

// حساب دلو واحد لجهاز واحد (نقي): يعيد ثواني الحالات + الإحصاءات + عدد العيّنات.
function computeRollup({ samples, events, windowStart, windowEnd, ttlMs, nowMs = Date.now() }) {
  const availability = computeAvailability({
    windowStart,
    windowEnd,
    samples: samples.map((s) => ({ at: s.at, status: s.status })),
    events: events || [],
    ttlMs,
    nowMs,
  });
  const stats = latencyStats(samples);
  return {
    onlineSeconds: Math.round(availability.onlineMs / 1000),
    offlineSeconds: Math.round(availability.offlineMs / 1000),
    unknownSeconds: Math.round(availability.unknownMs / 1000),
    sampleCount: samples.length,
    minResponseMs: stats.min,
    avgResponseMs: stats.avg,
    maxResponseMs: stats.max,
    p95ResponseMs: stats.p95,
  };
}

// ── بناء التجميعات من البيانات الخام ──
// fromMs/toMs: المجال المطلوب بناؤه. bucket: 'hour' | 'day'. deviceId اختياري.
function buildRollups({ bucket, fromMs, toMs, deviceId = null, ttlMsFor = null, nowMs = Date.now() }) {
  const devices = deviceId
    ? db.prepare('SELECT id, check_interval_seconds FROM devices WHERE id = ?').all(deviceId)
    : db.prepare('SELECT id, check_interval_seconds FROM devices').all();
  const factor = Math.max(2, parseInt(process.env.NM_STALE_FACTOR, 10) || 3);
  const defaultTtl = (dev) => Math.max(30000, Math.max(10, Number(dev.check_interval_seconds) || 10) * 1000 * factor);

  // ملاحظة ذاكرة: نستعلم **لكل جهاز على حدة** عن عيّنات مجاله (بدل جلب ملايين الصفوف دفعة واحدة
  // على شبكات كبيرة) ثم نبني دلاءه ونحرّر الذاكرة — أبطأ قليلًا لكنه آمن مع 50+ جهازًا و9 أيام.
  const samplesStmt = db.prepare(
    `SELECT checked_at, status, response_time_ms
       FROM status_logs WHERE device_id = ? AND checked_at >= ? AND checked_at <= ? ORDER BY checked_at`
  );

  // أحداث الانقطاع المتقاطعة مع المجال (لدمجها كأدلة offline موثوقة).
  const events = db.prepare(
    `SELECT device_id, started_at, ended_at FROM downtime_events
      WHERE started_at <= ? AND (ended_at IS NULL OR ended_at >= ?)`
  ).all(new Date(toMs).toISOString(), new Date(fromMs).toISOString());

  const eventsByDevice = new Map();
  for (const e of events) {
    if (!eventsByDevice.has(e.device_id)) eventsByDevice.set(e.device_id, []);
    eventsByDevice.get(e.device_id).push({
      started_at: new Date(e.started_at).getTime(),
      ended_at: e.ended_at ? new Date(e.ended_at).getTime() : null,
    });
  }

  const upsert = db.prepare(
    `INSERT INTO status_rollups
       (device_id, bucket, bucket_start, online_seconds, offline_seconds, unknown_seconds,
        sample_count, min_response_ms, avg_response_ms, max_response_ms, p95_response_ms, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(device_id, bucket, bucket_start) DO UPDATE SET
       online_seconds = excluded.online_seconds,
       offline_seconds = excluded.offline_seconds,
       unknown_seconds = excluded.unknown_seconds,
       sample_count = excluded.sample_count,
       min_response_ms = excluded.min_response_ms,
       avg_response_ms = excluded.avg_response_ms,
       max_response_ms = excluded.max_response_ms,
       p95_response_ms = excluded.p95_response_ms,
       computed_at = excluded.computed_at`
  );
  const computedAt = new Date(nowMs).toISOString();

  // نوافذ الدلاء المطلوبة: من أول دلو يقع فيه fromMs حتى آخر دلو كامل قبل toMs.
  let written = 0;
  const deviceIds = devices.map((d) => d.id);
  for (const dev of devices) {
    const devSamples = samplesStmt.all(dev.id, new Date(fromMs).toISOString(), new Date(toMs).toISOString());
    const devEvents = eventsByDevice.get(dev.id) || [];
    const ttl = ttlMsFor ? ttlMsFor(dev) : defaultTtl(dev);
    let start = bucketStartFor(fromMs, bucket);
    for (; start < toMs; start += bucket === 'day' ? DAY_MS : HOUR_MS) {
      const end = bucketEndFor(start, bucket);
      if (end > nowMs) break;                       // لا نبني دلوًا لم ينتهِ بعد (سيكون ناقصًا)
      const inBucket = devSamples.filter((s) => {
        const at = new Date(s.checked_at).getTime();
        return at >= start && at < end;
      }).map((s) => ({ at: new Date(s.checked_at).getTime(), status: s.status, response_time_ms: s.response_time_ms }));
      // عيّنة سابقة مباشرة (لاستمرار الحالة عند حدود الدلو) — بنفس منطق history.service.
      const prev = devSamples.filter((s) => new Date(s.checked_at).getTime() < start).slice(-1)[0];
      const withPrev = prev
        ? [{ at: new Date(prev.checked_at).getTime(), status: prev.status, response_time_ms: prev.response_time_ms }].concat(inBucket)
        : inBucket;
      const roll = computeRollup({
        samples: withPrev,
        events: devEvents,
        windowStart: start,
        windowEnd: end,
        ttlMs: ttl,
        nowMs,
      });
      upsert.run(
        dev.id, bucket, new Date(start).toISOString(),
        roll.onlineSeconds, roll.offlineSeconds, roll.unknownSeconds,
        roll.sampleCount, roll.minResponseMs, roll.avgResponseMs, roll.maxResponseMs, roll.p95ResponseMs,
        computedAt
      );
      written += 1;
    }
  }
  return { devices: deviceIds.length, bucketsWritten: written, bucket };
}

// القراءة: كل الدلاء المتقاطعة مع المجال لجهاز (مرتّبة).
function getRollups(deviceId, bucket, fromMs, toMs) {
  return db.prepare(
    `SELECT bucket_start, online_seconds, offline_seconds, unknown_seconds, sample_count,
            min_response_ms, avg_response_ms, max_response_ms, p95_response_ms
       FROM status_rollups
      WHERE device_id = ? AND bucket = ? AND bucket_start >= ? AND bucket_start < ?
      ORDER BY bucket_start ASC`
  ).all(deviceId, bucket, new Date(fromMs).toISOString(), new Date(toMs).toISOString());
}

// ── الصيانة الدورية ──
// تبني (ساعية لآخر hoursBack ساعة + يومية لآخر daysBack يوم) ثم تحذف التجميعات الأقدم من
// مدة الاحتفاظ. تُستدعى **قبل** تقليم status_logs كي لا تُفقد بيانات لم تُجمَّع بعد.
function runRollupMaintenance({ nowMs = Date.now(), hoursBack = 3, daysBack = 10, retentionDays = null } = {}) {
  const retDays = retentionDays != null
    ? retentionDays
    : (parseInt(process.env.NM_ROLLUP_RETENTION_DAYS, 10) || 90);
  // ملاحظة: نبني اليومية لآخر `daysBack` أيام فقط (نطاق يحوي البيانات الخام فعلًا) —
  // الدلاء الأقدم بُنيت سابقًا وتبقى محفوظة حتى انتهاء مدة الاحتفاظ.
  const dayBack = daysBack;

  const hourFrom = nowMs - hoursBack * HOUR_MS;
  const hourRes = buildRollups({ bucket: 'hour', fromMs: hourFrom, toMs: nowMs, nowMs });

  const dayFrom = nowMs - dayBack * DAY_MS;
  const dayRes = buildRollups({ bucket: 'day', fromMs: dayFrom, toMs: nowMs, nowMs });

  const cutoff = new Date(nowMs - retDays * DAY_MS).toISOString();
  const del = db.prepare('DELETE FROM status_rollups WHERE bucket_start < ?').run(cutoff);

  return {
    hours: hourRes.bucketsWritten,
    days: dayRes.bucketsWritten,
    deletedOld: del.changes,
    retentionDays: retDays,
  };
}

module.exports = {
  HOUR_MS,
  DAY_MS,
  bucketStartFor,
  bucketEndFor,
  latencyStats,
  computeRollup,
  buildRollups,
  getRollups,
  runRollupMaintenance,
};
