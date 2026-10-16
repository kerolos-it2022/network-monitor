// اختبارات MON-01 — فصل حالات المراقبة واحترام بروتوكول الفحص الأساسي (T03).\
// الدوال النقية تُختبر مباشرة، وسلوك الفحص يُختبر على قاعدة مؤقتة بفحوصات مُستبدَلة (mocks).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnv } = require('./helpers/test-app');

// البيئة قبل أي require لـ src (db.js يفتح القاعدة عند التحميل).
const env = setupTestEnv();

const { decideHostTransition, overallHealth, isStale } = require('../src/services/health-state.service');
const db = require('../src/db');
const { checkDevice, probePrimary } = require('../src/services/monitor.service');

test.after(() => env.cleanup());

// ── دوال الحالة النقية ──────────────────────────────────────────────────────
test('MON-01: انتقالات الحالة — online/offline/unknown وأحداث الانقطاع/العودة', () => {
  // unknown + نجاح ⇒ online بلا حدث «عودة» (لم يكن منقطعًا معروفًا)
  assert.deepEqual(
    decideHostTransition({ hostStatus: 'unknown', consecutiveFailures: 0, failureThreshold: 2, probeOk: true }),
    { hostStatus: 'online', consecutiveFailures: 0, event: null }
  );
  // online + فشل واحد دون العتبة ⇒ يبقى online بلا حدث
  assert.deepEqual(
    decideHostTransition({ hostStatus: 'online', consecutiveFailures: 0, failureThreshold: 2, probeOk: false }),
    { hostStatus: 'online', consecutiveFailures: 1, event: null }
  );
  // بلوغ العتبة ⇒ offline + حدث انقطاع واحد فقط
  const down = decideHostTransition({ hostStatus: 'online', consecutiveFailures: 1, failureThreshold: 2, probeOk: false });
  assert.equal(down.hostStatus, 'offline');
  assert.equal(down.event, 'down');
  // فشل إضافي وهو offline ⇒ لا تكرار للحدث
  const stillDown = decideHostTransition({ hostStatus: 'offline', consecutiveFailures: 5, failureThreshold: 2, probeOk: false });
  assert.equal(stillDown.event, null);
  // offline + نجاح ⇒ online + حدث عودة واحد
  const up = decideHostTransition({ hostStatus: 'offline', consecutiveFailures: 5, failureThreshold: 2, probeOk: true });
  assert.equal(up.hostStatus, 'online');
  assert.equal(up.event, 'recovered');
  assert.equal(up.consecutiveFailures, 0);
});

test('MON-01: الحالة العامة — العطل في المضيف أولى، وdegraded للخدمات المتوقفة', () => {
  assert.equal(overallHealth({ hostStatus: 'offline', servicesDown: 3 }), 'offline');
  assert.equal(overallHealth({ hostStatus: 'unknown' }), 'unknown');
  assert.equal(overallHealth({ hostStatus: 'online', servicesDown: 0 }), 'online');
  assert.equal(overallHealth({ hostStatus: 'online', servicesDown: 1 }), 'degraded', 'مضيف متصل + خدمة متوقفة ⇒ DEGRADED');
  assert.equal(overallHealth({ hostStatus: 'online', servicesCriticalDown: 1 }), 'degraded');
});

test('MON-01: كشف البيانات القديمة (stale) بحسب فترة الفحص', () => {
  const now = Date.now();
  const fresh = new Date(now - 10e3).toISOString();
  const old = new Date(now - 120e3).toISOString();
  assert.equal(isStale(fresh, 10, now, 3), false);
  assert.equal(isStale(old, 10, now, 3), true);
  assert.equal(isStale(null, 10, now, 3), true);
  assert.equal(isStale('ليست-تاريخًا', 10, now, 3), true);
});

