// appliance-update.routes.js (v2.8.7) — تحديث الأبلاينس بصلاحية root عبر مساعد منفصل.
// ─────────────────────────────────────────────────────────────
// لماذا ملف منفصل (بلا تعديل update.routes.js)؟
//   • خدمة الأبلاينس تعمل كـ netmon مع ProtectSystem=strict ⇒ لا تستطيع الكتابة في كود
//     التطبيق ولا استخدام systemctl.
//   • الجهاز قد يكون مكشوفًا على الإنترنت (ngrok) ⇒ **لا ننفّذ أوامر تحديث من الويب**.
//   • الحل: خدمة الويب تكتب **ملف طلب** يحوي وسم إصدار فقط (أو الكلمة «latest»)،
//     و nm-update.path يُشغّل nm-update.service (root) الذي:
//        1) يحلّ «latest» عبر GitHub API (المستودع مُثبَّت داخل الأداة نفسها — بلا توكن)،
//        2) يتحقّق من الوسم بصرامة ثم يُنزّل من المستودع المُثبَّت داخل الأداة نفسها،
//        3) يُحدِّث الملفات + npm ci + إعادة تشغيل الخدمة.
//   • لا يمرّ من الويب أي أمر أو مسار أو توكن ⇒ لو استُغلّت الخدمة عن بُعد لا تستطيع
//     كتابة كود ولا تنفيذ ما تريد.
// المسارات (كلها محميّة بجلسة الأدمن):
//   GET  /api/appliance-update/mode      — هل الجهاز appliance؟ (وجود المساعد)
//   POST /api/appliance-update/request   — { tag? } ⇒ كتابة ملف الطلب (الافتراضي latest)
//   GET  /api/appliance-update/progress  — { state, log } التقدّم الحالي (قراءة فقط)
const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');

// مسار المساعد (قابل للتجاوز بمتغيّر بيئة للاختبار فقط).
const APPLIANCE_HELPER = process.env.APPLIANCE_HELPER_PATH || '/usr/local/sbin/nm-update';
// semver صارم: v1.2.3 أو 1.2.3 مع لاحقة اختيارية — لا مسافات ولا رموز shell.
const TAG_RE = /^v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.]*)?$/;
const STATE_SUBDIR = 'update';

// v2.10.0 — قائمة وسوم الإصدارات (للرجوع لإصدار أقدم) من GitHub، بكاش داخلي يجنّبنا حدود الـ API.
const TAGS_REPO = 'kerolos-it2022/network-monitor';   // نفس المستودع المُثبَّت داخل nm-update
const TAGS_TTL_MS = 10 * 60 * 1000;
let tagsCache = { at: 0, list: [] };

// طلب HTTPS JSON بمهلة قصيرة (بلا أي اعتماديات إضافية).
function httpsGetJson(url, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: timeoutMs,
      headers: { 'User-Agent': 'nm-appliance-update', Accept: 'application/vnd.github+json' },
    }, (r) => {
      let body = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { body += c; if (body.length > 500000) req.destroy(); });
      r.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('رد غير صالح من GitHub')); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('مهلة الاتصال بـGitHub')); });
    req.on('error', (e) => reject(e));
  });
}

function isAppliance() {
  try { return fs.existsSync(APPLIANCE_HELPER); } catch (e) { return false; }
}
// مجلد البيانات = مجلد القاعدة (نفس منطق db.js و backup.routes.js).
function dataDirPath() {
  return path.dirname(path.resolve(process.cwd(), process.env.DB_PATH || '../database/monitoring.db'));
}
function paths() {
  const base = dataDirPath();
  const dir = path.join(base, STATE_SUBDIR);
  return {
    requestFile: path.join(base, 'update-request.json'),
    statusFile: path.join(dir, 'status.json'),
    logFile: path.join(dir, 'update.log'),
  };
}

// GET /mode — هل هذا تثبيت أبلاينس (المساعد موجود)؟
router.get('/mode', requireAuth, (req, res) => {
  res.json({ success: true, appliance: isAppliance(), helper: APPLIANCE_HELPER, dataDir: dataDirPath() });
});

