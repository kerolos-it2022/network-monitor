// اختبارات MON-02 — الخدمات المراقَبة: التحقق النقي، الـ CRUD عبر HTTP، حالة DEGRADED،
// والتنبيهات على مستوى الخدمة (T03: «Ping ناجح + Odoo متوقف ⇒ مضيف متصل وخدمة متوقفة»).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnv, startServer, seedUser, makeClient, readText } = require('./helpers/test-app');

const env = setupTestEnv();

const { statusMatcher, validateServiceInput, intervalDue } = require('../src/services/monitored-services.service');
const svc = require('../src/services/monitored-services.service');
const db = require('../src/db');
const { checkDevice } = require('../src/services/monitor.service');

let srv, admin, viewer, anon;
let deviceId;

test.before(async () => {
  srv = await startServer();
  seedUser(db, 'admin_ms', 'AdminPass123!', 'admin');
  seedUser(db, 'viewer_ms', 'ViewerPass123!', 'viewer');
  admin = makeClient(srv.baseUrl);
  viewer = makeClient(srv.baseUrl);
  anon = makeClient(srv.baseUrl);
  assert.equal((await admin.login('admin_ms', 'AdminPass123!')).status, 200);
  assert.equal((await viewer.login('viewer_ms', 'ViewerPass123!')).status, 200);

  const typeId = db.prepare('SELECT id FROM device_types LIMIT 1').get().id;
  deviceId = db.prepare(
    `INSERT INTO devices (name, ip, device_type_id, check_protocol, is_active, current_status, host_status, overall_health, failure_threshold)
     VALUES ('خادم Odoo', '192.168.88.20', ?, 'ping', 1, 'online', 'online', 'online', 2)`
  ).run(typeId).lastInsertRowid;
});

test.after(async () => {
  await srv.close();
  env.cleanup();
});

// ── التكافؤ مع الشرط T03 (سلسلة كاملة: مضيف متصل + خدمة متوقفة ⇒ DEGRADED) ──
test('T03: مضيف متصل + خدمة Odoo متوقفة ⇒ host ONLINE و service DOWN و overall DEGRADED + تنبيه واحد', async () => {
  // خدمة Odoo على TCP 8069 بعتبة 2 (الأجهزة/الخدمات تُدار عبر الـ API في اختبار آخر)
  const created = svc.createForDevice(deviceId, {
    name: 'Odoo ERP', kind: 'tcp', port: 8069, interval_seconds: 10, failure_threshold: 2, is_critical: true,
  });
  assert.equal(created.ok, true, created.error);
  const serviceId = created.service.id;

  // فحوصات مُستبدَلة: Ping ناجح + المنفذ مغلق
  const probes = {
    ping: async () => ({ isOnline: true, responseTimeMs: 3 }),
    port: async () => ({ isOnline: false, responseTimeMs: null }),
    http: async () => ({ isOnline: false, responseTimeMs: null }),
    https: async () => ({ isOnline: false, responseTimeMs: null }),
  };
  const alerts = [];
  const notifier = {
    notifyServiceDown: async (d, s) => alerts.push(['down', s.name]),
    notifyServiceRecovered: async (d, s) => alerts.push(['recovered', s.name]),
  };

  // المضيف يُفحص بنجاح (Ping) ⇒ online
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
  const hostResult = await checkDevice(device, { probes });
  assert.equal(hostResult.hostStatus, 'online');
  assert.equal(db.prepare('SELECT overall_health FROM devices WHERE id = ?').get(deviceId).overall_health, 'online');

  // دورة الخدمات: فشل أول (لم تبلغ العتبة) ثم فشل ثانٍ ⇒ down
  svc.checkDueServices({ probes, notifier });
  await new Promise((r) => setTimeout(r, 150));
  let row = db.prepare('SELECT status, consecutive_failures FROM monitored_services WHERE id = ?').get(serviceId);
  assert.equal(row.status, 'unknown');
  assert.equal(row.consecutive_failures, 1);

  // نجبر الاستحقاق بتصفير آخر فحص ثم نفحص مرة ثانية
  db.prepare("UPDATE monitored_services SET last_checked_at = NULL WHERE id = ?").run(serviceId);
  svc.checkDueServices({ probes, notifier });
  await new Promise((r) => setTimeout(r, 150));

  row = db.prepare('SELECT status, last_error FROM monitored_services WHERE id = ?').get(serviceId);
  assert.equal(row.status, 'offline');
  assert.match(String(row.last_error), /8069/);

  const dev = db.prepare('SELECT host_status, current_status, overall_health FROM devices WHERE id = ?').get(deviceId);
  assert.equal(dev.host_status, 'online', 'المضيف ما زال متصلًا (Ping ناجح)');
  assert.equal(dev.current_status, 'online');
  assert.equal(dev.overall_health, 'degraded', 'خدمة متوقفة ⇒ DEGRADED وليس أخضر كاذبًا');

  assert.deepEqual(alerts, [['down', 'Odoo ERP']], 'تنبيه انقطاع خدمة واحد فقط (لا تكرار)');

  // سجل الخدمة حُفظ
  const logs = db.prepare('SELECT status FROM service_status_logs WHERE service_id = ? ORDER BY id').all(serviceId).map((r) => r.status);
  assert.deepEqual(logs, ['offline'], 'فشل واحد بعد العتبة ⇒ سطر واحد في السجل');

  // العودة: المنفذ يستجيب ⇒ online + تنبيه عودة + DEGRADED يزول
  db.prepare("UPDATE monitored_services SET last_checked_at = NULL WHERE id = ?").run(serviceId);
  svc.checkDueServices({ probes: { ...probes, port: async () => ({ isOnline: true, responseTimeMs: 12 }) }, notifier });
  await new Promise((r) => setTimeout(r, 150));

  assert.equal(db.prepare('SELECT status FROM monitored_services WHERE id = ?').get(serviceId).status, 'online');
  assert.equal(db.prepare('SELECT overall_health FROM devices WHERE id = ?').get(deviceId).overall_health, 'online');
  assert.deepEqual(alerts, [['down', 'Odoo ERP'], ['recovered', 'Odoo ERP']], 'تنبيه عودة واحد فقط');

  // تنظيف الخدمة لبقية الاختبارات
  assert.equal(svc.removeById(serviceId).ok, true);
  svc.recomputeOverallHealth(deviceId);
});

