// services.routes.js (SpaceKit MON-02) — إدارة الخدمات المراقَبة لكل جهاز.
//   GET    /api/devices/:deviceId/services        🔐 قراءة (أي جلسة)
//   POST   /api/devices/:deviceId/services        🔒 إنشاء (المدير)
//   PUT    /api/devices/:deviceId/services/:id    🔒 تعديل (المدير)
//   DELETE /api/devices/:deviceId/services/:id    🔒 حذف (المدير)
// كل التعديلات تُسجَّل في سجل التدقيق (SEC-03). كل المدخلات مُتحقَّق منها في الخدمة.
'use strict';
const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const audit = require('../services/audit.service');
const svc = require('../services/monitored-services.service');

const router = express.Router({ mergeParams: true });
const adminOnly = [requireAuth, requireRole('admin')];

function deviceIdOf(req) {
  const id = Number(req.params.deviceId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.get('/', requireAuth, (req, res) => {
  const deviceId = deviceIdOf(req);
  if (!deviceId) return res.status(400).json({ success: false, error: 'معرّف جهاز غير صالح' });
  if (!svc.deviceExists(deviceId)) return res.status(404).json({ success: false, error: 'الجهاز غير موجود' });
  res.json({ success: true, data: svc.listByDevice(deviceId) });
});

router.post('/', adminOnly, (req, res) => {
  const deviceId = deviceIdOf(req);
  if (!deviceId) return res.status(400).json({ success: false, error: 'معرّف جهاز غير صالح' });
  const result = svc.createForDevice(deviceId, req.body);
  if (!result.ok) {
    const status = result.error === 'الجهاز غير موجود' ? 404 : 400;
    return res.status(status).json({ success: false, error: result.error });
  }
  audit.record('service_create', req, {
    target: `device:${deviceId}#service:${result.service.id}`,
    details: { name: result.service.name, kind: result.service.kind, port: result.service.port },
  });
  res.status(201).json({ success: true, data: result.service });
});

router.put('/:id', adminOnly, (req, res) => {
  const deviceId = deviceIdOf(req);
  const id = Number(req.params.id);
  if (!deviceId || !Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: 'معرّف غير صالح' });
  }
  const existing = svc.getById(id);
  if (!existing || existing.device_id !== deviceId) {
    return res.status(404).json({ success: false, error: 'الخدمة غير موجودة على هذا الجهاز' });
  }
  const result = svc.updateById(id, req.body);
  if (!result.ok) return res.status(400).json({ success: false, error: result.error });
  audit.record('service_update', req, { target: `service:${id}`, details: { fields: Object.keys(req.body || {}) } });
  res.json({ success: true, data: result.service });
});

router.delete('/:id', adminOnly, (req, res) => {
  const deviceId = deviceIdOf(req);
  const id = Number(req.params.id);
  const existing = Number.isInteger(id) ? svc.getById(id) : null;
  if (!existing || existing.device_id !== deviceId) {
    return res.status(404).json({ success: false, error: 'الخدمة غير موجودة على هذا الجهاز' });
  }
  const result = svc.removeById(id);
  if (!result.ok) return res.status(400).json({ success: false, error: result.error });
  svc.recomputeOverallHealth(existing.device_id);
  audit.record('service_delete', req, { target: `service:${id}`, details: { name: existing.name } });
  res.json({ success: true, data: { id } });
});

module.exports = router;
