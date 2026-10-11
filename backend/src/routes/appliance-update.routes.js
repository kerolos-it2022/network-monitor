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

// POST /request — كتابة ملف طلب التحديث (وسم صريح أو «latest» — والأداة الجذرية هي التي تحلّها).
router.post('/request', requireAuth, (req, res) => {
  try {
    if (!isAppliance()) {
      return res.status(400).json({ success: false, error: 'وضع الأبلاينس غير مُفعَّل على هذا التثبيت.' });
    }
    const raw = String((req.body && req.body.tag) || '').trim();
    const tag = raw || 'latest';
    if (tag !== 'latest' && !TAG_RE.test(tag)) {
      return res.status(400).json({ success: false, error: 'وسم إصدار غير صالح (semver مثل v2.8.7 أو latest).' });
    }
    const p = paths();
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
    try { state = JSON.parse(fs.readFileSync(p.statusFile, 'utf8')); } catch (e) {}
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

module.exports = router;
