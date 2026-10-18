// settings.routes.js ( SEC-02) — إعدادات عامة يملكها المدير.
// أول إعداد: وضع العرض العام public_display_mode (lan | minimal | off).
// القراءة والكتابة للمدير فقط — والكتابة تُسجَّل في سجل التدقيق لاحقًا (SEC-03).
'use strict';
const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const pd = require('../services/public-display.service');
const toolsPolicy = require('../services/tools-policy.service');
// لغة واجهة النظام (عربي/إنجليزي) — إعداد واحد للوحة والصفحة العامة وNOC.
const uiLang = require('../services/ui-language.service');
// لغة الإشعارات المُرسَلة وسجل الإشعارات — إعداد مستقل (زرّه في شاشة الإشعارات).
const ntfLang = require('../services/notification-language.service');
// SEC-03 — تغييرات الإعدادات تُسجَّل في سجل التدقيق.
const audit = require('../services/audit.service');
const { uiText } = require('../services/ui-text.service');

const router = express.Router();
const adminOnly = [requireAuth, requireRole('admin')];

// GET /api/settings/public-display — الوضع الحالي + مصدره (قاعدة/بيئة/افتراضي).
router.get('/public-display', adminOnly, (req, res) => {
  res.json({
    success: true,
    data: {
      mode: pd.getMode(),
      source: pd.getModeSource(),
      allowed: pd.MODES,
      env_var: 'NM_PUBLIC_DISPLAY',
      description: {
        lan: uiText('الحقول الآمنة + بنية العرض (بلا أي IP/MAC) — مناسب لشبكة داخلية.',
          'Safe fields + display structure (no IP/MAC at all) — suitable for an internal network.'),
        minimal: uiText('الحقول الآمنة فقط بلا شجرة/إحداثيات — مقترح عند النشر العام (ngrok).',
          'Safe fields only, no tree/coordinates — recommended for public deployment (ngrok).'),
        off: uiText('إيقاف العرض العام بالكامل — الواجهات العامة تُعيد 403.',
          'Disable public display entirely — public endpoints return 403.'),
      },
    },
  });
});

// PUT /api/settings/public-display { mode: 'lan'|'minimal'|'off' }
router.put('/public-display', adminOnly, (req, res) => {
  const result = pd.setMode(req.body && req.body.mode);
  if (!result.ok) {
    return res.status(400).json({ success: false, error: result.error });
  }
  audit.record('settings_change', req, { target: 'public_display_mode', details: { mode: result.mode } });
  // v2.33.0 — احترام الإعداد لحظيًّا: خطوط البثّ (SSE) المفتوحة تُغلق فورًا عند الوضع 'off'
  // بدل أن تظلّ تبثّ حتى يقفل الزائر تابعه. نُبلّغ العدد المُغلق للمالك في الردّ نفسه.
  let closedStreams = 0;
  try { closedStreams = require('../services/live.service').applyPolicyNow(); } catch (e) { closedStreams = 0; }
  res.json({ success: true, data: { mode: result.mode, closed_streams: closedStreams } });
});

// ─────────────────────────────────────────────────────────────
// شاشة NOC الداخلية: هل تُعرض عناوين IP للجلسات الإدارية؟
// GET/PUT /api/settings/noc-display  (المدير فقط)
// GET /api/settings/noc-mode        (بلا مصادقة — تُقرأ من شاشة NOC لتعرف أي مسار
//   تستعمل: 'full' فقط إن كان الإعداد مفعّلًا **والجلسة مدير**، وإلا 'sanitized'.)
// ─────────────────────────────────────────────────────────────
router.get('/noc-display', adminOnly, (req, res) => {
  res.json({
    success: true,
    data: {
      mode: pd.getNocMode(),
      allowed: ['full', 'off'],
      description: {
        full: uiText('الصفحة العامة وشاشة NOC تعرضان العناوين لأي مستخدم مسجَّل (مدير أو عرض) — والزوار بلا جلسة لا يرونها إطلاقًا. (الافتراضي)',
          'The public page and the NOC screen show addresses to any logged-in user (admin or viewer) — visitors without a session never see them. (default)'),
        off: uiText('الشاشتان تعرضان الحالة بلا عناوين حتى للمسجّلين (مفيد لشاشة معلّقة في مكان عام).',
          'Both screens show status without addresses, even for logged-in users (useful for a screen mounted in a public place).'),
      },
    },
  });
});

router.put('/noc-display', adminOnly, (req, res) => {
  const result = pd.setNocMode(req.body && req.body.mode);
  if (!result.ok) return res.status(400).json({ success: false, error: result.error });
  audit.record('settings_change', req, { target: 'noc_internal_full', details: { mode: result.mode } });
  res.json({ success: true, data: { mode: result.mode } });
});

