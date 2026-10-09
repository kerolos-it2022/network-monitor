// topology.routes.js: سلسلة الشبكة (Topology) — العرض + حفظ التخطيط المرسوم.
// GET /api/topology        (عام)  — الشجرة + المواضع المحفوظة + تمييز انقطاع المسار.
// POST /api/topology/layout 🔒 — حفظ مواضع البطاقات التي رسمها الأدمن (تظهر كما هي في NOC).
const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const db = require('../db');

// GET /api/topology (عام) — يعيد الجذور (كل جهاز مع أبنائه) وحالاتها ومواضعها.
// v2.8.2 — الشجرة الموحدة:
//   • عقدة نوع 'location' = موقع/مبنى — الشجرة تُبنى من parent_id (علاقة واحدة موحدة)، وتحتها:
//     المواقع الأبناء (parent_id) + الأجهزة المتصلة به (parent_location_id) + الأجهزة ذات parent_id.
//   • عقدة نوع 'device' = جهاز — أبوه جهاز (parent_id) أو موقع (parent_location_id).
//   الأولوية للأب الجهاز؛ لو فاضي يعلق تحت الموقع؛ لو الاتنين فاضي = جذر.
router.get('/', (req, res) => {
  const locs = db.prepare(`
    SELECT id, name, kind, parent_id, pos_x, pos_y
    FROM locations
    ORDER BY sort_order ASC, id ASC
  `).all();

  const devices = db.prepare(`
    SELECT d.id, d.name, d.ip, d.current_status, d.parent_id, d.location_id, d.is_active,
           d.pos_x, d.pos_y, d.device_type_id, dt.name AS device_type_name
    FROM devices d
    LEFT JOIN device_types dt ON dt.id = d.device_type_id
    ORDER BY d.name COLLATE NOCASE
  `).all();

  // عقد المواقع — مع سلسلة المباني عبر upstream_location_id.
  const locById = new Map();
  for (const l of locs) {
    locById.set(l.id, {
      type: 'location',
      id: 'L' + l.id,
      location_id: l.id,
      name: l.name,
      kind: l.kind || 'zone',
      status: null,
      parent_id: l.parent_id || null,
      pos_x: l.pos_x == null ? null : Number(l.pos_x),
      pos_y: l.pos_y == null ? null : Number(l.pos_y),
      children: [],
    });
  }

  // عقد الأجهزة.
  const byId = new Map();
  for (const d of devices) {
    byId.set(d.id, {
      type: 'device',
      id: d.id,
      name: d.name,
      ip: d.ip,
      device_type_name: d.device_type_name || null,
      status: d.is_active ? (d.current_status || 'unknown') : 'paused',
      parent_id: d.parent_id || null,
      location_id: d.location_id || null,
      pos_x: d.pos_x == null ? null : Number(d.pos_x),
      pos_y: d.pos_y == null ? null : Number(d.pos_y),
      children: [],
    });
  }

  const roots = [];

  // 1) شجرة المواقع من parent_id — علاقة واحدة موحدة (جغرافية وشبكية معًا):
  //    المبنى الإداري ← الدور الثالث، البوفية ← الورشة-1... الخ.
  for (const node of locById.values()) {
    const p = node.parent_id ? locById.get(node.parent_id) : null;
    if (p && p !== node) { p.children.push(node); continue; }
    roots.push(node); // جذر (internet أو موقع مستقل).
  }

  // 2) الأجهزة: الأولوية للأب الجهاز، ثم الموقع الأب، ثم جذر.
  for (const node of byId.values()) {
    if (node.parent_id) {
      const p = byId.get(node.parent_id);
      if (p) { p.children.push(node); continue; }
    }
    if (node.location_id) {
      const loc = locById.get(node.location_id);
      if (loc) { loc.children.push(node); continue; }
    }
    roots.push(node);
  }

  // تمييز انقطاع المسار تنازليًا: ابن تحت أب منقطع = مسدود عبر الأب (حتى لو هو استجاب).
  // عقد المواقع لا تُعلَّم pathDown إلا إذا سبقها انقطاع (تمرير الحالة فقط).
  function markPathDown(nodes, parentDown) {
    for (const n of nodes) {
      const pd = parentDown || n.status === 'offline';
      if (n.type === 'device') {
        n.pathDown = !!(pd && n.status !== 'offline' && n.status !== 'paused');
      }
      if (n.children && n.children.length) markPathDown(n.children, pd);
    }
  }
  markPathDown(roots, false);

  res.json({ success: true, data: roots });
});

// POST /api/topology/layout 🔒 — حفظ مواضع البطاقات (x/y) المرسومة في وضع الرسم.
router.post('/layout', requireAuth, (req, res) => {
  const layout = Array.isArray(req.body && req.body.layout) ? req.body.layout : null;
  if (!layout || !layout.length) {
    return res.status(400).json({ success: false, error: 'لا توجد مواضع في الطلب' });
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
