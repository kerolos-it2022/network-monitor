// remote-access.routes.js (v2.9.0) — قسم «🌍 الوصول عن بُعد» (ngrok) في لوحة التحكم.
// ─────────────────────────────────────────────────────────────
// لماذا ملف منفصل + مساعد root؟
//   • خدمة الويب تعمل كـ netmon مع ProtectSystem=strict + ProtectHome=true ⇒ لا تستطيع
//     تشغيل/إيقاف ngrok ولا قراءة التوكن (في /root) ولا استخدام systemctl.
//   • الجهاز مكشوف على الإنترنت عبر النفق ⇒ **لا ننفّذ أوامر آتية من الويب**.
//   • الحل (مطابق لـ nm-update): الويب تقرأ الحالة من مصادر مسموحة للقراءة فقط، وتكتب
//     **ملف طلب** بفعل واحد من قائمة بيضاء، و nm-remote.path يشغّل nm-remote.service (root).
// المسارات (كلها محميّة بجلسة الأدمن):
//   GET  /api/remote-access/status   — الحالة الكاملة (قراءة فقط، بلا أي توكن)
//   POST /api/remote-access/request  — { action } ⇒ كتابة ملف الطلب للتنفيذ بمصدر root
const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { execFile } = require('child_process');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');

// مسارات قابلة للتجاوز بمتغيّر بيئة (للاختبار فقط) — القيم الافتراضية هي الحقيقية على الأبلاينس.
const NGROK_BIN = process.env.NGROK_BIN_PATH || '/usr/local/bin/ngrok';
const NGROK_DOMAIN_FILE = process.env.NGROK_DOMAIN_FILE || '/etc/nm-ngrok-domain';
const NGROK_LOG_FILE = process.env.NGROK_LOG_FILE || '/var/log/ngrok.log';
const NGROK_API_URL = process.env.NGROK_API_URL || 'http://127.0.0.1:4040/api/tunnels';
const NGROK_UNIT = 'ngrok-tunnel.service';
const NGROK_ENABLED_LINK = '/etc/systemd/system/multi-user.target.wants/' + NGROK_UNIT;
const HELPER = process.env.REMOTE_HELPER_PATH || '/usr/local/sbin/nm-remote';

// القائمة البيضاء للأفعال — نفس ما يقبله nm-remote حرفيًّا.
const ALLOWED_ACTIONS = ['start', 'stop', 'restart', 'autostart-on', 'autostart-off'];
const ACTION_LABELS = {
  start: 'تشغيل النفق',
  stop: 'إيقاف النفق',
  restart: 'إعادة تشغيل النفق',
  'autostart-on': 'تفعيل التشغيل التلقائي عند الإقلاع',
  'autostart-off': 'تعطيل التشغيل التلقائي',
};

// مجلد البيانات = مجلد القاعدة (نفس منطق db.js / backup.routes.js / appliance-update.routes.js).
function dataDirPath() {
  return path.dirname(path.resolve(process.cwd(), process.env.DB_PATH || '../database/monitoring.db'));
}
function paths() {
  const base = dataDirPath();
  const dir = path.join(base, 'remote');
  return {
    requestFile: path.join(base, 'remote-request.json'),
    statusFile: path.join(dir, 'status.json'),
    logFile: path.join(dir, 'remote.log'),
  };
}

// قراءة آمنة لذيل ملف (بلا رفع كامل الملف في الذاكرة لو كان كبيرًا).
function readTailSafe(file, maxBytes) {
  try {
    const st = fs.statSync(file);
    const size = st.size;
    const len = Math.min(size, maxBytes);
    const start = size - len;
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch (e) {
    return '';
  }
}
function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

// ★ ممنوع ظهور أي سطر يحوي كلمة توكن/سرّ في الواجهة — نُسقط هذه السطور احتياطًا.
function sanitizeLog(text, maxLines) {
  return String(text || '')
    .split('\n')
    .filter((l) => l.trim() && !/authtoken|token|secret|password|passwd/i.test(l))
    .slice(-maxLines)
    .join('\n');
}

// استعلام واجهة ngrok المحلية (127.0.0.1:4040) — نفس طريقة كونسول الجهاز.
function queryNgrokApi() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    let req;
    try {
      req = http.get(NGROK_API_URL, { timeout: 1500 }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          body += c;
          if (body.length > 200000) { req.destroy(); finish(null); }
        });
        res.on('end', () => {
          try { finish(JSON.parse(body)); } catch (e) { finish(null); }
        });
      });
    } catch (e) {
      return finish(null);
    }
    req.on('timeout', () => { req.destroy(); finish(null); });
    req.on('error', () => finish(null));
  });
}

