// tools.routes.js: API أدوات الشبكة (Ping/Tracert) — بث مباشر (SSE Streaming) للصفحة العامة.
const express = require('express');
const { spawn } = require('child_process');
const router = express.Router();

// التحقق من صحة IP/hostname — منع حقن الأوامر.
function isValidTarget(target) {
  if (!target || typeof target !== 'string') return false;
  if (/[;&|`$()<>]/.test(target)) return false;
  if (target.length > 100) return false;
  return true;
}

// دالة مشتركة: بث مخرجات أمر ما بصيغة SSE (Server-Sent Events).
// يرسل كل سطر من stdout/stderr فور صدوره للعميل.
function streamCommand(req, res, cmd, args, timeoutMs) {
  const target = req.query.ip;
  if (!target || !isValidTarget(target)) {
    return res.status(400).json({ success: false, error: 'IP/Host غير صالح' });
  }

  // إعداد SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // تعطيل تخزين Nginx

  // إرسال حدث بداية
  res.write('event: start\n');
  res.write('data: بدء التنفيذ...\n\n');
  res.flushHeaders();

  const child = spawn(cmd, args, {
    timeout: timeoutMs,
    shell: true,
    encoding: 'utf-8',
  });

  // التخزين المؤقت للسطر الحالي (لأن spawn يرسل أجزاء غير مكتملة)
  let buffer = '';

  function sendLine(line) {
    res.write('event: line\n');
    res.write('data: ' + JSON.stringify(line) + '\n\n');
  }

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    // الاحتفاظ بآخر جزء (قد يكون غير مكتمل)
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) sendLine(line);
    }
  });

  child.stderr.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) sendLine(line);
    }
  });

  child.on('close', (code) => {
    // إرسال أي بيانات متبقية في الـ buffer
    if (buffer.trim()) sendLine(buffer);
    res.write('event: done\n');
    res.write('data: \n\n');
    res.end();
  });

  child.on('error', (err) => {
    res.write('event: error\n');
    res.write('data: ' + JSON.stringify('خطأ: ' + err.message) + '\n\n');
    res.end();
  });

  // عند انقطاع اتصال العميل — اقتل العملية
  req.on('close', () => {
    if (!child.killed) child.kill();
  });
}

// GET /api/tools/ping?ip=192.168.1.1  — بث مباشر
router.get('/ping', (req, res) => {
  const target = req.query.ip;
  if (!target || !isValidTarget(target)) {
    return res.status(400).json({ success: false, error: 'IP/Host غير صالح' });
  }
  // Windows: ping -n 4 | Linux: ping -c 4
  const cmd = process.platform === 'win32' ? 'ping' : 'ping';
  const args = process.platform === 'win32' ? ['-n', '4', target] : ['-c', '4', target];
  streamCommand(req, res, cmd, args, 15000);
});

// GET /api/tools/tracert?ip=192.168.1.1  — بث مباشر
router.get('/tracert', (req, res) => {
  const target = req.query.ip;
  if (!target || !isValidTarget(target)) {
    return res.status(400).json({ success: false, error: 'IP/Host غير صالح' });
  }
  // Windows: tracert -d -h 15 | Linux: traceroute -m 15
  const cmd = process.platform === 'win32' ? 'tracert' : 'traceroute';
  const args = process.platform === 'win32' ? ['-d', '-h', '15', target] : ['-m', '15', target];
  streamCommand(req, res, cmd, args, 30000);
});

module.exports = router;
