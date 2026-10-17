// integrations.routes.js (SpaceKit Phase 3) — تكاملات اختيارية للقراءة فقط (معطّلة افتراضيًّا).
//   GET  /api/integrations/capabilities        🔐 ما هو متاح فعلًا (SNMP + حالة) — بلا أسرار
//   GET  /api/integrations/snmp/settings       🔒 إعدادات SNMP العامة
//   PUT  /api/integrations/snmp/settings       🔒 تعديلها (opt-in صريح)
//   GET  /api/integrations/snmp/targets        🔒 الأهداف (الأسرار مقنّعة دائمًا)
//   PUT  /api/integrations/snmp/targets/:deviceId  🔒 إنشاء/تعديل هدف لجهاز
//   DELETE /api/integrations/snmp/targets/:deviceId 🔒 حذف هدف + بياناته
//   POST /api/integrations/snmp/poll/:deviceId 🔒 استطلاع فوري (قراءة فقط)
//   GET  /api/integrations/snmp/interfaces/:deviceId 🔒 واجهات مخزَّنة + معدّلات
'use strict';
const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const audit = require('../services/audit.service');
const snmp = require('../services/integrations/snmp.service');
const connectors = require('../services/integrations/connector-base.service');
const synology = require('../services/integrations/synology.service');
const db = require('../db');

const router = express.Router();
const adminOnly = [requireAuth, requireRole('admin')];

// GET /api/integrations/capabilities — يتيح للواجهة إظهار «ما هو متاح» بصدق (بلا مبالغة).
router.get('/capabilities', requireAuth, (req, res) => {
  const s = snmp.getSettings();
  res.json({
    success: true,
    data: {
      snmp: {
        available: true,
        enabled: !!s.enabled,
        allow_v2c: !!s.allow_v2c,
        interval_seconds: s.interval_seconds,
        note: 'قراءة فقط (ifOperStatus/حجم/أخطاء) — معطّل حتى يفعّله المالك صراحةً.',
      },
      // INT-01..03 — كل موصل بحالته الحقيقية: معطّل/ناقص/مُتحقَّق — بلا ادّعاء دعم.
      connectors: connectors.capabilitiesReport(),
    },
  });
});

// ── INT-01..03 — إعداد/فحص موصلات القراءة فقط ──
// GET /api/integrations/connectors — القائمة (الأسرار مقنّعة)
router.get('/connectors', adminOnly, (req, res) => {
  res.json({ success: true, data: connectors.listSettings() });
});

// PUT /api/integrations/connectors/:kind — حفظ الإعداد (opt-in + تفضيلات)
router.put('/connectors/:kind', adminOnly, (req, res) => {
  const kind = String(req.params.kind || '').toLowerCase();
  const result = connectors.saveSettings(kind, req.body || {});
  if (!result.ok) return res.status(400).json({ success: false, error: result.error });
  audit.record('connector_settings_saved', req, {
    target: 'connector:' + kind,
    details: { enabled: result.settings.enabled, base_url: connectors.sanitizeUrl(result.settings.base_url || ''), owner_verified: result.settings.owner_verified },
  });
  res.json({ success: true, data: result.settings });
});

// POST /api/integrations/connectors/:kind/probe — فحص قدرات (قراءة فقط)
router.post('/connectors/:kind/probe', adminOnly, async (req, res) => {
  const kind = String(req.params.kind || '').toLowerCase();
  const result = await connectors.probe(kind);
  audit.record('connector_probed', req, { target: 'connector:' + kind, details: { ok: result.ok, state: result.capabilities ? result.capabilities.summary : result.error } });
  if (!result.ok) return res.status(502).json({ success: false, error: result.error });
  res.json({ success: true, data: result.capabilities });
});

// GET /api/integrations/synology/storage — قراءة صحة التخزين (قراءة فقط)
router.get('/synology/storage', requireAuth, async (req, res) => {
  const result = await synology.readStorageHealth();
  if (!result.ok) return res.status(502).json({ success: false, error: result.error });
  res.json({ success: true, data: { volumes: result.volumes, disks: result.disks, smart_supported: result.smart_supported, at: result.at } });
});

