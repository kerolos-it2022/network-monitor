// public.routes.js (SpaceKit SEC-02) — الواجهة العامة المنقّاة للزوار (بلا تسجيل دخول).
// ═══════════════════════════════════════════════════════════════════════════
// هذه هي البديل الصريح للمسارات الداخلية (/api/devices, /api/topology) التي صارت
// تتطلب تسجيل دخول. كل حقل هنا مُختار يدويًّا في public-display.service (قائمة بيضاء):
// لا IP · لا MAC · لا اسم مضيف · لا سيريال · لا منافذ · لا إعدادات فحص.
// وضع العرض (lan | minimal | off) يحدده المالك — انظر GET/PUT /api/settings/public-display.
'use strict';
const express = require('express');
const { buildTopology } = require('../services/topology.service');
const { listDevicesWithOutages, getDeviceById } = require('../services/device-query.service');
const { getDeviceHistory } = require('../services/history.service');
const pd = require('../services/public-display.service');

const router = express.Router();

// بوابة الوضع: 'off' ⇒ لا عرض عام إطلاقًا.
router.use((req, res, next) => {
  if (pd.getMode() === 'off') {
    return res.status(403).json({ success: false, error: 'العرض العام معطّل من إعدادات المالك' });
  }
  next();
});

// GET /api/public/status — قائمة الأجهزة المنقّاة (بديل GET /api/devices للصفحة العامة).
router.get('/status', (req, res) => {
  const mode = pd.getMode();
  const devices = listDevicesWithOutages().map((d) => pd.deviceDto(d, mode));
  res.json({
    success: true,
    data: devices,
    display_mode: mode,
    generated_at: new Date().toISOString(),
  });
});

// GET /api/public/devices/:id — بطاقة جهاز منقّاة.
router.get('/devices/:id', (req, res) => {
  const device = getDeviceById(req.params.id);
  if (!device) {
    return res.status(404).json({ success: false, error: 'الجهاز غير موجود' });
  }
  res.json({ success: true, data: pd.deviceDto(device, pd.getMode()) });
});

// GET /api/public/devices/:id/history?range=24h|7d|30d — سجل الحالة (لا يحوي أي بيانات اتصال).
router.get('/devices/:id/history', (req, res) => {
  const history = getDeviceHistory(req.params.id, req.query.range);
  if (!history) {
    return res.status(404).json({ success: false, error: 'الجهاز غير موجود' });
  }
  // HIST-01 — الحمولة كاملة: حقول قديمة (للتوافق) + دلالة التغطية وجودة البيانات.
  // كل الحقول آمنة للعرض العام (أزمنة وحالات فقط — بلا أي عنوان/منفذ/معرّف داخلي).
  res.json({ success: true, data: history });
});

// GET /api/public/topology — شجرة الشبكة للعرض (بديل GET /api/topology للشاشات العامة).
router.get('/topology', (req, res) => {
  const mode = pd.getMode();
  res.json({
    success: true,
    data: pd.sanitizeTopology(buildTopology(), mode),
    display_mode: mode,
    generated_at: new Date().toISOString(),
  });
});

module.exports = router;
