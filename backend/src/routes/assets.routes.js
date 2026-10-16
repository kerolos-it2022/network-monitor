// assets.routes.js (SpaceKit AST-01/02/03) — الأصول ذات الهوية الثابتة.
//   GET    /api/assets                                🔐 قائمة الأصول (asset_id + ملخص)
//   GET    /api/assets/conflicts                      🔐 تعارضات الهوية (مراجعة المدير)
//   POST   /api/assets/conflicts/:id/resolve          🔒 قرار المدير (approve|reject) + تدقيق
//   GET    /api/assets/:assetId                       🔐 تفاصيل أصل (واجهات + سجل IP + تعارضات)
//   POST   /api/assets/:assetId/interfaces            🔒 إضافة MAC يدويًّا + تدقيق
//   POST   /api/assets/:assetId/interfaces/:id/deactivate 🔒 إيقاف واجهة (بلا حذف تاريخي) + تدقيق
//   POST   /api/assets/:assetId/ip                    🔒 تسجيل عنوان (يدويًّا/موثّقًا) + تدقيق
// ملاحظة: كل الكتابات للمدير فقط، ولا يوجد أي مسار «دمج تلقائي» — الدمج بقرار صريح.
'use strict';
const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const audit = require('../services/audit.service');
const assets = require('../services/assets.service');
const db = require('../db');

const router = express.Router();
const adminOnly = [requireAuth, requireRole('admin')];

// GET /api/assets — قائمة مختصرة (لجدول الأصول في الواجهة).
router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT d.id AS device_id, d.asset_id, d.name, d.ip, d.is_active, d.current_status, d.host_status, d.overall_health,
            (SELECT COUNT(*) FROM device_interfaces i WHERE i.device_id = d.id AND i.is_active = 1) AS interfaces_active,
            (SELECT COUNT(*) FROM device_ip_history h WHERE h.device_id = d.id) AS ip_entries
       FROM devices d ORDER BY d.id ASC`
  ).all();
  res.json({ success: true, data: rows });
});

// GET /api/assets/conflicts — قائمة المراجعة (بلا أي دمج تلقائي).
router.get('/conflicts', requireAuth, (req, res) => {
  res.json({ success: true, data: assets.listConflicts({ status: req.query.status, limit: req.query.limit }) });
});

// POST /api/assets/conflicts/:id/resolve { action: 'approve'|'reject', note }
router.post('/conflicts/:id/resolve', adminOnly, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, error: 'معرّف تعارض غير صالح' });
  const body = req.body || {};
  const result = assets.resolveConflict(id, body.action, {
    actor: req.session.user.username,
    note: body.note ? String(body.note).slice(0, 500) : null,
  });
  if (!result.ok) return res.status(400).json({ success: false, error: result.error });
  audit.record('asset_conflict_resolved', req, {
    target: `conflict:${id}`,
    details: { action: result.status, applied: result.applied || null },
  });
  res.json({ success: true, data: result });
});

// GET /api/assets/:assetId — تفاصيل كاملة (يقبل NM-000123 أو الرقم الداخلي).
router.get('/:assetId', requireAuth, (req, res) => {
  const detail = assets.getAssetDetail(req.params.assetId);
  if (!detail) return res.status(404).json({ success: false, error: 'الأصل غير موجود' });
  res.json({ success: true, data: detail });
});

// POST /api/assets/:assetId/interfaces { mac, kind, notes }
router.post('/:assetId/interfaces', adminOnly, (req, res) => {
  const detail = assets.getAssetDetail(req.params.assetId);
  if (!detail) return res.status(404).json({ success: false, error: 'الأصل غير موجود' });
  const body = req.body || {};
  const result = assets.addInterface(detail.device_id, body.mac, {
    kind: body.kind || null,
    source: 'manual',
    confidence: 80,
    notes: body.notes ? String(body.notes).slice(0, 300) : null,
  });
  if (!result.ok) return res.status(400).json({ success: false, error: result.error });

  // AST-02 — إضافة MAC يدويًّا قد تنشئ تعارضًا مع أصل آخر ⇒ مراجعة لا دمج.
  let conflict = null;
  try {
    const obs = assets.observeDiscovery({ ip: detail.ip, mac: body.mac, source: 'manual' });
    if (obs.action === 'review') conflict = { id: obs.conflictId, kind: obs.kind };
  } catch (_) { /* المراجعة اختيارية */ }

  audit.record('asset_interface_added', req, {
    target: `asset:${detail.asset_id}`,
    details: { mac: assets.normalizeMac(body.mac), conflict },
  });
  res.status(201).json({ success: true, data: { id: result.id, reactivated: !!result.reactivated, conflict } });
});

// POST /api/assets/:assetId/interfaces/:id/deactivate — إيقاف بلا حذف (تاريخ محفوظ).
router.post('/:assetId/interfaces/:id/deactivate', adminOnly, (req, res) => {
  const detail = assets.getAssetDetail(req.params.assetId);
  if (!detail) return res.status(404).json({ success: false, error: 'الأصل غير موجود' });
  const ifaceId = Number(req.params.id);
  const result = assets.deactivateInterface(detail.device_id, ifaceId);
  if (!result.ok) return res.status(404).json({ success: false, error: result.error });
  audit.record('asset_interface_deactivated', req, { target: `asset:${detail.asset_id}`, details: { mac: result.mac } });
  res.json({ success: true, data: result });
});

// POST /api/assets/:assetId/ip { ip, source, confidence } — تسجيل عنوان في سجل الأصل.
router.post('/:assetId/ip', adminOnly, (req, res) => {
  const detail = assets.getAssetDetail(req.params.assetId);
  if (!detail) return res.status(404).json({ success: false, error: 'الأصل غير موجود' });
  const body = req.body || {};
  const result = assets.recordIp(detail.device_id, String(body.ip || '').trim(), {
    source: body.source ? String(body.source).slice(0, 20) : 'manual',
    confidence: Number.isInteger(body.confidence) ? Math.max(0, Math.min(100, body.confidence)) : 80,
  });
  if (!result.ok) return res.status(400).json({ success: false, error: result.error });
  audit.record('asset_ip_recorded', req, { target: `asset:${detail.asset_id}`, details: { ip: body.ip, changed: !!result.changed } });
  res.status(201).json({ success: true, data: result });
});

module.exports = router;
