// incidents.routes.js ( RCA-01/02) — عرض الأعطال المرتبطة بالشجرة (قراءة فقط، بجلسة).
//   GET /api/incidents?status=open|all&limit=50
// يعرض: الجهاز الجذري المرشَّح، المستوى الثقة، زمن البداية/النهاية، وقائمة الأجهزة المتأثرة.
'use strict';
const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const incidents = require('../services/incidents.service');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  res.json({
    success: true,
    data: incidents.listIncidents({ status: req.query.status, limit: req.query.limit }),
    window_ms: incidents.rcaWindowMs(),
  });
});

module.exports = router;
