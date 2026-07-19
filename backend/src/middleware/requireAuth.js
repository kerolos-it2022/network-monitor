// requireAuth.js: دالة middleware تتحقق من وجود جلسة مسجّلة، وإلا ترجع 401.
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  return res.status(401).json({ success: false, error: 'not authenticated' });
}

module.exports = requireAuth;
