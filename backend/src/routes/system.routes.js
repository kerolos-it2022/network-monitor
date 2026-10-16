// system.routes.js — 🖥️ حالة النظام (v2.23.0): استهلاك الجهاز الحقيقي (رام/معالج/هارد/شبكة)
// + تفاصيل النظام + صحة محرك المراقبة. قراءة فقط (requireAuth)، بلا أي حزم جديدة —
// كل القياسات من وحدات Node الأساسية (os/fs) وملفات لينكس (/proc/net/dev).
// القياسات غير المتاحة على منصة معينة (شبكة لينكس على ويندوز مثلًا) ترد null
// والواجهة تخفي بطاقتها بلطف بدل الخطأ.
const express = require('express');
const os = require('os');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const { getEngineHealth } = require('../services/monitor.service');

const router = express.Router();

// ── v2.26.0 — سجل زمني في الذاكرة للرسوم البيانية: كل استدعاء /stats يضيف عينة
// (حتى 720 عينة ≈ ساعة بالتحديث الذاتي 5 ثوانٍ). /history يعيدها للرسم.
const historyRing = [];
const HISTORY_CAP = 720;
function pushHistory(sample) {
  historyRing.push({
    ts: sample.ts,
    cpu_percent: sample.cpu.usage_percent,
    mem_percent: sample.memory.used_percent,
    rx_rate_bps: sample.network ? sample.network.rx_rate_bps : null,
    tx_rate_bps: sample.network ? sample.network.tx_rate_bps : null,
  });
  if (historyRing.length > HISTORY_CAP) historyRing.splice(0, historyRing.length - HISTORY_CAP);
}

// ── CPU: نسبة الاستخدام الحية = الفرق بين لقطات أوقات المعالجة بين استدعائين ──
let lastCpuSample = null; // { idle, total }
function cpuUsagePercent() {
  const cpus = os.cpus();
  let idle = 0, total = 0;
  for (const c of cpus) {
    idle += c.times.idle;
    total += c.times.idle + c.times.user + c.times.nice + c.times.sys + c.times.irq;
  }
  if (!lastCpuSample) { lastCpuSample = { idle, total }; return null; } // أول استدعاء: لا أساس مقارنة
  const dIdle = idle - lastCpuSample.idle;
  const dTotal = total - lastCpuSample.total;
  lastCpuSample = { idle, total };
  if (dTotal <= 0) return null;
  return Math.round((1 - dIdle / dTotal) * 1000) / 10; // نسبة مئوية بخانة عشرية
}

// ── الشبكة: مجموع التنزيل/الرفع من /proc/net/dev (بلا loopback) + المعدل الحي ──
let lastNetSample = null; // { at, rxTotal, txTotal }
function networkSample() {
  // لينكس فقط — على غير لينكس ترد null والواجهة تخفي البطاقة.
  let txt;
  try { txt = fs.readFileSync('/proc/net/dev', 'utf8'); } catch (e) { return null; }
  let rxTotal = 0, txTotal = 0, ifaces = [];
  for (const line of txt.split('\n').slice(2)) {
    const m = line.match(/^\s*([^:]+):\s*(.+)$/);
    if (!m) continue;
    const name = m[1].trim();
    if (name === 'lo') continue; // حلقة محلية لا تُعدّ
    const f = m[2].split(/\s+/).map((x) => parseInt(x, 10) || 0);
    // العمودان: rx bytes (0) و tx bytes (8).
    rxTotal += f[0] || 0; txTotal += f[8] || 0;
    ifaces.push({ name, rx_bytes: f[0] || 0, tx_bytes: f[8] || 0 });
  }
  ifaces.sort((a, b) => (b.rx_bytes + b.tx_bytes) - (a.rx_bytes + a.tx_bytes)); // الأنشطة أولًا
  return { rx_total: rxTotal, tx_total: txTotal, interfaces: ifaces.slice(0, 5) };
}

function sampleNetworkRate() {
  const s = networkSample();
  if (!s) return null;
  const now = Date.now();
  let rx_rate = null, tx_rate = null; // بايت/ثانية
  if (lastNetSample && now - lastNetSample.at >= 1000) {
    const dt = (now - lastNetSample.at) / 1000;
    rx_rate = Math.max(0, Math.round((s.rx_total - lastNetSample.rx_total) / dt));
    tx_rate = Math.max(0, Math.round((s.tx_total - lastNetSample.tx_total) / dt));
  }
  lastNetSample = { at: now, rx_total: s.rx_total, tx_total: s.tx_total };
  return Object.assign(s, { rx_rate_bps: rx_rate, tx_rate_bps: tx_rate });
}

// ── الأقراص: fs.statfs متاح لينكس (وأغلب المنصات في Node 18.15+) — تخفق بهدوء على غيره ──
function diskStat(p) {
  try {
    const st = fs.statfsSync ? fs.statfsSync(p) : null;
    if (!st) return null;
    const total = st.blocks * st.bsize;
    const free = st.bavail * st.bsize;
    const used = total - free;
    return { total, free, used, used_percent: total ? Math.round((used / total) * 1000) / 10 : 0 };
  } catch (e) { return null; }
}

