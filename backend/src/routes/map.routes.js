// map.routes.js (v2.5.1 — مُحدّث لِـ v2.5.2: هرم internet-أَولاً)
// ─────────────────────────────────────────────────────────────
// مسار واحد لِـ شجرة المواقع الهرمية المعروضة في تبويب «🗺️ خريطة المواقع»:
//   - GET /api/map/tree — شجرة JSON مُتداخلة (nested) لِـ المواقع + الأَجهزة معاً.
//
// البنية المُرجعة:
//   { id, name, kind, device_count, online, offline, unknown, children: [...] }
// عُقد المواقع لها `children`، وعُقد الأَجهزة (الأَوراق) لها `{ id:'dev-X', kind:'device',
// ip, status, device_type }`.
//
// قمة الشجرة (v2.5.2): لو وُجد location واحد بـ kind='internet' → يَكون هو الجذر الفعلي
// (أَطفاله = بقية المواقع الجذرية + عُقدة «أَجهزة غير مُعَيَّن»). لو وُجد أَكثر من internet
// أَو لا يُوجد → نُعيد عقدة «كل المواقع» (kind='root') كجذر افتراضي يَحتضن الجميع.
// المسار محمي بـ requireAuth (لوحة الإِدارة فقط). لاحظ: هذا المسار للقراءة فقط (GET).
// ─────────────────────────────────────────────────────────────
const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const db = require('../db');

// أَحصِ أَعداد الأَجهزة من قائمتها مباشرةً (لِـ تَلخيص الجذر دون الاِعتماد على propagate).
function summarizeDevices(devices) {
  return {
    device_count: devices.length,
    online: devices.filter((d) => d.current_status === 'online').length,
    offline: devices.filter((d) => d.current_status === 'offline').length,
    unknown: devices.filter((d) => !['online', 'offline'].includes(d.current_status)).length,
  };
}

