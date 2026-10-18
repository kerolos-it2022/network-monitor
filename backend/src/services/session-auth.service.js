'use strict';
const crypto = require('crypto');
const db = require('../db');

function credentialsVersion(user) {
  return crypto.createHash('sha256').update(user.password_hash).digest('hex');
}

function bindSession(session, user) {
  session.user = { username: user.username, role: user.role };
  session.accountId = user.id;
  session.credentialsVersion = credentialsVersion(user);
}

// All routes, including inline session checks and public DTOs, see current identity.
function validateSession(req, res, next) {
  if (!req.session || !req.session.user) return next();
  const user = db.prepare('SELECT id, username, role, password_hash FROM users WHERE username = ?')
    .get(req.session.user.username);
  if (!user || (req.session.accountId != null && req.session.accountId !== user.id)
      || (req.session.credentialsVersion && req.session.credentialsVersion !== credentialsVersion(user))) {
    return req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie('nm.sid', { path: '/' });
      next();
    });
  }
  // Upgrade legacy sessions in place, preserving the documented restart behavior.
  bindSession(req.session, user);
  next();
}

function revokeSessions(username, exceptSid = '') {
  db.prepare(`DELETE FROM sessions WHERE sid <> ? AND
    CASE WHEN json_valid(sess) THEN json_extract(sess, '$.user.username') END = ?`)
    .run(exceptSid, username);
}

module.exports = { bindSession, validateSession, revokeSessions };
