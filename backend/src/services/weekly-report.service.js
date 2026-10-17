'use strict';
const db = require('../db');

// SQLite datetime('now') is UTC but lacks an offset; do not parse it as local time.
function timestamp(value) {
  const text = String(value);
  return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(text)
    ? text.replace(' ', 'T') + 'Z' : text);
}

// buildWeeklyReport(offsetWeeks): إحصاءات آخر 7 أيام (مزاحة بعدد الأسابيع).
function buildWeeklyReport(offsetWeeks = 0, nowMs = Date.now()) {
  const offset = Number(offsetWeeks);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 5200) {
    const err = new Error("offset must be an integer between 0 and 5200");
    err.status = 400;
    throw err;
  }
  const end = new Date(nowMs - offset * 7 * 86400000);
  const start = new Date(end.getTime() - 7 * 86400000);
  const startIso = start.toISOString(), endIso = end.toISOString();

  const events = db.prepare(`
    SELECT de.device_id, de.started_at, de.ended_at, de.duration_seconds, d.name, d.ip
    FROM downtime_events de
    LEFT JOIN devices d ON d.id = de.device_id
    WHERE julianday(de.started_at) < julianday(?)
      AND (de.ended_at IS NULL OR julianday(de.ended_at) > julianday(?))
    ORDER BY de.started_at ASC
  `).all(endIso, startIso).map((e) => ({ ...e, window_minutes: Math.max(0,
    Math.min(e.ended_at ? timestamp(e.ended_at) : end.getTime(), end.getTime())
      - Math.max(timestamp(e.started_at), start.getTime())) / 60000 }));

  const stillOpen = db.prepare(`
    SELECT COUNT(*) AS n FROM downtime_events WHERE ended_at IS NULL AND julianday(started_at) < julianday(?)
  `).get(endIso).n;

  const totalMin = events.reduce((a, e) => a + e.window_minutes, 0);
  const perDevice = {};
  for (const e of events) {
    const name = e.name || 'جهاز محذوف';
    const min = e.window_minutes;
    if (!perDevice[e.device_id]) perDevice[e.device_id] = { name, ip: e.ip, min: 0, count: 0, worst_start: null, worst_min: 0 };
    const p = perDevice[e.device_id];
    p.min += min; p.count++;
    const evMin = min;
    if (evMin > p.worst_min) { p.worst_min = evMin; p.worst_start = e.started_at; }
  }
  const worstList = Object.values(perDevice).sort((a, b) => b.min - a.min).slice(0, 10);
  const longest = events.slice().sort((a, b) => b.window_minutes - a.window_minutes).slice(0, 5);

  const devCount = db.prepare('SELECT COUNT(*) AS n FROM devices WHERE is_active = 1').get().n;
  // نسبة التشغيل التقريبية: (أجهزة × 7 أيام − دقائق الانقطاع) / (أجهزة × 7 أيام × 1440)
  const totalDeviceMinutes = devCount * 7 * 1440;
  const uptimePct = totalDeviceMinutes ? Math.max(0, (1 - totalMin / totalDeviceMinutes) * 100) : 100;

  return {
    start: startIso, end: endIso, offset,
    overlapping_events_count: events.length,
    events_count: events.filter((e) => timestamp(e.started_at) >= start.getTime()).length, // Starts within this week (legacy contract).
    open_still: stillOpen,                 // انقطاعات ما تزال قائمة (معلوماتية)
    total_minutes: Math.round(totalMin),
    uptime_percent: Math.round(uptimePct * 10) / 10,
    devices_active: devCount,
    per_device: worstList,
    longest_events: longest.map((e) => ({
      name: e.name || 'جهاز محذوف', ip: e.ip,
      started_at: e.started_at, ended_at: e.ended_at,
      minutes: Math.round(e.window_minutes),
    })),
  };
}


module.exports = { buildWeeklyReport };
