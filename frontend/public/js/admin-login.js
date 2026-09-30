// admin-login.js: إرسال نموذج تسجيل الدخول ثم التحويل إلى dashboard.html عند النجاح.
// v2.7.5 — خيار «تذكّرني»: نُرسل remember=true لتمديد عمر الجلسة في الخادم،
// ونَحفظ حالة الـ checkbox في localStorage لِنُعيد استرجاعها عند الزيارة القادمة.
const REMEMBER_KEY = 'nm.loginRemember';

document.addEventListener('DOMContentLoaded', () => {
  const rememberEl = document.getElementById('remember');

  // v2.7.5 — لو في جلسة صالحة (مِثلاً بَعْد «تذكّرني») نُوجّه لِـ dashboard مباشرة
  // بدل عَرض نموذج الدخول مرة أُخرى.
  fetch('/api/auth/me', { credentials: 'include' })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (data && data.success) window.location.replace('dashboard.html');
    })
    .catch(() => {});

  // اِسترجاع آخر حالة لِـ «تذكّرني» (افتراضيًّا: غير مُفعّل).
  try {
    if (localStorage.getItem(REMEMBER_KEY) === 'true' && rememberEl) {
      rememberEl.checked = true;
    }
  } catch (_) {}

  if (rememberEl) {
    rememberEl.addEventListener('change', () => {
      try { localStorage.setItem(REMEMBER_KEY, String(rememberEl.checked)); } catch (_) {}
    });
  }
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const remember = document.getElementById('remember') ? document.getElementById('remember').checked : false;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';

  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, remember }),
    });
    const data = await r.json();
    if (data.success) {
      // نَضمن أن حالة «تذكّرني» مَحفُوظة أَيضاً عند النجاح (تَفاديًا لِفقدانها لو نَسِي تَفعيلها قبل submit).
      try { localStorage.setItem(REMEMBER_KEY, String(remember)); } catch (_) {}
      window.location.href = 'dashboard.html';
    } else {
      errEl.textContent = data.error || 'بيانات الدخول غير صحيحة';
    }
  } catch (err) {
    errEl.textContent = 'تعذر الاتصال بالخادم';
  }
});
