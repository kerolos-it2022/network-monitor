// اختبارات SEC-02 — فصل العرض العام المنقّى عن الجرد الداخلي المحمي.
// T02 (BACKLOG_AND_TESTS): «أي استجابة مجهولة لا تحوي IP/MAC/سيريال/بيانات داخلية،
// والواجهة العامة تظل تعمل عبر تغذية منقّاة».
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnv, startServer, seedUser, makeClient, readText } = require('./helpers/test-app');

// ⚠️ ترتيب إلزامي: تهيئة البيئة (DB مؤقت) **قبل** أي require لوحدات src
// (db.js يفتح القاعدة عند التحميل — لو حُمّل قبل التهيئة سيكتب في قاعدة المشروع الحقيقية).
const env = setupTestEnv();
const pd = require('../src/services/public-display.service');

let srv, db;
let anon, admin, viewer;
let devA, devB; // أجهزة الاختبار
const IP_A = '192.168.88.50';
const IP_B = '192.168.88.51';

test.before(async () => {
  srv = await startServer();
  db = srv.db;

  // بيانات اختبار: موقع + جهازان (أحدهما متوقف بانقطاع مفتوح) + سجلات حالة.
  const locId = db.prepare("INSERT INTO locations (name, kind) VALUES ('قسم الاختبار', 'zone')").run().lastInsertRowid;
  const typeId = db.prepare('SELECT id FROM device_types LIMIT 1').get().id;
  devA = db.prepare(
    `INSERT INTO devices (name, ip, device_type_id, location_id, check_protocol, port, web_port,
                          is_active, current_status, http_accessible, last_response_time_ms, last_checked_at, pos_x, pos_y)
     VALUES ('جهاز اختبار A', ?, ?, ?, 'ping', 22, 4444, 1, 'online', 1, 12, ?, 120, 80)`
  ).run(IP_A, typeId, locId, new Date().toISOString()).lastInsertRowid;
  devB = db.prepare(
    `INSERT INTO devices (name, ip, device_type_id, location_id, check_protocol, port, web_port,
                          is_active, current_status, http_accessible, last_response_time_ms, last_checked_at, pos_x, pos_y)
     VALUES ('جهاز اختبار B', ?, ?, ?, 'port', 8069, NULL, 1, 'offline', 0, NULL, ?, 200, 160)`
  ).run(IP_B, typeId, locId, new Date().toISOString()).lastInsertRowid;
  // الجهاز B تابع للجهاز A (لاختبار بنية الشجرة)
  db.prepare('UPDATE devices SET parent_id = ? WHERE id = ?').run(devA, devB);
  // سجلات حالة (24 ساعة) + انقطاع مفتوح
  const now = new Date().toISOString();
  db.prepare('INSERT INTO status_logs (device_id, status, response_time_ms, checked_at) VALUES (?, ?, ?, ?)').run(devA, 'online', 12, now);
  db.prepare('INSERT INTO status_logs (device_id, status, response_time_ms, checked_at) VALUES (?, ?, ?, ?)').run(devA, 'online', 15, now);
  db.prepare('INSERT INTO status_logs (device_id, status, response_time_ms, checked_at) VALUES (?, ?, ?, ?)').run(devB, 'offline', null, now);
  db.prepare('INSERT INTO downtime_events (device_id, started_at) VALUES (?, ?)').run(devB, new Date(Date.now() - 3600e3).toISOString());

  seedUser(db, 'admin_s2', 'AdminPass123!', 'admin');
  seedUser(db, 'viewer_s2', 'ViewerPass123!', 'viewer');
  anon = makeClient(srv.baseUrl);
  admin = makeClient(srv.baseUrl);
  viewer = makeClient(srv.baseUrl);
  assert.equal((await admin.login('admin_s2', 'AdminPass123!')).status, 200);
  assert.equal((await viewer.login('viewer_s2', 'ViewerPass123!')).status, 200);
});

test.after(async () => {
  await srv.close();
  env.cleanup();
});

