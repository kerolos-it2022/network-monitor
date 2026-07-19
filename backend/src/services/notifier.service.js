// notifier.service.js: إرسال الإشعارات عبر تلجرام وواتساب + تسجيل نتائج الإرسال في notification_logs.
const axios = require('axios');
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

// notifyDeviceDown(device): إشعار انقطاع جهاز للقنوات المفعّلة.
async function notifyDeviceDown(device) {
  const timeStr = new Date().toLocaleString('ar');
  const message =
    `🔴 انقطع الجهاز: ${device.name}\n` +
    `IP: ${device.ip}\n` +
    `النوع: ${device.device_type_name || '-'}\n` +
    `الموقع: ${device.location_name || '-'}\n` +
    `الوقت: ${timeStr}`;
  await sendTelegram(message, device.id);
  await sendWhatsapp(message, device.id);
}

// notifyDeviceRecovered(device, downtimeDurationSeconds): إشعار عودة جهاز.
async function notifyDeviceRecovered(device, downtimeDurationSeconds) {
  const dur = formatDuration(downtimeDurationSeconds);
  const message =
    `🟢 عاد الجهاز للعمل: ${device.name}\n` +
    `IP: ${device.ip}\n` +
    `مدة الانقطاع: ${dur}`;
  await sendTelegram(message, device.id);
  await sendWhatsapp(message, device.id);
}

// formatDuration(seconds): تحويل ثواني إلى نص مقروء بالعربية.
function formatDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return 'غير معروف';
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s} ثانية`;
  if (s < 3600) return `${Math.floor(s / 60)} دقيقة`;
  return `${Math.floor(s / 3600)} ساعة و${Math.floor((s % 3600) / 60)} دقيقة`;
}

module.exports = { sendTelegram, sendWhatsapp, notifyDeviceDown, notifyDeviceRecovered };
