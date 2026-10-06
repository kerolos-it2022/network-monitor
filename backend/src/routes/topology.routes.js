// topology.routes.js: سلسلة الشبكة (Topology chain) — الأجهزة بترتيب المسار وحالاتها
// مع تمييز نقطة الانقطاع: جهاز منقطع وأبوه متصل = العيب فيه؛ الأب منقطع = الفرع مسدود عبره.
const express = require('express');
const router = express.Router();
// عام بدون requireAuth: نفس بيانات لوحة العرض العامة (أسماء/IPات/حالات فقط).
const db = require('../db');

// GET /api/topology (عام) — يعيد جذور السلسلة (كل جهاز مع أبنائه) وحالاتها.
router.get('/', (req, res) => {
  const devices = db.prepare(`
    SELECT d.id, d.name, d.ip, d.current_status, d.parent_id, d.is_active,
           d.device_type_id, dt.name AS device_type_name
    FROM devices d
    LEFT JOIN device_types dt ON dt.id = d.device_type_id
    ORDER BY d.name COLLATE NOCASE
  `).all();

  const byId = new Map();
  for (const d of devices) {
    byId.set(d.id, {
      id: d.id,
      name: d.name,
      ip: d.ip,
      device_type_name: d.device_type_name || null,
      status: d.is_active ? (d.current_status || 'unknown') : 'paused',
      parent_id: d.parent_id || null,
      children: [],
    });
  }

  const roots = [];
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  // تمييز انقطاع المسار تنازليًا: ابن تحت أب منقطع = مسدود عبر الأب حتى لو هو نفسه استجاب.
  function markPathDown(node, parentDown) {
    if (parentDown && node.status !== 'offline' && node.status !== 'paused') {
      node.pathDown = true;
    }
    for (const c of node.children) markPathDown(c, parentDown || node.status === 'offline');
  }
  for (const r of roots) markPathDown(r, false);

  res.json({ success: true, data: roots });
});

module.exports = router;
