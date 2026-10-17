// tools.routes.js: API أدوات الشبكة (Ping/Tracert) — بث مباشر (SSE Streaming).
// ═══ SEC-01 (SpaceKit Phase 0) — تأمين كامل ═══
//   1) لا وصول للمجهول: requireAuth + requireRole (افتراضيًا: المدير فقط — يُضبط
//      بـ NM_TOOLS_MIN_ROLE=viewer للسماح لحسابات العرض).
//   2) لا صدفة (shell): spawn بـ shell:false ومصفوفة وسائط صريحة ⇒ لا حقن أوامر.
//   3) تحقق صارم من الهدف (IP/اسم مضيف) + قائمة نطاقات مسموح بها (الافتراضي: الشبكات
//      الخاصة فقط — RFC1918/loopback/link-local/ULA) + حلّ الاسم ثم تنفيذ الـ IP نفسه
//      (منع DNS rebinding). الهدف الخارجي يحتاج NM_TOOLS_ALLOW_PUBLIC=1 صراحةً.
//   4) حدود: زمن أقصى، حد للمخرجات (أسطر/بايتات)، حد تزامن، وحد تكرار لكل مستخدم.
//   5) القتل عند انقطاع اتصال العميل (لا عمليات يتيمة).
const express = require('express');
const { spawn } = require('child_process');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const { authorizeTarget } = require('../services/net/target-guard');
const { createSlidingWindowLimiter, createSemaphore } = require('../services/net/tool-limits');
// SEC-01/قرار المالك — السياسة تُقرأ من اللوحة (app_settings) ← .env ← الافتراضي الآمن.
const toolsPolicy = require('../services/tools-policy.service');
// SEC-03 — سجل تدقيق لاستخدام أدوات التشخيص (من/إلى/أي أداة).
const audit = require('../services/audit.service');

const router = express.Router();

