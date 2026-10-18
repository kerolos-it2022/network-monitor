// device-query.service.js ( SEC-02) — استعلامات الأجهزة الموحّدة.
// استُخرجت من devices.routes.js ليعاد استخدامها في:
//   1) /api/devices (داخلي — يتطلب تسجيل دخول).
//   2) /api/public/* (عام — يمر عبر sanitizer في public-display.service).
// لا تغيير في منطق الاستعلام نفسه.
'use strict';
const db = require('../db');

// استعلام موحد لجلب جهاز/أجهزة مع أسماء النوع والموقع (JOINs)
const DEVICE_SELECT = `
  SELECT
    d.id, d.name, d.ip, d.device_type_id,
    dt.name AS device_type_name,
    d.location_id,
    l.name AS location_name,
    l.kind AS location_kind,
    d.parent_id,
    d.parent_location_id,
    d.pos_x, d.pos_y,
    d.check_protocol, d.port, d.web_port,
    d.check_interval_seconds, d.failure_threshold, d.is_active,
    d.current_status, d.http_accessible, d.https_accessible,
    d.last_response_time_ms, d.last_checked_at,
    -- MON-01: حالات المضيف/العامة المفصولة (للإدارة والعرض الداخلي).
    d.host_status, d.overall_health, d.last_probe_protocol,
    -- AST-01: المعرّف الخارجي الثابت (داخلي فقط — لا يُدرَج في DTO العام).
    -- MON-02: عدّاد الخدمات المراقَبة المتوقفة (بلا أسماء — صالح حتى للعرض العام).
    (SELECT COUNT(*) FROM monitored_services s
      WHERE s.device_id = d.id AND s.is_enabled = 1 AND s.status = 'offline') AS services_down_count,
    (SELECT COUNT(*) FROM monitored_services s2
      WHERE s2.device_id = d.id AND s2.is_enabled = 1) AS services_total
  FROM devices d
  LEFT JOIN device_types dt ON dt.id = d.device_type_id
  LEFT JOIN locations l ON l.id = d.location_id
`;

// v2.13.6 — آخر انقطاع مغلق لكل جهاز (عمود «آخر انقطاع» في جدول الصفحة العامة):
//   last_outage_ended_at (ISO نصًّا) · last_outage_seconds (مدة ذلك الانقطاع بالثواني).
//   NULL = لا انقطاع مسجَّل. MAX(ended_at) آمن لأن الأزمنة تُخزَّن ISO نصًّا.
function lastOutageByDevice() {
  const out = new Map();
  const rows = db.prepare(`
    SELECT device_id, MAX(ended_at) AS last_ended
    FROM downtime_events
    WHERE ended_at IS NOT NULL
    GROUP BY device_id
  `).all();
  const startedOf = db.prepare(
    'SELECT started_at FROM downtime_events WHERE device_id = ? AND ended_at = ? LIMIT 1'
  );
  for (const r of rows) {
    const s = startedOf.get(r.device_id, r.last_ended);
    out.set(r.device_id, { endedAt: r.last_ended, startedAt: s ? s.started_at : null });
  }
  return out;
}

// قائمة كل الأجهزة + حقول آخر انقطاع مدمجة (نفس مخرجات GET /api/devices القديمة بالحرف).
function listDevicesWithOutages() {
  const devices = db.prepare(`${DEVICE_SELECT} ORDER BY d.id ASC`).all();
  const last = lastOutageByDevice();
  for (const d of devices) {
    const l = last.get(d.id) || null;
    d.last_outage_ended_at = l ? l.endedAt : null;
    d.last_outage_seconds = (l && l.startedAt)
      ? Math.max(0, Math.round((new Date(l.endedAt) - new Date(l.startedAt)) / 1000))
      : null;
  }
  return devices;
}

function getDeviceById(id) {
  return db.prepare(`${DEVICE_SELECT} WHERE d.id = ?`).get(id);
}

module.exports = { DEVICE_SELECT, lastOutageByDevice, listDevicesWithOutages, getDeviceById };
