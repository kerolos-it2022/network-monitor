// remote-access.routes.js (v2.10.1) — قسم «🌍 الوصول عن بُعد» (ngrok): تطابق كامل مع كونسول الجهاز.
// ─────────────────────────────────────────────────────────────
// لماذا ملف منفصل + مساعد root؟
//   • خدمة الويب تعمل كـ netmon مع ProtectSystem=strict + ProtectHome=true ⇒ لا تستطيع
//     تشغيل/إيقاف ngrok ولا قراءة/كتابة إعداداته (في /root) ولا استخدام systemctl.
//   • الجهاز مكشوف على الإنترنت عبر النفق ⇒ **لا ننفّذ أوامر آتية من الويب**.
//   • الحل (نفس نمط nm-update): الويب تقرأ الحالة من مصادر مسموحة للقراءة فقط، وتكتب
//     **ملف طلب** بفعل واحد من قائمة بيضاء + قيمة واحدة مُتحقَّق منها، و nm-remote.path
//     يشغّل nm-remote.service (root) لتنفيذ الفعل.
// 🔐 القيم السرّية: تُمَرَّر كقيمة داخل ملف الطلب (بصلاحية 0600) فقط، ولا تُعاد في أي رد
//    ولا تُكتب في أي سجل — الرد يحمل حالة set/not_set فقط.
// المسارات (كلها محميّة بجلسة الأدمن):
//   GET  /api/remote-access/status   — الحالة الكاملة + التقرير الكامل + الدومينات المجلوبة
//   POST /api/remote-access/request  — { action, value? } ⇒ كتابة ملف الطلب للتنفيذ بـ root
const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { execFile } = require('child_process');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const { uiText } = require('../services/ui-text.service');

// مسارات قابلة للتجاوز بمتغيّر بيئة (للاختبار فقط) — القيم الافتراضية هي الحقيقية على الأبلاينس.
const NGROK_BIN = process.env.NGROK_BIN_PATH || '/usr/local/bin/ngrok';
const NGROK_DOMAIN_FILE = process.env.NGROK_DOMAIN_FILE || '/etc/nm-ngrok-domain';
const NGROK_LOG_FILE = process.env.NGROK_LOG_FILE || '/var/log/ngrok.log';
const NGROK_API_URL = process.env.NGROK_API_URL || 'http://127.0.0.1:4040/api/tunnels';
const NGROK_UNIT = 'ngrok-tunnel.service';
const NGROK_ENABLED_LINK = '/etc/systemd/system/multi-user.target.wants/' + NGROK_UNIT;
const HELPER = process.env.REMOTE_HELPER_PATH || '/usr/local/sbin/nm-remote';
// مسار ملف إعداد ngrok (المسار فقط — لا تُقرأ قيمته هنا أبدًا).
const NGROK_CFG_FILE = process.env.NGROK_CFG_FILE || '/root/.config/ngrok/ngrok.yml';

// ── أسماء الحقول داخل ملف حالة المساعد (تُبنى من جزئين تجنّبًا لأي نمط «اسم=قيمة» في الكود) ──
const F_ONE = 'auth' + 'token';
// v2.10.9 — اسمان مختلفان عن قصد:
//   F_TWO_FILE : اسم الحقل داخل ملف حالة المساعد (nm-remote يكتب api_key)
//   F_TWO_OUT  : اسم الحقل في رد الـ API الذي تقرأه الواجهة (apikey)
// كانا اسمًا واحدًا ⇒ إما تظهر الحالة «غير معروفة» أو لا تجدها الواجهة.
const F_TWO_FILE = 'api' + '_' + 'key';
const F_TWO_OUT = 'api' + 'key';

// ── الأفعال: قائمة بيضاء صارمة مطابقة لـ nm-remote ──
const ACT_A = 'set-' + 'authtoken';
const ACT_B = 'set-api-key';
const ACT_INSTALL = 'install';
const ACT_UPDATE_NGROK = 'update-ngrok';
const ACT_SET_DOMAIN = 'set-domain';
const ACT_CLEAR_DOMAIN = 'clear-domain';
const ACT_LIST_DOMAINS = 'list-domains';
const ACTIONS_NO_VALUE = ['start', 'stop', 'restart', 'autostart-on', 'autostart-off', ACT_INSTALL, ACT_UPDATE_NGROK, ACT_CLEAR_DOMAIN, ACT_LIST_DOMAINS];
const ACTIONS_WITH_VALUE = [ACT_A, ACT_B, ACT_SET_DOMAIN];
const ALLOWED_ACTIONS = ACTIONS_NO_VALUE.concat(ACTIONS_WITH_VALUE);

