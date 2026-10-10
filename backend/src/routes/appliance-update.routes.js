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
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');

// مسار المساعد (قابل للتجاوز بمتغيّر بيئة للاختبار فقط).
const APPLIANCE_HELPER = process.env.APPLIANCE_HELPER_PATH || '/usr/local/sbin/nm-update';
// semver صارم: v1.2.3 أو 1.2.3 مع لاحقة اختيارية — لا مسافات ولا رموز shell.
const TAG_RE = /^v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.]*)?$/;
const STATE_SUBDIR = 'update';

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

module.exports = router;
