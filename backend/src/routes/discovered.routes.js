// discovered.routes.js (v2.5.0)
// ─────────────────────────────────────────────────────────────
// مسارات API لِـ إدارة الأَجهزة المُكتشَفة (غير المعروفة في devices بعد):
//   - GET    /api/discovered            — قائمة الأَجهزة المُكتشَفة (تصفية بـ source/is_approved).
//   - GET    /api/discovered/:id        — تفاصيل جهاز.
//   - POST   /api/discovered/:id/approve — اعتماد: يَنقله لِـ devices (إن لم يَكُن موجُودًا) ويُعيّن is_approved=1.
//   - POST   /api/discovered/:id/reject  — رفض: is_approved=-1 (يُبقى السجل لأغراض تَوثيقية).
//   - DELETE /api/discovered/:id        — حذف السجل نهائيًّا.
// كل المسارات محميّة بـ requireAuth (مدير فقط).
// ─────────────────────────────────────────────────────────────
const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const db = require('../db');

// v2.11.7 — devices.device_type_id غير قابل للـ NULL ⇒ الاعتماد (السريع/الجماعي) يحتاج نوعًا:
//   1) نوع مطابق لـ detected_type (مثال Camera ⇒ لا يوجد ⇒ نتجاوز) · 2) نوع محايد إن وُجد · 3) أول نوع متاح.
// (قبل هذا الإصلاح كان «الاعتماد السريع» يفشل دائمًا بـ500: NOT NULL constraint failed.)
function resolveTypeIdFor(dev) {
  const detected = String((dev && dev.detected_type) || '').trim();
  if (detected) {
    const exact = db.prepare('SELECT id FROM device_types WHERE LOWER(name) = LOWER(?)').get(detected);
    if (exact) return exact.id;
    const partial = db.prepare('SELECT id FROM device_types WHERE LOWER(name) LIKE LOWER(?) ORDER BY id LIMIT 1').get('%' + detected + '%');
    if (partial) return partial.id;
  }
  for (const name of ['Other', 'Unknown', 'غير معروف', 'غير مُصنَّف', 'أخرى']) {
    const row = db.prepare('SELECT id FROM device_types WHERE name = ?').get(name);
    if (row) return row.id;
  }
  const first = db.prepare('SELECT id FROM device_types ORDER BY id LIMIT 1').get();
  return first ? first.id : null;
}

