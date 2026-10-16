// requireRole.js — وسيط فرض الأدوار (SEC-01/SEC-02): يسمح فقط لرتب محددة.
// 'admin' يمر دائمًا (أعلى رتبة). لو لم يكن المستخدم مسجّلًا ⇒ 401.
'use strict';

function requireRole(...allowed) {
  const set = new Set(allowed.concat('admin'));
  return function (req, res, next) {
    const user = req.session && req.session.user;
    if (!user) return res.status(401).json({ success: false, error: 'not authenticated' });
    if (!set.has(user.role)) {
      return res.status(403).json({ success: false, error: 'صلاحيتك لا تسمح بهذا الإجراء — تواصل مع المدير' });
    }
    return next();
  };
}

module.exports = requireRole;
