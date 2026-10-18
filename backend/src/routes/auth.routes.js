// auth.routes.js: مسارات المصادقة (login / logout / me / change-password) باستخدام جلسات express-session.
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
// SEC-03 — سجل تدقيق: نجاح/فشل الدخول، القفل، الخروج، تغيير كلمات المرور وإدارة المستخدمين.
const audit = require('../services/audit.service');
const { bindSession, revokeSessions } = require('../services/session-auth.service');
// كلمة مرور واحدة لكل الأبواب على الأبلاينس: تغييرها من اللوحة يحدّث شاشة الكونسول ودخول لينكس.
const { syncSystemPassword } = require('../services/console-password.service');
const { uiText } = require('../services/ui-text.service');

const router = express.Router();

// v2.7.5 — عمر الجلسة الافتراضي (12 ساعة) المُعرّف في server.js. عند تَفعيل «تذكّرني»
// نُمدّد عمرها إلى 30 يومًا لِـ إبقاء تسجيل الدخول بين الزيارات.
const REMEMBER_MAX_AGE = 1000 * 60 * 60 * 24 * 30; // 30 يومًا

// ─────────────────────────────────────────────────────────────
// v2.22.0 — 🔐 قفل محاولات الدخول (الوصول معتمد على رابط عام عبر ngrok، فاللوحة
// مكشوفة لكسر كلمة المرور بالتخمين). 5 محاولات فاشلة (لكل مستخدم+IP) خلال نافذة
// 15 دقيقة ⇒ قفل 15 دقيقة. في الذاكرة فقط (لا قاعدة) — إعادة تشغيل الخدمة تنظّفه،
// وهذا مقبول: الهدف إبطاء التخمين لا محاسبة تاريخية.
// ملاحظة: نفس رسالة الخطأ العامة «بيانات الدخول غير صحيحة» لبقية الحالات؛ رسالة
// القفل هي وحدها الوحيدة التي تفصح (لا تكشف للمهاجم هل المستخدم موجود).
// ─────────────────────────────────────────────────────────────
const LOCK_MAX_FAILURES = 5;
const LOCK_WINDOW_MS = 1000 * 60 * 15;      // نافذة عدّ المحاولات الفاشلة
const LOCK_DURATION_MS = 1000 * 60 * 15;    // مدة القفل بعد بلوغ الحد
const loginFailures = new Map();            // '${username}|${ip}' → { count, firstAt, lockedUntil }

// Express resolves forwarding headers only through the configured trusted proxies.
function clientIp(req) {
  return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}
function lockKey(req, username) {
  return String(username || '').toLowerCase() + '|' + clientIp(req);
}
// تنظيف كسول: لا يبقى مفتاح قديم بلا نافذة نشطة.
function pruneLocks(now) {
  for (const [k, st] of loginFailures) {
    if (st.lockedUntil && st.lockedUntil <= now) { loginFailures.delete(k); continue; }
    if (!st.lockedUntil && now - st.firstAt > LOCK_WINDOW_MS) loginFailures.delete(k);
  }
}

// POST /api/auth/login
// Body: { username, password, remember? }
router.post('/login', (req, res, next) => {
  const { username, password, remember } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res
      .status(400)
      .json({ success: false, error: uiText('بيانات الدخول غير صحيحة', 'Invalid login credentials') });
  }

  const now = Date.now();
  pruneLocks(now);
  const key = lockKey(req, username);
  const st = loginFailures.get(key);
  // حالة القفل النشط: رفض مباشر قبل أي فحص اعتمادات (بقية الوقت بالدقائق، أقلها 1).
  if (st && st.lockedUntil && st.lockedUntil > now) {
    const mins = Math.max(1, Math.ceil((st.lockedUntil - now) / 60000));
    audit.record('login_locked', req, { actor: String(username).slice(0, 120), target: username, details: { locked_minutes: mins } });
    return res.status(429).json({
      success: false,
      error: uiText('تم إيقاف تسجيل الدخول مؤقتًا بعد محاولات فاشلة متكررة — حاول بعد ' + mins + ' دقيقة',
        'Login temporarily locked after repeated failed attempts — try again in ' + mins + ' minute(s)'),
      locked_minutes: mins,
    });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const ok = user && bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    // عدّ المحاولات الفاشلة (للمستخدم الموجود وغير الموجود على السواء — الرسالة واحدة).
    const cur = loginFailures.get(key) || { count: 0, firstAt: now, lockedUntil: null };
    if (now - cur.firstAt > LOCK_WINDOW_MS) { cur.count = 0; cur.firstAt = now; }
    cur.count += 1;
    if (cur.count >= LOCK_MAX_FAILURES) {
      cur.lockedUntil = now + LOCK_DURATION_MS;
      loginFailures.set(key, cur);
      audit.record('login_locked', req, { actor: String(username).slice(0, 120), target: username, details: { failures: cur.count, locked_minutes: Math.ceil(LOCK_DURATION_MS / 60000) } });
      return res.status(429).json({
        success: false,
        error: uiText('تم إيقاف تسجيل الدخول مؤقتًا بعد ' + LOCK_MAX_FAILURES + ' محاولات فاشلة — حاول بعد ' + Math.ceil(LOCK_DURATION_MS / 60000) + ' دقيقة',
          'Login temporarily locked after ' + LOCK_MAX_FAILURES + ' failed attempts — try again in ' + Math.ceil(LOCK_DURATION_MS / 60000) + ' minute(s)'),
        locked_minutes: Math.ceil(LOCK_DURATION_MS / 60000),
      });
    }
    loginFailures.set(key, cur);
    audit.record('login_failed', req, { actor: String(username).slice(0, 120), target: username, details: { attempts: cur.count } });
    return res
      .status(401)
      .json({ success: false, error: uiText('بيانات الدخول غير صحيحة', 'Invalid login credentials') });
  }

  // نجاح الدخول: صفّر عدّاد هذا المستخدم+IP.
  loginFailures.delete(key);

  req.session.regenerate((err) => {
    if (err) return next(err);
    bindSession(req.session, user);
    audit.record('login_success', req, { target: user.username, role: user.role });

    // v2.7.5 — تَفعيل «تذكّرني»: نُعيد ضبط عمر الـ cookie لهذه الجلسة لِـ 30 يومًا.
    // (نُفعّلها فقط عند تَحقّق remember من النموذج، وإلا تَبقى 12 ساعة كالسابق.)
    if (remember && req.session.cookie && typeof req.session.cookie.maxAge === 'number') {
      req.session.cookie.maxAge = REMEMBER_MAX_AGE;
    }

    return res
      .status(200)
      .json({ success: true, data: { username: user.username, role: user.role } });
  });
});

