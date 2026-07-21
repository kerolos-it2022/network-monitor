// admin-profile.js: إدارة الملف الشخصي (تغيير كلمة المرور، عرض معلومات الحساب).
async function api(url, opts) {
  const r = await fetch(url, opts);
  return r.json();
}

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, String.fromCharCode(38) + 'amp;')
    .replace(/</g, String.fromCharCode(38) + 'lt;')
    .replace(/>/g, String.fromCharCode(38) + 'gt;')
    .replace(/"/g, String.fromCharCode(38) + 'quot;')
    .replace(/'/g, String.fromCharCode(38) + '#39;');
}

async function loadProfile() {
  try {
    const r = await api('/api/auth/me');
    if (r.success) {
      document.getElementById('profile-username').value = r.data.username || '';
      document.getElementById('profile-role').value = r.data.role || '';
    }
  } catch (e) {
    console.error('loadProfile error', e);
  }
}

async function changePassword(e) {
  e.preventDefault();
  const statusEl = document.getElementById('cp-status');
  statusEl.textContent = '';
  statusEl.style.color = '';

  const current = document.getElementById('cp-current').value;
  const newPass = document.getElementById('cp-new').value;
  const confirm = document.getElementById('cp-confirm').value;

  if (!current || !newPass || !confirm) {
    statusEl.textContent = 'جميع الحقول مطلوبة';
    statusEl.style.color = 'var(--offline)';
    return;
  }
  if (newPass !== confirm) {
    statusEl.textContent = 'كلمة المرور الجديدة غير متطابقة';
    statusEl.style.color = 'var(--offline)';
    return;
  }
  if (newPass.length < 6) {
    statusEl.textContent = 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
    statusEl.style.color = 'var(--offline)';
    return;
  }

  statusEl.textContent = 'جارٍ الحفظ...';
  statusEl.style.color = 'var(--muted)';

  try {
    const r = await api('/api/auth/change-password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: current, new_password: newPass }),
    });
    if (r.success) {
      statusEl.textContent = '✅ تم تغيير كلمة المرور بنجاح';
      statusEl.style.color = 'var(--online)';
      document.getElementById('change-password-form').reset();
    } else {
      statusEl.textContent = '❌ ' + (r.error || 'فشل تغيير كلمة المرور');
      statusEl.style.color = 'var(--offline)';
    }
  } catch (e) {
    statusEl.textContent = '❌ خطأ في الاتصال بالخادم';
    statusEl.style.color = 'var(--offline)';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // التحقق من الجلسة.
  try {
    const me = await api('/api/auth/me');
    if (!me.success) { window.location.href = 'login.html'; return; }
  } catch (e) {
    window.location.href = 'login.html';
    return;
  }

  await loadProfile();

  document.getElementById('change-password-form').addEventListener('submit', changePassword);
});