// auth.routes.js: مسارات المصادقة (login / logout / me) باستخدام جلسات express-session.
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// POST /api/auth/login
// Body: { username, password }
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res
      .status(400)
      .json({ success: false, error: 'بيانات الدخول غير صحيحة' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    return res
      .status(401)
      .json({ success: false, error: 'بيانات الدخول غير صحيحة' });
  }

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    return res
      .status(401)
      .json({ success: false, error: 'بيانات الدخول غير صحيحة' });
  }

  req.session.user = { username: user.username, role: user.role };
  return res
    .status(200)
    .json({ success: true, data: { username: user.username, role: user.role } });
});

// POST /api/auth/logout  (محمي)
router.post('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => {
    return res.status(200).json({ success: true, data: null });
  });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (req.session && req.session.user) {
    return res.status(200).json({ success: true, data: req.session.user });
  }
  return res
    .status(401)
    .json({ success: false, error: 'not authenticated' });
});

module.exports = router;
