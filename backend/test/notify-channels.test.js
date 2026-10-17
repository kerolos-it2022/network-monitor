// اختبارات v2.33.0 — اختبار قناة إشعار واحدة + مؤشر حالة بوت تلجرام.
// لا شبكة: القنوات غير مفعّلة في بيئة الاختبار فتُرجَع «متخطّاة» بسبب واضح بلا أي إرسال.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnv, startServer, seedUser, makeClient } = require('./helpers/test-app');

const env = setupTestEnv();

const db = require('../src/db');

let srv, admin;

test.before(async () => {
  srv = await startServer();
  seedUser(db, 'admin_notify', 'AdminPass123!', 'admin');
  admin = makeClient(srv.baseUrl);
  assert.equal((await admin.login('admin_notify', 'AdminPass123!')).status, 200);
});

test.after(async () => { if (srv) await srv.close(); env.cleanup(); });

test('T-notify: اختبار قناة واحدة يرسل لها وحدها ويعيد سببها', async () => {
  const r = await admin.post('/api/notifications/test', { channel: 'telegram' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.data.channel, 'telegram', 'المسار يوضّح أنه اختبار قناة واحدة');
  assert.equal(Array.isArray(j.data.results), true);
  assert.equal(j.data.results.length, 1, 'قناة واحدة فقط تُختبر — لا إرسال للبقية');
  assert.equal(j.data.results[0].channel, 'telegram');
  assert.equal(j.data.results[0].ok, false, 'بلا توكن في بيئة الاختبار ⇒ لا إرسال فعلي');
  assert.match(String(j.data.results[0].reason || ''), /توكن|معطّلة/, 'السبب واضح للمالك');
});

test('T-notify: بلا channel ⇒ كل القنوات الثلاث (سلوك قديم محفوظ)', async () => {
  const r = await admin.post('/api/notifications/test', {});
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.data.channel, null);
  assert.equal(j.data.results.length, 3);
  assert.deepEqual(j.data.results.map((x) => x.channel).sort(), ['mobile', 'telegram', 'whatsapp']);
});

test('T-notify: قناة غير معروفة ⇒ 400 برسالة عربية تسمّي المتاح', async () => {
  const r = await admin.post('/api/notifications/test', { channel: 'sms' });
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.equal(j.success, false);
  assert.match(j.error, /sms/);
  assert.match(j.error, /telegram/);
});

test('T-bot: /api/system/stats يفضح حالة البوت (شغّال/واقف + السبب)', async () => {
  const r = await admin.get('/api/system/stats');
  assert.equal(r.status, 200);
  const j = await r.json();
  const b = j.data.bot;
  assert.equal(b && typeof b, 'object', 'حقل bot موجود في اللقطة');
  assert.equal(typeof b.running, 'boolean');
  assert.equal(typeof b.listening, 'boolean');
  assert.equal(typeof b.updatesHandled, 'number');
  for (const k of ['telegramEnabled', 'hasToken', 'hasChatId', 'commandsEnabled']) {
    assert.equal(typeof b[k], 'boolean', k + ' منطقي');
  }
  // بيئة الاختبار لا تُشغّل البوت ⇒ إمّا لم تبدأ الحلقة أو في انتظار اعتمادات
  assert.ok(['idle', 'waiting'].includes(b.mode), 'الوضع: ' + b.mode);
});

test('T-bot: getBotStatus لا يبدأ الحلقة ولا يكتب شيئًا (قراءة فقط)', async () => {
  const bot = require('../src/services/telegram-bot.service');
  assert.equal(typeof bot.getBotStatus, 'function');
  const before = bot.getBotStatus();
  const after = bot.getBotStatus();
  assert.equal(before.running, after.running);
  assert.equal(before.mode, after.mode, 'النداء المتكرر لا يغيّر الحالة');
});
