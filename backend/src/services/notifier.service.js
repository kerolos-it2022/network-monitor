// notifier.service.js: إرسال الإشعارات عبر تلجرام وواتساب وإشعارات الموبايل + تسجيل نتائج الإرسال في notification_logs.
// v2.13.0 — أربعة تغييرات تعالج «الإشعارات مش بتوصل ولا فيه أي تفسير»:
//   1) مصادر الإعدادات: صف القاعدة (لوحة التحكم) مع **رجوع** إلى متغيّرات البيئة
//      (.env) عند غياب القيمة. السبب: DEPLOY.md و README يطلبان كتابة
//      TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID في .env، بينما الكود كان يقرأ القاعدة
//      فقط ⇒ إعداد صحيح وموثَّق يبقى مُهمَلًا تمامًا بلا أي أثر.
//   2) كل قناة تُرجع نتيجة مفصّلة {channel, ok, skipped, reason} ⇒ زر الاختبار في
//      لوحة التحكم يشرح حال كل قناة بدل «فشل الإرسال» المبهم.
//   3) سبب الفشل كما ردّه المزوّد يُخزَّن في notification_logs.error (كان يُطبع في
//      الكونسول فقط، فتبدو كل الإخفاقات متطابقة بلا سبب).
//   4) MOBILE_ENABLED صار مفتاحًا رئيسيًّا حقيقيًّا (كان مكتوبًا في .env.example
//      و README و deploy.sh لكنه **مُهمَل** في الكود — متغيّر مضلِّل).
const axios = require('axios');
const webpush = require('web-push');
const db = require('../db');
const vapid = require('./vapid.service');
// نصوص الرسائل المُرسَلة بلغتين — تتبع إعداد لغة الإشعارات (رسالة واحدة بلغة واحدة، بكل القنوات).
const { msg, pick, isEn, now } = require('./message-i18n.service');
// نصوص التشخيص التي يقرأها المالك **في اللوحة** (أسباب التخطّي/الفشل في زر الاختبار والسجل) — بلغة الواجهة.
const { uiText } = require('./ui-text.service');

// envText(name): قيمة نصّية من البيئة ('' لو غير موجودة/فارغة).
function envText(name) {
  const v = process.env[name];
  return v == null ? '' : String(v).trim();
}

// envOr(dbValue, envName): قيمة القاعدة إن وُجدت، وإلا قيمة البيئة.
function envOr(dbValue, envName) {
  const v = dbValue == null ? '' : String(dbValue).trim();
  return v || envText(envName);
}

// envFlag(name, dflt): مفتاح منطقي من البيئة (1/true/yes/on).
function envFlag(name, dflt = true) {
  const v = envText(name);
  if (!v) return dflt;
  return /^(1|true|yes|on)$/i.test(v);
}

// getSettingsRow(): الصف الوحيد من إعدادات الإشعارات (id=1) كما هو في القاعدة.
async function getSettingsRow() {
  const row = await db.prepare('SELECT * FROM notification_settings WHERE id = 1').get();
  return row || {};
}

// mergeSettings(row): الإعدادات الفعّالة = القاعدة + رجوع للبيئة في الحقول الناقصة.
// ملاحظة: مفاتيح التشغيل/التعطيل (telegram_enabled …) تبقى من القاعدة وحدها —
// لوحة التحكم هي المرجع، والبيئة تُكمل **الاعتمادات** (توكن/chat id/رابط API) فقط.
function mergeSettings(row) {
  return Object.assign({}, row, {
    telegram_bot_token: envOr(row.telegram_bot_token, 'TELEGRAM_BOT_TOKEN'),
    telegram_chat_id: envOr(row.telegram_chat_id, 'TELEGRAM_CHAT_ID'),
    whatsapp_api_url: envOr(row.whatsapp_api_url, 'WHATSAPP_API_URL'),
    whatsapp_api_token: envOr(row.whatsapp_api_token, 'WHATSAPP_API_TOKEN'),
    whatsapp_to_number: envOr(row.whatsapp_to_number, 'WHATSAPP_TO_NUMBER'),
  });
}