// GET /api/map/tree — شجرة المواقع + الأَجهزة.
router.get('/tree', requireAuth, (req, res) => {
  try {
    // 1) جَلب كل المواقع (نَبني الشجرة في JS لا في SQL لِـ بساطة + أَمان من الـ recursion
    //    الواسِع على DB كبيرة؛ SQLite محدود بِـ UNION ALL، هنا محدود بِـ parent_id).
    const locations = db
      .prepare('SELECT id, name, parent_id, kind FROM locations ORDER BY id ASC')
      .all();

    // 2) جَلب كل الأَجهزة مَع نوعها وموقعها.
    const devices = db
      .prepare(
        `SELECT d.id, d.name, d.ip, d.current_status, d.device_type_id,
                dt.name AS device_type, d.location_id
         FROM devices d
         LEFT JOIN device_types dt ON dt.id = d.device_type_id
         ORDER BY d.name ASC`
      )
      .all();

    // 3) بناء خريطة العُقد (id → node) لِـ المواقع.
    const nodeById = new Map();
    for (const loc of locations) {
      nodeById.set(loc.id, {
        id: loc.id,
        name: loc.name,
        kind: loc.kind || 'zone',
        device_count: 0,
        online: 0,
        offline: 0,
        unknown: 0,
        children: [],
      });
    }

    // 4) أَوتار الـ parent_id لِـ تَجميع المواقع الأَبناء تحت آبائهم، وجَمْع المواقع الجذرية.
    const roots = [];
    for (const loc of locations) {
      const node = nodeById.get(loc.id);
      if (loc.parent_id != null && nodeById.has(loc.parent_id)) {
        nodeById.get(loc.parent_id).children.push(node);
      } else {
        roots.push(node); // جذرية أَو parent مفقود (يَتم التعامل معه كجذري)
      }
    }

    // 5) إِدراج الأَجهزة كأَوراق تحت موقعها، وزيادة الـ counts على الموقع المباشر فقط
    //    (نُلخِّص الأَبوي لِاحقًا عبر propagateCounts).
    const unassignedDevices = [];
    for (const dev of devices) {
      const devNode = {
        id: `dev-${dev.id}`,
        name: `${dev.name} (${dev.ip})`,
        kind: 'device',
        ip: dev.ip,
        status: dev.current_status || 'unknown',
        device_type: dev.device_type || null,
      };
      const parentLoc = dev.location_id != null ? nodeById.get(dev.location_id) : null;
      if (parentLoc) {
        parentLoc.children.push(devNode);
        parentLoc.device_count += 1;
        if (dev.current_status === 'online') parentLoc.online += 1;
        else if (dev.current_status === 'offline') parentLoc.offline += 1;
        else parentLoc.unknown += 1;
      } else {
        // جهاز بدون location_id → نُجمِّعه تحت «غير مُعَيَّن» لِاحقًا.
        unassignedDevices.push(devNode);
      }
    }

    // 6) تَلخيص counts صعودًا: كل عُقدة موقع تُجمِّع counts أَطفالها المواقع فقط
    //    (الأَجهزة عدّت بالفعل على موقعها المباشر في الخطوة 5). نَعبر الشجرة قاعًا لِـأَعلى.
    function propagateCounts(node) {
      for (const child of node.children) {
        if (child.kind !== 'device') {
          propagateCounts(child);
          node.device_count += child.device_count || 0;
          node.online += child.online || 0;
          node.offline += child.offline || 0;
          node.unknown += child.unknown || 0;
        }
      }
    }
    for (const root of roots) propagateCounts(root);

    // 7) عُقدة «أَجهزة غير مُعَيَّن» لو وُجدت أَجهزة بلا موقع.
    const unassignedNode =
      unassignedDevices.length > 0
        ? {
            id: 'unassigned',
            name: 'أَجهزة غير مُعَيَّن',
            kind: 'unassigned',
            device_count: unassignedDevices.length,
            online: unassignedDevices.filter((d) => d.status === 'online').length,
            offline: unassignedDevices.filter((d) => d.status === 'offline').length,
            unknown: unassignedDevices.filter((d) => d.status === 'unknown').length,
            children: unassignedDevices,
          }
        : null;

    // 8) تَحديد قمة الشجرة (v2.5.2): هل يُوجد internet واحد يَكون هو الجذر الفعلي؟
    const internetLocs = locations.filter((l) => l.kind === 'internet');
    let tree;

    if (internetLocs.length === 1) {
      // internet واحد → نَستعمل عقدته كجذر فعلي. أَطفاله = المواقع الجذرية الأُخرى (غير internet)
      // + عُقدة unassigned. لو internet له أَبناء عبر parent_id فالخطوة 4 دمجتهم بالفعل
      // في nodeById.get(internet.id).children — نَتعامل مع الحالتين.
      const internetNode = nodeById.get(internetLocs[0].id);

      // ضَع أَيّ root أُخرى (غير internet) كأَبناء لِـ internet لأَنها مُفرَدة логيًّا تَتفرَّع عنه.
      // (لو personalities تمَّ تَوزيعها عبر parent_id فالـ root لَن تَتكرر هنا — الأَبناء في nodeById.)
      const otherRoots = roots.filter((r) => r.id !== internetNode.id);
      for (const r of otherRoots) {
        // نُقلّل التَكرار: لو r بالفعل في internetNode.children (عَبر parent_id) لَن نُضيفها.
        const alreadyChild = internetNode.children.some(
          (c) => c.id === r.id && c.kind !== 'device'
        );
        if (!alreadyChild) internetNode.children.push(r);
      }
      if (unassignedNode) internetNode.children.push(unassignedNode);

      // تَلخيص internet كجذر (نَعتمد على propagate + summarizeDevices لضمان التَلاؤم).
      propagateCounts(internetNode);
      const summary = summarizeDevices(devices);
      internetNode.device_count = summary.device_count;
      internetNode.online = summary.online;
      internetNode.offline = summary.offline;
      internetNode.unknown = summary.unknown;
      tree = internetNode;
    } else {
      // لا internet أَو أَكثر من internet → جذر افتراضي «كل المواقع».
      tree = {
        id: 'root',
        name: 'كل المواقع',
        kind: 'root',
        device_count: 0,
        online: 0,
        offline: 0,
        unknown: 0,
        children: [...roots, ...(unassignedNode ? [unassignedNode] : [])],
      };
      const summary = summarizeDevices(devices);
      tree.device_count = summary.device_count;
      tree.online = summary.online;
      tree.offline = summary.offline;
      tree.unknown = summary.unknown;
    }

    return res.json({ success: true, data: tree });
  } catch (e) {
    console.error('[MAP] /api/map/tree error:', e.message);
    return res
      .status(500)
      .json({ success: false, error: 'فشل جَلب شجرة المواقع', detail: e.message });
  }
});

