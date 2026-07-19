// monitor.service.js: محرك المراقبة — جدولة فحص دوري كل 10 ثوانٍ، عدّاد فشل متتالٍ، تحديث الحالة، فتح/إغلاق أحداث الانقطاع، وإطلاق الإشعارات.
const cron = require('node-cron');
const db = require('../db');
const { checkPing, checkPort } = require('./checkers');
const downtimeService = require('./downtime.service');
const notifier = require('./notifier.service');

// عدّاد فشل متتالٍ لكل جهاز (device_id → عدد).
const consecutiveFailures = new Map();
// آخر وقت تم فيه فحص الجهاز فعلياً (device_id → ms timestamp).
const lastCheckTime = new Map();

// استعلام جلب الأجهزة النشطة مع أسماء النوع والموقع.
const ACTIVE_DEVICES_SQL = `
  SELECT
    d.id, d.name, d.ip, d.device_type_id,
    dt.name AS device_type_name,
    d.location_id,
    l.name AS location_name,
    d.check_protocol, d.port,
    d.check_interval_seconds, d.failure_threshold,
    d.current_status
  FROM devices d
  LEFT JOIN device_types dt ON dt.id = d.device_type_id
  LEFT JOIN locations l ON l.id = d.location_id
  WHERE d.is_active = 1
`;

// checkDevice(device): تنفذ فحصاً واحداً للجهاز وتطبق منطق الحالة الكامل.
async function checkDevice(device) {
  const nowIso = new Date().toISOString();

  // 1) تنفيذ الفحص المناسب.
  let result;
  if (device.check_protocol === 'port' && device.port) {
    result = await checkPort(device.ip, device.port);
  } else {
    result = await checkPing(device.ip);
  }
  const isOnline = !!result.isOnline;
  const responseTimeMs = isOnline ? result.responseTimeMs : null;

  // 2) تسجيل نتيجة الفحص دائماً.
  db.prepare(
    `INSERT INTO status_logs (device_id, status, response_time_ms, checked_at)
     VALUES (?, ?, ?, ?)`
  ).run(device.id, isOnline ? 'online' : 'offline', responseTimeMs, nowIso);

  if (isOnline) {
    consecutiveFailures.set(device.id, 0);
    if (device.current_status !== 'online') {
      const durationSeconds = downtimeService.closeDowntimeEvent(device.id);
      if (device.current_status === 'offline') {
        try {
          await notifier.notifyDeviceRecovered(device, durationSeconds);
        } catch (e) {
          console.error('[notify recovered]', e);
        }
      }
      console.log(`[RECOVERED] device ${device.id}`);
    }
    db.prepare(
      `UPDATE devices SET current_status='online', last_response_time_ms=?, last_checked_at=? WHERE id=?`
    ).run(responseTimeMs, nowIso, device.id);
  } else {
    const failCount = (consecutiveFailures.get(device.id) || 0) + 1;
    consecutiveFailures.set(device.id, failCount);

    if (failCount >= device.failure_threshold) {
      if (device.current_status !== 'offline') {
        downtimeService.openDowntimeEvent(device.id);
        console.log(`[DOWN] device ${device.id}`);
        try {
          await notifier.notifyDeviceDown(device);
        } catch (e) {
          console.error('[notify down]', e);
        }
      }
      db.prepare(
        `UPDATE devices SET current_status='offline', last_response_time_ms=NULL, last_checked_at=? WHERE id=?`
      ).run(nowIso, device.id);
    } else {
      // لم يصل الحد بعد — فقط تحديث وقت آخر فحص دون تغيير current_status.
      db.prepare('UPDATE devices SET last_checked_at=? WHERE id=?').run(nowIso, device.id);
    }
  }
}

// startMonitoring(): جدولة فحص كل 10 ثوانٍ، تمر على كل الأجهزة النشطة وتختبر من حان وقته.
function startMonitoring() {
  cron.schedule('*/10 * * * * *', () => {
    try {
      const devices = db.prepare(ACTIVE_DEVICES_SQL).all();
      const now = Date.now();
      for (const device of devices) {
        const last = lastCheckTime.get(device.id) || 0;
        if (now - last >= device.check_interval_seconds * 1000) {
          lastCheckTime.set(device.id, now);
          checkDevice(device).catch((e) => console.error('checkDevice error', e));
        }
      }
    } catch (e) {
      console.error('monitoring tick error', e);
    }
  });
  console.log('Monitoring engine started (every 10s tick).');
}

module.exports = { startMonitoring };
