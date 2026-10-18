// log-i18n.test.js — زر لغة رسائل «📋 سجل الإشعارات» (ترجمة العرض في الواجهة).
//
// يحمي ثلاثة أشياء:
//   ١) الانحراف: كل «مِسلة» عربية في قواعد المترجم موجودة حرفيًا في ملفات السيرفر — فتغيير أي قالب
//      رسالة في السيرفر يُفشل الاختبار ويُلزم بتحديث القاعدة المقابلة في nm-log-i18n.js.
//   ٢) الواقع: نُشغّل مسارات الإرسال الفعلية بلا شبكة (axios موقوف) ثم نقرأ الصفوف المخزَّنة فعلًا في
//      notification_logs ونترجمها — فيُختبر النصّ الحقيقي بكل إيموجي/وسوم/تواريخه، لا نصًّا مؤلَّفًا.
//   ٣) الأمان: بيانات المستخدم (أسماء الأجهزة/المواقع/الخدمات) تبقى كما هي · سطر غير معروف يبقى كما
//      هو · لا `${`/`undefined` · تنظيف وسوم تلجرام في اللغتين · النصّ الفارغ/الفارغ كليًّا.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { setupTestEnv } = require('./helpers/test-app');
const env = setupTestEnv();

// ── شبكة مُوقَفة: axios لا يخرج للإنترنت إطلاقًا (الرسائل تُسجَّل كما لو أُرسلت) ──
const axiosPath = require.resolve('axios');
require.cache[axiosPath] = {
  id: axiosPath, filename: axiosPath, loaded: true, children: [], paths: [],
  exports: {
    post: async () => ({ data: { ok: true, result: { message_id: 1 } } }),
    get: async () => ({ data: {} }),
  },
};

const db = require('../src/db');
const notifier = require('../src/services/notifier.service');
const smartAlerts = require('../src/services/smart-alerts.service');
const escalation = require('../src/services/escalation.service');
const maintenance = require('../src/services/maintenance.service');

const FRONTEND_JS = path.join(__dirname, '..', '..', 'frontend', 'public', 'js', 'nm-log-i18n.js');
const BACKEND_FILES = [
  'src/services/notifier.service.js',
  'src/services/smart-alerts.service.js',
  'src/services/escalation.service.js',
  'src/services/scan-scheduler.service.js',
  'src/services/monitor.service.js',
  'src/routes/notifications.routes.js',
].map((f) => path.join(__dirname, '..', f));

/**
 * يحمّل مترجم الواجهة في صندوق رملي (بلا متصفح).
 * override = لغة اختارها المستخدم لشاشة السجل · ui = لغة الواجهة العامة.
 */
function loadTranslator(opts = {}) {
  const store = new Map();
  if (opts.override) store.set('nm.logLang', opts.override);
  const sandbox = {
    console: { warn() {}, log() {}, error() {} },
    window: {
      localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
      },
      NMI18N: { getLang: () => opts.ui || 'ar' },
    },
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(FRONTEND_JS, 'utf8'), sandbox, { filename: 'nm-log-i18n.js' });
  return sandbox.window.NMLogI18N;
}

const EN = loadTranslator({ override: 'en' });           // رسائل إنجليزية (اختيار صريح)
const AR = loadTranslator({ override: 'ar' });           // رسائل عربية (اختيار صريح)
const FOLLOW = loadTranslator({ ui: 'en' });             // بلا اختيار ⇒ تتبع لغة الواجهة

// بيانات مستخدم عربية مقصودة (لا تُترجم أبدًا) — تُستثنى من فحص «بقي عربي».
const AR_NAME = 'راوتر الفرع';
const AR_PARENT = 'الراوتر الرئيسي';
const AR_TYPE = 'جدار حماية';
const AR_LOC = 'الفرع الرئيسي';
const AR_SVC = 'خدمة أودو';
const USERDATA = [AR_NAME, AR_PARENT, AR_TYPE, AR_LOC, AR_SVC];

