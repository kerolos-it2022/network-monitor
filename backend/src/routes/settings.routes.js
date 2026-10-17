// settings.routes.js (SpaceKit SEC-02) — إعدادات عامة يملكها المدير.
// أول إعداد: وضع العرض العام public_display_mode (lan | minimal | off).
// القراءة والكتابة للمدير فقط — والكتابة تُسجَّل في سجل التدقيق لاحقًا (SEC-03).
'use strict';
const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const pd = require('../services/public-display.service');
// SEC-03 — تغييرات الإعدادات تُسجَّل في سجل التدقيق.
const audit = require('../services/audit.service');

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
        lan: 'الحقول الآمنة + بنية العرض (بلا أي IP/MAC) — مناسب لشبكة داخلية.',
        minimal: 'الحقول الآمنة فقط بلا شجرة/إحداثيات — مقترح عند النشر العام (ngrok).',
        off: 'إيقاف العرض العام بالكامل — الواجهات العامة تُعيد 403.',
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
  res.json({ success: true, data: { mode: result.mode } });
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
        full: 'الصفحة العامة وشاشة NOC تعرضان العناوين لأي مستخدم مسجَّل (مدير أو عرض) — والزوار بلا جلسة لا يرونها إطلاقًا. (الافتراضي)',
        off: 'الشاشتان تعرضان الحالة بلا عناوين حتى للمسجّلين (مفيد لشاشة معلّقة في مكان عام).',
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

// بلا requireAuth: تُرجع فقط الوضع الفعلي **لهذا الطلب** (تُستخدم من shashet NOC).
router.get('/noc-mode', (req, res) => {
  res.json({ success: true, data: { mode: pd.resolveNocMode(req) } });
});

module.exports = router;
