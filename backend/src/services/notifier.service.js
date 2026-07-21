// notifier.service.js: إرسال الإشعارات عبر تلجرام وواتساب + تسجيل نتائج الإرسال في notification_logs.
const axios = require('axios');
const webpush = require('web-push');
const db = require('../db');

// getSettings(): يقرأ الصف الوحيد من إعدادات الإشعارات (id=1).
async function getSettings() {
  return db.prepare('SELECT * FROM notification_settings WHERE id = 1').get();
}

// sendTelegram(message, deviceId): إرسال رسالة لتلجرام مع تسجيل النتيجة. يتجاهل بصمت إذا كان معطّلاً.
async function sendTelegram(message, deviceId = null) {
  const s = await getSettings();
  if (!s || !s.telegram_enabled || !s.telegram_bot_token || !s.telegram_chat_id) {
    return;
  }
  const url = `https://api.telegram.org/bot${s.telegram_bot_token}/sendMessage`;
  try {
    await axios.post(url, { chat_id: s.telegram_chat_id, text: message }, { timeout: 10000 });
    db.prepare(
      `INSERT INTO notification_logs (device_id, channel, message, status) VALUES (?, 'telegram', ?, 'sent')`
    ).run(deviceId, message);
  } catch (e) {
    console.error('Telegram send failed:', e.message);
    db.prepare(
      `INSERT INTO notification_logs (device_id, channel, message, status) VALUES (?, 'telegram', ?, 'failed')`
    ).run(deviceId, message);
  }
}

// sendWhatsapp(message, deviceId): إرسال عبر مزود WhatsApp عام. يتجاهل بصمت إذا كان معطّلاً أو ناقص الإعدادات.
async function sendWhatsapp(message, deviceId = null) {
  const s = await getSettings();
  if (!s || !s.whatsapp_enabled || !s.whatsapp_api_url || !s.whatsapp_api_token || !s.whatsapp_to_number) {
    return;
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
    db.prepare(
      `INSERT INTO notification_logs (device_id, channel, message, status) VALUES (?, 'whatsapp', ?, 'sent')`
    ).run(deviceId, message);
  } catch (e) {
    console.error('WhatsApp send failed:', e.message);
    db.prepare(
      `INSERT INTO notification_logs (device_id, channel, message, status) VALUES (?, 'whatsapp', ?, 'failed')`
    ).run(deviceId, message);
  }
}

// sendMobile(message, deviceId): إرسال إشعار Push لأجهزة الموبايل (PWA) عبر Web Push protocol.
// يستعمل VAPID keys (من .env: VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY).
// يُرجع true إذا تم الإرسال بنجاح لأي تسجيل، false خلاف ذلك.
async function sendMobile(message, deviceId = null) {
  const s = await getSettings();
  if (!s || !s.mobile_enabled) {
    return false;
  }

  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
  if (!vapidPublic || !vapidPrivate) {
    console.warn('[notify] VAPID keys غير مضبوطة في .env — تعطيل sendMobile');
    return false;
  }

  // إعداد web-push مرة واحدة
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  // جلب التسجيلات النشطة (كل تسجيل = PushSubscription كاملة JSON)
  const registrations = db
    .prepare('SELECT id, endpoint FROM mobile_registrations WHERE is_active = 1')
    .all();

  if (registrations.length === 0) {
    return false;
  }

  const payload = JSON.stringify({
    notification: {
      title: 'مراقبة الشبكة',
      body: message,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'nm-' + (deviceId || '0'),
      data: { deviceId: String(deviceId || ''), url: '/' },
    },
  });

  let anyOk = false;
  const nowIso = new Date().toISOString();
  const deadIds = [];

  await Promise.all(registrations.map(async (reg) => {
    let subscription;
    try {
      // endpoint مخزّن = JSON كامل لـ PushSubscription
      subscription = JSON.parse(reg.endpoint);
    } catch (e) {
      // إن لم يكن JSON، نتجاهل
      return;
    }
    if (!subscription || !subscription.endpoint) return;

    try {
      await webpush.sendNotification(subscription, payload, {
        TTL: 24 * 3600, // صلاحية 24 ساعة
        urgency: 'high',
      });
      anyOk = true;
    } catch (err) {
      const status = err.statusCode;
      // 404 / 410 = التسجيل لم يعد صالحاً
      if (status === 404 || status === 410) {
        deadIds.push(reg.id);
      } else {
        console.error(`[notify] web-push خطأ (${status}):`, err.message);
      }
    }
  }));

  // تعطيل التسجيلات الميتة
  if (deadIds.length > 0) {
    const stmt = db.prepare('UPDATE mobile_registrations SET is_active = 0 WHERE id = ?');
    deadIds.forEach((id) => stmt.run(id));
    console.log(`[notify] تم تعطيل ${deadIds.length} تسجيل ميت`);
  }

  // تسجيل في notification_logs
  db.prepare(
    `INSERT INTO notification_logs (device_id, channel, message, status) VALUES (?, 'mobile', ?, ?)`
  ).run(deviceId, message, anyOk ? 'sent' : 'failed');

  // تحديث last_notified_at للتسجيلات النشطة
  if (anyOk) {
    db.prepare('UPDATE mobile_registrations SET last_notified_at = ? WHERE is_active = 1').run(nowIso);
  }

  return anyOk;
}

// notifyDeviceDown(device): إشعار انقطاع جهاز للقنوات المفعّلة (متوازي).
async function notifyDeviceDown(device) {
  const timeStr = new Date().toLocaleString('ar');
  const message =
    `🔴 انقطع الجهاز: ${device.name}\n` +
    `IP: ${device.ip}\n` +
    `النوع: ${device.device_type_name || '-'}\n` +
    `الموقع: ${device.location_name || '-'}\n` +
    `الوقت: ${timeStr}`;
  // إرسال متوازي لكل القنوات (لا ننتظر تلجرام قبل واتساب)
  await Promise.all([
    sendTelegram(message, device.id),
    sendWhatsapp(message, device.id),
    sendMobile(message, device.id),
  ]);
}

// notifyDeviceRecovered(device, downtimeDurationSeconds): إشعار عودة جهاز (متوازي).
async function notifyDeviceRecovered(device, downtimeDurationSeconds) {
  const dur = formatDuration(downtimeDurationSeconds);
  const message =
    `🟢 عاد الجهاز للعمل: ${device.name}\n` +
    `IP: ${device.ip}\n` +
    `مدة الانقطاع: ${dur}`;
  await Promise.all([
    sendTelegram(message, device.id),
    sendWhatsapp(message, device.id),
    sendMobile(message, device.id),
  ]);
}

// formatDuration(seconds): تحويل ثواني إلى نص مقروء بالعربية.
function formatDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return 'غير معروف';
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s} ثانية`;
  if (s < 3600) return `${Math.floor(s / 60)} دقيقة`;
  return `${Math.floor(s / 3600)} ساعة و${Math.floor((s % 3600) / 60)} دقيقة`;
}

module.exports = { sendTelegram, sendWhatsapp, sendMobile, notifyDeviceDown, notifyDeviceRecovered };