// ── سلوك الفحص الفعلي (قاعدة مؤقتة + فحوصات مُستبدَلة) ─────────────────────
function seedDevice(overrides = {}) {
  const typeId = db.prepare('SELECT id FROM device_types LIMIT 1').get().id;
  const d = Object.assign({
    name: 'جهاز فحص', ip: '10.9.9.9', device_type_id: typeId, check_protocol: 'ping',
    port: null, web_port: null, failure_threshold: 2, check_interval_seconds: 10,
    is_active: 1, current_status: 'unknown',
  }, overrides);
  const id = db.prepare(
    `INSERT INTO devices (name, ip, device_type_id, check_protocol, port, web_port, failure_threshold, check_interval_seconds, is_active, current_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(d.name, d.ip, d.device_type_id, d.check_protocol, d.port, d.web_port, d.failure_threshold, d.check_interval_seconds, d.is_active, d.current_status).lastInsertRowid;
  return db.prepare(
    `SELECT d.*, NULL AS device_type_name, NULL AS location_name FROM devices d WHERE d.id = ?`
  ).get(id);
}

const probesAlways = ({ ping = false, port = false, http = false, https = false } = {}) => ({
  ping: async () => ({ isOnline: ping, responseTimeMs: ping ? 3 : null }),
  port: async () => ({ isOnline: port, responseTimeMs: port ? 5 : null }),
  http: async () => ({ isOnline: http, responseTimeMs: http ? 7 : null }),
  https: async () => ({ isOnline: https, responseTimeMs: https ? 8 : null }),
});

test('T03: check_protocol=port — Ping ناجح لا يجعل الجهاز متصلًا إذا كان المنفذ مغلقًا', async () => {
  const device = seedDevice({ check_protocol: 'port', port: 8069, failure_threshold: 2 });

  // الفحص الأول: فشل (1) ⇒ ما زال غير منقطع
  let r = await checkDevice(device, { probes: probesAlways({ ping: true, port: false }) });
  assert.equal(r.hostStatus, 'unknown');
  assert.equal(r.event, null);

  // الفحص الثاني: بلوغ العتبة ⇒ offline + حدث انقطاع
  r = await checkDevice(device, { probes: probesAlways({ ping: true, port: false }) });
  assert.equal(r.hostStatus, 'offline');
  assert.equal(r.event, 'down');
  assert.equal(r.protocol, 'port', 'الفيصل هو بروتوكول الجهاز المختار');

  const row = db.prepare('SELECT current_status, host_status, overall_health, last_probe_protocol FROM devices WHERE id = ?').get(device.id);
  assert.equal(row.host_status, 'offline');
  assert.equal(row.current_status, 'offline', 'current_status تبقى متوافقة مع حالة المضيف');
  assert.equal(row.overall_health, 'offline');
  assert.equal(row.last_probe_protocol, 'port');

  // انقطاع واحد مسجَّل ومفتوح
  const open = db.prepare('SELECT COUNT(*) AS c FROM downtime_events WHERE device_id = ? AND ended_at IS NULL').get(device.id).c;
  assert.equal(open, 1);

  // عودة المنفذ ⇒ online + إغلاق الانقطاع
  r = await checkDevice(device, { probes: probesAlways({ ping: true, port: true }) });
  assert.equal(r.hostStatus, 'online');
  assert.equal(r.event, 'recovered');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM downtime_events WHERE device_id = ? AND ended_at IS NULL').get(device.id).c, 0);
});

test('T03: check_protocol=ping — نجاح Ping يبقي المضيف متصلًا حتى لو فشل اكتشاف الويب', async () => {
  const device = seedDevice({ check_protocol: 'ping', failure_threshold: 2 });
  const r = await checkDevice(device, { probes: probesAlways({ ping: true, http: false, https: false }) });
  assert.equal(r.hostStatus, 'online');
  const row = db.prepare('SELECT host_status, overall_health, http_accessible FROM devices WHERE id = ?').get(device.id);
  assert.equal(row.host_status, 'online');
  assert.equal(row.overall_health, 'online');
  assert.equal(row.http_accessible, 0, 'فحص اكتشاف الويب يسجّل الحقيقة ولا يقلب حالة المضيف');
});

test('MON-03 (جزئي): فحص واحد فقط لكل جهاز في اللحظة نفسها (in-flight guard)', async () => {
  const device = seedDevice({ check_protocol: 'ping' });
  let probeCalls = 0;
  const slowProbes = {
    ping: async () => { probeCalls += 1; await new Promise((r) => setTimeout(r, 120)); return { isOnline: true, responseTimeMs: 2 }; },
    port: async () => ({ isOnline: false, responseTimeMs: null }),
    http: async () => ({ isOnline: false, responseTimeMs: null }),
    https: async () => ({ isOnline: false, responseTimeMs: null }),
  };
  const first = checkDevice(device, { probes: slowProbes });
  const second = await checkDevice(device, { probes: slowProbes });
  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'inflight');
  await first;
  assert.equal(probeCalls, 1, 'يجب ألا يُنفَّذ الفحص مرتين معًا لنفس الجهاز');
  assert.equal(db.prepare('SELECT host_status FROM devices WHERE id = ?').get(device.id).host_status, 'online');
});

test('MON-01: probePrimary يحترم البروتوكول والمنافذ (التحقق من الوسائط)', async () => {
  const calls = [];
  const recording = {
    ping: async (ip) => { calls.push(['ping', ip]); return { isOnline: true, responseTimeMs: 1 }; },
    port: async (ip, port) => { calls.push(['port', ip, port]); return { isOnline: true, responseTimeMs: 1 }; },
    http: async (ip, port) => { calls.push(['http', ip, port]); return { isOnline: true, responseTimeMs: 1 }; },
    https: async (ip, port) => { calls.push(['https', ip, port]); return { isOnline: true, responseTimeMs: 1 }; },
  };
  await probePrimary({ ip: '10.0.0.5', check_protocol: 'port', port: 22 }, recording);
  await probePrimary({ ip: '10.0.0.5', check_protocol: 'http', web_port: 4444 }, recording);
  await probePrimary({ ip: '10.0.0.5', check_protocol: 'https' }, recording);
  await probePrimary({ ip: '10.0.0.5', check_protocol: 'ping' }, recording);
  assert.deepEqual(calls, [
    ['port', '10.0.0.5', 22],
    ['http', '10.0.0.5', 4444],
    ['https', '10.0.0.5', 443],
    ['ping', '10.0.0.5'],
  ]);
});
