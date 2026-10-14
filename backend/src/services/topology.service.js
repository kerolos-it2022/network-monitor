// topology.service.js (v2.8.7) — باني شجرة الشبكة الموحّدة.
// ─────────────────────────────────────────────────────────────
// كان منطق بناء الشجرة داخل مسار GET /api/topology فقط. استُخرج إلى هذه الخدمة
// لِيُستعمل من مكانين بنفس المنطق تمامًا (بلا ازدواج):
//   1) مسار GET /api/topology (frontend/public/noc.html + admin-topology.js).
//   2) خدمة البثّ الحيّ SSE (live.service.js) لحساب «ما تغيّر» بعد كل دورة فحص.
// ملاحظة: لا تُغيّر أي قاعدة هنا دون مراجعة المسارين (الشجرة + التمييز pathDown).
const db = require('../db');

// buildTopology(): يعيد الجذور (مواقع وأجهزة جذرية) مع أبنائها وتمييز انقطاع المسار.
//   • عقدة نوع 'location' = موقع/مبنى — الشجرة تُبنى من parent_id (علاقة واحدة موحدة)، وتحتها:
//     المواقع الأبناء (parent_id) + الأجهزة المتصلة به (parent_location_id) + الأجهزة ذات parent_id.
//   • عقدة نوع 'device' = جهاز — أبوه جهاز (parent_id) أو موقع (parent_location_id).
//     الأولوية للأب الجهاز؛ لو فاضي يعلق تحت الموقع؛ لو الاتنين فاضي = جذر.
function buildTopology() {
  const locs = db.prepare(`
    SELECT id, name, kind, parent_id, map_parent_id, pos_x, pos_y
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

  // v2.13.3 — لحظة بدء الانقطاع المفتوح لكل جهاز (من downtime_events): تُستخدم في شاشة NOC
  // لشارة «منقطع منذ …» وتنبيه الشاشة الكاملة. لقطة واحدة بسيطة — مفتوحة فقط (ended_at IS NULL).
  const openDown = new Map();
  for (const row of db.prepare(
    'SELECT device_id, started_at FROM downtime_events WHERE ended_at IS NULL'
  ).all()) {
    openDown.set(row.device_id, row.started_at);
  }

  // عقد المواقع — مع سلسلة المباني عبر parent_id.
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
      // v2.11.0 — رابط «خريطة المواقع» المستقل («يتبع»): لا علاقة له بـ parent_id (سلسلة الشبكة).
      map_parent_id: l.map_parent_id || null,
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
      // v2.13.3 — بداية الانقطاع المفتوح (ISO) — null لو متصل أو بلا حدث مفتوح.
      offline_since: d.current_status === 'offline' && openDown.has(d.id)
        ? new Date(openDown.get(d.id)).toISOString()
        : null,
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

  return roots;
}

module.exports = { buildTopology };