// ─────────────────────────────────────────────────────────────
// 🌐 لغة الواجهة (ar | en) — إعداد واحد للوحة والصفحة العامة وشاشة NOC.
//   GET  /api/settings/ui-language  (بلا مصادقة: صفحة الدخول والصفحة العامة تحتاج معرفتها قبل الدخول)
//   PUT  /api/settings/ui-language  (المدير فقط + تدقيق)
// ملاحظة: القيمة تخصّ **لغة الواجهة** فقط — لا تلمس بيانات المستخدم ولا القيم البرمجية.
// ─────────────────────────────────────────────────────────────
router.get('/ui-language', (req, res) => {
  res.json({
    success: true,
    data: {
      ui_language: uiLang.getLang(),
      source: uiLang.getLangSource(),
      allowed: uiLang.LANGS,
      env_var: 'NM_UI_LANGUAGE',
    },
  });
});

router.put('/ui-language', adminOnly, (req, res) => {
  const result = uiLang.setLang(req.body && (req.body.ui_language || req.body.lang));
  if (!result.ok) return res.status(400).json({ success: false, error: result.error });
  audit.record('settings_change', req, { target: 'ui_language', details: { ui_language: result.lang } });
  res.json({ success: true, data: { ui_language: result.lang } });
});

// ─────────────────────────────────────────────────────────────
// 🔔 لغة الإشعارات المُرسَلة وسجل الإشعارات (ar | en) — إعداد مستقل عن لغة الواجهة.
//   GET  /api/settings/notification-language  (أي جلسة: شاشة الإشعارات تحتاج معرفتها للعرض)
//   PUT  /api/settings/notification-language  (المدير فقط + تدقيق)
// لماذا على الخادم؟ الرسائل تُبنى وتُرسَل من الخادم وقد لا يكون أي متصفح مفتوحًا
// (جهاز يقع بعد منتصف الليل) — فاختيار المتصفح وحده لا يكفي ليتّبع الإرسالُ اللغةَ المختارة.
// ─────────────────────────────────────────────────────────────
router.get('/notification-language', requireAuth, (req, res) => {
  res.json({
    success: true,
    data: {
      notification_language: ntfLang.getLang(),
      source: ntfLang.getLangSource(),
      allowed: ntfLang.LANGS,
      env_var: ntfLang.ENV_VAR,
    },
  });
});

router.put('/notification-language', adminOnly, (req, res) => {
  const result = ntfLang.setLang(req.body && (req.body.notification_language || req.body.lang));
  if (!result.ok) return res.status(400).json({ success: false, error: result.error });
  audit.record('settings_change', req, {
    target: 'notification_language',
    details: { notification_language: result.lang },
  });
  res.json({ success: true, data: { notification_language: result.lang } });
});

// ─────────────────────────────────────────────────────────────
// 🛠️ سياسة أدوات التشخيص (Ping/Tracert) — من اللوحة بدل .env، مع تدقيق.
//   GET/PUT /api/settings/tools-policy
//   min_role: admin|viewer · allow_public: 0|1 · allowed_cidrs: قائمة CIDR (فارغة = الخاص فقط)
// ─────────────────────────────────────────────────────────────
router.get('/tools-policy', adminOnly, (req, res) => {
  const p = toolsPolicy.getToolsPolicy();
  res.json({
    success: true,
    data: {
      min_role: p.minRole,
      allow_public: p.allowPublic ? 1 : 0,
      allowed_cidrs: p.allowedCidrs,
      source: p.source,
      effective: {
        who_can_use: p.minRole === 'viewer'
          ? uiText('أي مستخدم مسجَّل (مدير أو عرض)', 'Any logged-in user (admin or viewer)')
          : uiText('المدير فقط', 'Admin only'),
        targets: p.allowPublic
          ? uiText('أي عنوان (عام أو خاص) للمستخدمين المسجّلين', 'Any address (public or private) for logged-in users')
          : (p.allowedCidrs
            ? uiText('النطاقات المخصّصة فقط: ', 'Custom ranges only: ') + p.allowedCidrs
            : uiText('الشبكات الخاصة فقط (10.x · 172.16-31.x · 192.168.x · 127.x · IPv6 محلي)', 'Private networks only (10.x · 172.16-31.x · 192.168.x · 127.x · local IPv6)')),
        anonymous: uiText('ممنوع دائمًا (401)', 'Always forbidden (401)'),
      },
    },
  });
});

router.put('/tools-policy', adminOnly, (req, res) => {
  const result = toolsPolicy.saveToolsPolicy(req.body || {});
  if (!result.ok) return res.status(400).json({ success: false, error: result.error });
  audit.record('tools_policy_change', req, {
    target: 'tools_policy',
    details: { min_role: result.policy.minRole, allow_public: result.policy.allowPublic, allowed_cidrs: result.policy.allowedCidrs || null },
  });
  res.json({ success: true, data: { min_role: result.policy.minRole, allow_public: result.policy.allowPublic ? 1 : 0, allowed_cidrs: result.policy.allowedCidrs } });
});

// بلا requireAuth: تُرجع فقط الوضع الفعلي **لهذا الطلب** (تُستخدم من shashet NOC).
router.get('/noc-mode', (req, res) => {
  // ui_language يُرفَق هنا أيضًا: شاشة NOC تقرأ هذا المسار أصلًا فتضبط لغتها بلا طلب إضافي.
  res.json({ success: true, data: { mode: pd.resolveNocMode(req), ui_language: uiLang.getLang() } });
});

module.exports = router;
