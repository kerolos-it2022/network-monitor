// load-verify.js (SpaceKit MON-03) — تحقق أحمال 50/100/200 جهاز على **المحرك الحقيقي**.
// ═══════════════════════════════════════════════════════════════════════════
// لا محاكاة ولا حقن: نُنشئ قاعدة مؤقتة، نشغّل مستمع TCP محليًّا، نضيف N جهازًا كلها تفحص
// 127.0.0.1:PORT ببروتوكول `port` (فحص TCP حقيقي بلا عمليات فرعية)، ثم نُقلع محرك المراقبة
// الحقيقي (cron كل 10 ثوانٍ) ونقيس بعدة دورات:
//   • زمن الدورة (نبضة lastTickAt) وعدد الأجهزة المستحقة/المبدوءة/المؤجَّلة (tickStats)
//   • الالتزام بحد التزامن العام (inflightChecks ≤ NM_MAX_CONCURRENT_CHECKS)
//   • نمو قاعدة البيانات (صفوف status_logs + حجم الملف)
//   • الذاكرة (heapUsed/RSS) و«إنذارات كاذبة» (downtime_events يجب أن تبقى 0)
// التشغيل:  node scripts/load-verify.js [50 100 200]
// ملاحظة تشغيلية: يكتب نتائج JSON في docs/spacekit/LOAD_TEST_RESULTS.json (محلي).
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');

const SIZES = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n) && n > 0);
const TARGETS = SIZES.length ? SIZES : [50, 100, 200];
const TICKS_TO_OBSERVE = parseInt(process.env.LOAD_TICKS, 10) || 3;        // دورات كاملة بعد أول دورة
const TICK_MS = 10000;             // دورة المحرك

function makeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-load-'));
  return dir;
}

function startTcpListener() {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => socket.end());
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function runSize(n, listenerPort, baseDir) {
  const dir = path.join(baseDir, 'n' + n);
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, 'load.db');

  // بيئة معزولة قبل تحميل أي وحدة src
  process.env.DB_PATH = dbPath;
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'load-verify-secret-0123456789';
  
  process.env.NM_TOOLS_ALLOW_PUBLIC = '0';

  // إعادة تحميل الوحدات لكل مقاس (كي تُقرأ DB_PATH الجديدة)
  for (const k of Object.keys(require.cache)) {
    if (k.includes(path.sep + 'src' + path.sep)) delete require.cache[k];
  }
  const db = require('../src/db');
  const monitor = require('../src/services/monitor.service');

  const typeId = db.prepare('SELECT id FROM device_types LIMIT 1').get().id;
  const ins = db.prepare(
    `INSERT INTO devices (name, ip, device_type_id, check_protocol, port, check_interval_seconds, failure_threshold, is_active, current_status)
     VALUES (?, '127.0.0.1', ?, 'port', ?, 10, 2, 1, 'unknown')`
  );
  const seed = db.transaction(() => {
    for (let i = 0; i < n; i++) ins.run('load-dev-' + i, typeId, listenerPort);
  });
  seed();

  const dbFileBytes = () => ['', '-wal', '-shm'].reduce((acc, ext) => {
    try { return acc + fs.statSync(dbPath + ext).size; } catch (_) { return acc; }
  }, 0);

  const t0 = Date.now();
  const memStart = process.memoryUsage();
  const sizeStart = dbFileBytes();

  monitor.startMonitoring();

  // ننتظر أول نبضة ثم عددًا من الدورات، مع أخذ عيّنات لعدد الفحوصات الجارية
  const samples = [];
  let ticksSeen = 0;
  let lastTickAt = null;
  const deadline = Date.now() + TICK_MS * (TICKS_TO_OBSERVE + 2);
  let tickTimes = [];
  while (Date.now() < deadline && ticksSeen < TICKS_TO_OBSERVE) {
    await new Promise((r) => setTimeout(r, 500));
    const h = monitor.getEngineHealth();
    samples.push({ inflight: h.inflightChecks, stuck: h.stuckChecks });
    if (h.lastTickAt && h.lastTickAt !== lastTickAt) {
      lastTickAt = h.lastTickAt;
      ticksSeen += 1;
      tickTimes.push(Date.now());
    }
  }

  const h = monitor.getEngineHealth();
  const memEnd = process.memoryUsage();
  const sizeEnd = dbFileBytes();
  const logs = db.prepare('SELECT COUNT(*) AS c FROM status_logs').get().c;
  const openDowntimes = db.prepare('SELECT COUNT(*) AS c FROM downtime_events WHERE ended_at IS NULL').get().c;
  const online = db.prepare("SELECT COUNT(*) AS c FROM devices WHERE host_status = 'online'").get().c;
  const offline = db.prepare("SELECT COUNT(*) AS c FROM devices WHERE host_status = 'offline'").get().c;
  const unknown = db.prepare("SELECT COUNT(*) AS c FROM devices WHERE host_status IS NULL OR host_status = 'unknown'").get().c;

  const maxInflight = samples.reduce((m, s) => Math.max(m, s.inflight), 0);
  const tickDurations = tickTimes.slice(1).map((t, i) => t - tickTimes[i]);

  const result = {
    devices: n,
    ticksObserved: ticksSeen,
    tickIntervalSeconds: TICK_MS / 1000,
    lastTickStats: h.tickStats,
    maxInflightObserved: maxInflight,
    concurrencyCap: h.tickStats ? h.tickStats.maxConcurrent : null,
    concurrencyRespected: h.tickStats ? maxInflight <= h.tickStats.maxConcurrent : null,
    statusLogsRows: logs,
    expectedRowsPerTick: n,
    devicesOnline: online,
    devicesOffline: offline,
    devicesUnknown: unknown,
    falseAlerts_openDowntimes: openDowntimes,
    dbBytesStart: sizeStart,
    dbBytesEnd: sizeEnd,
    dbGrowthBytes: sizeEnd - sizeStart,
    // ملاحظة: حجم الملف في تشغيل قصير يهيمن عليه تخصيص صفحات/WAL — لا تُقرأ منه قيمة «بايت/صف».
    projectedRowsPerDay: n * Math.round(86400 / (process.env.LOAD_INTERVAL_SECONDS ? Number(process.env.LOAD_INTERVAL_SECONDS) : 10)),
    heapUsedMB_start: Math.round(memStart.heapUsed / 1048576),
    heapUsedMB_end: Math.round(memEnd.heapUsed / 1048576),
    rssMB_end: Math.round(memEnd.rss / 1048576),
    wallSeconds: Math.round((Date.now() - t0) / 1000),
    tickGapsMs: tickDurations,
    stuckChecks: h.stuckChecks,
  };
  return result;
}