test('MON-02: مطابق الحالة المتوقعة (نقي) — 2xx / رمز / مدى / قائمة', () => {
  const m2xx = statusMatcher('2xx');
  assert.equal(m2xx(200), true);
  assert.equal(m2xx(204), true);
  assert.equal(m2xx(299), true);
  assert.equal(m2xx(301), false);

  const m200 = statusMatcher('200');
  assert.equal(m200(200), true);
  assert.equal(m200(201), false);

  const range = statusMatcher('200-299');
  assert.equal(range(250), true);
  assert.equal(range(300), false);

  const list = statusMatcher('200,204,301');
  assert.equal(list(204), true);
  assert.equal(list(301), true);
  assert.equal(list(302), false);

  assert.equal(statusMatcher('abc'), null, 'صيغة غير صالحة ⇒ null');
  assert.equal(statusMatcher('200-100'), null);
  const literal999 = statusMatcher('999');
  assert.equal(typeof literal999, 'function', 'رمز من 3 أرقام يُقبل شكليًّا');
  assert.equal(literal999(999), true);
});

test('MON-02: تحقق المدخلات (نقي) — يرفض الأنواع والمنافذ والمعطيات غير الصالحة', () => {
  assert.equal(validateServiceInput({ name: 'x', kind: 'ftp' }).ok, false);
  assert.equal(validateServiceInput({ name: 'x', kind: 'tcp' }).ok, false, 'tcp بلا منفذ مرفوض');
  assert.equal(validateServiceInput({ name: 'x', kind: 'tcp', port: 70000 }).ok, false);
  assert.equal(validateServiceInput({ name: '', kind: 'http' }).ok, false);
  assert.equal(validateServiceInput({ name: 'x', kind: 'https', expect_status: 'abc' }).ok, false);
  assert.equal(validateServiceInput({ name: 'x', kind: 'http', url_path: 'no-slash' }).ok, false);
  assert.equal(validateServiceInput({ name: 'x', kind: 'http', interval_seconds: 3 }).ok, false);

  const ok = validateServiceInput({ name: 'Odoo', kind: 'https', port: 443, expect_status: '200-299', url_path: '/web/login', is_critical: 1 });
  assert.equal(ok.ok, true, ok.error);
  assert.equal(ok.value.expect_status, '200-299');
  assert.equal(ok.value.is_critical, 1);
  assert.equal(ok.value.verify_tls === undefined || ok.value.verify_tls === 1 || ok.value.verify_tls === 0, true);

  // التعديل الجزئي لا يفرض الحقول الغائبة
  assert.equal(validateServiceInput({ is_enabled: 0 }, { partial: true }).ok, true);
});

