// اختبارات سياسة أدوات التشخيص من اللوحة — الأولوية: لوحة ← بيئة ← افتراضي، والتطبيق فوري.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnv, startServer, seedUser, makeClient, readText, collectSSE } = require('./helpers/test-app');

const env = setupTestEnv({ NM_PING_COUNT: '1' });

const policy = require('../src/services/tools-policy.service');
const db = require('../src/db');

let srv, admin, viewer;

test.before(async () => {
  srv = await startServer();
  seedUser(db, 'admin_pol', 'AdminPass123!', 'admin');
  seedUser(db, 'viewer_pol', 'ViewerPass123!', 'viewer');
  admin = makeClient(srv.baseUrl);
  viewer = makeClient(srv.baseUrl);
  assert.equal((await admin.login('admin_pol', 'AdminPass123!')).status, 200);
  assert.equal((await viewer.login('viewer_pol', 'ViewerPass123!')).status, 200);
});

test.after(async () => {
  await srv.close();
  env.cleanup();
});

test('السياسة: الافتراضي الآمن — المدير فقط + الشبكات الخاصة فقط', () => {
  const p = policy.getToolsPolicy({});
  assert.equal(p.minRole, 'admin');
  assert.equal(p.allowPublic, false);
  assert.equal(p.allowedCidrs, '');
  assert.equal(p.source.minRole, 'default');
  assert.equal(p.source.allowPublic, 'default');
});

test('السياسة: البيئة تُقرأ عندما لا يوجد إعداد في اللوحة', () => {
  const p = policy.getToolsPolicy({ NM_TOOLS_MIN_ROLE: 'viewer', NM_TOOLS_ALLOW_PUBLIC: '1', NM_TOOLS_ALLOWED_CIDRS: '10.0.0.0/8' });
  assert.equal(p.minRole, 'viewer');
  assert.equal(p.allowPublic, true);
  assert.equal(p.allowedCidrs, '10.0.0.0/8');
  assert.equal(p.source.minRole, 'env');
});

test('السياسة: إعداد اللوحة يتقدّم على البيئة (ويهزمها فعليًّا)', () => {
  const saved = policy.saveToolsPolicy({ min_role: 'viewer', allow_public: true, allowed_cidrs: '192.168.88.0/23' });
  assert.equal(saved.ok, true);
  const p = policy.getToolsPolicy({ NM_TOOLS_MIN_ROLE: 'admin', NM_TOOLS_ALLOW_PUBLIC: '0' });
  assert.equal(p.minRole, 'viewer', 'اللوحة تتقدّم');
  assert.equal(p.allowPublic, true);
  assert.equal(p.allowedCidrs, '192.168.88.0/23');
  assert.equal(p.source.minRole, 'dashboard');

  // القيم تُخزَّن في app_settings
  const rows = db.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'tools_%' ORDER BY key").all();
  assert.ok(rows.some((r) => r.key === 'tools_min_role' && r.value === 'viewer'));
  assert.ok(rows.some((r) => r.key === 'tools_allow_public' && r.value === '1'));
});

test('السياسة: التحقق من المدخلات — رتبة غير معروفة أو CIDR خطأ تُرفض', () => {
  assert.equal(policy.saveToolsPolicy({ min_role: 'superuser' }).ok, false);
  const badCidr = policy.saveToolsPolicy({ allowed_cidrs: '192.168.88.0/23, nonsense' });
  assert.equal(badCidr.ok, false);
  assert.match(badCidr.error, /غير صالح/);
  assert.equal(policy.validateCidrs('').ok, true);
  assert.equal(policy.validateCidrs('10.0.0.0/8, 192.168.1.1').ok, true, 'عنوان مفرد مقبول كـ/32');
});

test('الأثر الفوري: تغيير اللوحة يُطبَّق على الأدوات بلا إعادة تشغيل', async () => {
  // 1) viewer ممنوع افتراضيًّا؟ لا — السياسة الآن 'viewer' من الاختبار السابق ⇒ مسموح
  const allowed = await viewer.get('/api/tools/ping?ip=8.8.8.8');
  assert.equal(allowed.status, 200, 'الأهداف العامة مسموحة الآن (allow_public=1) والرتبة viewer');
  const events = await collectSSE(allowed);
  assert.equal(events[events.length - 1].event, 'done');

  // 2) نُعيد السياسة للمدير + الخاص فقط ⇒ viewer يُرفض، والعام يُرفض
  const back = await admin.put('/api/settings/tools-policy', { min_role: 'admin', allow_public: 0, allowed_cidrs: '' });
  assert.equal(back.status, 200);
  assert.equal((await viewer.get('/api/tools/ping?ip=192.168.88.1')).status, 403, 'viewer ممنوع الآن');
  assert.equal((await admin.get('/api/tools/ping?ip=8.8.8.8')).status, 403, 'العام ممنوع الآن');
  // والهدف الخاص ما زال يعمل للمدير
  assert.equal((await admin.get('/api/tools/ping?ip=127.0.0.1')).status, 200);
});

test('الواجهة: القراءة للمدير فقط والكتابة مُدقَّقة، وviewer لا يغيّر السياسة', async () => {
  assert.equal((await viewer.get('/api/settings/tools-policy')).status, 403);
  assert.equal((await viewer.put('/api/settings/tools-policy', { allow_public: 1 })).status, 403);

  const get = await admin.get('/api/settings/tools-policy');
  assert.equal(get.status, 200);
  const body = await get.json();
  assert.equal(body.data.min_role, 'admin');
  assert.match(body.data.effective.targets, /خاصة/);
  assert.equal(body.data.effective.anonymous.includes('ممنوع'), true);

  const put = await admin.put('/api/settings/tools-policy', { allowed_cidrs: '192.168.88.0/23' });
  assert.equal(put.status, 200);
  const after = await (await admin.get('/api/settings/tools-policy')).json();
  assert.equal(after.data.allowed_cidrs, '192.168.88.0/23');
  assert.match(after.data.effective.targets, /192\.168\.88\.0\/23/);

  // هدف داخل النطاق المخصّص يعمل، وخارجه يُرفض
  const inside = await admin.get('/api/tools/ping?ip=192.168.88.20');
  assert.equal(inside.status, 200);
  assert.equal((await admin.get('/api/tools/ping?ip=192.168.99.5')).status, 403, 'خارج النطاق المخصّص');

  const bad = await admin.put('/api/settings/tools-policy', { allowed_cidrs: 'not-a-cidr' });
  assert.equal(bad.status, 400);
  assert.match(JSON.parse(await readText(bad)).error, /غير صالح/);

  const audit = db.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE event = 'tools_policy_change'").get().c;
  assert.ok(audit >= 2, 'كل تغيير سياسة مُسجَّل في التدقيق');
});