(async () => {
  const baseDir = makeDir();
  const { server, port } = await startTcpListener();
  const results = [];
  console.log('MON-03 load verification — real engine, real TCP probes against 127.0.0.1:' + port);
  console.log('sizes:', TARGETS.join(', '), '| ticks per size:', TICKS_TO_OBSERVE, '| cap:', process.env.NM_MAX_CONCURRENT_CHECKS);
  try {
    for (const n of TARGETS) {
      const r = await runSize(n, port, baseDir);
      results.push(r);
      console.log(`\n[${n} devices] ticks=${r.ticksObserved} · status_logs=${r.statusLogsRows} · online=${r.devicesOnline} offline=${r.devicesOffline} unknown=${r.devicesUnknown}`);
      console.log(`  concurrency: maxInflight=${r.maxInflightObserved} ≤ cap=${r.concurrencyCap} => ${r.concurrencyRespected}`);
      console.log(`  tickStats: ${JSON.stringify(r.lastTickStats)}`);
      console.log(`  falseAlerts(openDowntimes)=${r.falseAlerts_openDowntimes} · dbGrowth=${r.dbGrowthBytes}B (rows/day≈${r.projectedRowsPerDay}) · heap=${r.heapUsedMB_end}MB rss=${r.rssMB_end}MB · wall=${r.wallSeconds}s`);
    }
  } finally {
    server.close();
  }
  const outDir = path.join(__dirname, '..', '..', 'docs', 'spacekit');
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'LOAD_TEST_RESULTS.json'), JSON.stringify({ at: new Date().toISOString(), node: process.version, results }, null, 2));
    console.log('\nresults written to docs/spacekit/LOAD_TEST_RESULTS.json');
  } catch (e) {
    console.log('could not write results file:', e.message);
  }
  try { fs.rmSync(baseDir, { recursive: true, force: true }); } catch (e) { console.log("cleanup skipped:", e.code); }
  // الانتهاء الصريح (cron/monitor يبقيان مستمرَّين بطبيعتهما)
  process.exit(0);
})().catch((e) => { console.error('load-verify failed:', e); process.exit(1); });
