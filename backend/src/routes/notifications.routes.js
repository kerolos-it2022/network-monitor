// notifications.routes.js: مسارات إعدادات الإشعارات وسجلها (محمية).
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// maskToken(value): إرجاع آخر 4 خانات فقط.
function maskToken(value) {
  if (!value) return '';
  const v = String(value).trim();
  if (v.length <= 4) return '***' + v.slice(-4);
  return '***' + v.slice(-4);
}

// GET /api/notifications/settings  🔒
router.get('/settings', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM notification_settings WHERE id = 1').get();
  if (!row) {
    return res.json({
      success: true,
      data: {
        telegram_enabled: 0,
        telegram_bot_token: '',
        telegram_chat_id: '',
        telegram_bot_token_masked: '',
        whatsapp_enabled: 0,
        whatsapp_api_url: '',
        whatsapp_api_token: '',
        whatsapp_to_number: '',
        whatsapp_api_token_masked: '',
        mobile_enabled: 0,
        fcm_server_key: '',
        fcm_server_key_masked: '',
      },
    });
  }
  return res.json({
    success: true,
    data: {
      telegram_enabled: row.telegram_enabled,
      telegram_bot_token: maskToken(row.telegram_bot_token),
      telegram_bot_token_masked: maskToken(row.telegram_bot_token),
      telegram_chat_id: row.telegram_chat_id,
      whatsapp_enabled: row.whatsapp_enabled,
      whatsapp_api_url: row.whatsapp_api_url,
      whatsapp_api_token: maskToken(row.whatsapp_api_token),
      whatsapp_api_token_masked: maskToken(row.whatsapp_api_token),
      whatsapp_to_number: row.whatsapp_to_number,
      mobile_enabled: row.mobile_enabled || 0,
      fcm_server_key: maskToken(row.fcm_server_key),
      fcm_server_key_masked: maskToken(row.fcm_server_key),
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

  db.prepare(
    `UPDATE notification_settings SET
      telegram_enabled = ?,
      telegram_bot_token = ?,
      telegram_chat_id = ?,
      whatsapp_enabled = ?,
      whatsapp_api_url = ?,
      whatsapp_api_token = ?,
      whatsapp_to_number = ?,
      mobile_enabled = ?,
      fcm_server_key = ?
     WHERE id = 1`
  ).run(
    telegram_enabled ? 1 : 0,
    keepOrNew(telegram_bot_token, current.telegram_bot_token),
    telegram_chat_id || null,
    whatsapp_enabled ? 1 : 0,
    whatsapp_api_url || null,
    keepOrNew(whatsapp_api_token, current.whatsapp_api_token),
    whatsapp_to_number || null,
    mobile_enabled ? 1 : 0,
    keepOrNew(fcm_server_key, current.fcm_server_key)
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
         nl.channel, nl.message, nl.status, nl.sent_at
       FROM notification_logs nl
       LEFT JOIN devices d ON d.id = nl.device_id
       ORDER BY nl.sent_at DESC
       LIMIT 100`
    )
    .all();
  return res.json({ success: true, data: rows });
});

// DELETE /api/notifications/logs?older_than_days=1|7|30  🔒
router.delete('/logs', requireAuth, (req, res) => {
  const days = Number(req.query.older_than_days);
  if (![1, 7, 30].includes(days)) {
    return res.status(400).json({ success: false, error: 'قيمة older_than_days غير صالحة (1/7/30)' });
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
    return res.status(400).json({ success: false, error: 'endpoint غير صالح' });
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
    return res.status(400).json({ success: false, error: 'endpoint مطلوب' });
  }
  db.prepare('UPDATE mobile_registrations SET is_active = 0 WHERE endpoint = ?').run(endpoint);
  return res.json({ success: true, data: { unregistered: true } });
});

// POST /api/notifications/test  🔒 — إرسال إشعار تجربة لكل التسجيلات النشطة
router.post('/test', requireAuth, async (req, res) => {
  const notifier = require('../services/notifier.service');
  try {
    const ok = await notifier.sendMobile('🔔 إشعار تجريبي من نظام مراقبة الشبكة', null);
    return res.json({ success: true, data: { sent: ok } });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'فشل الإرسال: ' + e.message });
  }
});

// GET /api/notifications/vapid-public — عام (لا auth): يُرجع VAPID public key للمتصفح.
router.get('/vapid-public', (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    return res.status(503).json({ success: false, error: 'VAPID غير مُهيّأ على الخادم' });
  }
  return res.json({ success: true, data: { publicKey: key } });
});

module.exports = router;