/** يعيد أي نصّ عربي باقٍ في المخرجات بعد استثناء بيانات المستخدم (+ رموز بيانات إضافية). */
function leftoverArabic(text, extra) {
  let t = String(text == null ? '' : text);
  for (const tok of USERDATA.concat(extra || [])) t = t.split(tok).join(' \u0001 ');
  return (t.match(/[\u0600-\u06FF][\u0600-\u06FF\s]*/g) || []).map((s) => s.trim());
}

function assertEnglish(text, label, extra) {
  const left = leftoverArabic(text, extra);
  assert.deepEqual(left, [], `${label}: بقي عربي بعد الترجمة → ${JSON.stringify(left)} | ${JSON.stringify(text)}`);
  assert.ok(!/\$\{|undefined|NaN/.test(String(text)), `${label}: إدراج مكسور → ${JSON.stringify(text)}`);
}

// ═══ ١) حماية الانحراف: المِسلات موجودة حرفيًا في ملفات السيرفر ══════════════

test('T-log-i18n: كل مِسلة عربية في القواعد موجودة حرفيًا في السيرفر', () => {
  const corpus = BACKEND_FILES.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  let needles = 0;
  for (const r of EN.rules) {
    assert.ok(r.ar.length > 0, 'قاعدة بلا مِسلة عربية');
    for (const n of r.ar) {
      assert.ok(corpus.includes(n),
        `مِسلة غير موجودة في ملفات السيرفر (تغيّر قالب؟): ${JSON.stringify(n)}`);
      needles++;
    }
  }
  assert.ok(needles >= 50, `عدد المِسلات المُدقَّقة منخفض: ${needles}`);
});

// ═══ ٢) التقاط حقيقي: مسارات الإرسال الفعلية ⇒ صفوف السجل تُترجم بالكامل ═══

const ids = {};
let dailyReport = '';

function seedFixtures() {
  const type = db.prepare('INSERT INTO device_types (name, icon) VALUES (?, ?)').run(AR_TYPE, 'firewall');
  const zone = db.prepare("INSERT INTO locations (name, kind) VALUES (?, 'zone')").run(AR_LOC);
  const net = db.prepare("INSERT INTO locations (name, kind) VALUES (?, 'internet')").run('مدخل الإنترنت');
  const parent = db.prepare(
    'INSERT INTO devices (name, ip, device_type_id, location_id, is_active, current_status) VALUES (?,?,?,?,1,?)'
  ).run(AR_PARENT, '10.20.30.1', type.lastInsertRowid, net.lastInsertRowid, 'online');
  const a = db.prepare(
    'INSERT INTO devices (name, ip, device_type_id, location_id, parent_id, is_active, current_status) VALUES (?,?,?,?,?,1,?)'
  ).run(AR_NAME, '10.20.30.40', type.lastInsertRowid, zone.lastInsertRowid, parent.lastInsertRowid, 'offline');
  const b = db.prepare(
    'INSERT INTO devices (name, ip, device_type_id, location_id, parent_id, is_active, current_status) VALUES (?,?,?,?,?,1,?)'
  ).run('سويتش الطابق', '10.20.30.41', type.lastInsertRowid, zone.lastInsertRowid, parent.lastInsertRowid, 'offline');
  USERDATA.push('سويتش الطابق', 'مدخل الإنترنت');
  Object.assign(ids, { type: type.lastInsertRowid, zone: zone.lastInsertRowid, net: net.lastInsertRowid,
    parent: parent.lastInsertRowid, a: a.lastInsertRowid, b: b.lastInsertRowid });

  db.prepare(`UPDATE notification_settings SET
      telegram_enabled = 1, telegram_bot_token = 'test-token', telegram_chat_id = '123',
      whatsapp_enabled = 1, whatsapp_api_url = 'https://wa.invalid/send',
      whatsapp_api_token = 'test-token', whatsapp_to_number = '201000000000',
      mobile_enabled = 0, storm_digest_enabled = 1, storm_window_seconds = 90
    WHERE id = 1`).run();
}

function dev(id, name, ip) {
  return { id, name, ip, device_type_name: AR_TYPE, location_name: AR_LOC };
}

// يضبط لغة الإشعارات في القاعدة (نفس ما يكتبه مسار /api/settings/notification-language — بلا HTTP).
// مسارات العقد العربي (٢) تُشغَّل بـ 'ar'؛ ومسار العقد الجديد (٢ب) يبدّل بين 'ar' و'en' بنفسه.
function setNotificationLanguage(lang) {
  db.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES ('notification_language', ?, ?) " +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
  ).run(lang, new Date().toISOString());
}

