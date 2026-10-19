// TZ-01 (2026-10-18) — اختبارات المنطقة الزمنية للجدولة (طلب المالك: «ينفع نخلى ظبط التوقيت
// من لوحة التحكم» + «ضيف كمان ان فى توقيت صيفى و شتوى»).
// التغطية: (a) ذهاب وعودة حفظ/قراءة المنطقة · (b) رفض منطقة غير صالحة / إزاحة ثابتة بـ400
// · (c) الفراغ = توقيت الخادم المحلي (السلوك القديم بالحرف) · (d) مساعد المجدولات
// { timezone } عند الضبط ولا شيء عند الفراغ · (e) إثبات أن التوقيت الصيفي (DST) يُحسب تلقائيًّا:
// نفس 10:30 محليًّا في القاهرة = 07:30 UTC في يوليو و08:30 UTC في ديسمبر.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnv, startServer, seedUser, makeClient } = require('./helpers/test-app');

const env = setupTestEnv();

const db = require('../src/db');
const schedulerTime = require('../src/services/scheduler-time.service');

let srv, admin;

test.before(async () => {
  // رسائل الرفض تُفحص بالصياغة العربية (نمط notify-channels) ⇒ تثبيت عربي.
  require('../src/services/ui-language.service').setLang('ar');
  srv = await startServer();
  seedUser(db, 'admin_tz', 'AdminPass123!', 'admin');
  admin = makeClient(srv.baseUrl);
  assert.equal((await admin.login('admin_tz', 'AdminPass123!')).status, 200);
});

test.after(async () => { if (srv) await srv.close(); env.cleanup(); });

test('T-tz: (a) حفظ المنطقة الزمنية والعودة بها (round-trip من الـAPI وإلى القاعدة)', async () => {
  const r = await admin.put('/api/notifications/settings', { timezone: 'Africa/Cairo' });
  assert.equal(r.status, 200);
  const g = await admin.get('/api/notifications/settings');
  assert.equal(g.status, 200);
  const j = await g.json();
  assert.equal(j.data.timezone, 'Africa/Cairo', 'GET يعيد المنطقة كما حُفظت');
  assert.equal(
    db.prepare('SELECT timezone FROM notification_settings WHERE id = 1').get().timezone,
    'Africa/Cairo',
    'والقاعدة نفسها تحمل المنطقة (عمود timezone الجديد)'
  );
});

test('T-tz: (b) منطقة غير صالحة ⇒ 400 برسالة واضحة، والقيمة المحفوظة لا تتغيّر', async () => {
  const r = await admin.put('/api/notifications/settings', { timezone: 'Not/AZone' });
  assert.equal(r.status, 400, 'منطقة وهمية تُرفض');
  const j = await r.json();
  assert.equal(j.success, false);
  assert.match(j.error, /Not\/AZone/, 'الرسالة تسمّي القيمة المرفوضة');
  assert.match(j.error, /Africa\/Cairo/, 'وترشد لصيغة IANA صحيحة');
  assert.equal(
    db.prepare('SELECT timezone FROM notification_settings WHERE id = 1').get().timezone,
    'Africa/Cairo',
    'الرفض قبل الكتابة — القيمة السابقة باقية'
  );

  // إزاحة ثابتة (+03:00) مرفوضة أيضًا: القرار «اسم منطقة IANA فقط» لأن الإزاحة الثابتة
  // تُجمّد التوقيت الصيفي (المالك طلبه صريحًا: «ضيف كمان ان فى توقيت صيفى و شتوى»).
  const r2 = await admin.put('/api/notifications/settings', { timezone: '+03:00' });
  assert.equal(r2.status, 400, 'لا إزاحات ثابتة — اسم منطقة فقط');
  assert.match((await r2.json()).error, /\+03:00/);
});

