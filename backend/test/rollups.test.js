// اختبارات HIST-02 — التجميعات الساعية/اليومية: بناء idempotent، دقة زمنية، احتفاظ 90 يومًا،
// ودمجها في تقرير الجهاز (تحسين تغطية 30 يومًا بعد تقليم السجلات الخام).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnv, startServer, makeClient } = require('./helpers/test-app');

const env = setupTestEnv();

const rollup = require('../src/services/rollup.service');
const { getDeviceHistory, computeAvailability } = require('../src/services/history.service');
const db = require('../src/db');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
let srv, anon, deviceId;

test.before(async () => {
  srv = await startServer();
  anon = makeClient(srv.baseUrl);
  const typeId = db.prepare('SELECT id FROM device_types LIMIT 1').get().id;
  deviceId = db.prepare(
    `INSERT INTO devices (name, ip, device_type_id, check_protocol, is_active, current_status, host_status, overall_health, check_interval_seconds, failure_threshold)
     VALUES ('جهاز التجميع', '10.7.7.7', ?, 'ping', 1, 'online', 'online', 'online', 60, 2)`
  ).run(typeId).lastInsertRowid;
});

test.after(async () => {
  await srv.close();
  env.cleanup();
});

function insertSamples(deviceIdArg, fromMs, toMs, status, stepMs) {
  const stmt = db.prepare('INSERT INTO status_logs (device_id, status, response_time_ms, checked_at) VALUES (?, ?, ?, ?)');
  const tx = db.transaction(() => {
    for (let t = fromMs; t <= toMs; t += stepMs) {
      stmt.run(deviceIdArg, status, status === 'online' ? 10 + (t % 7) : null, new Date(t).toISOString());
    }
  });
  tx();
}

test('HIST-02: دوال الدلاء والإحصاءات (نقاء)', () => {
  const t = Date.UTC(2026, 9, 17, 13, 37, 12);
  assert.equal(new Date(rollup.bucketStartFor(t, 'hour')).getUTCHours(), 13);
  assert.equal(new Date(rollup.bucketStartFor(t, 'hour')).getUTCMinutes(), 0);
  assert.equal(new Date(rollup.bucketStartFor(t, 'day')).getUTCHours(), 0);
  assert.equal(rollup.bucketEndFor(rollup.bucketStartFor(t, 'hour'), 'hour') - rollup.bucketStartFor(t, 'hour'), HOUR);
  assert.equal(rollup.bucketEndFor(rollup.bucketStartFor(t, 'day'), 'day') - rollup.bucketStartFor(t, 'day'), DAY);

  const stats = rollup.latencyStats([{ response_time_ms: 10 }, { response_time_ms: 20 }, { response_time_ms: null }, { response_time_ms: 30 }]);
  assert.equal(stats.min, 10);
  assert.equal(stats.max, 30);
  assert.equal(stats.avg, 20);
  assert.equal(stats.p95, 30);
  assert.deepEqual(rollup.latencyStats([]), { min: null, avg: null, max: null, p95: null });
});

test('HIST-02: دلو ساعة بدقة زمنية (نصف ساعة انقطاع ⇒ 1800/1800 ثانية)', () => {
  const hourStart = Date.UTC(2026, 0, 5, 8, 0, 0);
  const samples = [];
  for (let m = 0; m < 60; m++) {
    samples.push({ at: hourStart + m * 60 * 1000, status: m < 30 ? 'online' : 'offline', response_time_ms: m < 30 ? 12 : null });
  }
  const r = rollup.computeRollup({ samples, events: [], windowStart: hourStart, windowEnd: hourStart + HOUR, ttlMs: 3 * 60 * 1000, nowMs: hourStart + HOUR });
  assert.equal(r.onlineSeconds, 1800);
  assert.equal(r.offlineSeconds, 1800);
  assert.equal(r.unknownSeconds, 0);
  assert.equal(r.sampleCount, 60);
  assert.equal(r.minResponseMs, 12);
});

test('HIST-02: البناء idempotent — إعادة البناء لا تُضاعف الصفوف ولا تغيّر القيم', () => {
  const now = Date.now();
  const from = rollup.bucketStartFor(now - 5 * HOUR, 'hour');
  insertSamples(deviceId, from, from + 5 * HOUR - 60000, 'online', 60000);

  const first = rollup.buildRollups({ bucket: 'hour', fromMs: from, toMs: now, nowMs: now });
  assert.ok(first.bucketsWritten >= 4, 'يجب بناء عدة دلاء ساعية');
  const rows1 = db.prepare('SELECT COUNT(*) AS c FROM status_rollups WHERE device_id = ?').get(deviceId).c;
  const sampleRow1 = db.prepare("SELECT online_seconds, sample_count FROM status_rollups WHERE device_id = ? ORDER BY bucket_start LIMIT 1").get(deviceId);

  const second = rollup.buildRollups({ bucket: 'hour', fromMs: from, toMs: now, nowMs: now });
  const rows2 = db.prepare('SELECT COUNT(*) AS c FROM status_rollups WHERE device_id = ?').get(deviceId).c;
  const sampleRow2 = db.prepare("SELECT online_seconds, sample_count FROM status_rollups WHERE device_id = ? ORDER BY bucket_start LIMIT 1").get(deviceId);

  assert.equal(rows2, rows1, 'إعادة البناء يجب ألا تُنشئ صفوفًا جديدة (UNIQUE + upsert)');
  assert.deepEqual(sampleRow2, sampleRow1, 'القيم تبقى كما هي');
  assert.equal(second.bucketsWritten, first.bucketsWritten);
});