// getSettings(): الإعدادات الفعّالة (يُستعمل داخليًّا وفي المسارات).
async function getSettings() {
  return mergeSettings(await getSettingsRow());
}

// fieldSource(dbValue, envName): مصدر قيمة الحقل الحسّاس — 'db' | 'env' | ''.
function fieldSource(dbValue, envName) {
  const v = dbValue == null ? '' : String(dbValue).trim();
  if (v) return 'db';
  return envText(envName) ? 'env' : '';
}

// getSettingsWithSources(): الإعدادات الفعّالة + مصدر الحقول الحسّاسة.
// يستهلكه GET /api/notifications/settings ليُخبر الأدمن أن التوكن يعمل من .env
// رغم أن حقل الواجهة يبدو فارغًا (تجنّبًا لالتباس «غير مضبوط» مع إشعارات تعمل).
async function getSettingsWithSources() {
  const row = await getSettingsRow();
  const s = mergeSettings(row);
  s._sources = {
    telegram_bot_token: fieldSource(row.telegram_bot_token, 'TELEGRAM_BOT_TOKEN'),
    telegram_chat_id: fieldSource(row.telegram_chat_id, 'TELEGRAM_CHAT_ID'),
    whatsapp_api_url: fieldSource(row.whatsapp_api_url, 'WHATSAPP_API_URL'),
    whatsapp_api_token: fieldSource(row.whatsapp_api_token, 'WHATSAPP_API_TOKEN'),
    whatsapp_to_number: fieldSource(row.whatsapp_to_number, 'WHATSAPP_TO_NUMBER'),
    mobile_vapid: vapid.isReady() ? 'env' : '',
    mobile_master_switch: envFlag('MOBILE_ENABLED', true) ? 'env' : '',
  };
  return s;
}

