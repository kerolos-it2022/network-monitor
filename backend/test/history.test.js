// اختبارات HIST-01 (T06) — حساب التشغيل الزمني مع التغطية: لا 0% ولا 100% مُختلَقة.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnv, startServer, makeClient, readText } = require('./helpers/test-app');

const env = setupTestEnv();
const { computeAvailability, mergeIntervals, dataQualityFor, getDeviceHistory } = require('../src/services/history.service');
const db = require('../src/db');

let srv, anon;
let deviceId;

test.before(async () => {
  srv = await startServer();
  anon = makeClient(srv.baseUrl);
  const typeId = db.prepare('SELECT id FROM device_types LIMIT 1').get().id;
  deviceId = db.prepare(
    `INSERT INTO devices (name, ip, device_type_id, check_protocol, is_active, current_status, host_status, overall_health, check_interval_seconds, failure_threshold)
     VALUES ('جهاز التاريخ', '10.5.5.5', ?, 'ping', 1, 'online', 'online', 'online', 60, 2)`
  ).run(typeId).lastInsertRowid;
});

test.after(async () => {
  await srv.close();
  env.cleanup();
});

const MIN = 60 * 1000;
const TTL = 3 * 60 * 1000; // فترة الفحص 60 ث ⇒ TTL = 3 دقائق (كما يحسبها المحرك)

// عيّنات كل دقيقة من from إلى to بحالة status
function samplesEveryMinute(fromMs, toMs, status, step = MIN) {
  const out = [];
  for (let t = fromMs; t <= toMs; t += step) out.push({ at: t, status });
  return out;
}

test('T06: انقطاع 15 دقيقة داخل ساعة، والباقي متصل ⇒ 75% مع تغطية 100%', () => {
  const end = 12 * 60 * MIN;   // نافذة ساعة كاملة
  const start = end - 60 * MIN;
  const downFrom = start + 10 * MIN;
  const downTo = downFrom + 15 * MIN;

  // حالة كل دقيقة حتى الدقيقة السابقة للاستعادة (عيّنة الاستعادة = online تُنهي الانقطاع).
  const samples = samplesEveryMinute(start, end, 'online')
    .filter((s) => s.at < downFrom || s.at >= downTo)
    .concat(samplesEveryMinute(downFrom, downTo - MIN, 'offline'));

  const calc = computeAvailability({ windowStart: start, windowEnd: end, samples, events: [], ttlMs: TTL, nowMs: end });
  assert.equal(Math.round(calc.availability * 100), 75, 'التشغيل الزمني = 75%');
  assert.equal(Math.round(calc.coveragePercentage), 100, 'التغطية كاملة (عيّنات كل دقيقة وTTL 3 دقائق)');
  assert.equal(calc.dataQuality, 'complete');
  assert.equal(Math.round(calc.offlineMs / MIN), 15);
});

test('T06: نصف ساعة مُراقَبة فقط والباقي متصل ⇒ 100% من المُغطّى وتغطية 50% وليست 100% كاملة', () => {
  const end = 60 * MIN;
  const start = 0;
  const samples = samplesEveryMinute(start, start + 30 * MIN, 'online');
  const calc = computeAvailability({ windowStart: start, windowEnd: end, samples, events: [], ttlMs: TTL, nowMs: end });

  assert.equal(Math.round(calc.availability * 100), 100, 'التشغيل = 100% من المُغطّى فقط');
  // آخر عيّنة تمتد TTL (3 دقائق) بعد وقتها ⇒ التغطية 55% لا 100% — والفارق يبقى unknown.
  assert.ok(calc.coveragePercentage >= 50 && calc.coveragePercentage < 60,
    `التغطية يجب أن تكون ~50-55% (كانت ${calc.coveragePercentage.toFixed(1)}%)`);
  assert.equal(calc.dataQuality, 'partial', 'ليست «complete» لأن نصف النافذة بلا دليل');
  assert.ok(calc.unknownMs >= 25 * MIN, 'الوقت غير المُغطّى محسوب unknown صريحًا');
});

test('T06: نافذة 30 يومًا مع بيانات 7 أيام فقط ⇒ تغطية ~23% وبلا نقاط خضراء مُختلَقة', () => {
  const end = 30 * 24 * 60 * MIN;
  const start = 0;
  const windowMs = end - start;
  const down = end - 7 * 24 * 60 * MIN; // آخر 7 أيام فقط
  // عيّنات كل دقيقة (كفاصل الفحص الحقيقي 60 ثانية) — TTL 3 دقائق فلا فجوات داخل الـ7 أيام.
  const samples = samplesEveryMinute(down, end, 'online', MIN);
  const calc = computeAvailability({ windowStart: start, windowEnd: end, samples, events: [], ttlMs: TTL, nowMs: end });

  const coverage = calc.coveragePercentage;
  assert.ok(coverage > 20 && coverage < 26, `التغطية يجب أن تكون ~23% (كانت ${coverage.toFixed(1)}%)`);
  assert.equal(calc.dataQuality, 'partial');
  assert.equal(Math.round(calc.availability * 100), 100, 'التشغيل محسوب على المُغطّى فقط');
  assert.ok(calc.unknownMs > windowMs * 0.7, 'الأيام غير المُراقَبة تبقى unknown');
});