// POST /api/auth/logout  (محمي)
router.post('/logout', requireAuth, (req, res) => {
  audit.record('logout', req);
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

// PUT /api/auth/change-password  🔒
router.put('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (typeof current_password !== 'string' || typeof new_password !== 'string' || !current_password || !new_password) {
    return res.status(400).json({ success: false, error: uiText('كلمة المرور الحالية والجديدة مطلوبتان', 'Current and new password are required') });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ success: false, error: uiText('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل', 'New password must be at least 6 characters') });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(req.session.user.username);
  if (!user) {
    return res.status(404).json({ success: false, error: uiText('المستخدم غير موجود', 'User not found') });
  }

  const ok = bcrypt.compareSync(current_password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ success: false, error: uiText('كلمة المرور الحالية غير صحيحة', 'Current password is incorrect') });
  }

  const newHash = bcrypt.hashSync(new_password, 10);
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(newHash, user.username);
    revokeSessions(user.username, req.sessionID);
  })();
  bindSession(req.session, { ...user, password_hash: newHash });

  // مزامنة الأبواب النظامية (شاشة الكونسول على tty1 + دخول لينكس):
  // أفضل جهد — لو كان المساعد غير موجود (تطوير/ويندوز) أو فشل، تظل كلمة مرور اللوحة قد تغيّرت فعلًا.
  const sysSync = syncSystemPassword(new_password);
  audit.record('password_change', req, {
    target: user.username,
    system_sync: sysSync.ok ? 'ok' : (sysSync.skipped ? 'skipped' : 'failed'),
  });

  return res.json({ success: true, data: null });
});

module.exports = router;

// ── v2.20.0 — حسابات متعددة بصلاحيات (admin فقط): قائمة · إضافة · حذف ──
function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  return res.status(403).json({ success: false, error: uiText('هذه العملية للمدير (admin) فقط', 'This operation is for admins only') });
}

router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id').all();
  res.json({ success: true, users: rows });
});

router.post('/users', requireAuth, requireAdmin, (req, res) => {
  const u = String((req.body || {}).username || '').trim();
  const pw = String((req.body || {}).password || '');
  const role = ((req.body || {}).role === 'viewer') ? 'viewer' : 'admin';
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(u)) {
    return res.status(400).json({ success: false, error: uiText('اسم المستخدم: 3-32 حرفًا (أحرف/أرقام/._-)', 'Username: 3-32 characters (letters/digits/._-)') });
  }
  if (pw.length < 6) {
    return res.status(400).json({ success: false, error: uiText('كلمة المرور 6 أحرف على الأقل', 'Password must be at least 6 characters') });
  }
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(u)) {
    return res.status(409).json({ success: false, error: uiText('اسم المستخدم موجود بالفعل', 'Username already exists') });
  }
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(u, bcrypt.hashSync(pw, 10), role);
  res.json({ success: true, data: { username: u, role } });
});

router.delete('/users/:username', requireAuth, requireAdmin, (req, res) => {
  const target = String(req.params.username || '');
  if (target === req.session.user.username) {
    return res.status(400).json({ success: false, error: uiText('لا يمكنك حذف حسابك الحالي', 'You cannot delete your current account') });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(target);
  if (!user) return res.status(404).json({ success: false, error: uiText('المستخدم غير موجود', 'User not found') });
  if (user.role === 'admin' && db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n <= 1) {
    return res.status(400).json({ success: false, error: uiText('لا يمكن حذف آخر مدير في النظام', 'Cannot delete the last admin in the system') });
  }
  db.transaction(() => {
    db.prepare('DELETE FROM users WHERE username = ?').run(target);
    revokeSessions(target);
  })();
  audit.record('user_delete', req, { target });
  res.json({ success: true });
});