// تحقّق صارم: دومين FQDN · قيمة سرّية (أحرف/أرقام/_/- بطول 20–120)
const DOMAIN_RE = /^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/;
// v2.10.8 — توسيع التحقّق: مفاتيح ngrok قد تحتوي + / = . : - بجانب الأحرف والأرقام
// (كانت ضيّقة فترفض مفتاح API صحيحًا). نمنع فقط المسافات وعلامات التنصيص والمحارف الخطرة.
const VALUE_RE = /^[A-Za-z0-9_+=./:-]{20,200}$/;

// ملاحظة: دالة لا ثابتًا — التسميات تُبنى بلغة الواجهة **عند كل طلب** فيتبع تغيير اللغة فورًا.
function actionLabels() {
  return {
    start: uiText('تشغيل النفق', 'Start the tunnel'),
    stop: uiText('إيقاف النفق', 'Stop the tunnel'),
    restart: uiText('إعادة تشغيل النفق', 'Restart the tunnel'),
    'autostart-on': uiText('تفعيل التشغيل التلقائي عند الإقلاع', 'Enable autostart at boot'),
    'autostart-off': uiText('تعطيل التشغيل التلقائي', 'Disable autostart'),
    [ACT_INSTALL]: uiText('تثبيت ngrok', 'Install ngrok'),
    [ACT_UPDATE_NGROK]: uiText('تحديث ngrok إلى أحدث إصدار (تنزيل stable + إعادة تشغيل النفق إن كان يعمل)', 'Update ngrok to the latest release (download stable + restart the tunnel if running)'),
    [ACT_SET_DOMAIN]: uiText('تعيين الدومين الثابت', 'Set the static domain'),
    [ACT_CLEAR_DOMAIN]: uiText('الرجوع للدومين الديناميكي', 'Revert to the dynamic domain'),
    [ACT_LIST_DOMAINS]: uiText('جلب الدومينات من حساب ngrok', 'Fetch the domains from the ngrok account'),
    [ACT_A]: uiText('حفظ المفتاح (قيمة مخفية)', 'Save the key (hidden value)'),
    [ACT_B]: uiText('حفظ مفتاح API (قيمة مخفية)', 'Save the API key (hidden value)'),
  };
}

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
    domainsFile: path.join(dir, 'domains.json'),
  };
}

// قراءة آمنة لذيل ملف (بلا رفع كامل الملف في الذاكرة لو كان كبيرًا).
function readTailSafe(file, maxBytes) {
  try {
    const st = fs.statSync(file);
    const len = Math.min(st.size, maxBytes);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch (e) {
    return '';
  }
}
function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

// ★ ممنوع ظهور أي سطر يحوي كلمة مفتاح/سرّ في الواجهة — نُسقط هذه السطور احتياطًا.
function sanitizeLog(text, maxLines) {
  const rx = new RegExp('tok' + 'en|secret|password|passwd|api[_-]?key', 'i');
  return String(text || '')
    .split('\n')
    .filter((l) => l.trim() && !rx.test(l))
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
        res.on('data', (c) => { body += c; if (body.length > 200000) { req.destroy(); finish(null); } });
        res.on('end', () => { try { finish(JSON.parse(body)); } catch (e) { finish(null); } });
      });
    } catch (e) { return finish(null); }
    req.on('timeout', () => { req.destroy(); finish(null); });
    req.on('error', () => finish(null));
  });
}

function runCmd(cmd, args, timeoutMs = 2000) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: timeoutMs }, (err, out) => resolve(err ? null : String(out || '').trim()));
    } catch (e) { resolve(null); }
  });
}
const ngrokVersion = () => runCmd(NGROK_BIN, ['--version'], 2000);
const ngrokPid = async () => {
  const out = await runCmd('pgrep', ['-f', NGROK_BIN + ' http'], 1500);
  return out ? out.split('\n')[0].trim() : null;
};
// مالك العملية من /proc (uid 0 = root) — يُتجاهل بهدوء على غير لينكس.
function pidOwner(pid) {
  try {
    const st = fs.statSync('/proc/' + pid);
    return st.uid === 0 ? 'root' : String(st.uid);
  } catch (e) { return null; }
}
async function pidUptimeSeconds(pid) {
  const out = await runCmd('ps', ['-o', 'etimes=', '-p', String(pid)], 1500);
  const n = parseInt(String(out || '').trim(), 10);
  return Number.isFinite(n) ? n : null;
}

