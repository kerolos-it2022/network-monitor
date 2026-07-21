// devices.routes.js: مسارات إدارة الأجهزة (عامة للقراءة، محمية للكتابة) + سجل الحالة (history).
const express = require('express');
const multer = require('multer');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const { checkHttp, checkHttps } = require('../services/checkers');

const router = express.Router();

// إعداد multer لملفات Excel في الذاكرة
const upload = multer({ storage: multer.memoryStorage() });

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
    d.current_status, d.http_accessible, d.https_accessible,
    d.last_response_time_ms, d.last_checked_at
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
      durationSeconds = Math.floor((Date.now() - new Date(e.started_at).getTime()) / 1000);
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

  // منع تكرار عنوان IP — كل IP يجب أن يُسجَّل مرة واحدة فقط.
  const existingIp = db.prepare('SELECT id FROM devices WHERE ip = ?').get(ip);
  if (existingIp) {
    return res
      .status(409)
      .json({ success: false, error: 'عنوان IP "' + ip + '" مسجّل بالفعل لجهاز آخر (رقم ' + existingIp.id + ')' });
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

  const newDeviceId = result.lastInsertRowid;

  // فحص تلقائي لبروتوكولات HTTP و HTTPS عند إضافة جهاز جديد
  // تنفيذ بشكل غير متزامن حتى لا يؤخر إرجاع الرد
  (async () => {
    try {
      const [httpRes, httpsRes] = await Promise.all([
        checkHttp(ip, 80, 5000),
        checkHttps(ip, 443, 5000),
      ]);
      db.prepare(
        'UPDATE devices SET http_accessible = ?, https_accessible = ? WHERE id = ?'
      ).run(httpRes.isOnline ? 1 : 0, httpsRes.isOnline ? 1 : 0, newDeviceId);
      console.log(`[AUTO-SCAN] New device ${newDeviceId} (${ip}): HTTP=${httpRes.isOnline}, HTTPS=${httpsRes.isOnline}`);
    } catch (e) {
      console.error(`[AUTO-SCAN] Error scanning new device ${newDeviceId} (${ip}):`, e);
    }
  })();

  return res.status(201).json({ success: true, data: { id: newDeviceId } });
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

  // منع تكرار IP عند التعديل — نتأكد أنه لا يملكه جهاز آخر.
  const ipConflict = db.prepare('SELECT id FROM devices WHERE ip = ? AND id != ?').get(ip, id);
  if (ipConflict) {
    return res
      .status(409)
      .json({ success: false, error: 'عنوان IP "' + ip + '" مسجّل بالفعل لجهاز آخر (رقم ' + ipConflict.id + ')' });
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
router.post('/import/excel', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'لم يتم رفع ملف' });
  }

  const XLSX = require('xlsx');

  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];

    // تحويل الصفوف إلى JSON (الصف الأول هو العناوين).
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    // خرائط لتحويل أسماء الأعمدة العربية/الإنجليزية إلى معرّفات.
    const typeMap = new Map();
    db.prepare('SELECT id, name FROM device_types').all().forEach((t) => typeMap.set(String(t.name).trim(), t.id));
    const locMap = new Map();
    db.prepare('SELECT id, name FROM locations').all().forEach((l) => locMap.set(String(l.name).trim(), l.id));

    // مجموعة كل عناوين IP الموجودة فعلاً في قاعدة البيانات + داخل هذا الملف.
    const existingIps = new Set(
      db.prepare('SELECT ip FROM devices').all().map((r) => String(r.ip).trim())
    );
    const seenInFile = new Set(); // لكتشاف التكرار داخل نفس ملف Excel أيضاً.

    let imported = 0;
    let skipped = 0;
    const errors = [];

    const insertStmt = db.prepare(
      `INSERT INTO devices
        (name, ip, device_type_id, location_id, check_protocol, port,
         check_interval_seconds, failure_threshold, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = String(row['الاسم'] || row.name || row.Name || '').trim();
      const ip = String(row['IP'] || row.ip || row.IP || '').trim();
      const typeName = String(row['النوع'] || row.type || row['device_type'] || '').trim();
      const locName = String(row['الموقع'] || row.location || '').trim();
      const protocol = String(row['طريقة الفحص'] || row.protocol || row.check_protocol || 'ping').trim() || 'ping';
      const port = row['المنفذ'] || row.port || null;
      const interval = Number(row['فترة الفحص (ثانية)'] || row.interval || row.check_interval_seconds || 30);
      const threshold = Number(row['حد التنبيه'] || row.threshold || row.failure_threshold || 3);
      const activeRaw = String(row['مفعّل'] || row.is_active || 'نعم').trim();
      const isActive = /^(1|true|نعم|yes|y)$/i.test(activeRaw) ? 1 : 0;

      if (!name || !ip || !typeName) {
        skipped++;
        errors.push(`الصف ${i + 2}: حقول مفقودة (الاسم/IP/النوع)`);
        continue;
      }

      // تخطّي IP الموجود بالفعل في قاعدة البيانات (بدلاً من تكراره).
      if (existingIps.has(ip)) {
        skipped++;
        errors.push(`الصف ${i + 2}: IP "${ip}" موجود بالفعل في قاعدة البيانات — تم تخطّيه`);
        continue;
      }
      // تخطّي IP المكرر داخل نفس ملف Excel.
      if (seenInFile.has(ip)) {
        skipped++;
        errors.push(`الصف ${i + 2}: IP "${ip}" مكرر داخل الملف — تم تخطّيه`);
        continue;
      }

      const typeId = typeMap.get(typeName);
      if (!typeId) {
        skipped++;
        errors.push(`الصف ${i + 2}: النوع "${typeName}" غير موجود`);
        continue;
      }
      const locId = locName ? locMap.get(locName) || null : null;

      try {
        insertStmt.run(
          name,
          ip,
          typeId,
          locId,
          protocol === 'port' ? 'port' : (protocol === 'http' ? 'http' : (protocol === 'https' ? 'https' : 'ping')),
          port ? Number(port) : null,
          interval || 30,
          threshold || 3,
          isActive
        );
        imported++;
        // أضف IP لقائمة الموجودة حتى لا يتكرر داخل نفس الملف.
        existingIps.add(ip);
        seenInFile.add(ip);
      } catch (e) {
        skipped++;
        errors.push(`الصف ${i + 2}: ${e.message}`);
      }
    }

    return res.json({
      success: true,
      data: {
        imported,
        skipped,
        errors,
        message: `تم استيراد ${imported} جهاز، تم تخطّي ${skipped} (IPs مكررة أو ناقصة)`,
      },
    });
  } catch (e) {
    console.error('Excel import error:', e);
    return res.status(500).json({ success: false, error: 'فشل قراءة ملف Excel: ' + e.message });
  }
});

module.exports = router;