// إصدار الملف التنفيذي (اختياري — بلا فشل لو تعذّر).
function ngrokVersion() {
  return new Promise((resolve) => {
    try {
      execFile(NGROK_BIN, ['--version'], { timeout: 2000 }, (err, out) => {
        resolve(err ? null : String(out || '').trim() || null);
      });
    } catch (e) { resolve(null); }
  });
}

// هل العملية شغّالة؟ (احتياطي لو واجهة 4040 معطّلة)
function ngrokProcessRunning() {
  return new Promise((resolve) => {
    try {
      execFile('pgrep', ['-f', NGROK_BIN + ' http'], { timeout: 1500 }, (err, out) => {
        resolve(!err && String(out || '').trim().length > 0);
      });
    } catch (e) { resolve(false); }
  });
}

// GET /status — الحالة الكاملة (قراءة فقط).
router.get('/status', requireAuth, async (req, res) => {
  try {
    const p = paths();
    const installed = fs.existsSync(NGROK_BIN);
    let domain = null;
    try {
      const raw = fs.readFileSync(NGROK_DOMAIN_FILE, 'utf8').split('\n')[0].trim();
      domain = raw || null;
    } catch (e) { domain = null; }

    const api = await queryNgrokApi();
    const tunnels = api && Array.isArray(api.tunnels) ? api.tunnels : [];
    const httpsTunnel = tunnels.find((t) => /^https:/i.test(String(t.public_url || ''))) || null;
    const tunnel = httpsTunnel || tunnels[0] || null;

    let running = tunnels.length > 0;
    if (!running) running = await ngrokProcessRunning();

    const helperStatus = readJsonSafe(p.statusFile);
    const autostart = fs.existsSync(NGROK_ENABLED_LINK);

    // حالة التوكن: من مساعد root إن وُجد، وإلا استنتاج آمن (يعمل ⇒ مضبوط)، وإلا «غير معروفة».
    let authtoken = helperStatus && helperStatus.authtoken ? helperStatus.authtoken : null;
    if (!authtoken) authtoken = running ? 'set' : 'unknown';

    res.json({
      success: true,
      appliance: fs.existsSync(HELPER),
      unit: NGROK_UNIT,
      installed,
      version: installed ? await ngrokVersion() : null,
      running,
      publicUrl: tunnel ? String(tunnel.public_url || '') || null : null,
      protocol: tunnel ? String(tunnel.proto || '') || null : null,
      addr: tunnel && tunnel.config && tunnel.config.addr ? String(tunnel.config.addr) : null,
      domain,
      expectedUrl: domain ? 'https://' + domain : null,
      autostart,
      authtoken,
      control: {
        available: fs.existsSync(HELPER),
        actions: ALLOWED_ACTIONS,
        labels: ACTION_LABELS,
        last: helperStatus,
      },
      log: sanitizeLog(readTailSafe(p.logFile, 64 * 1024), 12) || null,
      ngrokLog: sanitizeLog(readTailSafe(NGROK_LOG_FILE, 32 * 1024), 10) || null,
    });
  } catch (e) {
    console.error('[REMOTE-ACCESS] status error:', e.message);
    res.status(500).json({ success: false, error: 'تعذّر قراءة حالة الوصول عن بُعد: ' + e.message });
  }
});

// POST /request — كتابة ملف طلب (فعل واحد من القائمة البيضاء) — والتنفيذ بمصدر root.
router.post('/request', requireAuth, (req, res) => {
  try {
    if (!fs.existsSync(HELPER)) {
      return res.status(400).json({
        success: false,
        error: 'التحكّم غير متاح على هذا التثبيت (مساعد nm-remote غير مثبّت) — العرض للقراءة يعمل طبيعيًّا.',
      });
    }
    const action = String((req.body && req.body.action) || '').trim();
    if (!ALLOWED_ACTIONS.includes(action)) {
      return res.status(400).json({ success: false, error: 'فعل غير مسموح.' });
    }
    const p = paths();
    fs.writeFileSync(p.requestFile, JSON.stringify({ action, requestedAt: new Date().toISOString() }) + '\n', 'utf8');
    console.log('[REMOTE-ACCESS] request written:', action);
    res.json({
      success: true,
      action,
      message: `أُرسل طلب «${ACTION_LABELS[action]}» — التنفيذ جارٍ على الخادم…`,
    });
  } catch (e) {
    console.error('[REMOTE-ACCESS] request error:', e.message);
    res.status(500).json({ success: false, error: 'تعذّر كتابة ملف الطلب: ' + e.message });
  }
});

module.exports = router;
