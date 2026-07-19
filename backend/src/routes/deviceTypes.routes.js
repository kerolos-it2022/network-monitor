// deviceTypes.routes.js: CRUD أنواع الأجهزة (عام للقراءة، محمي للكتابة).
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// GET /api/device-types  (عام)
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT id, name, icon FROM device_types ORDER BY id ASC').all();
  return res.json({ success: true, data: rows });
});

// POST /api/device-types  🔒
router.post('/', requireAuth, (req, res) => {
  const { name, icon } = req.body || {};
  if (!name) {
    return res.status(400).json({ success: false, error: 'الحقل name مطلوب' });
  }
  const result = db.prepare(
    'INSERT INTO device_types (name, icon) VALUES (?, ?)'
  ).run(name, icon || 'server');
  return res.status(201).json({ success: true, data: { id: result.lastInsertRowid } });
});

// PUT /api/device-types/:id  🔒
router.put('/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT id FROM device_types WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ success: false, error: 'النوع غير موجود' });
  }
  const { name, icon } = req.body || {};
  if (!name) {
    return res.status(400).json({ success: false, error: 'الحقل name مطلوب' });
  }
  db.prepare('UPDATE device_types SET name = ?, icon = ? WHERE id = ?').run(
    name,
    icon || 'server',
    id
  );
  return res.json({ success: true, data: null });
});

// DELETE /api/device-types/:id  🔒
router.delete('/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT id FROM device_types WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ success: false, error: 'النوع غير موجود' });
  }
  db.prepare('DELETE FROM device_types WHERE id = ?').run(id);
  return res.json({ success: true, data: null });
});

module.exports = router;