function fileSizeSafe(p) {
  try { return fs.statSync(p).size; } catch (e) { return null; }
}

function dirSizeSafe(p, maxEntries) {
  // مجموع أحجام الملفات (عمق محدود — مجلدي النسخ الاحتياطية قائمة ملفات مسطحة).
  let total = 0, count = 0, entries = 0;
  (function walk(dir, depth) {
    if (depth > 3 || count > 5000) return;
    let list = null;
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of list) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules') continue; // تِباع لا تُعَدّ (كبيرة وتابعة للتثبيت)
        walk(fp, depth + 1);
      } else {
        entries++; count++;
        try { total += fs.statSync(fp).size; } catch (_) {}
      }
      if (maxEntries && entries >= maxEntries) return;
    }
  })(p, 0);
  return total;
}

// GET /api/system/stats 🔒 — لقطة كاملة، قراءة خالصة.
router.get('/stats', requireAuth, (req, res) => {
  // الرام
  const memTotal = os.totalmem();
  const memFree = os.freemem();
  const procMem = process.memoryUsage();

  // الأقراص: جذر النظام + مجلد قاعدة البيانات.
  // ⚠️ علة v2.23.0: DB_PATH يُحل نسبيًّا من مجلد التشغيل (cwd = backend/)
  // لا من مجلد الكود — ونسخة 2.23.0 كانت تُشتق المسار من __dirname فاختلف على الخادم
  // وأظهرت «قاعدة البيانات: —» و«النسخ الاحتياطية: 0 B». الإصلاح: المسار المعتمد
  // الوحيد هو db.name (الملف المفتوح فعليًّا بـ better-sqlite3).
  const dbFile = db.name || path.resolve(process.cwd(), process.env.DB_PATH || '../database/monitoring.db');
  const dbDir = path.dirname(dbFile);
  const diskRoot = diskStat('/');
  const diskData = diskStat(dbDir) || diskRoot;

  // قاعدة البيانات: حجم ملفها المعتمد + مجلدا النسخ الاحتياطية (backups القياسي
  // وsvc-backups البديل — نفس منطق v2.19.0: أول مجلد يقبل الكتابة هو المعتمد).
  const dbSize = fileSizeSafe(dbFile);
  const backupsSize = dirSizeSafe(path.join(dbDir, 'backups'))
    + dirSizeSafe(path.join(dbDir, 'svc-backups'));

  // عدد الأجهزة المراقبة (نفس مصباح اللوحة)
  let devicesCount = null;
  try { devicesCount = db.prepare('SELECT COUNT(*) AS n FROM devices WHERE is_active = 1').get().n; } catch (e) {}

  let engine = null;
  try { engine = getEngineHealth(); } catch (e) { engine = null; }

  const cpuPercent = cpuUsagePercent(); // أول نداء null — النداء التالي كل 5ث يعطي قيمة حية

  const snapshot = {
    ts: new Date().toISOString(),
      cpu: {
        cores: os.cpus().length,
        model: (os.cpus()[0] && os.cpus()[0].model) || null,
        usage_percent: cpuPercent,
        loadavg_1_5_15: os.loadavg ? os.loadavg().map((x) => Math.round(x * 100) / 100) : null,
      },
      memory: {
        total_bytes: memTotal,
        free_bytes: memFree,
        used_bytes: memTotal - memFree,
        used_percent: Math.round(((memTotal - memFree) / memTotal) * 1000) / 10,
        process: {
          rss_bytes: procMem.rss,
          heap_used_bytes: procMem.heapUsed,
          heap_total_bytes: procMem.heapTotal,
          uptime_seconds: Math.round(process.uptime()),
        },
      },
      disks: {
        root: diskRoot,
        data_dir: diskData,
        db_file_bytes: dbSize,
        backups_bytes: backupsSize,
      },
      network: sampleNetworkRate(),
      lan_ips: Object.values(os.networkInterfaces()).flat().filter(i => i && !i.internal && i.family === 'IPv4').map(i => i.address),
      engine: engine ? {
        last_tick_age_ms: engine.lastTickAgeMs,
        active_devices: engine.activeDevices,
        inflight_checks: engine.inflightChecks,
        stalled: !!engine.stalled,
        stuck_checks: engine.stuckChecks || 0,
      } : null,
      devices_active: devicesCount,
      system: {
        platform: os.platform(),           // 'linux' | 'win32' …
        type: os.type(),                   // 'Linux' | 'Windows_NT'
        release: os.release(),
        arch: os.arch(),
        hostname: os.hostname(),
        node_version: process.version,
        app_uptime_seconds: Math.round(process.uptime()),
        os_uptime_seconds: Math.round(os.uptime ? os.uptime() : 0),
      },
  };
  res.json({ success: true, data: snapshot });
  pushHistory(snapshot);
});

// GET /api/system/history 🔒 — عينات الرسم الزمني (v2.26.0): آخر ≤720 عينة
// (cpu% · mem% · معدل الشبكة) كما رصدها استدعاء /stats المتكرر من شاشة الحالة.
router.get('/history', requireAuth, (req, res) => {
  return res.json({ success: true, data: historyRing });
});

module.exports = router;