test('MON-02: استحقاق الفحص بفاصل الخدمة (نقي)', () => {
  const now = Date.now();
  assert.equal(intervalDue(null, 60, now), true);
  assert.equal(intervalDue(new Date(now - 30e3).toISOString(), 60, now), false);
  assert.equal(intervalDue(new Date(now - 61e3).toISOString(), 60, now), true);
});

test('MON-02: واجهة إدارة الخدمات عبر HTTP — الصلاحيات والتحقق', async () => {
  // المجهول يُرفض (401) — كل مسارات الخدمات محمية
  assert.equal((await anon.get(`/api/devices/${deviceId}/services`)).status, 401);
  assert.equal((await anon.post(`/api/devices/${deviceId}/services`, { name: 'x', kind: 'http' })).status, 401);

  // حساب العرض يقرأ ولا يعدّل
  const vGet = await viewer.get(`/api/devices/${deviceId}/services`);
  assert.equal(vGet.status, 200);
  assert.equal((await vGet.json()).success, true);
  const vPost = await viewer.post(`/api/devices/${deviceId}/services`, { name: 'x', kind: 'http' });
  assert.equal(vPost.status, 403);

  // المدير ينشئ خدمة صحيحة
  const created = await admin.post(`/api/devices/${deviceId}/services`, {
    name: 'واجهة Odoo', kind: 'https', port: 443, url_path: '/web/login', expect_status: '200-299', verify_tls: 1,
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  const id = createdBody.data.id;
  assert.equal(createdBody.data.status, 'unknown', 'الحالة تبدأ unknown حتى أول فحص');
  assert.equal(createdBody.data.verify_tls, 1, 'التحقق من الشهادة مفعّل افتراضيًّا');

  // مدخلات غير صالحة ⇒ 400 برسالة عربية (رسائل التحقق تتبع لغة الواجهة ⇒ نُثبّتها عربيًا هنا)
  require('../src/services/ui-language.service').setLang('ar');
  const bad = await admin.post(`/api/devices/${deviceId}/services`, { name: 'bad', kind: 'tcp', port: 99999 });
  assert.equal(bad.status, 400);
  assert.match(JSON.parse(await readText(bad)).error, /منفذ/);

  // جهاز غير موجود ⇒ 404
  assert.equal((await admin.post('/api/devices/999999/services', { name: 'x', kind: 'http' })).status, 404);

  // تعديل جزئي
  const upd = await admin.put(`/api/devices/${deviceId}/services/${id}`, { is_enabled: 0, name: 'واجهة Odoo (معطّلة)' });
  assert.equal(upd.status, 200);
  const updBody = await upd.json();
  assert.equal(updBody.data.is_enabled, 0);
  assert.equal(updBody.data.name, 'واجهة Odoo (معطّلة)');

  // الحذف + التدقيق
  const del = await admin.del(`/api/devices/${deviceId}/services/${id}`);
  assert.equal(del.status, 200);
  assert.equal((await admin.get(`/api/devices/${deviceId}/services`)).status, 200);

  const auditEvents = db.prepare("SELECT event FROM audit_log WHERE event LIKE 'service_%' ORDER BY id").all().map((r) => r.event);
  assert.deepEqual(auditEvents, ['service_create', 'service_update', 'service_delete'], 'كل تعديل خدمة مُسجَّل في التدقيق');
});

test('MON-02: الطلب العام المنقّى يحمل عدد الخدمات المتوقفة بلا أسماء', async () => {
  const created = svc.createForDevice(deviceId, { name: 'خدمة سرية للاختبار', kind: 'tcp', port: 1234, is_enabled: 1 });
  assert.equal(created.ok, true);
  db.prepare("UPDATE monitored_services SET status = 'offline' WHERE id = ?").run(created.service.id);
  svc.recomputeOverallHealth(deviceId);

  const res = await anon.get('/api/public/status');
  assert.equal(res.status, 200);
  const body = await res.json();
  const d = body.data.find((x) => x.id === deviceId);
  assert.equal(d.services_down_count, 1);
  assert.equal(d.overall_health, 'degraded', 'الحالة العامة المنقّاة تُظهر DEGRADED');
  assert.ok(!JSON.stringify(body).includes('خدمة سرية للاختبار'), 'أسماء الخدمات لا تظهر للزوار');
  assert.ok(!JSON.stringify(body).includes('8069'), 'منافذ الخدمات لا تظهر للزوار');

  svc.removeById(created.service.id);
  svc.recomputeOverallHealth(deviceId);
});
