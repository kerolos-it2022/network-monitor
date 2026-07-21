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
    },
  });
});

// PUT /api/notifications/settings  🔒 — تحديث كامل لكل الحقول المرسلة.
router.put('/settings', requireAuth, (req, res) => {
  const {
    telegram_enabled,
    telegram_bot_token,
    telegram_chat_id,
    whatsapp_enabled,
    whatsapp_api_url,
    whatsapp_api_token,
    whatsapp_to_number,
  } = req.body || {};

  // ضمان وجود الصف قبل التحديث.
  db.prepare('INSERT OR IGNORE INTO notification_settings (id) VALUES (1)').run();

  db.prepare(
    `UPDATE notification_settings SET
      telegram_enabled = ?,
      telegram_bot_token = ?,
      telegram_chat_id = ?,
      whatsapp_enabled = ?,
      whatsapp_api_url = ?,
      whatsapp_api_token = ?,
      whatsapp_to_number = ?
     WHERE id = 1`
  ).run(
    telegram_enabled ? 1 : 0,
    telegram_bot_token || null,
    telegram_chat_id || null,
    whatsapp_enabled ? 1 : 0,
    whatsapp_api_url || null,
    whatsapp_api_token || null,
    whatsapp_to_number || null
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

module.exports = router;