test('T02: المسارات الداخلية لم تعد مجهولة (401) — devices/topology/scan', async () => {
  const paths = [
    '/api/devices',
    '/api/devices/' + devA,
    '/api/devices/' + devA + '/history?range=24h',
    '/api/topology',
    '/api/scan/last',
    '/api/discovered',
    '/api/map/tree',
  ];
  for (const p of paths) {
    const res = await anon.get(p);
    assert.equal(res.status, 401, `${p} يجب أن يُعيد 401 للمجهول`);
  }
  // كتابات المسح (كانت متاحة للمجهول كليًّا!)
  for (const p of ['/api/scan/subnet', '/api/scan/bulk-add', '/api/scan/cancel/xyz']) {
    const res = await anon.post(p, { cidr: '192.168.88.0/24' });
    assert.equal(res.status, 401, `${p} يجب أن يُعيد 401 للمجهول`);
  }
});

test('T02: /api/public/status يعمل للمجهول وبلا أي حقل حساس', async () => {
  const res = await anon.get('/api/public/status');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.data) && body.data.length >= 2);
  assert.deepEqual(pd.assertNoForbiddenKeys(body.data), [], 'لا يجب ظهور أي مفتاح ممنوع');
  const raw = JSON.stringify(body);
  assert.ok(!raw.includes(IP_A) && !raw.includes(IP_B), 'لا يجب أن تظهر عناوين IP في الاستجابة العامة');
  const a = body.data.find((d) => d.id === devA);
  assert.ok(a && a.name === 'جهاز اختبار A' && a.status === 'online');
  assert.ok(a.device_type_name && a.location_name === 'قسم الاختبار');
});

test('T02: /api/public/devices/:id و /history يعملان بلا بيانات اتصال', async () => {
  const d = await anon.get('/api/public/devices/' + devA);
  assert.equal(d.status, 200);
  const det = await d.json();
  assert.equal(det.data.id, devA);
  assert.deepEqual(pd.assertNoForbiddenKeys(det.data), []);
  assert.ok(!JSON.stringify(det).includes(IP_A));

  const h = await anon.get('/api/public/devices/' + devB + '/history?range=24h');
  assert.equal(h.status, 200);
  const hist = await h.json();
  assert.equal(hist.data.range, '24h');
  assert.equal(typeof hist.data.uptime_percentage, 'number');
  assert.ok(Array.isArray(hist.data.status_points) && hist.data.status_points.length >= 1);
  assert.ok(Array.isArray(hist.data.downtime_events) && hist.data.downtime_events.length === 1);
  assert.equal(hist.data.downtime_events[0].ended_at, null, 'الانقطاع لا يزال مفتوحًا');

  const missing = await anon.get('/api/public/devices/999999');
  assert.equal(missing.status, 404);
});

test('T02: /api/public/topology شجرة منقّاة (بلا IP) وفي وضع lan تحمل الإحداثيات', async () => {
  const res = await anon.get('/api/public/topology');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.display_mode, 'lan');
  assert.deepEqual(pd.assertNoForbiddenKeys(body.data), []);
  assert.ok(!JSON.stringify(body).includes(IP_A));
  // الجهاز B يجب أن يظهر كابن للجهاز A (بنية الشجرة محفوظة)
  const flat = [];
  (function walk(list) { for (const n of list) { flat.push(n); if (n.children) walk(n.children); } })(body.data);
  const nodeA = flat.find((n) => n.type === 'device' && n.id === devA);
  const nodeB = flat.find((n) => n.type === 'device' && n.id === devB);
  assert.ok(nodeA && nodeB);
  assert.equal(nodeA.pos_x, 120);
  assert.equal(nodeB.offline_since != null, true, 'يجب أن تحمل العقدة بداية الانقطاع');
  assert.ok(nodeA.children.some((c) => c.id === devB));
});

