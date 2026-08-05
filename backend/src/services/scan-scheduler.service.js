// scan-scheduler.service.js (v2.5.0)
// ─────────────────────────────────────────────────────────────
// مُجدوِل المسح الدوري: يَقرأ إعدادات scan_settings من قاعدة البيانات
// ويَستدعي نَفس helpers المستخدمة في scan.routes.js لِـ مسح الشبكة
// كل interval_minutes، ويُسجّل النتائج في scan_runs + discovered_devices،
// ويُطلِق تنبيهات عبر notifier.service.js عند ظهور أَجهزة جديدة.
//
// المُجدوِل يَعمل داخل نَفس عملية الـ backend (single process).
// لا يَعتمد على نظام cron خارجي — يَكتفي بـ setInterval.
// ─────────────────────────────────────────────────────────────
'use strict';

const db = require('../db');
const scanRouter = require('../routes/scan.routes');
const notifier = require('./notifier.service');

// helpers المُصدَّرة من scan.routes.js (راجع آخر الملف)
const scanHelpers = scanRouter.helpers || {};

let intervalHandle = null;        // handle لِـ setInterval الحالي
let isScanRunning = false;        // قفل لِـ منع تَداخل المسحات (لو استَغرق المسح أَكثر من interval)
let lastRunSummary = null;         // ملخّص آخر مسح (لِـ endpoint /status)