// يضبط لغة الواجهة في القاعدة — نصوص التشخيص **المخزَّنة في السجل** (سبب التجميع/الفشل) تتبع لغة
// الواجهة لا لغة الإشعارات، واختبارات العقد العربي هنا تفترض تخزينها عربية ثم ترجمتها عند العرض.
function setUiLanguage(lang) {
  db.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES ('ui_language', ?, ?) " +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
  ).run(lang, new Date().toISOString());
}

// أحدث رسالة خُزِّنت في السجل — كل تشغيل يترك صفًّا جديدًا في آخر الجدول.
function newestMessage() {
  return db.prepare('SELECT message FROM notification_logs ORDER BY id DESC LIMIT 1').get().message;
}

test('T-log-i18n: رسائل الإرسال الحقيقية تُترجم للإنجليزية بالكامل', async () => {
  setNotificationLanguage('ar');   // العقد العربي: الرسائل تُخزَّن عربية ثم يُترجم عرضها في الواجهة
  setUiLanguage('ar');             // وأسباب التشخيص المخزَّنة في السجل تتبع لغة الواجهة ⇒ عربية أيضًا
  seedFixtures();
  const devA = dev(ids.a, AR_NAME, '10.20.30.40');
  const devB = dev(ids.b, 'سويتش الطابق', '10.20.30.41');
  const svc = { name: AR_SVC, kind: 'https', port: 8069, url_path: '/web/login',
    is_critical: true, last_error: 'connection refused' };

  // رسائل فردية + تجميع عاصفة (الجهاز الأب متصل ⇒ «الانقطاع داخلي»)
  await notifier.notifyDeviceDown(devA);
  await notifier.notifyDeviceDown(devB);
  await smartAlerts.flushStorm();
  // عاصفة ثانية والجهاز الأب واقع ⇒ «الخط الخارجي واقع أيضًا»
  db.prepare("UPDATE devices SET current_status = 'offline' WHERE id = ?").run(ids.parent);
  await notifier.notifyDeviceDown(devA);
  await notifier.notifyDeviceDown(devB);
  await smartAlerts.flushStorm();
  db.prepare("UPDATE devices SET current_status = 'online' WHERE id = ?").run(ids.parent);
  // تعافٍ (مدة 185 ثانية ⇒ 3 دقائق) + خدمة متوقفة/عادت + إشعار تجريبي
  await notifier.notifyDeviceRecovered(devA, 185);
  await notifier.notifyServiceDown(devA, svc);
  await notifier.notifyServiceRecovered(devA, svc);
  await notifier.testChannel('telegram');

  // تصعيد: تمكين + دورة تأسيس + انقطاع مفتوح قديم ⇒ تصعيد فعلي
  db.prepare(`UPDATE notification_settings SET escalation_enabled = 1,
      escalation_after_minutes = 5, escalation_repeat_minutes = 0 WHERE id = 1`).run();
  await escalation.tickEscalation();
  db.prepare('INSERT INTO downtime_events (device_id, started_at) VALUES (?, ?)')
    .run(ids.a, new Date(Date.now() - 25 * 60000).toISOString());
  await escalation.tickEscalation();
  // إغلاق الانقطاع داخل آخر 24 ساعة ⇒ فروع التقرير اليومي (عدد/الأكثر انقطاعًا/الوضع الآن)
  db.prepare('UPDATE downtime_events SET ended_at = ?, duration_seconds = 900 WHERE ended_at IS NULL')
    .run(new Date(Date.now() - 10 * 60000).toISOString());
  dailyReport = smartAlerts.buildDailyReport();

  const rows = db.prepare('SELECT channel, status, message, error FROM notification_logs ORDER BY id').all();
  assert.ok(rows.length >= 14, `صفوف السجل قليلة (${rows.length}) — المسارات لم تُسجّل كما هو متوقّع`);

  const outs = [];
  for (const r of rows) {
    const label = `${r.channel}/${r.status}`;
    outs.push(EN.translate(r.message));
    assertEnglish(EN.translate(r.message), `message ${label}`);
    if (r.error) {
      outs.push(EN.translate(r.error));
      assertEnglish(EN.translate(r.error), `error ${label}`);
    }
  }
  const enDaily = EN.translate(dailyReport);
  assertEnglish(enDaily, 'daily report');
  outs.push(enDaily);

  const all = outs.join('\n');
  const expected = [
    '🔴 Device down: ' + AR_NAME,
    'Type: ' + AR_TYPE,
    'Location: ' + AR_LOC,
    'Time: 1',                                  // طابع زمني لاتيني لا عربي
    '🟢 Device back online: ' + AR_NAME,
    'Downtime: 3 minutes',
    '⛔ Service down: ' + AR_SVC,
    'Check: HTTPS 8069/web/login',
    'Error: connection refused',
    '✅ Service back up: ' + AR_SVC,
    'Mass outage — 2 devices within two minutes:',
    'Likely common cause:',
    AR_PARENT + ' (10.20.30.1) — check it first.',
    'The external internet line is up — the outage is internal (switch/cable/wiring)',
    'The external line is down too (10.20.30.1) — most likely an ISP / main-router fault',
    'Batched into the storm alert (will be sent within two minutes)',
    'Test notification from Network Monitor',
    '🚨 Outage escalation',
    'Still down for 25 minutes (threshold: 5 minutes) — act now or acknowledge.',
    '📊 Daily report — ',
    'Outages in the last 24 hours: 1 · total 15 minutes',
    'Most affected: ' + AR_NAME + ' — 15 minutes (1 time)',
    'Status now: 🟢 1 online · 🔴 2 offline',
  ];
  for (const phrase of expected) {
    assert.ok(all.includes(phrase), `العبارة المترجمة مفقودة: ${JSON.stringify(phrase)}`);
  }
  // وسوم تلجرام (<b>/<code>) لا تظهر في العرض — لا في العربية ولا في الإنجليزية.
  assert.ok(!/<\/?(b|code)>/.test(all), 'وسوم تلگرام ما زالت ظاهرة في السجل');
});

