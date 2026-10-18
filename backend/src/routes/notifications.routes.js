// notifications.routes.js: مسارات إعدادات الإشعارات وسجلها (محمية).
// v2.13.0 — هذه المسارات هي حلقة الوصل بين إصلاحات الإشعارات الجديدة (notifier/vapid) والواجهة.
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
// نصّ الإشعار المُرسَل بلغتين — يتبع إعداد لغة الإشعارات (رسالة واحدة بلغة واحدة).
const { msg, pick } = require('../services/message-i18n.service');
const { uiText } = require('../services/ui-text.service');

const router = express.Router();

// maskToken(value): إرجاع آخر 4 خانات فقط.
function maskToken(value) {
  if (!value) return '';
  const v = String(value).trim();
  if (v.length <= 4) return '***' + v.slice(-4);
  return '***' + v.slice(-4);
}

// GET /api/notifications/settings  🔒
// v2.13.0 — يقرأ الإعدادات **الفعّالة** (صف القاعدة + رجوع متغيّرات البيئة) لا الصف وحده:
// كان الحقل يظهر «غير مضبوط» بينما الإرسال يعمل فعلًا من .env (والعكس أيضًا).
// ويُضيف للتشخيص: sources (مصدر كل اعتماد: db/env) و vapid_public_key_ready
// (سبب تعطّل إشعارات الهاتف قبل أي محاولة إرسال).
router.get('/settings', requireAuth, async (req, res) => {
  const notifier = require('../services/notifier.service');
  const vapid = require('../services/vapid.service');
  let s;
  try {
    s = await notifier.getSettingsWithSources();
  } catch (e) {
    return res.status(500).json({ success: false, error: uiText('تعذّر قراءة إعدادات الإشعارات: ', 'Could not read the notification settings: ') + e.message });
  }
  return res.json({
    success: true,
    data: {
      telegram_enabled: s.telegram_enabled ? 1 : 0,
      telegram_bot_token: maskToken(s.telegram_bot_token),
      telegram_bot_token_masked: maskToken(s.telegram_bot_token),
      telegram_chat_id: s.telegram_chat_id || '',
      whatsapp_enabled: s.whatsapp_enabled ? 1 : 0,
      whatsapp_api_url: s.whatsapp_api_url || '',
      whatsapp_api_token: maskToken(s.whatsapp_api_token),
      whatsapp_api_token_masked: maskToken(s.whatsapp_api_token),
      whatsapp_to_number: s.whatsapp_to_number || '',
      mobile_enabled: s.mobile_enabled ? 1 : 0,
      maintenance_enabled: s.maintenance_enabled ? 1 : 0,
      maintenance_window: s.maintenance_window || '',
      daily_report_enabled: s.daily_report_enabled ? 1 : 0,
      daily_report_hour: s.daily_report_hour || '08:00',
      bot_commands_enabled: s.bot_commands_enabled === undefined ? 1 : (s.bot_commands_enabled ? 1 : 0),
      storm_digest_enabled: s.storm_digest_enabled === undefined ? 1 : (s.storm_digest_enabled ? 1 : 0),
      storm_window_seconds: Number(s.storm_window_seconds) || 90,
      // v2.25.0 — تصعيد الانقطاعات.
      escalation_enabled: s.escalation_enabled ? 1 : 0,
      escalation_after_minutes: Number(s.escalation_after_minutes) || 30,
      escalation_repeat_minutes: Number(s.escalation_repeat_minutes) || 0,
      noc_alert_screen_enabled: (s.noc_alert_screen_enabled === undefined || s.noc_alert_screen_enabled === null) ? 1 : (s.noc_alert_screen_enabled ? 1 : 0),
      fcm_server_key: maskToken(s.fcm_server_key),
      fcm_server_key_masked: maskToken(s.fcm_server_key),
      sources: s._sources || {},
      vapid_public_key_ready: vapid.isReady(),
    },
  });
});