// trimText(value, max): تنظيف نصّ (يُستعمل قبل تخزين أسباب الخطأ في السجل).
function trimText(value, max = 300) {
  const s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// axiosDetail(e): استخراج رسالة المزوّد الفعلية من خطأ axios.
// تلجرام يضع السبب الحقيقي في response.data.description
// (مثال: «chat not found» · «Forbidden: bot was blocked by the user»).
function axiosDetail(e) {
  const status = e && e.response ? e.response.status : null;
  const data = e && e.response ? e.response.data : null;
  let desc = '';
  if (data) {
    if (typeof data === 'string') desc = data;
    else if (data.description) desc = data.description;
    else if (data.error) desc = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
    else desc = JSON.stringify(data);
  }
  const base = desc || (e && e.message) || uiText('خطأ غير معروف', 'Unknown error');
  return trimText(status ? `HTTP ${status}: ${base}` : base);
}

// logNotification(channel, deviceId, message, status, errorText):
// تسجيل نتيجة الإرسال في notification_logs (بما فيها سبب الفشل).
function logNotification(channel, deviceId, message, status, errorText = null) {
  try {
    db.prepare(
      'INSERT INTO notification_logs (device_id, channel, message, status, error) VALUES (?, ?, ?, ?, ?)'
    ).run(deviceId, channel, message, status, errorText ? trimText(errorText) : null);
  } catch (e) {
    // فشل التسجيل لا يجب أن يكسر الإرسال نفسه (الجدول/العمود قد يكونان قيد migration).
    console.error('[notify] تعذّر تسجيل الإشعار في notification_logs:', e.message);
  }
}

// ─────────────────────────────── تلجرام ───────────────────────────────
// deliverTelegram(message, deviceId, replyMarkup): إرسال فعلي + نتيجة مفصّلة.
// v2.14.0 — replyMarkup اختياري (أزرار مضمّنة: /status · /down · /recent).
async function deliverTelegram(message, deviceId = null, replyMarkup = null, parseMode = null) {
  // v2.18.3 — parseMode اختياري ('HTML') للرسائل المبنية بوسوم (التجميع والتقارير).
  const s = await getSettings();
  if (!s.telegram_enabled) {
    return { channel: 'telegram', ok: false, skipped: true, reason: uiText('القناة معطّلة من لوحة التحكم (Telegram مفعّل = لا)', 'Channel disabled in the dashboard (Telegram enabled = no)') };
  }
  if (!s.telegram_bot_token) {
    return {
      channel: 'telegram', ok: false, skipped: true,
      reason: uiText('توكن البوت غير مضبوط: لوحة التحكم → الإشعارات، أو TELEGRAM_BOT_TOKEN في .env', 'Bot token is not set: Dashboard → Notifications, or TELEGRAM_BOT_TOKEN in .env'),
    };
  }
  if (!s.telegram_chat_id) {
    return {
      channel: 'telegram', ok: false, skipped: true,
      reason: uiText('Chat ID غير مضبوط: لوحة التحكم → الإشعارات، أو TELEGRAM_CHAT_ID في .env', 'Chat ID is not set: Dashboard → Notifications, or TELEGRAM_CHAT_ID in .env'),
    };
  }
  const url = `https://api.telegram.org/bot${s.telegram_bot_token}/sendMessage`;
  const payload = { chat_id: s.telegram_chat_id, text: message };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  if (parseMode) payload.parse_mode = parseMode;
  try {
    await axios.post(url, payload, { timeout: 10000 });
    logNotification('telegram', deviceId, message, 'sent');
    return { channel: 'telegram', ok: true };
  } catch (e) {
    const detail = axiosDetail(e);
    console.error('Telegram send failed:', detail);
    logNotification('telegram', deviceId, message, 'failed', detail);
    return { channel: 'telegram', ok: false, error: detail };
  }
}

// sendTelegram(message, deviceId): يبقى يُرجع true/false (توافقًا مع المستدعين الحاليين).
async function sendTelegram(message, deviceId = null, replyMarkup = null, parseMode = null) {
  return (await deliverTelegram(message, deviceId, replyMarkup, parseMode)).ok;
}

// ─────────────────────────────── واتساب ───────────────────────────────
// deliverWhatsapp(message, deviceId): إرسال عبر مزود WhatsApp عام + نتيجة مفصّلة.
async function deliverWhatsapp(message, deviceId = null) {
  const s = await getSettings();
  if (!s.whatsapp_enabled) {
    return { channel: 'whatsapp', ok: false, skipped: true, reason: uiText('القناة معطّلة من لوحة التحكم (واتساب مفعّل = لا)', 'Channel disabled in the dashboard (WhatsApp enabled = no)') };
  }
  if (!s.whatsapp_api_url || !s.whatsapp_api_token || !s.whatsapp_to_number) {
    return {
      channel: 'whatsapp', ok: false, skipped: true,
      reason: uiText('إعداد واتساب ناقص (رابط API/التوكن/رقم المستلم) — لوحة التحكم أو WHATSAPP_API_URL · WHATSAPP_API_TOKEN · WHATSAPP_TO_NUMBER في .env', 'WhatsApp configuration is incomplete (API URL / token / recipient number) — dashboard or WHATSAPP_API_URL · WHATSAPP_API_TOKEN · WHATSAPP_TO_NUMBER in .env'),
    };
  }
  try {
    await axios.post(
      s.whatsapp_api_url,
      { to: s.whatsapp_to_number, message },
      {
        headers: { Authorization: `Bearer ${s.whatsapp_api_token}` },
        timeout: 10000,
      }
    );
    logNotification('whatsapp', deviceId, message, 'sent');
    return { channel: 'whatsapp', ok: true };
  } catch (e) {
    const detail = axiosDetail(e);
    console.error('WhatsApp send failed:', detail);
    logNotification('whatsapp', deviceId, message, 'failed', detail);
    return { channel: 'whatsapp', ok: false, error: detail };
  }
}

// sendWhatsapp(message, deviceId): يُرجع true/false.
async function sendWhatsapp(message, deviceId = null) {
  return (await deliverWhatsapp(message, deviceId)).ok;
}

// ──────────────────────── إشعارات الموبايل (PWA) ────────────────────────
// deliverMobile(message, deviceId): إرسال Web Push لكل التسجيلات النشطة.
// يستعمل مفاتيح VAPID — وتُولَّد تلقائيًّا عند غيابها عبر vapid.service (v2.13.0).
async function deliverMobile(message, deviceId = null) {
  const s = await getSettings();
  if (!envFlag('MOBILE_ENABLED', true)) {
    return { channel: 'mobile', ok: false, skipped: true, reason: uiText('إشعارات الموبايل معطّلة بمفتاح البيئة MOBILE_ENABLED=0 في .env', 'Mobile notifications are disabled by the environment flag MOBILE_ENABLED=0 in .env') };
  }
  if (!s.mobile_enabled) {
    return { channel: 'mobile', ok: false, skipped: true, reason: uiText('القناة معطّلة من لوحة التحكم (إشعارات الهاتف = لا)', 'Channel disabled in the dashboard (phone notifications = no)') };
  }

  // ضمان المفاتيح قبل أي إرسال (توليد + حفظ عند أول حاجة).
  try {
    vapid.ensureVapidKeys();
  } catch (e) {
    console.error('[notify] تعذّر ضمان مفاتيح VAPID:', e.message);
  }
  if (!vapid.isReady()) {
    return { channel: 'mobile', ok: false, skipped: true, reason: uiText('مفاتيح VAPID غير متوفّرة على الخادم — راجع سجل الخدمة', 'VAPID keys are unavailable on the server — check the service log') };
  }

  const details = vapid.getVapidDetails();
  webpush.setVapidDetails(details.subject, details.publicKey, details.privateKey);

  // جلب التسجيلات النشطة (كل تسجيل = PushSubscription كاملة JSON).
  const registrations = db
    .prepare('SELECT id, endpoint FROM mobile_registrations WHERE is_active = 1')
    .all();

  if (registrations.length === 0) {
    return {
      channel: 'mobile', ok: false, skipped: true,
      reason: uiText('لا يوجد أي هاتف مُسجَّل — افتح الصفحة العامة على الهاتف واضغط «🔔 تفعيل الإشعارات»', 'No phone is registered — open the public page on the phone and tap «🔔 Enable notifications»'),
    };
  }

  const payload = JSON.stringify({
    notification: {
      title: pick('مراقبة الشبكة', 'Network Monitor'),
      body: message,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'nm-' + (deviceId || '0'),
      data: { deviceId: String(deviceId || ''), url: '/' },
    },
  });

  let okCount = 0;
  let deadCount = 0;
  const failures = [];
  const deadIds = [];

  await Promise.all(registrations.map(async (reg) => {
    let subscription;
    try {
      // endpoint مخزّن = JSON كامل لـ PushSubscription
      subscription = JSON.parse(reg.endpoint);
    } catch (e) {
      return; // ليس JSON ⇒ نتجاهله
    }
    if (!subscription || !subscription.endpoint) return;

    try {
      await webpush.sendNotification(subscription, payload, {
        TTL: 24 * 3600, // صلاحية 24 ساعة
        urgency: 'high',
      });
      okCount++;
    } catch (err) {
      const status = err.statusCode;
      // 404 / 410 = التسجيل لم يعد صالحاً
      if (status === 404 || status === 410) {
        deadIds.push(reg.id);
        deadCount++;
      } else {
        const detail = `HTTP ${status || '?'}: ${trimText(err.message)}`;
        console.error(`[notify] web-push خطأ (${status}):`, err.message);
        failures.push(detail);
      }
    }
  }));

  // تعطيل التسجيلات الميتة
  if (deadIds.length > 0) {
    const stmt = db.prepare('UPDATE mobile_registrations SET is_active = 0 WHERE id = ?');
    deadIds.forEach((id) => stmt.run(id));
    console.log(`[notify] تم تعطيل ${deadIds.length} تسجيل ميت`);
  }

  const anyOk = okCount > 0;
  let failReason = null;
  if (!anyOk) {
    if (failures.length) failReason = failures.join(' | ');
    else if (deadCount) failReason = uiText('كل التسجيلات لم تعد صالحة (404/410) وتم تعطيلها — أعِد التفعيل من الهاتف', 'All subscriptions are no longer valid (404/410) and were disabled — re-enable them from the phone');
    else failReason = uiText('تعذّر الإرسال لأي تسجيل', 'Could not send to any subscription');
  }

  // تسجيل في notification_logs (مع سبب الفشل عند الفشل الكامل).
  logNotification('mobile', deviceId, message, anyOk ? 'sent' : 'failed', failReason);

  if (anyOk) {
    const nowIso = new Date().toISOString();
    db.prepare('UPDATE mobile_registrations SET last_notified_at = ? WHERE is_active = 1').run(nowIso);
  }

  return {
    channel: 'mobile',
    ok: anyOk,
    sent: okCount,
    failed: registrations.length - okCount,
    error: failReason || undefined,
  };
}

// sendMobile(message, deviceId): يُرجع true/false (توافقًا مع المستدعين الحاليين).
async function sendMobile(message, deviceId = null) {
  return (await deliverMobile(message, deviceId)).ok;
}

// testAllChannels(message): إرسال إشعار تجربة عبر القنوات الثلاث مع نتيجة مفصّلة
// لكل قناة — يستهلكه POST /api/notifications/test. القنوات المعطّلة لا يُرسَل لها
// شيء، بل تُرجَع بسببه واضحًا (تشخيص بلا إزعاج).
const TEST_DELIVERERS = {
  telegram: (msg) => deliverTelegram(msg, null),
  whatsapp: (msg) => deliverWhatsapp(msg, null),
  mobile: (msg) => deliverMobile(msg, null),
};
const TEST_CHANNELS = Object.keys(TEST_DELIVERERS);

/** القنوات المتاحة لاختبار فردي (للتحقق في المسار والواجهة). */
function testChannelNames() { return TEST_CHANNELS.slice(); }

/** اختبار قناة واحدة بالاسم — {channel, ok, error} (بلا إرسال للبقية). */
async function testChannel(channel, message = pick('🔔 إشعار تجريبي من نظام مراقبة الشبكة', '🔔 Test notification from Network Monitor')) {
  const key = String(channel || '').trim().toLowerCase();
  const deliver = TEST_DELIVERERS[key];
  if (!deliver) {
    return { channel: key || null, ok: false, error: uiText('قناة غير معروفة — المتاح: ', 'Unknown channel — available: ') + TEST_CHANNELS.join(' · ') };
  }
  const r = await deliver(message);
  return Object.assign({ channel: key }, r || { ok: false, error: uiText('بلا نتيجة', 'No result') });
}

async function testAllChannels(message = pick('🔔 إشعار تجريبي من نظام مراقبة الشبكة', '🔔 Test notification from Network Monitor')) {
  return Promise.all(TEST_CHANNELS.map((c) => testChannel(c, message)));
}

// notifyDeviceDown(device): إشعار انقطاع جهاز للقنوات المفعّلة (متوازي).
// v2.14.0 — رسالة تلجرام تأتي بأزرار مضمّنة (الحالة/المنقطعون/آخر الانقطاعات).
// v2.14.1 — ذكاء الإشعارات:
//   • نافذة الصيانة: أثناءها تُكتم الإشعارات وتُسجَّل بحالة 'maintenance' في السجل.
//   • تجميع العواصف: أول انقطاع يُرسل فوريًّا، والمتلاحق خلال 90ث تُجمَّع برسالة
//     واحدة (انظر smart-alerts.service).
async function notifyDeviceDown(device) {
  try {
    const { isMaintenanceNow } = require('./maintenance.service');
    if (await isMaintenanceNow()) {
      const timeStr = now();
      const message = msg(
        '🛠️ [صيانة] انقطع الجهاز: {name} (IP: {ip}) — الوقت: {time}',
        '🛠️ [Maintenance] Device down: {name} (IP: {ip}) — Time: {time}',
        { name: device.name, ip: device.ip, time: timeStr }
      );
      logNotification('telegram', device.id, message, 'maintenance', null);
      logNotification('whatsapp', device.id, message, 'maintenance', null);
      logNotification('mobile', device.id, message, 'maintenance', null);
      console.log(`[notify] نافذة صيانة — كتم إشعار انقطاع: ${device.name}`);
      return;
    }
  } catch (e) { console.error('[notify] فحص الصيانة فشل — سنكمل الإرسال الطبيعي:', e.message); }

  const timeStr = now();
  const message = msg(
    '🔴 انقطع الجهاز: {name}\nIP: {ip}\nالنوع: {type}\nالموقع: {loc}\nالوقت: {time}',
    '🔴 Device down: {name}\nIP: {ip}\nType: {type}\nLocation: {loc}\nTime: {time}',
    {
      name: device.name,
      ip: device.ip,
      type: device.device_type_name || '-',
      loc: device.location_name || '-',
      time: timeStr,
    }
  );
  let tgMarkup = null;
  try { tgMarkup = require('./telegram-bot.service').tgButtons(); } catch (e) { tgMarkup = null; }

  // تجميع العواصف: 'buffer' ⇒ لا إرسال فردي، ستُرسل رسالة مجمّعة بعد نافذة 90ث.
  let decision = 'send';
  try { decision = require('./smart-alerts.service').consumeDownEvent(device); }
  catch (e) { console.error('[notify] منطق العاصفة فشل — سنرسل فرديًّا:', e.message); }

  if (decision === 'buffer') {
    logNotification('telegram', device.id, message, 'maintenance', uiText('مجمَّع في تنبيه العاصفة (سيصدر خلال دقيقتين)', 'Bundled into the storm alert (will be sent within two minutes)'));
    return;
  }

  // إرسال متوازي لكل القنوات (لا ننتظر تلجرام قبل واتساب)
  await Promise.all([
    sendTelegram(message, device.id, tgMarkup),
    sendWhatsapp(message, device.id),
    sendMobile(message, device.id),
  ]);
}

// notifyDeviceRecovered(device, downtimeDurationSeconds): إشعار عودة جهاز (متوازي).
// v2.14.0 — بنفس أزرار الاستعلام السريع على تلجرام. v2.14.1 — كتم أثناء نافذة الصيانة.
async function notifyDeviceRecovered(device, downtimeDurationSeconds) {
  try {
    const { isMaintenanceNow } = require('./maintenance.service');
    if (await isMaintenanceNow()) {
      const timeStr = now();
      const message = msg(
        '🛠️ [صيانة] عاد الجهاز: {name} (IP: {ip}) — الوقت: {time}',
        '🛠️ [Maintenance] Device recovered: {name} (IP: {ip}) — Time: {time}',
        { name: device.name, ip: device.ip, time: timeStr }
      );
      logNotification('telegram', device.id, message, 'maintenance', null);
      logNotification('whatsapp', device.id, message, 'maintenance', null);
      logNotification('mobile', device.id, message, 'maintenance', null);
      return;
    }
  } catch (e) { /* فشل الفحص ⇒ إرسال طبيعي */ }

  const dur = formatDuration(downtimeDurationSeconds);
  const message = msg(
    '🟢 عاد الجهاز للعمل: {name}\nIP: {ip}\nمدة الانقطاع: {dur}',
    '🟢 Device back online: {name}\nIP: {ip}\nDowntime: {dur}',
    { name: device.name, ip: device.ip, dur: dur }
  );
  let tgMarkup = null;
  try { tgMarkup = require('./telegram-bot.service').tgButtons(); } catch (e) { tgMarkup = null; }
  await Promise.all([
    sendTelegram(message, device.id, tgMarkup),
    sendWhatsapp(message, device.id),
    sendMobile(message, device.id),
  ]);
}

// formatDuration(seconds): تحويل ثواني إلى نص مقروء — بالعربية كما كان حرفيًّا، وبالإنجليزية بوحدات
// كاملة مفردة/جمعًا (1 minute · 3 minutes) مطابقةً لمخرجات مترجم السجل في الواجهة (enDuration)،
// فيقرأ الأدمن في السجل نفس نصّ ما أُرسل بالحرف.
function formatDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return pick('غير معروف', 'unknown');
  const s = Math.max(0, Math.floor(seconds));
  if (isEn()) {
    const u = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    if (s < 60) return u(s, 'second');
    if (s < 3600) return u(Math.floor(s / 60), 'minute');
    return u(Math.floor(s / 3600), 'hour') + ' ' + u(Math.floor((s % 3600) / 60), 'minute');
  }
  if (s < 60) return `${s} ثانية`;
  if (s < 3600) return `${Math.floor(s / 60)} دقيقة`;
  return `${Math.floor(s / 3600)} ساعة و${Math.floor((s % 3600) / 60)} دقيقة`;
}

