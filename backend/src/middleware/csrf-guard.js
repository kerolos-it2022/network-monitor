// csrf-guard.js (SpaceKit SEC-03) — حماية CSRF لكل الطلبات المُغيِّرة (non-GET).
// ═══════════════════════════════════════════════════════════════════════════
// الأسلوب: التحقق من الأصل (Origin verification) — المتصفح يُرسل Origin تلقائيًّا في كل
// طلب تغيير ولا يستطيع الموقع المهاجم تزويره. نقبل الطلب فقط إذا:
//   • الأصل يطابق مضيف الطلب نفسه (Host)، أو
//   • الأصل ضمن قائمة مسموح بها صراحةً (NM_ALLOWED_ORIGINS — للفصل بين نطاق ngrok وواجهة داخلية).
// غياب Origin (curl/سكربتات/تكاملات داخلية) يُقبل: ليس طلب متصفح ⇒ لا CSRF، ويبقى محتاجًا
// لجلسة صحيحة. الأصل "null" يُرفض دائمًا (iframe/file:// ).
// إيقاف مؤقت عند الحاجة التشغيلية: NM_CSRF_GUARD=0 (يُوثَّق كمخاطرة عند الاستعمال).
'use strict';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function normalizeOrigin(value) {
  try {
    const u = new URL(String(value));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.protocol + '//' + u.host;
  } catch (_) {
    return null;
  }
}

function createCsrfGuard(options = {}) {
  const rawAllowed = options.allowOrigins !== undefined ? options.allowOrigins : process.env.NM_ALLOWED_ORIGINS;
  const allowed = new Set(
    String(rawAllowed || '')
      .split(',')
      .map((s) => normalizeOrigin(s.trim()))
      .filter(Boolean)
  );
  const enabled = options.enabled !== undefined
    ? !!options.enabled
    : String(process.env.NM_CSRF_GUARD || '1') !== '0';

  return function csrfGuard(req, res, next) {
    if (!enabled || SAFE_METHODS.has(req.method)) return next();

    const originHeader = req.headers.origin;
    if (!originHeader) return next(); // ليس طلب متصفح (أداة/تكامل داخلي) — لا CSRF
    if (originHeader === 'null') {
      return res.status(403).json({ success: false, error: 'طلب مرفوض: أصل غير موثوق (CSRF)' });
    }
    const origin = normalizeOrigin(originHeader);
    if (!origin) {
      return res.status(403).json({ success: false, error: 'طلب مرفوض: أصل غير موثوق (CSRF)' });
    }
    const host = String(req.headers.host || '').toLowerCase();
    const originHost = origin.replace(/^https?:\/\//, '').toLowerCase();
    if (originHost === host || allowed.has(origin)) return next();

    return res.status(403).json({ success: false, error: 'طلب مرفوض: أصل غير موثوق (CSRF)' });
  };
}

module.exports = { createCsrfGuard, normalizeOrigin, SAFE_METHODS };