// GET /api/discovered — قائمة (تصفية + بحث + فرز + ترقيم). v2.11.7: أُضيف q/sort/order/offset وtotal.
router.get('/', requireAuth, (req, res) => {
  try {
    const source = req.query.source;
    const isApproved = req.query.is_approved;
    const q = String(req.query.q || '').trim();
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '100', 10) || 100));
    const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);

    // قائمة بيضاء للأعمدة (مَنع حقن SQL عبر sort/order).
    const SORTABLE = {
      ip: 'ip', hostname: 'hostname', vendor: 'vendor', detected_type: 'detected_type',
      source: 'source', last_seen_at: 'last_seen_at', first_seen_at: 'first_seen_at',
      seen_count: 'seen_count', is_approved: 'is_approved',
    };
    const sortCol = SORTABLE[String(req.query.sort || '')] || 'last_seen_at';
    const order = String(req.query.order || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const clauses = [];
    const params = [];
    if (source) { clauses.push('source = ?'); params.push(source); }
    if (isApproved !== undefined && isApproved !== null && isApproved !== '') {
      clauses.push('is_approved = ?'); params.push(parseInt(isApproved, 10));
    }
    if (q) {
      clauses.push('(ip LIKE ? OR hostname LIKE ? OR vendor LIKE ? OR detected_type LIKE ? OR mac LIKE ?)');
      const like = '%' + q + '%';
      params.push(like, like, like, like, like);
    }
    const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';

    const total = db.prepare('SELECT COUNT(*) AS c FROM discovered_devices' + where).get(...params).c;
    const rows = db.prepare(
      `SELECT id, ip, mac, hostname, vendor, detected_type, source, first_seen_at, last_seen_at, seen_count, is_approved
       FROM discovered_devices` + where + ` ORDER BY ${sortCol} ${order} LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    res.json({ success: true, data: rows, total, limit, offset, sort: sortCol, order: order.toLowerCase() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/discovered/:id — تفاصيل.
router.get('/:id', requireAuth, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM discovered_devices WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: 'الجهاز غير موجود.' });
    res.json({ success: true, data: row });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/discovered/bulk/approve — اعتماد جماعي (ids[]).
// v2.11.7 — مُقدَّم قبل /:id/approve عمدًا: وإلا التقطه ذلك المسار بـ id='bulk' ⇒ 404 (عيب قديم).
router.post('/bulk/approve', requireAuth, (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ success: false, error: 'ids[] مطلوب.' });
    const approveStmt = db.prepare(`UPDATE discovered_devices SET is_approved = 1, approved_at = datetime('now') WHERE id = ?`);
    const findDev = db.prepare('SELECT ip, mac, hostname, vendor, detected_type FROM discovered_devices WHERE id = ?');
    const findExisting = db.prepare('SELECT id FROM devices WHERE ip = ?');
    const insertDev = db.prepare(`INSERT INTO devices (name, ip, device_type_id, current_status, is_active) VALUES (?, ?, ?, 'unknown', 1)`);

    const tx = db.transaction((ids) => {
      let approved = 0;
      let skipped = 0;
      for (const id of ids) {
        const dev = findDev.get(id);
        if (!dev) continue;
        let createdId = null;
        if (!findExisting.get(dev.ip)) {
          const typeId = resolveTypeIdFor(dev);
          if (typeId === null) { skipped++; continue; }
          const ins = insertDev.run(dev.hostname || dev.vendor || `جهاز ${dev.ip}`, dev.ip, typeId);
          createdId = ins.lastInsertRowid;
        }
        approveStmt.run(id);
        approved++;
      }
      return { approved, skipped };
    });
    const out = tx(ids);

    res.json({ success: true, message: `تم اعتماد ${out.approved} جهاز.` + (out.skipped ? ` (تُخطّي ${out.skipped} لعدم وجود أنواع أجهزة)` : ''),
      data: out });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/discovered/:id/approve — اعتماد + نَقل لِـ devices.
router.post('/:id/approve', requireAuth, (req, res) => {
  try {
    const body = req.body || {};
    const dev = db.prepare('SELECT * FROM discovered_devices WHERE id = ?').get(req.params.id);
    if (!dev) return res.status(404).json({ success: false, error: 'الجهاز غير موجود.' });

    // هل موجود في devices بالفعل (بـ نفس IP)؟
    const existing = db.prepare('SELECT id FROM devices WHERE ip = ?').get(dev.ip);

    // v2.11.7 — حقول اختيارية من نافذة «الاعتماد الكامل» (غياب الحقول = «⚡ اعتماد سريع»
    // بالسلوك القديم حرفيًّا: إنشاء جهاز باسم تلقائي بلا نوع/موقع).
    const name = (typeof body.name === 'string' && body.name.trim())
      ? body.name.trim()
      : (dev.hostname || dev.vendor || `جهاز ${dev.ip}`);
    const typeId = (body.device_type_id !== undefined && body.device_type_id !== null && body.device_type_id !== '')
      ? Number(body.device_type_id) : null;
    const locId = (body.location_id !== undefined && body.location_id !== null && body.location_id !== '')
      ? Number(body.location_id) : null;
    const protocol = (typeof body.check_protocol === 'string' && body.check_protocol)
      ? body.check_protocol : null;
    const port = (body.port !== undefined && body.port !== null && body.port !== '') ? Number(body.port) : null;
    const webPort = (body.web_port !== undefined && body.web_port !== null && body.web_port !== '') ? Number(body.web_port) : null;

    if (typeId !== null && !db.prepare('SELECT id FROM device_types WHERE id = ?').get(typeId)) {
      return res.status(400).json({ success: false, error: 'نوع الجهاز غير موجود (id=' + typeId + ').' });
    }
    if (locId !== null && !db.prepare('SELECT id FROM locations WHERE id = ?').get(locId)) {
      return res.status(400).json({ success: false, error: 'الموقع غير موجود (id=' + locId + ').' });
    }

    let deviceId;
    if (existing) {
      deviceId = existing.id;
      // لجهاز مُراقَب سابقًا: نُحدّث الحقول المُرسَلة فقط (COALESCE يحفظ ما لم يُرسَل ⇒ لا نُفسد إعداداته).
      if (Object.keys(body).length > 0) {
        db.prepare(
          `UPDATE devices SET
             name = COALESCE(?, name),
             device_type_id = COALESCE(?, device_type_id),
             location_id = COALESCE(?, location_id),
             check_protocol = COALESCE(?, check_protocol),
             port = COALESCE(?, port),
             web_port = COALESCE(?, web_port)
           WHERE id = ?`
        ).run(
          (typeof body.name === 'string' && body.name.trim()) ? body.name.trim() : null,
          typeId, locId, protocol, port, webPort, deviceId
        );
      }
    } else {
      // نوع فعّال: المُرسَل، وإلا نوع مشتق من detected_type، وإلا نوع محايد/أول نوع (NOT NULL).
      const effectiveTypeId = (typeId !== null) ? typeId : resolveTypeIdFor(dev);
      if (effectiveTypeId === null) {
        return res.status(400).json({ success: false, error: 'لا توجد أنواع أجهزة معرَّفة — أضِف نوعًا من تبويب «📱 الأجهزة» أولًا.' });
      }
      const ins = db.prepare(
        `INSERT INTO devices (name, ip, device_type_id, location_id, check_protocol, port, web_port, current_status, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'unknown', 1)`
      ).run(name, dev.ip, effectiveTypeId, locId, protocol || 'ping', port, webPort);
      deviceId = ins.lastInsertRowid;
    }

    // ضَع is_approved=1 + approved_at.
    db.prepare(
      `UPDATE discovered_devices SET is_approved = 1, approved_at = datetime('now') WHERE id = ?`
    ).run(req.params.id);

    res.json({
      success: true,
      message: 'تم اعتماد الجهاز ونقله لمكتبة الأجهزة.',
      data: { discovered_id: req.params.id, device_id: deviceId },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/discovered/:id/reject — رفض (بَقاء السجل لأغراض تَوثيقية).
router.post('/:id/reject', requireAuth, (req, res) => {
  try {
    const dev = db.prepare('SELECT id FROM discovered_devices WHERE id = ?').get(req.params.id);
    if (!dev) return res.status(404).json({ success: false, error: 'الجهاز غير موجود.' });
    db.prepare('UPDATE discovered_devices SET is_approved = -1, approved_at = datetime(\'now\') WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'تم رفض الجهاز. سيبقى السجل لأغراض التَوثيق.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/discovered/:id — حذف نهائي.
router.delete('/:id', requireAuth, (req, res) => {
  try {
    const info = db.prepare('DELETE FROM discovered_devices WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ success: false, error: 'الجهاز غير موجود.' });
    res.json({ success: true, message: 'تم حذف السجل.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
