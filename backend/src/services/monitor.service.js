// monitor.service.js: محرك المراقبة — جدولة فحص دوري كل 10 ثوانٍ، عدّاد فشل متتالٍ، تحديث الحالة، فتح/إغلاق أحداث الانقطاع، وإطلاق الإشعارات.
const cron = require('node-cron');
const db = require('../db');
const { checkPing, checkPort, checkHttp, checkHttps, checkAllProtocols } = require('./checkers');
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
    d.check_interval_seconds, d.failure_threshold,
    d.current_status, d.port
  FROM devices d
  LEFT JOIN device_types dt ON dt.id = d.device_type_id
  LEFT JOIN locations l ON l.id = d.location_id
  WHERE d.is_active = 1
`;

// checkDevice(device): تنفذ فحصاً واحداً للجهاز وتطبق منطق الحالة الكامل.
// يتم فحص جميع البروتوكولات (Ping, HTTP, HTTPS) لكل جهاز تلقائياً.
// إذا كان للجهاز منفذ مخصص (port)، يتم فحصه أيضاً.
// الجهاز "متصل" إذا نجح أي فحص.
async function checkDevice(device) {
  const nowIso = new Date().toISOString();

  // 1) تنفيذ فحص جميع البروتوكولات بالتوازي لكل جهاز
  const allResults = await checkAllProtocols(device.ip);

  // إذا كان للجهاز منفذ مخصص (port)، نضيف فحص المنفذ
  let portResult = { isOnline: false, responseTimeMs: null };
  if (device.port) {
    portResult = await checkPort(device.ip, device.port);
  }

  // الجهاز متصل إذا نجح أي فحص (ping أو http أو https أو port المخصص)
  const isOnline = allResults.isOnline || portResult.isOnline;

  // وقت الاستجابة = أقل وقت استجابة بين الفحوصات الناجحة
  let responseTimeMs = null;
  if (isOnline) {
    const times = [];
    if (allResults.protocols.ping.isOnline) times.push(allResults.protocols.ping.responseTimeMs);
    if (allResults.protocols.http.isOnline) times.push(allResults.protocols.http.responseTimeMs);
    if (allResults.protocols.https.isOnline) times.push(allResults.protocols.https.responseTimeMs);
    if (portResult.isOnline) times.push(portResult.responseTimeMs);
    responseTimeMs = times.length > 0 ? Math.min(...times.filter(t => t !== null)) : null;
  }

  // 2) تسجيل نتيجة الفحص دائماً (نخزن الحالة العامة).
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
      `UPDATE devices SET current_status='online', last_response_time_ms=?, 
       http_accessible=?, https_accessible=?, last_checked_at=? WHERE id=?`
    ).run(
      responseTimeMs, 
      allResults.protocols.http.isOnline ? 1 : 0,
      allResults.protocols.https.isOnline ? 1 : 0,
      nowIso, 
      device.id
    );
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
        `UPDATE devices SET current_status='offline', last_response_time_ms=NULL, 
         http_accessible=?, https_accessible=?, last_checked_at=? WHERE id=?`
      ).run(
        allResults.protocols.http.isOnline ? 1 : 0,
        allResults.protocols.https.isOnline ? 1 : 0,
        nowIso, 
        device.id
      );
    } else {
      // لم يصل الحد بعد — فقط تحديث وقت آخر فحص دون تغيير current_status.
      db.prepare('UPDATE devices SET last_checked_at=?, http_accessible=?, https_accessible=? WHERE id=?').run(
        nowIso,
        allResults.protocols.http.isOnline ? 1 : 0,
        allResults.protocols.https.isOnline ? 1 : 0,
        device.id
      );
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