test('T-log-i18n: رسائل نافذة الصيانة تُترجم أيضًا', async () => {
  setNotificationLanguage('ar');   // رسائل الصيانة تُخزَّن عربية (العقد العربي) ثم تُترجم عند العرض
  const original = maintenance.isMaintenanceNow;
  maintenance.isMaintenanceNow = async () => true;
  try {
    await notifier.notifyDeviceDown(dev(ids.a, AR_NAME, '10.20.30.40'));
    await notifier.notifyDeviceRecovered(dev(ids.a, AR_NAME, '10.20.30.40'), 65);
  } finally {
    maintenance.isMaintenanceNow = original;
  }
  const rows = db.prepare("SELECT message FROM notification_logs WHERE status = 'maintenance' AND message LIKE '%صيانة%'").all();
  assert.ok(rows.length >= 2, 'لم تُسجَّل رسائل نافذة الصيانة');
  const outs = rows.map((r) => EN.translate(r.message));
  for (const o of outs) assertEnglish(o, 'maintenance message');
  const all = outs.join('\n');
  assert.ok(all.includes('[Maintenance] Device down: ' + AR_NAME), 'رسالة صيانة الانقطاع لم تُترجم');
  assert.ok(all.includes('[Maintenance] Device recovered: ' + AR_NAME), 'رسالة صيانة التعافي لم تُترجم');
});

