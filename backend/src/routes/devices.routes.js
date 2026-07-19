// devices.routes.js: مسارات إدارة الأجهزة (عامة للقراءة، محمية للكتابة) + سجل الحالة (history).
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// ---------------------------------------------------------
// استعلام موحد لجلب جهاز/أجهزة مع أسماء النوع والموقع (JOINs)
// ---------------------------------------------------------
const DEVICE_SELECT = `
  SELECT
    d.id, d.name, d.ip, d.device_type_id,
    dt.name AS device_type_name,
    d.location_id,
    l.name AS location_name,
    d.check_protocol, d.port,
    d.check_interval_seconds, d.failure_threshold, d.is_active,
    d.current_status, d.last_response_time_ms, d.last_checked_at
  FROM devices d
  LEFT JOIN device_types dt ON dt.id = d.device_type_id
  LEFT JOIN locations l ON l.id = d.location_id
`;

// GET /api/devices  (عام)
router.get('/', (req, res) => {
  const devices = db.prepare(`${DEVICE_SELECT} ORDER BY d.id ASC`).all();
  return res.json({ success: true, data: devices });
});

// GET /api/devices/:id  (عام)
router.get('/:id', (req, res) => {
  const device = db.prepare(`${DEVICE_SELECT} WHERE d.id = ?`).get(req.params.id);
  if (!device) {
    return res.status(404).json({ success: false, error: 'الجهاز غير موجود' });
  }
  return res.json({ success: true, data: device });
});

// GET /api/devices/:id/history?range=24h|7d|30d  (عام)
router.get('/:id/history', (req, res) => {
  const { id } = req.params;
  const device = db.prepare('SELECT id FROM devices WHERE id = ?').get(id);
  if (!device) {
    return res.status(404).json({ success: false, error: 'الجهاز غير موجود' });
  }

  // تحويل range إلى عدد ساعات.
  const rangeMap = { '24h': 24, '7d': 168, '30d': 720 };
  const hours = rangeMap[req.query.range] || 24;
  const sinceIso = new Date(Date.now() - hours * 3600 * 1000).toISOString();

  // 1) سجلات الحالة ضمن النافذة.
  const statusPoints = db.prepare(
    `SELECT checked_at, status, response_time_ms
       FROM status_logs
      WHERE device_id = ? AND checked_at >= ?
      ORDER BY checked_at ASC`
  ).all(id, sinceIso);

  // 2) حساب نسبة التشغيل.
  let uptimePercentage = 0;
  if (statusPoints.length > 0) {
    const onlineCount = statusPoints.filter((s) => s.status === 'online').length;
    uptimePercentage =
      Math.round((onlineCount / statusPoints.length) * 10000) / 100; // رقمين عشريين
  }

  // 3) أحداث الانقطاع: أي حدث بدأ ضمن النافذة أو لا يزال مستمراً (ended_at IS NULL).
  const events = db.prepare(
    `SELECT started_at, ended_at, duration_seconds
       FROM downtime_events
      WHERE device_id = ?
        AND (started_at >= ? OR ended_at IS NULL)
      ORDER BY started_at ASC`
  ).all(id, sinceIso);

  const now = Date.now();
  const downtimeEvents = events.map((e) => {
    let durationSeconds = e.duration_seconds;
    if (e.ended_at == null) {
      durationSeconds = Math.floor((now - new Date(e.started_at).getTime()) / 1000);
      if (durationSeconds < 0) durationSeconds = 0;
    }
    return {
      started_at: e.started_at,
      ended_at: e.ended_at,
      duration_seconds: durationSeconds,
    };
  });

  return res.json({
    success: true,
    data: {
      uptime_percentage: uptimePercentage,
      status_points: statusPoints,
      downtime_events: downtimeEvents,
    },
  });
});

// POST /api/devices  🔒
router.post('/', requireAuth, (req, res) => {
  const {
    name, ip, device_type_id, location_id,
    check_protocol, port, check_interval_seconds, failure_threshold, is_active,
  } = req.body || {};

  if (!name || !ip || !device_type_id) {
    return res
      .status(400)
      .json({ success: false, error: 'الحقول name وip وdevice_type_id مطلوبة' });
  }

  const result = db.prepare(
    `INSERT INTO devices
      (name, ip, device_type_id, location_id, check_protocol, port,
       check_interval_seconds, failure_threshold, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    name,
    ip,
    device_type_id,
    location_id ?? null,
    check_protocol || 'ping',
    port ?? null,
    check_interval_seconds ?? 30,
    failure_threshold ?? 3,
    is_active == null ? 1 : is_active
  );

  return res.status(201).json({ success: true, data: { id: result.lastInsertRowid } });
});

// PUT /api/devices/:id  🔒
router.put('/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT id FROM devices WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ success: false, error: 'الجهاز غير موجود' });
  }

  const {
    name, ip, device_type_id, location_id,
    check_protocol, port, check_interval_seconds, failure_threshold, is_active,
  } = req.body || {};

  if (!name || !ip || !device_type_id) {
    return res
      .status(400)
      .json({ success: false, error: 'الحقول name وip وdevice_type_id مطلوبة' });
  }

  db.prepare(
    `UPDATE devices SET
      name = ?, ip = ?, device_type_id = ?, location_id = ?,
      check_protocol = ?, port = ?,
      check_interval_seconds = ?, failure_threshold = ?, is_active = ?
     WHERE id = ?`
  ).run(
    name,
    ip,
    device_type_id,
    location_id ?? null,
    check_protocol || 'ping',
    port ?? null,
    check_interval_seconds ?? 30,
    failure_threshold ?? 3,
    is_active == null ? 1 : is_active,
    id
  );

  return res.json({ success: true, data: null });
});

// DELETE /api/devices/:id  🔒
router.delete('/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT id FROM devices WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ success: false, error: 'الجهاز غير موجود' });
  }
  db.prepare('DELETE FROM devices WHERE id = ?').run(id);
  return res.json({ success: true, data: null });
});

module.exports = router;