// sendGenericNotification(message): إشعار عام لِـ أحاديث ليست مَربُوطة بجهاز محدد
// (مِثل: جهاز جديد مُكتشَف في scan-scheduler.service.js، تَنبيه مَنشئي admin، ...).
// لا يَستقبل device_id — يُسجّل في notification_logs بـ device_id=NULL.
async function sendGenericNotification(message) {
  await Promise.all([
    sendTelegram(message, null),
    sendWhatsapp(message, null),
    sendMobile(message, null),
  ]);
}

// ═══ MON-02 — تنبيهات على مستوى **الخدمة** ═══
// رسالة مستقلة تحمل اسم الخدمة ونوعها ومنفذها، فلا تُخلط بانقطاع المضيف.
// تحترم نافذة الصيانة مثل بقية الإشعارات، وتُسجَّل في notification_logs بمعرّف الجهاز.
// isMaintenanceWindow(): فحص نافذة الصيانة بحماية من فشل الخدمة (لا يكسر الإرسال).
async function isMaintenanceWindow() {
  try {
    const { isMaintenanceNow } = require('./maintenance.service');
    return await isMaintenanceNow();
  } catch (_) {
    return false;
  }
}

function serviceTarget(service) {
  if (service.kind === 'tcp') return `TCP ${service.port}`;
  const port = service.port || (service.kind === 'https' ? 443 : 80);
  return `${String(service.kind).toUpperCase()} ${port}${service.url_path || '/'}`;
}