// ═══ ٢ب) العقد الجديد: النصّ الإنجليزي المُرسَل = ما يعرضه السجل بالإنجليزية حرفيًّا ══════
// قرار المالك (2026-10-18): الرسائل تُبنى بلغة الإشعارات (ar|en) لحظة الإرسال. فحين يتحوّل الإعداد
// إلى 'en' يجب أن يخرج من مسار الإرسال نفسه نصّ مطابق حرفيًّا لما كان السجل سيعرضه لو ترجم (عند
// العرض) نسخة 'ar' المخزَّنة. أي انزياح في قالب (كلمة/وحدة/تشكيل/طابع زمني) يُفشل هذا الاختبار
// باسم السيناريو المعنيّ.
test('T-log-i18n: الرسالة الإنجليزية المُرسَلة تطابق ترجمة الرسالة العربية المخزَّنة حرفيًّا', async (t) => {
  // الساعة مُثبَّتة: رسائل الانقطاع/الخدمة تحمل داخل النصّ وقت الإرسال — تثبيتها يجعل المقارنة
  // حرفية بلا أي تسامح على الثواني، والرسائل في اللغتين تُبنى على نفس الطابع الزمني.
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 18, 12, 34, 56).getTime() });

  const devA = dev(ids.a, AR_NAME, '10.20.30.40');
  const devB = dev(ids.b, 'سويتش الطابق', '10.20.30.41');
  const svc = { name: AR_SVC, kind: 'https', port: 8069, url_path: '/web/login',
    is_critical: true, last_error: 'connection refused' };

  // سيناريو واحد: عربيّ (يُخزَّن) ثم إنجليزيّ (يُخزَّن) — نقرأ أحدث صفّ بعد كل تشغيل.
  async function assertSentMatchesTranslation(label, run) {
    setNotificationLanguage('ar');
    await run();
    const arMessage = newestMessage();
    setNotificationLanguage('en');
    await run();
    const enMessage = newestMessage();
    assertEnglish(enMessage, label);
    assert.equal(EN.translate(arMessage), enMessage,
      `${label}: النصّ الإنجليزي المُرسَل يجب أن يطابق ترجمة النصّ العربي المخزَّن حرفيًّا`);
  }

  // الانقطاع/التعافي/الخدمة/الإشعار التجريبي: مع إطفاء تجميع العواصف يُسجَّل كل حدث فورًا.
  db.prepare('UPDATE notification_settings SET storm_digest_enabled = 0 WHERE id = 1').run();
  await assertSentMatchesTranslation('device down', () => notifier.notifyDeviceDown(devA));
  await assertSentMatchesTranslation('device recovered', () => notifier.notifyDeviceRecovered(devA, 185));
  await assertSentMatchesTranslation('service down', () => notifier.notifyServiceDown(devA, svc));
  await assertSentMatchesTranslation('service recovered', () => notifier.notifyServiceRecovered(devA, svc));
  await assertSentMatchesTranslation('test notification', () => notifier.testChannel('telegram'));

  // نافذة الصيانة: القالبان المختومان بـ[Maintenance] — نفس العقد.
  const originalMaintenance = maintenance.isMaintenanceNow;
  maintenance.isMaintenanceNow = async () => true;
  try {
    await assertSentMatchesTranslation('maintenance down', () => notifier.notifyDeviceDown(devA));
    await assertSentMatchesTranslation('maintenance recovered', () => notifier.notifyDeviceRecovered(devA, 65));
  } finally {
    maintenance.isMaintenanceNow = originalMaintenance;
  }

  // رسالة العاصفة المجمّعة: الحدث الأول يفتح النافذة ويُبفَّر الثاني، ثم يُرسل flushStorm الدفعة
  // وحدها (هذا هو مسار notifier الحقيقي: consumeDownEvent ← flushStorm). أحدث صفّ هنا نسخة
  // واتساب المجرَّدة من وسوم تلجرام — وهي المقابلة لتجريد العرض في السجل.
  db.prepare('UPDATE notification_settings SET storm_digest_enabled = 1 WHERE id = 1').run();
  await assertSentMatchesTranslation('storm digest', async () => {
    smartAlerts.consumeDownEvent(devA);
    smartAlerts.consumeDownEvent(devB);
    await smartAlerts.flushStorm();
  });
  db.prepare('UPDATE notification_settings SET storm_digest_enabled = 0 WHERE id = 1').run();

  // التقرير اليومي: يُبنى للإرسال بلا صفّ سجل، وstartDailyReport يرسل نسخته المجرَّدة من الوسوم
  // إلى واتساب/الهاتف — نقارن ما يُرسَل فعلًا في اللغتين (بلا الوسوم التي ينظّفها العرض أيضًا).
  setNotificationLanguage('ar');
  const dailyAr = smartAlerts.buildDailyReport();
  setNotificationLanguage('en');
  const dailyEn = smartAlerts.buildDailyReport();
  const dailyEnSent = dailyEn.replace(/<[^>]+>/g, '');
  assertEnglish(dailyEn, 'daily report');
  assert.equal(EN.translate(dailyAr), dailyEnSent,
    'daily report: النصّ الإنجليزي المُرسَل يجب أن يطابق ترجمة النصّ العربي المخزَّن حرفيًّا');
});