function intEnv(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function toolsConfig() {
  return {
    // minRole/allowPublic من سياسة اللوحة (تتجاوز .env) — تُقرأ في كل طلب فتُطبَّق فورًا.
    policy: toolsPolicy.getToolsPolicy(),
    ratePerMin: intEnv('NM_TOOLS_RATE_PER_MIN', 10),
    maxConcurrent: intEnv('NM_TOOLS_MAX_CONCURRENT', 2),
    pingCount: Math.min(intEnv('NM_PING_COUNT', 4), 10),
    tracertHops: Math.min(intEnv('NM_TRACERT_MAX_HOPS', 15), 30),
    maxOutputLines: intEnv('NM_TOOLS_MAX_OUTPUT_LINES', 400),
    maxOutputBytes: intEnv('NM_TOOLS_MAX_OUTPUT_BYTES', 65536),
  };
}

// المحدِّدات تُبنى عند أول استخدام (وتُعاد بناؤها لو تغيّر الإعداد) لتسهيل اختبارها.
let limiter = null; let limiterMax = 0;
let semaphore = null; let semaphoreMax = 0;

function getLimiter(cfg) {
  if (!limiter || limiterMax !== cfg.ratePerMin) {
    limiter = createSlidingWindowLimiter({ windowMs: 60000, max: cfg.ratePerMin });
    limiterMax = cfg.ratePerMin;
  }
  return limiter;
}

function getSemaphore(cfg) {
  if (!semaphore || semaphoreMax !== cfg.maxConcurrent) {
    semaphore = createSemaphore(cfg.maxConcurrent);
    semaphoreMax = cfg.maxConcurrent;
  }
  return semaphore;
}

// بث مخرجات الأمر بصيغة SSE مع كل الحدود الأمنية.
function streamCommand(req, res, ctx) {
  const { tool, address, cfg, release } = ctx;
  const isWin = process.platform === 'win32';
  const cmd = tool === 'ping' ? 'ping' : (isWin ? 'tracert' : 'traceroute');
  const args = tool === 'ping'
    ? (isWin ? ['-n', String(cfg.pingCount), address] : ['-c', String(cfg.pingCount), address])
    : (isWin ? ['-d', '-h', String(cfg.tracertHops), address] : ['-m', String(cfg.tracertHops), address]);
  const timeoutMs = tool === 'ping' ? 15000 : 30000;

  let child;
  try {
    // shell:false + مصفوفة وسائط ⇒ الهدف لا يُفسَّر أبدًا كمحارف شل.
    child = spawn(cmd, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    release();
    return res.status(500).json({ success: false, error: 'تعذّر تشغيل الأمر' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.write('event: start\n');
  res.write('data: بدء التنفيذ...\n\n');
  res.flushHeaders();

  let finished = false;
  let buffer = '';
  let outBytes = 0;
  let outLines = 0;
  let truncated = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(killTimer);
    release();
  };

  const endStream = () => {
    if (truncated) {
      try {
        res.write('event: error\ndata: ' + JSON.stringify('تم إيقاف التنفيذ: تجاوز الحد المسموح من الوقت أو حجم المخرجات') + '\n\n');
      } catch (_) { /* العميل مغلق */ }
    }
    try { res.write('event: done\ndata: \n\n'); res.end(); } catch (_) { /* العميل مغلق */ }
    finish();
  };

  const killTimer = setTimeout(() => {
    truncated = true;
    try { child.kill(); } catch (_) { /* انتهت العملية */ }
  }, timeoutMs);

  function sendLine(line) {
    if (outLines >= cfg.maxOutputLines || outBytes >= cfg.maxOutputBytes) {
      truncated = true;
      try { child.kill(); } catch (_) { /* انتهت العملية */ }
      return;
    }
    outBytes += Buffer.byteLength(line, 'utf8');
    outLines += 1;
    try {
      res.write('event: line\ndata: ' + JSON.stringify(line) + '\n\n');
    } catch (_) { /* العميل مغلق */ }
  }

  const onData = (chunk) => {
    buffer += chunk.toString('utf8');
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() || '';
    for (const line of parts) if (line.trim()) sendLine(line);
  };

  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('close', () => {
    if (buffer.trim()) sendLine(buffer);
    endStream();
  });
  child.on('error', () => {
    truncated = false;
    try {
      res.write('event: error\ndata: ' + JSON.stringify('خطأ: تعذّر تشغيل الأمر على الخادم') + '\n\n');
    } catch (_) { /* العميل مغلق */ }
    endStream();
  });

  // انقطاع العميل ⇒ اقتل العملية فورًا.
  req.on('close', () => {
    try { child.kill(); } catch (_) { /* انتهت العملية */ }
    finish();
  });
}

function buildHandler(tool) {
  return async function handler(req, res) {
    const cfg = toolsConfig();
    const user = (req.session && req.session.user) || {};

    const rate = getLimiter(cfg).check(user.username || req.ip || 'unknown');
    if (!rate.ok) {
      return res.status(429).json({
        success: false,
        error: 'محاولات كثيرة — أعد المحاولة بعد ' + Math.ceil(rate.retryAfterMs / 1000) + ' ثانية',
      });
    }

    // تحقق + سياسة الوجهة (يُحلّ الاسم هنا ويُنفَّذ العنوان الناتج نفسه).
    const auth = await authorizeTarget(req.query.ip, {
      allowPublic: cfg.policy.allowPublic,
      cidrs: toolsPolicy.resolveCidrsForPolicy(cfg.policy),
    });
    if (!auth.ok) {
      const status = auth.code === 'TARGET_NOT_ALLOWED' ? 403 : 400;
      return res.status(status).json({ success: false, error: auth.error });
    }

    const release = getSemaphore(cfg).tryAcquire();
    if (!release) {
      return res.status(429).json({ success: false, error: 'عدد عمليات التشخيص المتزامنة بلغ الحد — حاول بعد قليل' });
    }

    audit.record('tool_run', req, { target: auth.address, details: { tool } });

    streamCommand(req, res, { tool, address: auth.address, cfg, release });
  };
}

const gate = [requireAuth, (req, res, next) => requireRole(toolsConfig().policy.minRole)(req, res, next)];

// GET /api/tools/ping?ip=192.168.1.1  — بث مباشر (للمدير/المشغّل فقط)
router.get('/ping', gate, buildHandler('ping'));

// GET /api/tools/tracert?ip=192.168.1.1  — بث مباشر (للمدير/المشغّل فقط)
router.get('/tracert', gate, buildHandler('tracert'));

module.exports = router;
