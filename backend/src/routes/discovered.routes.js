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

// GET /api/discovered — قائمة (تصفية + ترقيم).
router.get('/', requireAuth, (req, res) => {
  try {
    const source = req.query.source;
    const isApproved = req.query.is_approved;
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '100', 10) || 100));

    let sql = `SELECT id, ip, mac, hostname, vendor, detected_type, source, first_seen_at, last_seen_at, seen_count, is_approved
               FROM discovered_devices`;
    const clauses = [];
    const params = [];
    if (source) { clauses.push('source = ?'); params.push(source); }
    if (isApproved !== undefined && isApproved !== null && isApproved !== '') {
      clauses.push('is_approved = ?'); params.push(parseInt(isApproved, 10));
    }
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY last_seen_at DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(sql).all(...params);
    res.json({ success: true, data: rows });
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

// POST /api/discovered/:id/approve — اعتماد + نَقل لِـ devices.
router.post('/:id/approve', requireAuth, (req, res) => {
  try {
    const dev = db.prepare('SELECT * FROM discovered_devices WHERE id = ?').get(req.params.id);
    if (!dev) return res.status(404).json({ success: false, error: 'الجهاز غير موجود.' });

    // هل موجود في devices بالفعل (بـ نفس IP)؟
    const existing = db.prepare('SELECT id FROM devices WHERE ip = ?').get(dev.ip);

    let deviceId;
    if (existing) {
      deviceId = existing.id;
    } else {
      // إِنشاء جهاز جديد (so اسم تلقائي + type افتراضيًّا 1 "Firewall" أَولاحقًا nullable).
      const name = dev.hostname || dev.vendor || `جهاز ${dev.ip}`;
      // نَلتقط device_type_id "غير مُصنّف" (NULL آمن) — الواجهة تُتيح التَصنيف لاحقًا.
      const ins = db.prepare(
        `INSERT INTO devices (name, ip, current_status, is_active)
         VALUES (?, ?, 'unknown', 1)`
      ).run(name, dev.ip);
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

// POST /api/discovered/bulk/approve — اعتماد جماعي (ids[]).
router.post('/bulk/approve', requireAuth, (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ success: false, error: 'ids[] مطلوب.' });
    const approveStmt = db.prepare(`UPDATE discovered_devices SET is_approved = 1, approved_at = datetime('now') WHERE id = ?`);
    const findDev = db.prepare('SELECT ip, hostname, vendor FROM discovered_devices WHERE id = ?');
    const findExisting = db.prepare('SELECT id FROM devices WHERE ip = ?');
    const insertDev = db.prepare(`INSERT INTO devices (name, ip, current_status, is_active) VALUES (?, ?, 'unknown', 1)`);

    const tx = db.transaction((ids) => {
      let approved = 0;
      for (const id of ids) {
        const dev = findDev.get(id);
        if (!dev) continue;
        if (!findExisting.get(dev.ip)) {
          insertDev.run(dev.hostname || dev.vendor || `جهاز ${dev.ip}`, dev.ip);
        }
        approveStmt.run(id);
        approved++;
      }
      return approved;
    });
    const approved = tx(ids);
    res.json({ success: true, message: `تم اعتماد ${approved} جهاز.`, data: { approved } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
