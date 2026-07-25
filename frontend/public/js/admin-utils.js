// admin-utils.js: دوال مساعدة مشتركة لكل ملفات لوحة التحكم.
// يُحمَّل FIRST في dashboard.html قبل كل سكريبتات admin لتفادي تكرار التعريفات.

// تحويل القيمة إلى نص ثم الهروب من أحرف HTML الخطيرة (يمنع XSS عند الحقن في innerHTML).
// ملاحظة: الترتيب مهم — يجب معالجة & أولاً حتى لا تُشوّه escapes اللاحقة.
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#39;');
}

// دالة fetch عامة للطلبات البسيطة (JSON) — تتعامل مع الاستجابات غير JSON بأمان.
// ملاحظة: لا تُستخدم لطلاقات SSE (Server-Sent Events) — فهي تحتاج معالجة بث خاصّة.
async function api(url, opts) {
  try {
    const r = await fetch(url, opts);
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
    if (!r.ok && r.status !== 401 && r.status !== 404) {
      return data || { success: false, error: 'HTTP ' + r.status };
    }
    return data != null ? data : { success: false, error: 'استجابة غير صالحة من الخادم' };
  } catch (e) {
    return { success: false, error: 'تعذر الاتصال بالخادم' };
  }
}