// PUT /api/notifications/settings  🔒 — تحديث كامل لكل الحقول المرسلة.
// ملاحظة مهمة: الحقول السرية (التوكنات و fcm_server_key) لو أُرسلت فارغة،
// لا يتم مسحها — يحتفظ بالقيمة الموجودة. لإزالتها يجب إرسال null صراحة.
router.put('/settings', requireAuth, (req, res) => {
  const {
    telegram_enabled,
    telegram_bot_token,
    telegram_chat_id,
    whatsapp_enabled,
    whatsapp_api_url,
    whatsapp_api_token,
    whatsapp_to_number,
    mobile_enabled,
    fcm_server_key,
    maintenance_enabled,
    maintenance_window,
    daily_report_enabled,
    daily_report_hour,
    bot_commands_enabled,
    storm_digest_enabled,
    storm_window_seconds,
    escalation_enabled,
    escalation_after_minutes,
    escalation_repeat_minutes,
    noc_alert_screen_enabled,
  } = req.body || {};

  // ضمان وجود الصف قبل التحديث.
  db.prepare('INSERT OR IGNORE INTO notification_settings (id) VALUES (1)').run();

  // جلب القيم الحالية للحفاظ على الأسرار إن لم تُرسل.
  const current = db.prepare('SELECT * FROM notification_settings WHERE id = 1').get() || {};

  // الحقول السرية: استخدم القيمة الجديدة إن وُجدت (string غير فارغ)، أو null صراحة،
  // أو احتفظ بالقيمة القديمة إن أُرسلت كـ undefined أو ''.
  const keepOrNew = ((newValue, oldValue) => {
    if (newValue === null) return null;
    if (typeof newValue === 'string' && newValue.trim() !== '') return newValue.trim();
    return oldValue ? oldValue : null;
  });

  // v2.13.0 — أسماء أعمدة التحديث في قائمة واحدة تُبنى منها العبارة: لا تبقى أسماء الأسطر
  // مكتوبة مرّتين (العبارة + مواضع القيم) فيفترقان عند أول حقل يُضاف لاحقًا.
  const COLUMNS = [
    'telegram_enabled',
    'telegram_bot_token',
    'telegram_chat_id',
    'whatsapp_enabled',
    'whatsapp_api_url',
    'whatsapp_api_token',
    'whatsapp_to_number',
    'mobile_enabled',
    'fcm_server_key',
    'maintenance_enabled',
    'maintenance_window',
    'daily_report_enabled',
    'daily_report_hour',
    'bot_commands_enabled',
    'storm_digest_enabled',
    'storm_window_seconds',
    'escalation_enabled',
    'escalation_after_minutes',
    'escalation_repeat_minutes',
    'noc_alert_screen_enabled',
  ];
  db.prepare(
    'UPDATE notification_settings SET ' + COLUMNS.map((c) => c + ' = ?').join(', ') + ' WHERE id = 1'
  ).run(
    telegram_enabled ? 1 : 0,
    keepOrNew(telegram_bot_token, current.telegram_bot_token),
    telegram_chat_id || null,
    whatsapp_enabled ? 1 : 0,
    whatsapp_api_url || null,
    keepOrNew(whatsapp_api_token, current.whatsapp_api_token),
    whatsapp_to_number || null,
    mobile_enabled ? 1 : 0,
    keepOrNew(fcm_server_key, current.fcm_server_key),
    maintenance_enabled ? 1 : 0,
    maintenance_window || null,
    daily_report_enabled ? 1 : 0,
    daily_report_hour || '08:00',
    bot_commands_enabled === undefined ? 1 : (bot_commands_enabled ? 1 : 0),
    storm_digest_enabled === undefined ? 1 : (storm_digest_enabled ? 1 : 0),
    Math.min(600, Math.max(15, Number(storm_window_seconds) || 90)),
    escalation_enabled ? 1 : 0,
    Math.max(1, Math.min(1440, Number(escalation_after_minutes) || 30)),
    Math.max(0, Math.min(1440, Number(escalation_repeat_minutes) || 0)),
    (noc_alert_screen_enabled === undefined || noc_alert_screen_enabled === null) ? 1 : (noc_alert_screen_enabled ? 1 : 0),
  );

  return res.json({ success: true, data: null });
});