// ═══ ٣) عيّنات القوالب التي لا يمكن التقاطها بالتشغيل (حراسة/جهاز جديد/تصعيد دوري) ══

test('T-log-i18n: عيّنات قوالب الحراسة والجهاز الجديد والتصعيد الدوري تُترجم بالكامل', () => {
  // «كاميرا» = النوع المكتشَف من الماسح (بيانات سيرفر لا تسميات) ⇒ يبقى كما هو.
  const SAMPLES = [
    { text: '⚠️ تحذير: محرك المراقبة متعطل!\nلا نبضة من محرك الفحص منذ 95 ثانية\nالبيانات المعروضة قد تكون قديمة — راجع حالة الجهاز.' },
    { text: '⚠️ تحذير: محرك المراقبة متعطل!\n2 فحص عالق منذ أكثر من 60 ثانية (راوتر الفرع، سويتش الطابق)\nالبيانات المعروضة قد تكون قديمة — راجع حالة الجهاز.' },
    { text: '✅ عاد محرك المراقبة للعمل طبيعيًا.' },
    // جهاز جديد — scan-scheduler.service
    { text: '🆕 جهاز جديد في الشبكة!\nIP: 10.20.30.77\nMAC: aa:bb:cc:dd:ee:ff\nالصانع: Cisco\nالاسم: cam-3\nالنوع المتوقَّع: كاميرا',
      data: ['كاميرا'] },
    // تصعيد دوري — escalation.service
    { text: '🚨 <b>تصعيد انقطاع</b> (تذكير دوري كل 30 دقيقة)\n🔴 <b>راوتر الفرع</b> — <code>10.20.30.40</code>\n⏱️ ما زال واقعًا منذ <b>60 دقيقة</b> (العتبة: 5 دقيقة) — تحرّك الآن أو أكّد العمل.' },
    // التقرير اليومي — يوم نظيف
    { text: '📊 <b>التقرير اليومي — 15‏/10‏/2026</b>\n✅ يوم نظيف: لا انقطاعات في آخر 24 ساعة 🎉' },
    // أسباب السجل — notifier/routes (وأسباب المزوّدين الإنجليزية تبقى كما هي)
    { text: 'كل التسجيلات لم تعد صالحة (404/410) وتم تعطيلها — أعِد التفعيل من الهاتف' },
    { text: 'تعذّر الإرسال لأي تسجيل' },
    { text: 'خطأ غير معروف' },
    { text: 'قناة غير معروفة — المتاح: telegram · whatsapp · mobile' },
    { text: 'قناة غير معروفة: sms — المتاح: telegram · whatsapp' },
    { text: 'بلا نتيجة' },
    { text: 'HTTP 403: Forbidden: bot was blocked by the user' },
  ];
  for (const s of SAMPLES) assertEnglish(EN.translate(s.text), 'sample ' + JSON.stringify(s.text.slice(0, 24)), s.data);
  const all = SAMPLES.map((s) => EN.translate(s.text)).join('\n');
  for (const phrase of [
    '⚠️ Warning: the monitoring engine is stalled!',
    'No heartbeat from the check engine for 95 seconds',
    '2 checks stuck for more than 60 seconds (راوتر الفرع, سويتش الطابق)',
    'Displayed data may be stale — check the device status.',
    'The monitoring engine is working normally again.',
    '🆕 New device on the network!',
    'Vendor: Cisco',
    'Name: cam-3',
    'Expected type: كاميرا',
    '(periodic reminder every 30 minutes)',
    'Still down for 60 minutes (threshold: 5 minutes) — act now or acknowledge.',
    '📊 Daily report — 15/10/2026',
    'Clean day: no outages in the last 24 hours 🎉',
    'All subscriptions are no longer valid (404/410) and were disabled — re-enable them from the phone',
    'Could not send to any subscription',
    'Unknown error',
    'Unknown channel — available: telegram · whatsapp · mobile',
    'Unknown channel: sms — available: telegram · whatsapp',
    'No result',
    'HTTP 403: Forbidden: bot was blocked by the user',
  ]) {
    assert.ok(all.includes(phrase), `العبارة المترجمة مفقودة: ${JSON.stringify(phrase)}`);
  }
});

