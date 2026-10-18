// downtime.service.js: إدارة أحداث الانقطاع — فتح عند الإقرار بالانقطاع، وإغلاق عند العودة مع حساب المدة.
const db = require('../db');

// openDowntimeEvent(deviceId): يفتح حدث انقطاع جديد فقط إن لم يوجد حدث مفتوح لهذا الجهاز.
function openDowntimeEvent(deviceId) {
  const open = db
    .prepare('SELECT id FROM downtime_events WHERE device_id = ? AND ended_at IS NULL')
    .get(deviceId);
  if (open) return null; // حدث مفتوح بالفعل، لا شيء.

  const now = new Date().toISOString();
  const result = db.prepare(
    'INSERT INTO downtime_events (device_id, started_at, ended_at) VALUES (?, ?, NULL)'
  ).run(deviceId, now);
  return result.lastInsertRowid;
}

// closeDowntimeEvent(deviceId): يغلق آخر حدث مفتوح ويرجع duration_seconds أو null.
function closeDowntimeEvent(deviceId) {
  const open = db
    .prepare('SELECT id, started_at FROM downtime_events WHERE device_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1')
    .get(deviceId);
  if (!open) return null;

  const endedAt = new Date().toISOString();
  const durationSeconds = Math.floor(
    (new Date(endedAt).getTime() - new Date(open.started_at).getTime()) / 1000
  );
  db.prepare(
    'UPDATE downtime_events SET ended_at = ?, duration_seconds = ? WHERE id = ?'
  ).run(endedAt, durationSeconds < 0 ? 0 : durationSeconds, open.id);
  return durationSeconds < 0 ? 0 : durationSeconds;
}

module.exports = { openDowntimeEvent, closeDowntimeEvent };