test('HIST-02: تقرير 30 يومًا يستفيد من الدلاء اليومية بعد تقليم السجلات الخام', async () => {
  // نُجمّع حالة 20 يومًا مضت كدلاء يومية عند 100% تشغيل (كأن البيانات الخام قُلِّمت بعدها)
  const now = Date.now();
  const dayStart = rollup.bucketStartFor(now - 20 * DAY, 'day');
  const insert = db.prepare(
    `INSERT INTO status_rollups (device_id, bucket, bucket_start, online_seconds, offline_seconds, unknown_seconds, sample_count, computed_at)
     VALUES (?, 'day', ?, ?, ?, 0, ?, ?)`
  );
  for (let i = 0; i < 20; i++) {
    insert.run(deviceId, new Date(dayStart + i * DAY).toISOString(), 86400, 0, 1440, new Date(now).toISOString());
  }

  const hist = await anon.get(`/api/public/devices/${deviceId}/history?range=30d`);
  assert.equal(hist.status, 200);
  const data = (await hist.json()).data;

  assert.equal(data.range, '30d');
  assert.equal(data.rollup_granularity, 'day', 'النافذة الطويلة تستعمل الدلاء اليومية');
  assert.ok(data.rollup_buckets >= 19, `يجب دمج ~20 دلوًا يوميًّا (كان ${data.rollup_buckets})`);
  assert.ok(data.coverage_percentage > 55, `التغطية يجب أن تتجاوز 55% بفضل الدلاء (كانت ${data.coverage_percentage}%)`);
  assert.ok(['complete', 'partial'].includes(data.data_quality));
  assert.equal(data.uptime_percentage, 100, 'الدلاء كلها 100% تشغيل ⇒ النسبة 100%');
  assert.ok(data.unknown_seconds > 0, 'الفترة غير المُجمَّعة (آخر ~10 أيام بلا دقة) تبقى unknown صريحة');

  // وللمقارنة: حساب بلا دلاء (نفس المجال عبر الدالة النقية) يعطي تغطية أقل بكثير
  const raw = computeAvailability({ windowStart: now - 30 * DAY, windowEnd: now, samples: [], events: [], ttlMs: 180000, nowMs: now });
  assert.equal(raw.coveragePercentage, 0, 'بلا أدلة إطلاقًا ⇒ تغطية 0 (لا نسب مُختلَقة)');
});

test('HIST-02: الصيانة الدورية تبني وتحذف الأقدم من مدة الاحتفاظ', () => {
  const now = Date.now();
  // دلو قديم جدًا (خارج الاحتفاظ) + دلو حديث
  const insert = db.prepare(
    `INSERT INTO status_rollups (device_id, bucket, bucket_start, online_seconds, offline_seconds, unknown_seconds, sample_count, computed_at)
     VALUES (?, ?, ?, 60, 0, 0, 1, ?)`
  );
  insert.run(deviceId, 'day', new Date(now - 120 * DAY).toISOString(), new Date(now).toISOString());
  insert.run(deviceId, 'day', new Date(now - 3 * DAY).toISOString(), new Date(now).toISOString());

  const res = rollup.runRollupMaintenance({ nowMs: now, hoursBack: 2, daysBack: 3, retentionDays: 90 });
  assert.ok(res.deletedOld >= 1, 'يجب حذف الدلاء الأقدم من 90 يومًا');
  const oldRow = db.prepare('SELECT COUNT(*) AS c FROM status_rollups WHERE device_id = ? AND bucket_start < ?')
    .get(deviceId, new Date(now - 100 * DAY).toISOString()).c;
  assert.equal(oldRow, 0, 'الدلو القديم حُذف');
  const kept = db.prepare('SELECT COUNT(*) AS c FROM status_rollups WHERE device_id = ? AND bucket_start >= ?')
    .get(deviceId, new Date(now - 100 * DAY).toISOString()).c;
  assert.ok(kept > 0, 'الدلاء الحديثة محفوظة');
  assert.equal(res.retentionDays, 90);
});