// ═══ ٤) الأمان وسلوك الحالة ═════════════════════════════════════════════════

test('T-log-i18n: سطر غير معروف يبقى كما هو · الفارغ/غير النصّي آمن', () => {
  const unknown = 'رسالة عربية جديدة تمامًا لم تُضف لها قاعدة بعد\nسطر ثانٍ';
  assert.equal(EN.translate(unknown), unknown, 'سطر مجهول يجب أن يبقى كما هو — لا ترجمة نصف مكسورة');
  assert.equal(EN.translate(null), '');
  assert.equal(EN.translate(undefined), '');
  assert.equal(EN.translate(''), '');
  assert.equal(EN.translate('🔴 Device down: Router-A'), '🔴 Device down: Router-A');
  // بيانات المستخدم وحدها لا تتغيّر أبدًا
  assert.equal(EN.translate(AR_NAME), AR_NAME);
});

test('T-log-i18n: الوسوم تُنظَّف في اللغتين · العربية تبقى عربية', () => {
  const tg = '⚠️ <b>انقطاع جماعي — 3 جهازًا خلال دقيقتين:</b>';
  const ar = AR.translate(tg);
  assert.ok(!/<\/?b>/.test(ar), 'الوسوم يجب أن تُنظَّف في الوضع العربي أيضًا');
  assert.ok(ar.includes('انقطاع جماعي'), 'الوضع العربي لا يُترجم النصّ');
  assert.equal(FOLLOW.getLang(), 'en', 'بلا اختيار صريح ⇒ تتبع لغة الواجهة');
  assert.equal(FOLLOW.followsUi(), true);
  assert.equal(AR.getLang(), 'ar');
  assert.equal(EN.getLang(), 'en');
  assert.equal(EN.translate(tg), '⚠️ Mass outage — 3 devices within two minutes:');
});

test('T-log-i18n: الوحدات والتواريخ والأرقام العربية تُحوَّل صحيحًا', () => {
  assert.equal(EN.enDuration('45 ثانية'), '45 seconds');
  assert.equal(EN.enDuration('1 ثانية'), '1 second');
  assert.equal(EN.enDuration('3 دقيقة'), '3 minutes');
  assert.equal(EN.enDuration('60 دقيقة'), '60 minutes');
  assert.equal(EN.enDuration('1 ساعة و20 دقيقة'), '1 hour 20 minutes');
  assert.equal(EN.enDuration('غير معروف'), 'unknown');
  assert.equal(EN.enDuration('شيء غريب'), null);
  // أرقام عربية-هندية (أبلاينس Debian) وطابع Node اللاتيني — كلاهما يُقرأ إنجليزيًّا
  assert.equal(EN.latinDigits('٠١٢٣٤٥٦٧٨٩'), '0123456789');
  assert.equal(EN.translate('الوقت: ١٨‏/١٠‏/٢٠٢٦، ٥:٣٠:٠٥ م'), 'Time: 18/10/2026, 5:30:05 PM');
  assert.equal(EN.translate('الوقت: 18‏/10‏/2026، 12:27:30 ص'), 'Time: 18/10/2026, 12:27:30 AM');
});

test.after(() => { env.cleanup(); });