// GET /api/notifications/logs  🔒 — آخر 100 سجل إشعار.
router.get('/logs', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT
         nl.id, nl.device_id,
         d.name AS device_name,
         nl.channel, nl.message, nl.status, nl.error, nl.sent_at
       FROM notification_logs nl
       LEFT JOIN devices d ON d.id = nl.device_id
       ORDER BY nl.sent_at DESC
       LIMIT 100`
    )
    .all();
  return res.json({ success: true, data: rows });
});

// DELETE /api/notifications/logs?older_than_days=1|7|30|365  🔒
router.delete('/logs', requireAuth, (req, res) => {
  const days = Number(req.query.older_than_days);
  // v2.7.x — تَمديد القَبُول لِـ 365 (سنة) تَماثُلاً مَع cleanup-history وcleanup-status-logs
  // الَّتان يَقبَلان range='year'. كان هَذا يُسَبِّب فَشَل «مَسح الإِشعارات» عند اختِيار «سنة».
  if (![1, 7, 30, 365].includes(days)) {
    return res.status(400).json({ success: false, error: uiText('قيمة older_than_days غير صالحة (1/7/30/365)', 'Invalid older_than_days value (1/7/30/365)') });
  }
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare('DELETE FROM notification_logs WHERE sent_at < ?').run(cutoff);
  return res.json({ success: true, data: { deleted: result.changes, older_than_days: days } });
});

// ============================================================
// تسجيل/إلغاء أجهزة الموبايل (PWA) — عام بدون مصادقة
// POST   /api/notifications/register   { endpoint, platform, deviceInfo }
// DELETE /api/notifications/register   { endpoint }
// ============================================================
router.post('/register', (req, res) => {
  const { endpoint, platform, deviceInfo } = req.body || {};
  if (!endpoint || typeof endpoint !== 'string' || endpoint.length < 10) {
    return res.status(400).json({ success: false, error: uiText('endpoint غير صالح', 'Invalid endpoint') });
  }
  // إدراج أو تحديث isActive=1 لو كان مسجلاً من قبل
  db.prepare(
    `INSERT INTO mobile_registrations (endpoint, platform, device_info, is_active)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(endpoint) DO UPDATE SET is_active = 1, platform = ?, device_info = ?`
  ).run(endpoint, platform || null, deviceInfo || null, platform || null, deviceInfo || null);
  return res.json({ success: true, data: { registered: true } });
});

router.delete('/register', (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) {
    return res.status(400).json({ success: false, error: uiText('endpoint مطلوب', 'endpoint is required') });
  }
  db.prepare('UPDATE mobile_registrations SET is_active = 0 WHERE endpoint = ?').run(endpoint);
  return res.json({ success: true, data: { unregistered: true } });
});

// POST /api/notifications/test  🔒 — v2.13.0: يجرّب **القنوات المفعّلة** كلها ويُعيد نتيجة كل
// قناة بسببها (كان يجرّب إشعارات الهاتف وحدها ويردّ «فشل الإرسال» بلا أي تفصيل).
// v2.33.0 — جسم اختياري { channel: 'telegram'|'whatsapp'|'mobile' } لاختبار قناة واحدة
// (زر اختبار مستقل لكل قناة في اللوحة)؛ بلا channel ⇒ كل القنوات كما كان (توافق خلفي).
// success = نجح إرسال فعلي لقناة واحدة على الأقل؛ والتفصيل الكامل في data.results.
router.post('/test', requireAuth, async (req, res) => {
  const notifier = require('../services/notifier.service');
  try {
    const wanted = (req.body && req.body.channel !== undefined && req.body.channel !== null)
      ? String(req.body.channel).trim().toLowerCase()
      : '';
    if (wanted && !notifier.testChannelNames().includes(wanted)) {
      return res.status(400).json({
        success: false,
        error: uiText('قناة غير معروفة: ', 'Unknown channel: ') + wanted + uiText(' — المتاح: ', ' — available: ') + notifier.testChannelNames().join(' · '),
      });
    }
    const message = wanted
      ? msg('🔔 إشعار تجريبي ({ch}) من نظام مراقبة الشبكة', '🔔 Test notification ({ch}) from Network Monitor', { ch: wanted })
      : pick('🔔 إشعار تجريبي من نظام مراقبة الشبكة', '🔔 Test notification from Network Monitor');
    const results = wanted
      ? [await notifier.testChannel(wanted, message)]
      : await notifier.testAllChannels(message);
    const sent = results.some((r) => r.ok);
    return res.json({ success: sent, data: { sent: sent, channel: wanted || null, results: results } });
  } catch (e) {
    return res.status(500).json({ success: false, error: uiText('فشل الإرسال: ', 'Sending failed: ') + e.message });
  }
});

// GET /api/notifications/vapid-public — عام (لا auth): يُرجع VAPID public key للمتصفح.
// v2.13.0 — لم يعد يقرأ البيئة وحدها: عند غياب المفاتيح يُولَّد زوج ويُحفظ (vapid.service)،
// فلا يفشل «تفعيل الإشعارات» على الأبلاينس برسالة «غير مُهيّأ على الخادم».
router.get('/vapid-public', (req, res) => {
  const vapid = require('../services/vapid.service');
  try {
    if (!vapid.isReady()) vapid.ensureVapidKeys();
  } catch (e) {
    console.error('[vapid] تعذّر ضمان المفاتيح عند /vapid-public:', e.message);
  }
  if (!vapid.isReady()) {
    return res.status(503).json({
      success: false,
      error: uiText('تعذّر تجهيز مفاتيح Web Push على الخادم — راجع سجل الخدمة (صلاحية ملف الإعدادات/مساحة القرص).',
        'Could not prepare the Web Push keys on the server — check the service log (settings-file permissions/disk space).'),
    });
  }
  return res.json({ success: true, data: { publicKey: vapid.getPublicKey() } });
});

module.exports = router;