test('T06: حدث بدأ قبل النافذة وانتهى داخلها يُحتسب + انقطاع مستمر حتى الآن', () => {
  const end = 60 * MIN;
  const start = 0;
  // عيّنات متصلة قبل/داخل النافذة
  const samples = samplesEveryMinute(start, end, 'online');
  // انقطاع موثّق بدأ قبل البداية بـ10 دقائق وانتهى عند الدقيقة 10
  const calc = computeAvailability({
    windowStart: start, windowEnd: end, samples, ttlMs: TTL, nowMs: end,
    events: [{ started_at: -10 * MIN, ended_at: 10 * MIN }],
  });
  assert.equal(Math.round(calc.offlineMs / MIN), 10, 'يُحتسب الجزء الواقع داخل النافذة');
  assert.equal(Math.round(calc.onlineMs / MIN), 50);
  assert.equal(Math.round(calc.availability * 100), 83, '50 من 60 ⇒ 83%');

  // انقطاع مستمر (ended_at = null) حتى الآن
  const calc2 = computeAvailability({
    windowStart: start, windowEnd: end, samples: samplesEveryMinute(start, start + 20 * MIN, 'online'),
    ttlMs: TTL, nowMs: end, events: [{ started_at: 20 * MIN, ended_at: null }],
  });
  assert.equal(Math.round(calc2.offlineMs / MIN), 40, 'من لحظة البداية حتى «الآن»');
  assert.equal(Math.round(calc2.availability * 100), 33);
});

test('T06: بلا أي عيّنة ⇒ availability = null وinsufficient (وليس 0%)', () => {
  const calc = computeAvailability({ windowStart: 0, windowEnd: 60 * MIN, samples: [], events: [], ttlMs: TTL, nowMs: 60 * MIN });
  assert.equal(calc.availability, null);
  assert.equal(calc.dataQuality, 'insufficient');
  assert.equal(Math.round(calc.coveragePercentage), 0);
});

test('T06: فجوة أطول من TTL ⇒ unknown، وترتيب معكوس/أزمنة مستقبلية لا تُنتج مددًا سالبة', () => {
  const end = 30 * MIN;
  const start = 0;
  // عيّنتان متصلتان ثم فجوة 20 دقيقة (أكبر من TTL=3د)
  const samples = [
    { at: 0, status: 'online' },
    { at: 2 * MIN, status: 'online' },
    { at: 25 * MIN, status: 'online' }, // فجوة طويلة
  ];
  const calc = computeAvailability({ windowStart: start, windowEnd: end, samples, events: [], ttlMs: TTL, nowMs: end });
  assert.ok(calc.unknownMs >= 20 * MIN, 'الفجوة الطويلة تبقى unknown');
  assert.equal(calc.availability, 1, 'المُغطّى كان متصلًا بالكامل');

  // عيّنات غير مرتّبة + زمن مستقبلي
  const messy = [
    { at: 10 * MIN, status: 'online' },
    { at: 1 * MIN, status: 'offline' },
    { at: 10 * MIN + 5 * 60 * MIN, status: 'online' }, // مستقبلي خارج النافذة
  ];
  const calc2 = computeAvailability({ windowStart: start, windowEnd: end, samples: messy, events: [], ttlMs: TTL, nowMs: 15 * MIN });
  assert.ok(calc2.onlineMs >= 0 && calc2.offlineMs >= 0 && calc2.unknownMs >= 0, 'لا مدد سالبة');
  assert.ok(calc2.knownMs <= 30 * MIN, 'لا تتجاوز النافذة');
});

test('HIST-01: دمج الفترات وتصنيف الجودة (نقاء)', () => {
  assert.deepEqual(mergeIntervals([{ start: 0, end: 5 }, { start: 3, end: 8 }, { start: 10, end: 12 }]),
    [{ start: 0, end: 8 }, { start: 10, end: 12 }]);
  assert.equal(dataQualityFor({ windowMs: 1000, unknownMs: 0, knownMs: 1000, ttlMs: 10 }), 'complete');
  assert.equal(dataQualityFor({ windowMs: 1000, unknownMs: 500, knownMs: 500, ttlMs: 10 }), 'partial');
  assert.equal(dataQualityFor({ windowMs: 1000, unknownMs: 1000, knownMs: 0, ttlMs: 10 }), 'insufficient');
});

test('HIST-01: المسار العام يعرض التغطية ويحفظ الحقول القديمة', async () => {
  const now = Date.now();
  for (let i = 0; i < 10; i++) {
    db.prepare('INSERT INTO status_logs (device_id, status, response_time_ms, checked_at) VALUES (?, ?, ?, ?)')
      .run(deviceId, i < 8 ? 'online' : 'offline', 12, new Date(now - (10 - i) * 60 * 1000).toISOString());
  }
  const res = await anon.get(`/api/public/devices/${deviceId}/history?range=24h`);
  assert.equal(res.status, 200);
  const body = await res.json();
  const d = body.data;

  // حقول قديمة موجودة (توافق)
  for (const k of ['uptime_percentage', 'status_points', 'downtime_events']) {
    assert.ok(k in d, `الحقل القديم ${k} يجب أن يبقى`);
  }
  // حقول HIST-01 الجديدة
  assert.equal(d.calculation_method, 'time_weighted_v1');
  assert.ok(['complete', 'partial', 'insufficient'].includes(d.data_quality));
  assert.ok(typeof d.coverage_percentage === 'number');
  assert.ok(d.window_start && d.window_end);
  assert.ok(typeof d.unknown_seconds === 'number');

  // نافذة 24 ساعة وعيّنات دقائق فقط ⇒ تغطية صغيرة صريحة (بلا تلوين كاذب)
  assert.ok(d.coverage_percentage < 5, `التغطية صغيرة (${d.coverage_percentage}%) لأن العيّنات دقائق فقط`);
  assert.equal(d.data_quality, 'partial');
});