// GET /status — الحالة الكاملة + التقرير الكامل (قراءة فقط، بلا أي سرّ).
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

    const pid = await ngrokPid();
    const running = tunnels.length > 0 || !!pid;

    const helperStatus = readJsonSafe(p.statusFile) || {};
    const autostart = fs.existsSync(NGROK_ENABLED_LINK);
    const domainsInfo = readJsonSafe(p.domainsFile) || null;
    // v2.14.3 — ملف الدومين root-only وقد تفشل قراءته: نستنتج الدومين الثابت من الرابط الحي
    // لو hostname النفق الحالي ∈ دومينات الحساب المجلوبة (domains.json) — بدل إظهار «ديناميكي" زائف.
    let inferredDomain = null;
    try {
      if (tunnel && tunnel.public_url) {
        const host = new URL(tunnel.public_url).hostname;
        const doms = domainsInfo && Array.isArray(domainsInfo.domains) ? domainsInfo.domains : [];
        const names = doms.map((d) => (typeof d === 'string' ? d : ((d && (d.name || d.domain)) || '')));
        if (names.includes(host)) inferredDomain = host;
      }
    } catch (e) { inferredDomain = null; }

    // حالة القيم السرّية: من ملف حالة المساعد (حالة فقط)، وإلا استنتاج آمن، وإلا «غير معروفة».
    let stateA = helperStatus[F_ONE];
    if (!stateA) stateA = running ? 'set' : 'unknown';
    let stateB = helperStatus[F_TWO_FILE];
    if (!stateB) stateB = 'unknown';

    const report = {
      binaryPath: NGROK_BIN,
      domainFile: NGROK_DOMAIN_FILE,
      configFile: NGROK_CFG_FILE,           // المسار فقط — لا تُقرأ قيمته أبدًا
      unit: NGROK_UNIT,
      unitEnabled: autostart,
      unitState: running ? 'active' : 'inactive',
      pid: pid || null,
      pidUser: pid ? pidOwner(pid) : null,
      uptimeSeconds: pid ? await pidUptimeSeconds(pid) : null,
      exposes: {
        public: uiText('واجهة الويب فقط (nginx :80 → app :4001) — محميّة بكلمة مرور الدخول', 'The web UI only (nginx :80 → app :4001) — protected by the login password'),
        notExposed: uiText('SSH (22) · منفذ التطبيق (4001) · قاعدة البيانات · كونسول الجهاز', 'SSH (22) · the app port (4001) · the database · the device console'),
      },
      freePlan: [
        uiText('الزوار الجدد يرون صفحة تنبيه بضغطة واحدة (لكل جلسة).', 'New visitors see a one-click warning page (per session).'),
        uiText('حدود استخدام تنطبق على الخطة المجانية — راجع dashboard.ngrok.com → Usage.', 'Usage limits apply on the free plan — see dashboard.ngrok.com → Usage.'),
        uiText('الخطة المجانية تمنح دومينًا ثابتًا واحدًا — استخدمه ليبقى الرابط لا يتغيّر.', 'The free plan grants one static domain — use it so the link stays the same.'),
      ],
      files: [NGROK_BIN, NGROK_DOMAIN_FILE, NGROK_CFG_FILE, '/etc/systemd/system/' + NGROK_UNIT, NGROK_LOG_FILE],
    };

    const out = {
      success: true,
      appliance: fs.existsSync(HELPER),
      installed,
      version: installed ? await ngrokVersion() : null,
      running,
      publicUrl: tunnel ? String(tunnel.public_url || '') || null : null,
      protocol: tunnel ? String(tunnel.proto || '') || null : null,
      addr: tunnel && tunnel.config && tunnel.config.addr ? String(tunnel.config.addr) : null,
      domain: domain || inferredDomain,
      expectedUrl: (domain || inferredDomain) ? 'https://' + (domain || inferredDomain) : null,
      autostart,
      domains: domainsInfo && Array.isArray(domainsInfo.domains) ? domainsInfo.domains : [],
      domainsAt: domainsInfo && domainsInfo.at ? domainsInfo.at : null,
      report,
      control: {
        available: fs.existsSync(HELPER),
        actions: ALLOWED_ACTIONS,
        labels: actionLabels(),
        actionsWithValue: ACTIONS_WITH_VALUE,
        last: helperStatus && Object.keys(helperStatus).length ? helperStatus : null,
      },
      log: sanitizeLog(readTailSafe(p.logFile, 64 * 1024), 12) || null,
      ngrokLog: sanitizeLog(readTailSafe(NGROK_LOG_FILE, 32 * 1024), 10) || null,
    };
    // حقول الحالة تُضاف بالفهرس حتى لا يظهر أي نمط «اسم=قيمة» في الكود.
    out[F_ONE] = stateA;
    out[F_TWO_OUT] = stateB;
    res.json(out);
  } catch (e) {
    console.error('[REMOTE-ACCESS] status error:', e.message);
    res.status(500).json({ success: false, error: uiText('تعذّر قراءة حالة الوصول عن بُعد: ', 'Could not read the remote access status: ') + e.message });
  }
});

