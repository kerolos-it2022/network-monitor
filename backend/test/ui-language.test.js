// اختبارات لغة الواجهة (ar | en) — إعداد واحد لكل الحاجات (لوحة + صفحة عامة + NOC).
// يتحقّق من: الافتراضي والتحقّق من القيمة، أن القراءة عامة والكتابة للمدير فقط، أن الإعداد يُحفظ
// فعلًا، وأنه يُرفَق في ردود العرض العام وشاشة NOC (فتضبط الصفحات لغتها بلا طلب إضافي)، وأن
// رسائل التطبيق في app.js (404 · 403 لحساب «عرض فقط» · 500) تتبع اللغة نفسها.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnv, startServer, seedUser, makeClient } = require('./helpers/test-app');

const env = setupTestEnv();
const uiLang = require('../src/services/ui-language.service');
const db = require('../src/db');

let srv, admin, viewer;

test.before(async () => {
  srv = await startServer();
  seedUser(db, 'admin_lang', 'AdminPass123!', 'admin');
  seedUser(db, 'viewer_lang', 'ViewerPass123!', 'viewer');
  admin = makeClient(srv.baseUrl);
  viewer = makeClient(srv.baseUrl);
  assert.equal((await admin.login('admin_lang', 'AdminPass123!')).status, 200);
  assert.equal((await viewer.login('viewer_lang', 'ViewerPass123!')).status, 200);
});

test.after(async () => {
  await srv.close();
  env.cleanup();
});

test('اللغة الافتراضية إنجليزي، والقيم المقبولة ar|en فقط', () => {
  assert.equal(uiLang.getLang(), 'en');
  assert.deepEqual(uiLang.LANGS, ['ar', 'en']);
  assert.equal(uiLang.normalize('EN'), 'en');
  assert.equal(uiLang.normalize(' en '), 'en');
  assert.equal(uiLang.normalize('fr'), null);
  assert.equal(uiLang.normalize(''), null);
});

test('متغيّر البيئة NM_UI_LANGUAGE يُحترم عند غياب إعداد قاعدة البيانات', () => {
  db.prepare("DELETE FROM app_settings WHERE key = 'ui_language'").run();
  process.env.NM_UI_LANGUAGE = 'ar';
  try {
    assert.equal(uiLang.getLang(), 'ar');
    assert.equal(uiLang.getLangSource(), 'env');
  } finally {
    delete process.env.NM_UI_LANGUAGE;
  }
  assert.equal(uiLang.getLang(), 'en');
  assert.equal(uiLang.getLangSource(), 'default');
});

test('قيمة غير صالحة تُرفض ولا تُحفظ', () => {
  const r = uiLang.setLang('fr');
  assert.equal(r.ok, false);
  assert.match(r.error, /ar \| en/);
  assert.equal(uiLang.getLang(), 'en');
});

test('GET للغة متاح بلا تسجيل دخول (صفحة الدخول والصفحة العامة تحتاجانه)', async () => {
  const res = await fetch(srv.baseUrl + '/api/settings/ui-language');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.ui_language, 'en');
  assert.deepEqual(body.data.allowed, ['ar', 'en']);
});

test('الكتابة للمدير فقط — حساب «عرض» يُرفض، والمدير يُحفظ إعداده', async () => {
  const denied = await viewer.put('/api/settings/ui-language', { ui_language: 'ar' });
  assert.equal(denied.status, 403);
  assert.equal(uiLang.getLang(), 'en');

  const okRes = await admin.put('/api/settings/ui-language', { ui_language: 'ar' });
  assert.equal(okRes.status, 200);
  const okBody = await okRes.json();
  assert.equal(okBody.data.ui_language, 'ar');
  assert.equal(uiLang.getLang(), 'ar');
  assert.equal(uiLang.getLangSource(), 'database');
});

test('اللغة تُرفَق في ردود الصفحة العامة وشاشة NOC (ونُعيدها إنجليزيًّا في النهاية)', async () => {
  const status = await fetch(srv.baseUrl + '/api/public/status');
  const statusBody = await status.json();
  assert.equal(statusBody.ui_language, 'ar');

  const topo = await fetch(srv.baseUrl + '/api/public/topology');
  const topoBody = await topo.json();
  assert.equal(topoBody.ui_language, 'ar');

  const noc = await fetch(srv.baseUrl + '/api/settings/noc-mode');
  const nocBody = await noc.json();
  assert.equal(nocBody.data.ui_language, 'ar');

  const back = await admin.put('/api/settings/ui-language', { ui_language: 'en' });
  assert.equal(back.status, 200);
  assert.equal(uiLang.getLang(), 'en');
});

test('تغيير اللغة يُسجَّل في سجل التدقيق', async () => {
  await admin.put('/api/settings/ui-language', { ui_language: 'ar' });
  const row = db.prepare(
    "SELECT * FROM audit_log WHERE event = 'settings_change' ORDER BY id DESC LIMIT 5"
  ).all().find((r) => String(r.target || '').includes('ui_language') || String(r.details || '').includes('ui_language'));
  assert.ok(row, 'سطر تدقيق لتغيير اللغة موجود');
  db.prepare("DELETE FROM app_settings WHERE key = 'ui_language'").run();   // رجوع للحالة الافتراضية
});

test('رسائل التطبيق الأساسية بلغتين: مسار غير موجود · حساب «عرض فقط» · خطأ داخلي', async () => {
  const brokenJson = () => fetch(srv.baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"username":',
  });

  // إنجليزي (الافتراضي بعد الاختبار السابق ⇒ حذف الإعداد)
  assert.equal(uiLang.getLang(), 'en');

  const notFoundEn = await fetch(srv.baseUrl + '/api/no-such-endpoint-xyz');
  assert.equal(notFoundEn.status, 404);
  assert.equal((await notFoundEn.json()).error, 'Path not found');

  const viewerEn = await viewer.post('/api/devices', { name: 'x', ip: '10.0.0.9' });
  assert.equal(viewerEn.status, 403);
  assert.equal(
    (await viewerEn.json()).error,
    'Your account is view-only and cannot make changes — contact the administrator'
  );

  const internalEn = await brokenJson();
  assert.equal(internalEn.status, 500);
  assert.equal((await internalEn.json()).error, 'Internal server error');

  // عربي — نفس النصوص القديمة حرفيًّا (عقد حماية للمخرَج العربي)
  await admin.put('/api/settings/ui-language', { ui_language: 'ar' });
  try {
    const notFoundAr = await fetch(srv.baseUrl + '/api/no-such-endpoint-xyz');
    assert.equal((await notFoundAr.json()).error, 'المسار غير موجود');

    const viewerAr = await viewer.post('/api/devices', { name: 'x', ip: '10.0.0.9' });
    assert.equal((await viewerAr.json()).error, 'حسابك (عرض فقط) لا يسمح بالتعديلات — تواصل مع المدير');

    const internalAr = await brokenJson();
    assert.equal((await internalAr.json()).error, 'خطأ داخلي في الخادم');
  } finally {
    await admin.put('/api/settings/ui-language', { ui_language: 'en' });
  }
});