// GET /api/integrations/snmp/settings
router.get('/snmp/settings', adminOnly, (req, res) => {
  const s = snmp.getSettings();
  res.json({ success: true, data: { enabled: !!s.enabled, allow_v2c: !!s.allow_v2c, interval_seconds: s.interval_seconds } });
});

// PUT /api/integrations/snmp/settings { enabled, allow_v2c, interval_seconds }
router.put('/snmp/settings', adminOnly, (req, res) => {
  const b = req.body || {};
  const interval = Number(b.interval_seconds);
  const seconds = Number.isInteger(interval) && interval >= 30 && interval <= 3600 ? interval : 60;
  db.prepare('UPDATE snmp_settings SET enabled = ?, allow_v2c = ?, interval_seconds = ? WHERE id = 1').run(
    b.enabled ? 1 : 0,
    b.allow_v2c ? 1 : 0,
    seconds
  );
  audit.record('snmp_settings_change', req, { target: 'snmp_settings', details: { enabled: !!b.enabled, allow_v2c: !!b.allow_v2c, interval_seconds: seconds } });
  const s = snmp.getSettings();
  res.json({ success: true, data: { enabled: !!s.enabled, allow_v2c: !!s.allow_v2c, interval_seconds: s.interval_seconds } });
});

// GET /api/integrations/snmp/targets
router.get('/snmp/targets', adminOnly, (req, res) => {
  res.json({ success: true, data: snmp.listTargets() });
});

// PUT /api/integrations/snmp/targets/:deviceId
router.put('/snmp/targets/:deviceId', adminOnly, (req, res) => {
  const deviceId = Number(req.params.deviceId);
  if (!Number.isInteger(deviceId) || deviceId <= 0) return res.status(400).json({ success: false, error: 'معرّف جهاز غير صالح' });
  const result = snmp.upsertTarget(deviceId, req.body || {});
  if (!result.ok) return res.status(400).json({ success: false, error: result.error });
  // التدقيق يذكر فقط ما ليس سرًّا (الإصدار/الاسم/التفعيل).
  audit.record('snmp_target_saved', req, {
    target: `device:${deviceId}`,
    details: { version: result.target.version, enabled: result.target.enabled, security_name: result.target.security_name },
  });
  res.json({ success: true, data: result.target });
});

// DELETE /api/integrations/snmp/targets/:deviceId
router.delete('/snmp/targets/:deviceId', adminOnly, (req, res) => {
  const deviceId = Number(req.params.deviceId);
  const result = snmp.removeTarget(deviceId);
  audit.record('snmp_target_removed', req, { target: `device:${deviceId}`, details: { removed: result.removed } });
  res.json({ success: true, data: result });
});

// POST /api/integrations/snmp/poll/:deviceId — استطلاع فوري (قراءة فقط، بلا أي كتابة على الجهاز)
router.post('/snmp/poll/:deviceId', adminOnly, async (req, res) => {
  const deviceId = Number(req.params.deviceId);
  if (!Number.isInteger(deviceId) || deviceId <= 0) return res.status(400).json({ success: false, error: 'معرّف جهاز غير صالح' });
  const result = await snmp.pollDevice(deviceId);
  audit.record('snmp_poll', req, { target: `device:${deviceId}`, details: { ok: result.ok, interfaces: result.interfaces || 0 } });
  if (!result.ok) return res.status(502).json({ success: false, error: result.error });
  res.json({ success: true, data: result });
});

// GET /api/integrations/snmp/interfaces/:deviceId
router.get('/snmp/interfaces/:deviceId', requireAuth, (req, res) => {
  const deviceId = Number(req.params.deviceId);
  if (!Number.isInteger(deviceId) || deviceId <= 0) return res.status(400).json({ success: false, error: 'معرّف جهاز غير صالح' });
  res.json({ success: true, data: snmp.listInterfaces(deviceId) });
});

module.exports = router;