// v2.24.0 — قفل تزامن التشغيلين (مسار الويب + مسار الجذر): وقع فعليًّا أن يُطلق
// تحديثان توأمان في نفس الدقيقة فتتقاطع رسائل النتيجة وتُخطئ الشاشة. قبل كتابة أي
// طلب: إن وُجدت عملية جارية (in_progress/running/rebooting) بطابع أحدث من 30 دقيقة نرفض.
const ACTIVE_UPDATE_STATES = new Set(['in_progress', 'running', 'rebooting']);
const ACTIVE_UPDATE_WINDOW_MS = 1000 * 60 * 30;
function recentActiveUpdate() {
  const p = paths();
  const cands = [];
  try { cands.push(JSON.parse(fs.readFileSync(p.statusFile, 'utf8'))); } catch (e) {}
  try { cands.push(JSON.parse(fs.readFileSync(path.join(__dirname, '../../database', 'update-web-status.json'), 'utf8'))); } catch (e) {}
  const now = Date.now();
  let newest = null;
  for (const c of cands) {
    if (!c || !ACTIVE_UPDATE_STATES.has(String(c.state || ''))) continue;
    const ts = Date.parse(c.at || '');
    if (!Number.isFinite(ts) || now - ts > ACTIVE_UPDATE_WINDOW_MS) continue;
    if (!newest || ts > newest.ts) newest = { ts, rec: c };
  }
  return newest;
}

// POST /request — كتابة ملف طلب التحديث (وسم صريح أو «latest» — والأداة الجذرية هي التي تحلّها).
router.post('/request', requireAuth, (req, res) => {
  try {
    if (!isAppliance()) {
      return res.status(400).json({ success: false, error: 'وضع الأبلاينس غير مُفعَّل على هذا التثبيت.' });
    }
    // v2.24.0 — لا تشغيل ثانٍ فوق عملية قائمة.
    const active = recentActiveUpdate();
    if (active) {
      const mins = Math.max(1, Math.round((Date.now() - active.ts) / 60000));
      return res.status(409).json({
        success: false,
        error: 'التحديث جارٍ بالفعل (بدأ منذ ' + mins + ' دقيقة — ' + String(active.rec.message || active.rec.state) + ') — انتظر اكتماله ثم أعد المحاولة إن لزم.',
        update_in_progress: true,
      });
    }
    // SEC-03 — تدقيق طلب تحديث الأبلاينس (المستخدم/الوسم).
    require('../services/audit.service').record('appliance_update_request', req, { target: String((req.body && req.body.tag) || 'latest').slice(0, 80) });

    const raw = String((req.body && req.body.tag) || '').trim();
    const tag = raw || 'latest';
    if (tag !== 'latest' && !TAG_RE.test(tag)) {
      return res.status(400).json({ success: false, error: 'وسم إصدار غير صالح (semver مثل v2.8.7 أو latest).' });
    }
    const p = paths();
    // v2.10.4 — نحذف الملف أولًا ثم ننشئه من جديد: هذا يضمن أن مُراقب systemd (PathExists/PathModified)
    // يرى «ظهورًا» للملف فيعمل دائمًا — حتى لو كان ملف طلب قديم موجودًا من محاولة سابقة.
    try { fs.unlinkSync(p.requestFile); } catch (e) { /* لا يوجد ملف سابق */ }
    fs.writeFileSync(
      p.requestFile,
      JSON.stringify({ tag, requestedAt: new Date().toISOString() }) + '\n',
      'utf8'
    );
    console.log('[APPLIANCE-UPDATE] request written:', tag);
    const msg = tag === 'latest'
      ? 'أُرسل طلب تحديث إلى أحدث إصدار — التنفيذ جارٍ على الخادم…'
      : `أُرسل طلب تحديث إلى ${tag} — التنفيذ جارٍ على الخادم…`;
    res.json({ success: true, appliance: true, tag, message: msg });
  } catch (e) {
    console.error('[APPLIANCE-UPDATE] request error:', e.message);
    res.status(500).json({ success: false, error: 'تعذّر كتابة ملف الطلب: ' + e.message });
  }
});