// GET /public/tree — شجرة المواقع + الأَجهزة للعرض العام (read-only، بلا requireAuth).
// إِصدار مُخفّف لِـ الصفحة العامة (index.html): عُقد الأَجهزة تَحمل فقط
//   { kind:'device', ip, status, device_type }
// بِلا أَسماء الأَجهزة و بلا IDs رقمية حقيقية (نَستعمل "dev-${id}" بِدل نَشر الـ integer).
// المواقع: { id, name, kind, parent_id, device_count, online, offline, unknown } — الـ ids
// تُستعمل لرسم الهرم فقط (هرم بِـ dev- prefix على الأَجهزة و id المواقع لرسم الشجرة).
router.get('/public/tree', (req, res) => {
  try {
    const locations = db
      .prepare('SELECT id, name, parent_id, kind FROM locations ORDER BY id ASC')
      .all();
    const devices = db
      .prepare(
        `SELECT d.id, d.ip, d.current_status, dt.name AS device_type, d.location_id
         FROM devices d
         LEFT JOIN device_types dt ON dt.id = d.device_type_id
         ORDER BY d.ip ASC`
      )
      .all();

    const nodeById = new Map();
    for (const loc of locations) {
      nodeById.set(loc.id, {
        id: loc.id,
        name: loc.name,
        kind: loc.kind || 'zone',
        device_count: 0,
        online: 0,
        offline: 0,
        unknown: 0,
        children: [],
      });
    }

    const roots = [];
    for (const loc of locations) {
      const node = nodeById.get(loc.id);
      if (loc.parent_id != null && nodeById.has(loc.parent_id)) {
        nodeById.get(loc.parent_id).children.push(node);
      } else {
        roots.push(node);
      }
    }

    const unassignedDevices = [];
    for (const dev of devices) {
      // مُخفّف: لا name، id بِـ dev- prefix، يَحمل ip + status + device_type فقط.
      const devNode = {
        id: `dev-${dev.id}`,
        kind: 'device',
        ip: dev.ip,
        status: dev.current_status || 'unknown',
        device_type: dev.device_type || null,
      };
      const parentLoc = dev.location_id != null ? nodeById.get(dev.location_id) : null;
      if (parentLoc) {
        parentLoc.children.push(devNode);
        parentLoc.device_count += 1;
        if (dev.current_status === 'online') parentLoc.online += 1;
        else if (dev.current_status === 'offline') parentLoc.offline += 1;
        else parentLoc.unknown += 1;
      } else {
        unassignedDevices.push(devNode);
      }
    }

    function propagateCounts(node) {
      for (const child of node.children) {
        if (child.kind !== 'device') {
          propagateCounts(child);
          node.device_count += child.device_count || 0;
          node.online += child.online || 0;
          node.offline += child.offline || 0;
          node.unknown += child.unknown || 0;
        }
      }
    }
    for (const root of roots) propagateCounts(root);

    const unassignedNode =
      unassignedDevices.length > 0
        ? {
            id: 'unassigned',
            name: 'أَجهزة غير مُعَيَّن',
            kind: 'unassigned',
            device_count: unassignedDevices.length,
            online: unassignedDevices.filter((d) => d.status === 'online').length,
            offline: unassignedDevices.filter((d) => d.status === 'offline').length,
            unknown: unassignedDevices.filter((d) => d.status === 'unknown').length,
            children: unassignedDevices,
          }
        : null;

    const internetLocs = locations.filter((l) => l.kind === 'internet');
    let tree;

    if (internetLocs.length === 1) {
      const internetNode = nodeById.get(internetLocs[0].id);
      const otherRoots = roots.filter((r) => r.id !== internetNode.id);
      for (const r of otherRoots) {
        const alreadyChild = internetNode.children.some(
          (c) => c.id === r.id && c.kind !== 'device'
        );
        if (!alreadyChild) internetNode.children.push(r);
      }
      if (unassignedNode) internetNode.children.push(unassignedNode);
      propagateCounts(internetNode);
      const total = devices.length;
      const online = devices.filter((d) => d.current_status === 'online').length;
      const offline = devices.filter((d) => d.current_status === 'offline').length;
      internetNode.device_count = total;
      internetNode.online = online;
      internetNode.offline = offline;
      internetNode.unknown = total - online - offline;
      tree = internetNode;
    } else {
      tree = {
        id: 'root',
        name: 'كل المواقع',
        kind: 'root',
        device_count: 0,
        online: 0,
        offline: 0,
        unknown: 0,
        children: [...roots, ...(unassignedNode ? [unassignedNode] : [])],
      };
      const total = devices.length;
      const online = devices.filter((d) => d.current_status === 'online').length;
      const offline = devices.filter((d) => d.current_status === 'offline').length;
      tree.device_count = total;
      tree.online = online;
      tree.offline = offline;
      tree.unknown = total - online - offline;
    }

    return res.json({ success: true, data: tree });
  } catch (e) {
    console.error('[MAP] /api/map/public/tree error:', e.message);
    return res
      .status(500)
      .json({ success: false, error: 'فشل جَلب شجرة المواقع العامة', detail: e.message });
  }
});

module.exports = router;
