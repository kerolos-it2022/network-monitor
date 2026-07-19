// admin-login.js: إرسال نموذج تسجيل الدخول ثم التحويل إلى dashboard.html عند النجاح.
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';

  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await r.json();
    if (data.success) {
      window.location.href = 'dashboard.html';
    } else {
      errEl.textContent = data.error || 'بيانات الدخول غير صحيحة';
    }
  } catch (err) {
    errEl.textContent = 'تعذر الاتصال بالخادم';
  }
});