async function notifyServiceDown(device, service) {
  const maintenance = await isMaintenanceWindow();
  const timeStr = now();
  const message = msg(
    `${service.is_critical ? '⛔' : '🟠'} خدمة متوقفة: {name}\nالجهاز: {device}{ip}\nالفحص: {target}\nالخطأ: {err}\nالوقت: {time}`,
    `${service.is_critical ? '⛔' : '🟠'} Service down: {name}\nDevice: {device}{ip}\nCheck: {target}\nError: {err}\nTime: {time}`,
    {
      name: service.name,
      device: device.name,
      ip: device.ip ? ' (' + device.ip + ')' : '',
      target: serviceTarget(service),
      err: service.last_error || pick('غير متاح', 'unavailable'),
      time: timeStr,
    }
  );
  if (maintenance) {
    logNotification('telegram', device.id, message, 'maintenance', null);
    logNotification('whatsapp', device.id, message, 'maintenance', null);
    logNotification('mobile', device.id, message, 'maintenance', null);
    console.log(`[notify] نافذة صيانة — كتم إشعار خدمة: ${service.name}`);
    return;
  }
  await Promise.all([
    sendTelegram(message, device.id),
    sendWhatsapp(message, device.id),
    sendMobile(message, device.id),
  ]);
}

async function notifyServiceRecovered(device, service) {
  const maintenance = await isMaintenanceWindow();
  const timeStr = now();
  const message = msg(
    '✅ عادت الخدمة للعمل: {name}\nالجهاز: {device}{ip}\nالفحص: {target}\nالوقت: {time}',
    '✅ Service back up: {name}\nDevice: {device}{ip}\nCheck: {target}\nTime: {time}',
    {
      name: service.name,
      device: device.name,
      ip: device.ip ? ' (' + device.ip + ')' : '',
      target: serviceTarget(service),
      time: timeStr,
    }
  );
  if (maintenance) {
    logNotification('telegram', device.id, message, 'maintenance', null);
    logNotification('whatsapp', device.id, message, 'maintenance', null);
    logNotification('mobile', device.id, message, 'maintenance', null);
    return;
  }
  await Promise.all([
    sendTelegram(message, device.id),
    sendWhatsapp(message, device.id),
    sendMobile(message, device.id),
  ]);
}

module.exports = {
  sendTelegram,
  sendWhatsapp,
  sendMobile,
  notifyDeviceDown,
  notifyDeviceRecovered,
  notifyServiceDown,
  notifyServiceRecovered,
  sendGenericNotification,
  testAllChannels,
  testChannel,
  testChannelNames,
  getSettings,
  getSettingsWithSources,
};
