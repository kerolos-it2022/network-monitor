// sources.routes.js (v2.5.0 — STUB لِـ المرحلة 2)
// ─────────────────────────────────────────────────────────────
// العَمَل المُتوقَّع في المرحلة 2 (v2.6.0):
//  - جدول `external_sources` + `external_devices` (مُضاف بالفعل بِـ migration في db.js).
//  - POST GET PUT DELETE /api/sources — إدارة المَصادر.
//  - POST /api/sources/:id/test — اختبار الاتصال (MikroTik / Sophos / SNMP / LLDP).
//  - POST /api/sources/:id/sync — سَحب فوري للأَجهزة.
//
// في v2.5.0 الحالي، نُوفِّر stub خَفيف يَردّ برسالة واضحة "غير مُتاح بَعد".
// هذا يُمكّن الواجهة من استدعاء الـ endpoint دون فَشل (UX أفضل) حتى يُنفَّذ في v2.6.0.
// ─────────────────────────────────────────────────────────────
const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');

// GET /api/sources — قائمة المَصادر (لِـ المرحلة 2: يَقرأ من external_sources).
router.get('/', requireAuth, (req, res) => {
  // STUB: نَردّ قائمة فارغة مع عَلَم stub ليَعرف frontend أَنّه غير مُفعّل بَعد.
  res.json({
    success: true,
    data: [],
    stub: true,
    message: 'دَعم المَصادر الخارجية (MikroTik/Sophos/SNMP/LLDP) سيُتاح في v2.6.0.',
  });
});

// POST /api/sources — إضافة مَصدر (لِـ المرحلة 2).
router.post('/', requireAuth, (req, res) => {
  res.status(501).json({
    success: false,
    stub: true,
    error: 'إضافة المَصادر الخارجية غير مُتاحة بَعد في v2.5.0. أَنتظر v2.6.0.',
  });
});

// POST /api/sources/:id/test — اختبار الاتصال (لِـ المرحلة 2).
router.post('/:id/test', requireAuth, (req, res) => {
  res.status(501).json({
    success: false,
    stub: true,
    error: 'اختبار المَصادر غير مُتاح بَعد في v2.5.0.',
  });
});

// POST /api/sources/:id/sync — سَحب فوري (لِـ المرحلة 2).
router.post('/:id/sync', requireAuth, (req, res) => {
  res.status(501).json({
    success: false,
    stub: true,
    error: 'مَزامنة المَصادر غير مُتاحة بَعد في v2.5.0.',
  });
});

module.exports = router;