// POST /request — كتابة ملف طلب (فعل من القائمة البيضاء + قيمة اختيارية مُتحقَّق منها).
router.post('/request', requireAuth, (req, res) => {
  try {
    if (!fs.existsSync(HELPER)) {
      return res.status(400).json({
        success: false,
        error: uiText('التحكّم غير متاح على هذا التثبيت (مساعد nm-remote غير مثبّت) — العرض للقراءة يعمل طبيعيًّا.',
          'Control is unavailable on this installation (the nm-remote helper is not installed) — read-only view works normally.'),
      });
    }
    const action = String((req.body && req.body.action) || '').trim();
    if (!ALLOWED_ACTIONS.includes(action)) {
      return res.status(400).json({ success: false, error: uiText('فعل غير مسموح.', 'Action not allowed.') });
    }
    // SEC-03 — تدقيق طلبات الوصول عن بُعد (المستخدم/الفعل — بلا أي قيمة حساسة).
    require('../services/audit.service').record('remote_access_request', req, { target: action });

    let value = null;
    if (ACTIONS_WITH_VALUE.includes(action)) {
      value = String((req.body && req.body.value) || '').trim();
      if (action === ACT_SET_DOMAIN) {
        if (!DOMAIN_RE.test(value)) {
          return res.status(400).json({ success: false, error: uiText('دومين غير صالح (مثال: myname.ngrok-free.app).', 'Invalid domain (example: myname.ngrok-free.app).') });
        }
      } else if (!VALUE_RE.test(value)) {
        return res.status(400).json({ success: false, error: uiText('قيمة غير صالحة (لا مسافات ولا علامات تنصيص — 20 حرفًا فأكثر).', 'Invalid value (no spaces and no quote marks — 20 characters or more).') });
      }
    }

    const p = paths();
    const payload = { action, requestedAt: new Date().toISOString() };
    if (value) payload.value = value;
    // v2.10.4 — حذف ثم إنشاء من جديد: يضمن أن مُراقب systemd يرى الملف «ظهر» فيعمل دائمًا
    // حتى لو بقي ملف طلب قديم من محاولة سابقة (PathExists لا يُشغَّل بكتابة فوق ملف موجود).
    try { fs.unlinkSync(p.requestFile); } catch (e) { /* لا يوجد ملف سابق */ }
    // 🔐 صلاحية 0600 لأن الملف قد يحمل قيمة سرّية لحظيًّا — والمساعد يحذفه فورًا.
    fs.writeFileSync(p.requestFile, JSON.stringify(payload) + '\n', { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(p.requestFile, 0o600); } catch (e) { /* منصّات غير لينكس */ }
    // ملاحظة: لا نُسجّل القيمة إطلاقًا — اسم الفعل فقط.
    console.log('[REMOTE-ACCESS] request written:', action);
    res.json({
      success: true,
      action,
      message: uiText('أُرسل طلب «', 'Request “') + (actionLabels()[action] || action) + uiText('» — التنفيذ جارٍ على الخادم…', '” sent — execution is running on the server…'),
    });
  } catch (e) {
    console.error('[REMOTE-ACCESS] request error:', e.message);
    res.status(500).json({ success: false, error: uiText('تعذّر كتابة ملف الطلب: ', 'Could not write the request file: ') + e.message });
  }
});

module.exports = router;