test('T-tz: (c) الفراغ/null = توقيت الخادم المحلي (السلوك القديم بلا تغيير)', async () => {
  const r = await admin.put('/api/notifications/settings', { timezone: '' });
  assert.equal(r.status, 200);
  assert.equal(
    db.prepare('SELECT timezone FROM notification_settings WHERE id = 1').get().timezone,
    null,
    'الفراغ يُصفَّر إلى NULL'
  );
  const g = await admin.get('/api/notifications/settings');
  assert.equal((await g.json()).data.timezone, '', 'GET يعرض فارغًا (توقيت الخادم)');
  assert.equal(schedulerTime.schedulerTimezone(), null);
  assert.equal(schedulerTime.cronSchedulerOptions(), undefined);
  // وقت الحائط بلا منطقة = getHours/getMinutes القديمة بالحرف.
  const now = new Date();
  assert.equal(
    schedulerTime.wallClockIn(null, now).hm,
    String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
  );
});

test('T-tz: (d) مساعد المجدولات → { timezone } عند الضبط ولا شيء عند الفراغ', () => {
  db.prepare('UPDATE notification_settings SET timezone = ? WHERE id = 1').run('Africa/Cairo');
  assert.equal(schedulerTime.schedulerTimezone(), 'Africa/Cairo');
  assert.deepEqual(schedulerTime.cronSchedulerOptions(), { timezone: 'Africa/Cairo' });

  db.prepare('UPDATE notification_settings SET timezone = NULL WHERE id = 1').run();
  assert.equal(schedulerTime.schedulerTimezone(), null);
  assert.equal(schedulerTime.cronSchedulerOptions(), undefined, 'undefined ⇒ node-cron بلا خيار = السلوك القديم');
});

test('T-tz: (e) التوقيت الصيفي: 10:30 بالقاهرة = 07:30 UTC صيفًا و08:30 UTC شتاءً', () => {
  // 1) الإزاحة من Intl مباشرة لمنتصف يوليو ومنتصف ديسمبر (مصر: +3 صيفًا · +2 شتاءً).
  const longOffset = (zone, date) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(date);
    return (parts.find((p) => p.type === 'timeZoneName') || {}).value;
  };
  const july = new Date('2026-07-15T12:00:00.000Z');
  const december = new Date('2026-12-15T12:00:00.000Z');
  assert.equal(longOffset('Africa/Cairo', july), 'GMT+03:00');
  assert.equal(longOffset('Africa/Cairo', december), 'GMT+02:00');

  // 2) الإزاحات بالدقائق من مساعد المجدولات: تختلف بساعة واحدة بالضبط، والساعة المحلية واحدة.
  const offJuly = schedulerTime.zoneOffsetMinutes('Africa/Cairo', july);
  const offDec = schedulerTime.zoneOffsetMinutes('Africa/Cairo', december);
  assert.equal(offJuly, 180);
  assert.equal(offDec, 120);
  assert.equal(offJuly - offDec, 60, 'فارق ساعة واحدة بين الصيفي والشتوي');

  // نفس وقت الحائط 10:30 في اللحظتين (07:30Z صيفًا · 08:30Z شتاءً).
  assert.equal(schedulerTime.wallClockIn('Africa/Cairo', new Date('2026-07-15T07:30:00.000Z')).hm, '10:30');
  assert.equal(schedulerTime.wallClockIn('Africa/Cairo', new Date('2026-12-15T08:30:00.000Z')).hm, '10:30');

  // 3) أوقات الإطلاق التالية لتقرير 10:30 بالقاهرة — تُبنى على قواعد المنطقة نفسها
  // (نفس ما يفعله خيار timezone في node-cron): يوليو 07:30Z · ديسمبر 08:30Z.
  const nextJuly = schedulerTime.nextReportDates('10:30', 'Africa/Cairo', 1, new Date('2026-07-14T00:00:00.000Z'));
  assert.equal(nextJuly.length, 1);
  assert.equal(nextJuly[0].toISOString(), '2026-07-14T07:30:00.000Z', 'صيفًا: 10:30 القاهرة = 07:30 UTC');
  const nextDec = schedulerTime.nextReportDates('10:30', 'Africa/Cairo', 1, new Date('2026-12-14T00:00:00.000Z'));
  assert.equal(nextDec.length, 1);
  assert.equal(nextDec[0].toISOString(), '2026-12-14T08:30:00.000Z', 'شتاءً: 10:30 القاهرة = 08:30 UTC');
});