// ─────────────────────────────────────────────────────────────
// تَهيئة: تَبدأ من `startMonitoring` بعد استِماع الخادم على المنفذ.
// تَقرأ scan_settings، لو enabled → تَبدأ setInterval.
// ─────────────────────────────────────────────────────────────
function startScheduler() {
  try {
    // تَأكد بِأن الإعدادات موجُودة (auto-migration في db.js يَنشئها)
    db.prepare(
      `INSERT OR IGNORE INTO scan_settings (id) VALUES (1)`
    ).run();

    const settings = getSettings();
    if (settings && settings.enabled === 1) {
      console.log(`[SCHEDULER] Auto-enabled — interval=${settings.interval_minutes} min, subnets="${settings.subnets}"`);
      startInterval();
    } else {
      console.log('[SCHEDULER] Disabled at startup. Enable from dashboard → "المسح الدوري".');
    }
  } catch (e) {
    console.error('[SCHEDULER] Failed to start:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// إعدادات المسح الدوري (read)
// ─────────────────────────────────────────────────────────────
function getSettings() {
  return db.prepare('SELECT * FROM scan_settings WHERE id = 1').get();
}

function updateSettings(patch) {
  const allowed = ['enabled', 'interval_minutes', 'subnets', 'scan_ports_enabled', 'scan_snmp_enabled', 'snmp_community', 'new_device_alert'];
  const current = getSettings() || {};
  const next = { ...current };
  for (const k of allowed) {
    if (patch[k] !== undefined) next[k] = patch[k];
  }
  // تَحقق من صِحة interval_minutes (5..1440 دقيقة)
  if (typeof next.interval_minutes === 'number') {
    next.interval_minutes = Math.max(5, Math.min(1440, Math.floor(next.interval_minutes)));
  }
  // تَحقق بسيط من subnets (قائمة CIDR غير فارغة)
  if (typeof next.subnets === 'string') {
    next.subnets = next.subnets.trim();
  }

  db.prepare(
    `INSERT INTO scan_settings (id, enabled, interval_minutes, subnets, scan_ports_enabled, scan_snmp_enabled, snmp_community, new_device_alert, updated_at)
     VALUES (1, @enabled, @interval_minutes, @subnets, @scan_ports_enabled, @scan_snmp_enabled, @snmp_community, @new_device_alert, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       enabled=excluded.enabled,
       interval_minutes=excluded.interval_minutes,
       subnets=excluded.subnets,
       scan_ports_enabled=excluded.scan_ports_enabled,
       scan_snmp_enabled=excluded.scan_snmp_enabled,
       snmp_community=excluded.snmp_community,
       new_device_alert=excluded.new_device_alert,
       updated_at=datetime('now')`
  ).run({
    enabled: Number(!!next.enabled),
    interval_minutes: Number(next.interval_minutes) || 15,
    subnets: next.subnets || '',
    scan_ports_enabled: Number(!!next.scan_ports_enabled),
    scan_snmp_enabled: Number(!!next.scan_snmp_enabled),
    snmp_community: next.snmp_community || 'public',
    new_device_alert: Number(next.new_device_alert === undefined ? 1 : !!next.new_device_alert),
  });

  return getSettings();
}

// ─────────────────────────────────────────────────────────────
// تَشغيل/إيقاف الـ interval (تَستَدعى من الـ route عند تغيير enabled)
// ─────────────────────────────────────────────────────────────
function startInterval() {
  stopInterval();
  const settings = getSettings();
  if (!settings || settings.enabled !== 1) {
    return false;
  }
  // تَحقق من وجود subnets
  if (!settings.subnets || settings.subnets.trim() === '') {
    console.warn('[SCHEDULER] No subnets configured — cannot start.');
    return false;
  }
  const minutes = Number(settings.interval_minutes) || 15;
  const ms = minutes * 60 * 1000;
  intervalHandle = setInterval(() => {
    runScheduledScan().catch((e) => {
      console.error('[SCHEDULER] Scheduled scan error:', e.message);
    });
  }, ms);
  // أَوّل scan فور التَفعيل (بَعد ثانية واحدة لِـ تَجنّب الـ startup contention)
  setTimeout(() => {
    runScheduledScan().catch((e) => {
      console.error('[SCHEDULER] Initial scan error:', e.message);
    });
  }, 1000);
  console.log(`[SCHEDULER] Started — every ${minutes} min.`);
  return true;
}

function stopInterval() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('[SCHEDULER] Stopped.');
  }
}

function isRunning() {
  return isScanRunning;
}

function getLastRunSummary() {
  return lastRunSummary;
}

// ─────────────────────────────────────────────────────────────
// نَفّذ المسح الدوري على كل subnets المُهَيَّأة بِالتَسلسل.
// يُسجّل نتيجة في scan_runs، ويَكتشف/يُسجّل الأَجهزة الجديدة في discovered_devices،
// ويُطلِق تنبيهًا (notifier + webhook) لأَيّ جهاز جديد غير معروف.
// ─────────────────────────────────────────────────────────────
async function runScheduledScan() {
  if (isScanRunning) {
    console.log('[SCHEDULER] Previous scan still running — skipping this tick.');
    return;
  }
  const settings = getSettings();
  if (!settings || settings.enabled !== 1) return;

  const subnetsRaw = (settings.subnets || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (subnetsRaw.length === 0) return;

  isScanRunning = true;

  const startedAt = new Date().toISOString();
  const runId = db.prepare(
    `INSERT INTO scan_runs (subnet, started_at, status) VALUES (?, ?, 'running')`
  ).run(subnetsRaw.join(','), startedAt).lastInsertRowid;

  let totalFound = 0;
  let totalAdded = 0;
  let totalLost = 0;
  let errorMsg = null;

  try {
    // قَفل أَجهزة "معروفة" حاليًّا (قبل المسح) لِـ تَحديد التي اختفت لاحقاً
    const knownBefore = new Set(
      db.prepare('SELECT DISTINCT ip FROM devices WHERE is_active = 1').all().map((r) => r.ip)
    );

    // تَهيئة set IPs المُكتشفة في هذا المسح (كل subnets)
    const seenThisRun = new Set();

    for (const subnet of subnetsRaw) {
      // تَحقق CIDR عبر helpers
      if (!scanHelpers.isValidCIDR || !scanHelpers.isValidCIDR(subnet)) {
        console.warn(`[SCHEDULER] Skipping invalid CIDR: ${subnet}`);
        continue;
      }
      const ips = scanHelpers.cidrToIPs(subnet);
      if (ips.length > 1024) {
        console.warn(`[SCHEDULER] Skipping too-large CIDR (>1024): ${subnet}`);
        continue;
      }

      console.log(`[SCHEDULER] Scanning ${subnet} (${ips.length} IPs)...`);
      const aliveHosts = await scanHelpers.pingSweep(ips);
      totalFound += aliveHosts.length;

      for (const host of aliveHosts) {
        seenThisRun.add(host.ip);
        try {
          // processHost يُرجع عدد الأَجهزة الجَديدة التي أُضيفت لِـ discovered_devices
          // (0 لو كان الجهاز معروفًا أَو موجُودًا سَبقًا) — نُجمِّعها لِـ scan_runs.devices_added.
          totalAdded += (await processHost(host, settings)) || 0;
        } catch (e) {
          // لا نَكسر المسح كلِّه لو فَشل جهاز واحد
          console.warn(`[SCHEDULER] Failed processing ${host.ip}:`, e.message);
        }
      }
    }

    // تَحديد الأَجهزة المعروفة التي اختفت عن هذا المسح
    for (const knownIp of knownBefore) {
      if (!seenThisRun.has(knownIp)) {
        totalLost += 1;
      }
    }

    // (المرحلة 2) تَخزين تَفصيل الأَجهزة المفقودة لاحقًا — حاليًّا نُسجِّل العدد فقط في scan_runs.devices_lost.
  } catch (e) {
    errorMsg = e.message;
    console.error('[SCHEDULER] runScheduledScan error:', errorMsg);
  } finally {
    // تَحديث السِجل
    db.prepare(
      `UPDATE scan_runs
       SET ended_at = datetime('now'),
           devices_found = ?,
           devices_added = ?,
           devices_lost = ?,
           status = ?,
           error_message = ?
       WHERE id = ?`
    ).run(totalFound, totalAdded, totalLost, errorMsg ? 'failed' : 'completed', errorMsg, runId);

    isScanRunning = false;
    lastRunSummary = {
      runId,
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      devices_found: totalFound,
      devices_added: totalAdded,
      devices_lost: totalLost,
      status: errorMsg ? 'failed' : 'completed',
      error: errorMsg,
    };
    console.log(`[SCHEDULER] Scan #${runId} done — found=${totalFound}, added=${totalAdded}, lost=${totalLost}`);
  }
}

// ─────────────────────────────────────────────────────────────
// معالجة جهاز واحد من المسح الدوري:
// - يَستخرج MAC + vendor + hostname + type
// - يَتحقق إن كان جهاز معروف في devices → لَا شيء
// - لو غير معروف：يُسجّله في discovered_devices أَو يُحدّث last_seen_at/seen_count
// - لو new_device_alert مُفعّل وظهر أَول مرة → يُطلِق notifier + webhook
// يَعيد عدد الأَجهزة الجديدة التي أُضيفت (لِـ تَجميع result run).
// ─────────────────────────────────────────────────────────────
async function processHost(host, settings) {
  const known = db.prepare('SELECT id FROM devices WHERE ip = ?').get(host.ip);
  if (known) {
    return 0; // جهاز معروف — لا شيء
  }

  // استِخراج بيانات بِـ نَفس helpers الواجهة
  let mac = null;
  let vendor = null;
  let hostname = null;
  let detectedType = null;
  try {
    mac = await scanHelpers.getMacAddress(host.ip);
  } catch (_) { /* ARP قد يَفشل على host معطّل */ }
  if (mac) {
    try { vendor = scanHelpers.getMacVendor(mac); } catch (_) { /* ignore */ }
  }
  try { hostname = await scanHelpers.resolveHostname(host.ip); } catch (_) { /* ignore */ }

  let openPorts = [];
  if (settings.scan_ports_enabled === 1) {
    try { openPorts = await scanHelpers.scanPorts(host.ip); } catch (_) { /* ignore */ }
  }
  try {
    detectedType = scanHelpers.identifyDeviceType(openPorts, vendor);
    // identifyDeviceType يُرجِع { type, subtype } (object) أو null — نخزّنه كنص قابل للقراءة.
    if (detectedType && typeof detectedType === 'object') {
      detectedType = detectedType.subtype
        ? `${detectedType.type} (${detectedType.subtype})`
        : String(detectedType.type);
    }
  } catch (_) { /* ignore */ }

  // هل مَوجُذ فِعليًّا في discovered_devices؟
  const existingDisc = db.prepare(
    `SELECT id, seen_count, is_approved FROM discovered_devices WHERE ip = ? AND (mac IS ? OR mac = ?) AND source = 'scan'`
  ).get(host.ip, mac || null, mac || '');

  const now = new Date().toISOString();
  if (existingDisc) {
    // تَحديث last_seen + seen_count (ما لم يَكُن approved/rejected)
    db.prepare(
      `UPDATE discovered_devices SET last_seen_at = ?, seen_count = seen_count + 1 WHERE id = ?`
    ).run(now, existingDisc.id);
    return 0;
  }

  // جهاز جديد كَليًّا في قائمة الـ discovered — إِضافة
  const insRes = db.prepare(
    `INSERT INTO discovered_devices (ip, mac, hostname, vendor, detected_type, source, first_seen_at, last_seen_at, seen_count, is_approved)
     VALUES (?, ?, ?, ?, ?, 'scan', ?, ?, 1, 0)
     ON CONFLICT(ip, mac, source) DO UPDATE SET last_seen_at = ?, seen_count = seen_count + 1`
  ).run(
    host.ip,
    mac || null,
    hostname || null,
    vendor || null,
    detectedType || null,
    now,
    now,
    now
  );

  // إرسال الإِشعار لو new_device_alert مُفعّل
  if (settings.new_device_alert === 1) {
    notifyNewDevice({ ip: host.ip, mac, vendor, hostname, detectedType });
  }

  return 1;
}

// ─────────────────────────────────────────────────────────────
// تنبيه: يُطلِق notifier.service.js (Telegram/WhatsApp/Push) + webhook خارجي.
// ─────────────────────────────────────────────────────────────
function notifyNewDevice(device) {
  const message = `🆕 جهاز جديد في الشبكة!\nIP: ${device.ip}${device.mac ? `\nMAC: ${device.mac}` : ''}${device.vendor ? `\nالصانع: ${device.vendor}` : ''}${device.hostname ? `\nالاسم: ${device.hostname}` : ''}${device.detectedType ? `\nالنوع المتوقَّع: ${device.detectedType}` : ''}`;
  try {
    if (notifier && typeof notifier.sendGenericNotification === 'function') {
      // fire-and-forget: لا نَكسر المسح لو فَشل الإِشعار
      notifier.sendGenericNotification(message).catch((e) => {
        console.warn('[SCHEDULER] sendGenericNotification failed:', e.message);
      });
    }
  } catch (e) {
    console.warn('[SCHEDULER] notifier.service call failed:', e.message);
  }

  // Webhook خارجي (مرحلة 1 — لِـ تكامل Slack/Discord/ntfy/Grafana).
  try {
    const wh = db.prepare('SELECT webhook_url FROM notification_settings WHERE id = 1').get();
    if (wh && wh.webhook_url) {
      const axios = require('axios');
      axios.post(wh.webhook_url, {
        event: 'new_device',
        device,
        at: new Date().toISOString(),
      }, { timeout: 10000, headers: { 'Content-Type': 'application/json' } })
        .then(() => console.log(`[SCHEDULER] Webhook sent to ${wh.webhook_url}`))
        .catch((e) => console.warn(`[SCHEDULER] Webhook failed: ${e.message}`));
    }
  } catch (e) {
    console.warn('[SCHEDULER] Webhook dispatch error:', e.message);
  }
}

module.exports = {
  startScheduler,
  getSettings,
  updateSettings,
  startInterval,
  stopInterval,
  isRunning,
  getLastRunSummary,
  runScheduledScan, // للوصول الآمن (test route)
};
