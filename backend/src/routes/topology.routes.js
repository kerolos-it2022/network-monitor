// topology.routes.js: سلسلة الشبكة (Topology) — العرض + حفظ التخطيط المرسوم.
// GET /api/topology        (عام)  — الشجرة + المواضع المحفوظة + تمييز انقطاع المسار.
// POST /api/topology/layout 🔒 — حفظ مواضع البطاقات التي رسمها الأدمن (تظهر كما هي في NOC).
// v2.8.7 — منطق بناء الشجرة انتقل إلى services/topology.service.js ليكون مشتركًا مع
//          بثّ SSE الحيّ (live.service.js) بنفس المنطق تمامًا (شجرة + pathDown) بلا ازدواج.
const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const db = require('../db');
const { buildTopology } = require('../services/topology.service');
const { uiText } = require('../services/ui-text.service');

// GET /api/topology 🔒 (SEC-02) — كان عامًّا ويكشف IP/بنية الشبكة الداخلية.
// صار يتطلب تسجيل دخول؛ الشاشات العامة تستعمل GET /api/public/topology المنقّى.
router.get('/', requireAuth, (req, res) => {
  res.json({ success: true, data: buildTopology() });
});

// POST /api/topology/layout 🔒 — حفظ مواضع البطاقات (x/y) المرسومة في وضع الرسم.
router.post('/layout', requireAuth, (req, res) => {
  const layout = Array.isArray(req.body && req.body.layout) ? req.body.layout : null;
  if (!layout || !layout.length) {
    return res.status(400).json({ success: false, error: uiText('لا توجد مواضع في الطلب', 'No positions in the request') });
  }
  // v2.8.2 — حفظ موحد: 'L<id>' = موقع (locations.pos_x/pos_y)، رقم أو 'D<id>' = جهاز.
  const updDev = db.prepare('UPDATE devices SET pos_x = ?, pos_y = ? WHERE id = ?');
  const updLoc = db.prepare('UPDATE locations SET pos_x = ?, pos_y = ? WHERE id = ?');
  const norm = (v) => (v === null || v === undefined || v === '') ? null
    : Number.isFinite(Number(v)) ? Math.round(Number(v)) : null;
  const tx = db.transaction((items) => {
    for (const it of items) {
      const x = norm(it.pos_x);
      const y = norm(it.pos_y);
      const rawId = String(it.id == null ? '' : it.id);
      // v2.8.3 guard — (0,0) ممنوع: نتيجة صفحة قديمة/تحميل ناقص، وبتتراكب كل الكروت فوق بعض.
      if (x === 0 && y === 0) continue;
      if (rawId[0] === 'L') {
        const lid = Number(rawId.slice(1));
        if (Number.isInteger(lid) && lid > 0) updLoc.run(x, y, lid);
        continue;
      }
      const id = Number(rawId[0] === 'D' ? rawId.slice(1) : rawId);
      if (Number.isInteger(id) && id > 0) updDev.run(x, y, id);
    }
  });
  tx(layout);
  res.json({ success: true, saved: layout.length });
});

module.exports = router;
