// اختبارات لغة الإشعارات (ar | en) — إعداد **مستقل** عن لغة الواجهة.
// يتحقّق من: الافتراضي (إنجليزي) والتحقّق من القيمة، أن القراءة لأي جلسة والكتابة للمدير فقط،
// أن الإعداد يُحفظ فعلًا ويُسجَّل في سجل التدقيق، وأن الإعدادين (الواجهة/الإشعارات) لا يتداخلان.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnv, startServer, seedUser, makeClient } = require('./helpers/test-app');

const env = setupTestEnv();
const ntfLang = require('../src/services/notification-language.service');
const uiLang = require('../src/services/ui-language.service');
const db = require('../src/db');

let srv, admin, viewer;

test.before(async () => {
  srv = await startServer();
  seedUser(db, 'admin_ntf', 'AdminPass123!', 'admin');
  seedUser(db, 'viewer_ntf', 'ViewerPass123!', 'viewer');
  admin = makeClient(srv.baseUrl);
  viewer = makeClient(srv.baseUrl);
  assert.equal((await admin.login('admin_ntf', 'AdminPass123!')).status, 200);
  assert.equal((await viewer.login('viewer_ntf', 'ViewerPass123!')).status, 200);
});

test.after(async () => {
  await srv.close();
  env.cleanup();
});

test('لغة الإشعارات الافتراضية إنجليزي، والمفتاح والقيم المقبولة صحيحة', () => {
  assert.equal(ntfLang.getLang(), 'en');
  assert.equal(ntfLang.SETTING_KEY, 'notification_language');
  assert.deepEqual(ntfLang.LANGS, ['ar', 'en']);
  assert.equal(ntfLang.normalize('AR'), 'ar');
  assert.equal(ntfLang.normalize(' en '), 'en');
  assert.equal(ntfLang.normalize('fr'), null);
  assert.equal(ntfLang.normalize(''), null);
});

test('متغيّر البيئة NM_NOTIFICATION_LANGUAGE يُحترم عند غياب إعداد قاعدة البيانات', () => {
  db.prepare("DELETE FROM app_settings WHERE key = 'notification_language'").run();
  process.env.NM_NOTIFICATION_LANGUAGE = 'ar';
  try {
    assert.equal(ntfLang.getLang(), 'ar');
    assert.equal(ntfLang.getLangSource(), 'env');
  } finally {
    delete process.env.NM_NOTIFICATION_LANGUAGE;
  }
  assert.equal(ntfLang.getLang(), 'en');
  assert.equal(ntfLang.getLangSource(), 'default');
});

test('قيمة غير صالحة تُرفض ولا تُحفظ', () => {
  const r = ntfLang.setLang('english');
  assert.equal(r.ok, false);
  assert.match(r.error, /ar \| en/);
  assert.equal(ntfLang.getLang(), 'en');
});

test('GET يحتاج جلسة (بخلاف لغة الواجهة) — ويقرؤه أي دور مسجَّل', async () => {
  const anon = await fetch(srv.baseUrl + '/api/settings/notification-language');
  assert.equal(anon.status, 401);

  const res = await viewer.get('/api/settings/notification-language');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.notification_language, 'en');
  assert.deepEqual(body.data.allowed, ['ar', 'en']);
  assert.equal(body.data.env_var, 'NM_NOTIFICATION_LANGUAGE');
});

test('الكتابة للمدير فقط — حساب «عرض» يُرفض، والمدير يُحفظ إعداده', async () => {
  const denied = await viewer.put('/api/settings/notification-language', { notification_language: 'ar' });
  assert.equal(denied.status, 403);
  assert.equal(ntfLang.getLang(), 'en');

  const okRes = await admin.put('/api/settings/notification-language', { notification_language: 'ar' });
  assert.equal(okRes.status, 200);
  const okBody = await okRes.json();
  assert.equal(okBody.data.notification_language, 'ar');
  assert.equal(ntfLang.getLang(), 'ar');
  assert.equal(ntfLang.getLangSource(), 'database');
});

test('الإعدادان مستقلّان: تغيير لغة الإشعارات لا يغيّر لغة الواجهة', async () => {
  assert.equal(ntfLang.getLang(), 'ar');
  assert.equal(uiLang.getLang(), 'en');
  const r = await admin.put('/api/settings/ui-language', { ui_language: 'en' });
  assert.equal(r.status, 200);
  assert.equal(ntfLang.getLang(), 'ar');   // لغة الإشعارات ما زالت عربية
  assert.equal(uiLang.getLang(), 'en');
});

test('تغيير لغة الإشعارات يُسجَّل في سجل التدقيق', async () => {
  await admin.put('/api/settings/notification-language', { notification_language: 'en' });
  const row = db.prepare(
    "SELECT * FROM audit_log WHERE event = 'settings_change' ORDER BY id DESC LIMIT 5"
  ).all().find((r) => String(r.target || '').includes('notification_language') || String(r.details || '').includes('notification_language'));
  assert.ok(row, 'سطر تدقيق لتغيير لغة الإشعارات موجود');
  db.prepare("DELETE FROM app_settings WHERE key = 'notification_language'").run();   // رجوع للافتراضي
});
