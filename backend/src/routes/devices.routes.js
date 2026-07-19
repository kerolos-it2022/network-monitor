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

// ============================================================
// تصدير الأجهزة إلى Excel
// GET /api/devices/export/excel  🔒
// ============================================================
router.get('/export/excel', requireAuth, (req, res) => {
  const XLSX = require('xlsx');
  const devices = db.prepare(`${DEVICE_SELECT} ORDER BY d.id ASC`).all();

  // تحضير البيانات للتصدير
  const exportData = devices.map((d) => ({
    'الاسم': d.name,
    'IP': d.ip,
    'النوع': d.device_type_name || '',
    'الموقع': d.location_name || '',
    'طريقة الفحص': d.check_protocol,
    'المنفذ': d.port || '',
    'فترة الفحص (ثانية)': d.check_interval_seconds,
    'حد التنبيه': d.failure_threshold,
    'مفعّل': d.is_active ? 'نعم' : 'لا',
    'الحالة الحالية': d.current_status,
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(exportData);
  // تعيين عرض الأعمدة
  ws['!cols'] = [
    { wch: 25 }, { wch: 18 }, { wch: 15 }, { wch: 25 },
    { wch: 15 }, { wch: 10 }, { wch: 18 }, { wch: 12 },
    { wch: 10 }, { wch: 15 }
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'الأجهزة');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=devices.xlsx');
  return res.send(buf);
});

// ============================================================
// استيراد الأجهزة من Excel
// POST /api/devices/import/excel  🔒
// ============================================================
router.post('/import/excel', requireAuth, (req, res) => {
  if (!req.files || !req.files.file) {
    return res.status(400).json({ success: false, error: 'لم يتم رفع ملف' });
  }

  const XLSX = require('xlsx');
  const file = req.files.file;

  try {
    const wb = XLSX.read(file.data, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    // جلب الأنواع والمواقع للربط
    const types = db.prepare('SELECT id, name FROM device_types').all();
    const typeMap = Object.fromEntries(types.map(t => [t.name, t.id]));
    const locs = db.prepare('SELECT id, name FROM locations').all();
    const locMap = Object.fromEntries(locs.map(l => [l.name, l.id]));

    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = (row['الاسم'] || '').toString().trim();
      const ip = (row['IP'] || '').toString().trim();
      const typeName = (row['النوع'] || '').toString().trim();
      const locName = (row['الموقع'] || '').toString().trim();
      const checkProtocol = (row['طريقة الفحص'] || 'ping').toString().trim().toLowerCase();
      const port = row['المنفذ'] ? parseInt(row['المنفذ'], 10) : null;
      const checkInterval = row['فترة الفحص (ثانية)'] ? parseInt(row['فترة الفحص (ثانية)'], 10) : 30;
      const failureThreshold = row['حد التنبيه'] ? parseInt(row['حد التنبيه'], 10) : 3;
      const isActive = (row['مفعّل'] || 'نعم').toString().trim() === 'نعم' ? 1 : 0;

      if (!name || !ip || !typeName) {
        skipped++;
        errors.push(`صف ${i + 2}: حقول الاسم/IP/النوع مطلوبة`);
        continue;
      }

      const deviceTypeId = typeMap[typeName];
      if (!deviceTypeId) {
        skipped++;
        errors.push(`صف ${i + 2}: نوع الجهاز "${typeName}" غير موجود`);
        continue;
      }

      const locationId = locName ? locMap[locName] || null : null;

      try {
        db.prepare(
          `INSERT INTO devices
            (name, ip, device_type_id, location_id, check_protocol, port,
             check_interval_seconds, failure_threshold, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(name, ip, deviceTypeId, locationId, checkProtocol, port, checkInterval, failureThreshold, isActive);
        imported++;
      } catch (e) {
        skipped++;
        errors.push(`صف ${i + 2}: ${e.message}`);
      }
    }

    return res.json({
      success: true,
      data: { imported, skipped, errors }
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'فشل قراءة ملف Excel: ' + e.message });
  }
});

module.exports = router;