// GET /progress — حالة التحديث + آخر سطور السجل (قراءة فقط).
router.get('/progress', requireAuth, (req, res) => {
  try {
    const p = paths();
    let state = null;
    let log = '';
    try { state = JSON.parse(fs.readFileSync(p.statusFile, 'utf8')); if (state) state.source = 'appliance'; } catch (e) {}
    // v2.24.0 — دمج صحيح: المقارنة النصية القديمة (String(at)) بين صيغتين مختلفتين
    // (توقيت الجهاز +00:00 وتوقيت الويب UTC .mmmZ) كانت تعطي الفوز لسجل قديم بالصدفة
    // فتعرض رسالة «تم التحديث إلى <إصدار أقدم>». الآن: Date.parse حقيقي والأحدث فعليًا يفوز.
    try {
      const webRec = JSON.parse(fs.readFileSync(path.join(__dirname, '../../database', 'update-web-status.json'), 'utf8'));
      if (webRec) webRec.source = 'web';
      const tsNm = state && state.at ? Date.parse(state.at) : NaN;
      const tsWeb = webRec && webRec.at ? Date.parse(webRec.at) : NaN;
      const webWins = webRec && Number.isFinite(tsWeb) && (!state || !Number.isFinite(tsNm) || tsWeb > tsNm);
      if (webWins) state = webRec;
    } catch (e) { /* لا سجل ويب — لا بأس */ }
    // v2.28.3 — الحقيقة المقاسة من الجذر: رسالة النجاح تُبنى من إصدار package.json
    // العامَل فعليًّا (يُقاس الآن) — مصادر السجل (الجذر+الويب) قد تتداخل فتعرض رسالة قديمة؛
    // الرسالة القديمة تُحفظ في raw_message للسجل التفصيلي فقط.
    try {
      const appVersion = (JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')).version) || null;
      if (state && state.state === 'success' && appVersion) {
        state.raw_message = state.message;
        state.running_version = appVersion;
        state.message = '✅ التحديث اكتمل — النسخة العاملة الآن: v' + appVersion;
      }
    } catch (e) { /* لا نُفشل الحالة لو فشلت قراءة الإصدار */ }
    try { log = fs.readFileSync(p.logFile, 'utf8').split('\n').slice(-40).join('\n'); } catch (e) {}
    res.json({ success: true, appliance: isAppliance(), state, log });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /tags — قائمة وسوم الإصدارات المتاحة (تنازليًّا) للرجوع لإصدار أقدم.
// كاش 10 دقائق + إرجاع آخر كاش عند فشل الشبكة (حتى لا تتعطّل الواجهة).
router.get('/tags', requireAuth, async (req, res) => {
  try {
    const now = Date.now();
    if (tagsCache.list.length && now - tagsCache.at < TAGS_TTL_MS) {
      return res.json({ success: true, cached: true, tags: tagsCache.list });
    }
    const json = await httpsGetJson(`https://api.github.com/repos/${TAGS_REPO}/tags?per_page=50`);
    const cmp = (a, b) => {
      const pa = String(a).replace(/^v/i, '').split('.').map(Number);
      const pb = String(b).replace(/^v/i, '').split('.').map(Number);
      for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
      return 0;
    };
    const list = (Array.isArray(json) ? json : [])
      .map((t) => String((t && t.name) || ''))
      .filter((n) => /^v?\d+\.\d+\.\d+$/.test(n))
      .sort(cmp)
      .slice(0, 30);
    if (list.length) tagsCache = { at: now, list };
    res.json({ success: true, cached: false, tags: list });
  } catch (e) {
    if (tagsCache.list.length) {
      return res.json({ success: true, cached: true, stale: true, tags: tagsCache.list });
    }
    res.status(502).json({ success: false, error: 'تعذّر جلب قائمة الإصدارات من GitHub: ' + e.message });
  }
});

// GET/PUT /auto-schedule — إعدادات التحديث التلقائي المجدول (v2.25.0) في
// <dataDir>/auto-update.json (نمط backup-schedule.json). ملف الخدمة فقط؛ الحلقة
// في services/auto-update.service.js.
router.get('/auto-schedule', requireAuth, (req, res) => {
  try {
    const cfg = require('../services/auto-update.service').readSchedule();
    return res.json({ success: true, data: cfg });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});
router.put('/auto-schedule', requireAuth, (req, res) => {
  try {
    const body = req.body || {};
    const hour = String(body.hour || '03:30').trim();
    if (!/^\d{2}:\d{2}$/.test(hour)) return res.status(400).json({ success: false, error: 'الساعة بصيغة HH:MM' });
    require('../services/auto-update.service').writeSchedule({ enabled: !!body.enabled, hour });
    return res.json({ success: true, data: { enabled: !!body.enabled, hour } });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
// v2.25.0 — قفل التزامن مُصدَّر ليستخدمه auto-update.service (تشغيل واحد عبر كل المسارات).
module.exports.recentActiveUpdate = recentActiveUpdate;