test('T02: شكل عقد الشجرة العامة مطابق لما تتوقعه شاشة NOC (عقد كاملة الحقول)', async () => {
  const res = await anon.get('/api/public/topology');
  const body = await res.json();
  const flat = [];
  (function walk(list) { for (const n of list) { flat.push(n); if (n.children) walk(n.children); } })(body.data);
  const dev = flat.find((n) => n.type === 'device' && n.id === devA);
  const loc = flat.find((n) => n.type === 'location');
  assert.ok(dev, 'يجب وجود عقدة جهاز');
  for (const k of ['id', 'name', 'status', 'pathDown', 'offline_since', 'device_type_name', 'parent_id', 'location_id', 'pos_x', 'pos_y', 'children']) {
    assert.ok(k in dev, `عقدة الجهاز يجب أن تحمل الحقل "${k}" (تستعمله noc.js)`);
  }
  assert.ok(loc, 'يجب وجود عقدة موقع');
  for (const k of ['id', 'name', 'kind', 'parent_id', 'pos_x', 'pos_y', 'children']) {
    assert.ok(k in loc, `عقدة الموقع يجب أن تحمل الحقل "${k}" (تستعمله noc.js)`);
  }
  // ولا حقل IP في أي عقدة
  assert.ok(!('ip' in dev) && !('ip' in loc));
});

test('T02: /api/map/public/tree لم يعد يسرّب عناوين الأجهزة', async () => {
  const res = await anon.get('/api/map/public/tree');
  assert.equal(res.status, 200);
  const raw = await readText(res);
  assert.ok(!raw.includes(IP_A) && !raw.includes(IP_B), 'يجب ألا تظهر عناوين IP في شجرة الخريطة العامة');
  const body = JSON.parse(raw);
  assert.deepEqual(pd.assertNoForbiddenKeys(body.data), []);
});

test('T02: الجلسة الداخلية ترى البيانات الكاملة (admin/viewer قراءة)', async () => {
  const aRes = await admin.get('/api/devices');
  assert.equal(aRes.status, 200);
  const aBody = await aRes.json();
  const fullA = aBody.data.find((d) => d.id === devA);
  assert.equal(fullA.ip, IP_A, 'المسار المحمي يجب أن يعيد IP كاملًا');
  assert.equal(fullA.port, 22);

  const vRes = await viewer.get('/api/devices');
  assert.equal(vRes.status, 200, 'حساب العرض يقرأ الجرد الداخلي');

  // viewer لا يملك أي كتابة (الوسيط المركزي)
  const vPost = await viewer.post('/api/devices', { name: 'x', ip: '10.0.0.9', device_type_id: 1 });
  assert.equal(vPost.status, 403);
});

test('T02: وضع العرض قابل للضبط (lan/minimal/off) ويُطبَّق فورًا', async () => {
  // قيمة غير صالحة ⇒ 400
  const bad = await admin.put('/api/settings/public-display', { mode: 'everything' });
  assert.equal(bad.status, 400);

  // viewer لا يضبط الإعدادات
  const vPut = await viewer.put('/api/settings/public-display', { mode: 'off' });
  assert.equal(vPut.status, 403);

  // minimal ⇒ قائمة مسطّحة بلا إحداثيات/بنية
  const toMin = await admin.put('/api/settings/public-display', { mode: 'minimal' });
  assert.equal(toMin.status, 200);
  const minRes = await anon.get('/api/public/topology');
  const minBody = await minRes.json();
  assert.equal(minBody.display_mode, 'minimal');
  assert.ok(Array.isArray(minBody.data));
  assert.ok(minBody.data.every((n) => n.type === 'device'), 'الوضع minimal = أجهزة مسطّحة فقط');
  assert.equal(minBody.data[0].pos_x, undefined, 'بلا إحداثيات في الوضع minimal');

  // off ⇒ 403 على كل العرض العام والبثّ الحيّ
  const toOff = await admin.put('/api/settings/public-display', { mode: 'off' });
  assert.equal(toOff.status, 200);
  assert.equal((await anon.get('/api/public/status')).status, 403);
  assert.equal((await anon.get('/api/public/topology')).status, 403);
  assert.equal((await anon.get('/api/live/status')).status, 403);

  // العودة إلى lan (وكذلك المسار المحمي يعمل دائمًا)
  const toLan = await admin.put('/api/settings/public-display', { mode: 'lan' });
  assert.equal(toLan.status, 200);
  assert.equal((await anon.get('/api/public/status')).status, 200);
  assert.equal((await admin.get('/api/devices')).status, 200);

  // قراءة الإعداد الحالي (admin)
  const get = await admin.get('/api/settings/public-display');
  assert.equal(get.status, 200);
  const g = await get.json();
  assert.equal(g.data.mode, 'lan');
  assert.equal(g.data.source, 'database');
});
