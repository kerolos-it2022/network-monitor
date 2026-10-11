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

// v2.8.9 — مساعدات صفحة الدخول: زر إظهار/إخفاء كلمة المرور + تحذير Caps Lock + التركيز المبدئي.
document.addEventListener('DOMContentLoaded', () => {
  const pwEl = document.getElementById('password');
  const toggleEl = document.getElementById('pw-toggle');
  const hintEl = document.getElementById('pw-hint');
  const userEl = document.getElementById('username');

  // زر الإظهار/الإخفاء (تفادي أخطاء كتابة كلمة المرور)
  if (toggleEl && pwEl) {
    toggleEl.addEventListener('click', () => {
      const show = pwEl.type === 'password';
      pwEl.type = show ? 'text' : 'password';
      toggleEl.textContent = show ? '🙈' : '👁️';
      toggleEl.setAttribute('aria-label', show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
      toggleEl.setAttribute('aria-pressed', String(show));
      pwEl.focus();
      try { const n = pwEl.value.length; pwEl.setSelectionRange(n, n); } catch (_) {}
    });
  }

  // تحذير Caps Lock (سبب شائع لفشل الدخول)
  if (hintEl && pwEl) {
    const capsCheck = (e) => {
      let on = false;
      try { on = !!(e.getModifierState && e.getModifierState('CapsLock')); } catch (_) {}
      hintEl.textContent = on ? '⚠️ مفتاح Caps Lock مُفعَّل — ستُكتب الحروف كبيرة' : '';
    };
    ['keydown', 'keyup', 'focus'].forEach((ev) => pwEl.addEventListener(ev, capsCheck));
  }

  // التركيز على اسم المستخدم عند فتح الصفحة
  if (userEl && !userEl.value) { try { userEl.focus(); } catch (_) {} }
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const remember = document.getElementById('remember') ? document.getElementById('remember').checked : false;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';

  // v2.8.9 — تعطيل الزر أثناء الطلب لمنع الإرسال المزدوج + إعلام المستخدم
  const submitBtn = document.querySelector('#login-form button[type="submit"]');
  const submitLabel = submitBtn ? submitBtn.textContent : '';
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '⏳ جارٍ الدخول…'; }
  const resetSubmit = () => {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = submitLabel; }
  };
  const focusPassword = () => {
    const pwEl = document.getElementById('password');
    if (pwEl) { try { pwEl.focus(); pwEl.select(); } catch (_) {} }
  };

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
      resetSubmit();
      focusPassword();
    }
  } catch (err) {
    errEl.textContent = 'تعذر الاتصال بالخادم';
    resetSubmit();
  }
});
