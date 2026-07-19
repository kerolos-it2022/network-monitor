// locations.routes.js: CRUD المواقع (عام للقراءة، محمي للكتابة).
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// GET /api/locations  (عام)
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT id, name, parent_id FROM locations ORDER BY id ASC').all();
  return res.json({ success: true, data: rows });
});

// POST /api/locations  🔒
router.post('/', requireAuth, (req, res) => {
  const { name, parent_id } = req.body || {};
  if (!name) {
    return res.status(400).json({ success: false, error: 'الحقل name مطلوب' });
  }
  const result = db.prepare(
    'INSERT INTO locations (name, parent_id) VALUES (?, ?)'
  ).run(name, parent_id ?? null);
  return res.status(201).json({ success: true, data: { id: result.lastInsertRowid } });
});

// PUT /api/locations/:id  🔒
router.put('/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT id FROM locations WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ success: false, error: 'الموقع غير موجود' });
  }
  const { name, parent_id } = req.body || {};
  if (!name) {
    return res.status(400).json({ success: false, error: 'الحقل name مطلوب' });
  }
  db.prepare('UPDATE locations SET name = ?, parent_id = ? WHERE id = ?').run(
    name,
    parent_id ?? null,
    id
  );
  return res.json({ success: true, data: null });
});

// DELETE /api/locations/:id  🔒
router.delete('/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT id FROM locations WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ success: false, error: 'الموقع غير موجود' });
  }
  db.prepare('DELETE FROM locations WHERE id = ?').run(id);
  return res.json({ success: true, data: null });
});

module.exports = router;
