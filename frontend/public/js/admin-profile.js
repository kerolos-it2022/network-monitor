// admin-profile.js: إدارة الملف الشخصي (تغيير كلمة المرور، عرض معلومات الحساب).
// ملاحظة: esc و api مُعرّفتان في admin-utils.js (يُحمَّل أولاً).

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
    statusEl.textContent = T('s2j.all_fields_are_required', 'جميع الحقول مطلوبة');
    statusEl.style.color = 'var(--offline)';
    return;
  }
  if (newPass !== confirm) {
    statusEl.textContent = T('s2j.the_new_passwords_do_not_match', 'كلمة المرور الجديدة غير متطابقة');
    statusEl.style.color = 'var(--offline)';
    return;
  }
  if (newPass.length < 6) {
    statusEl.textContent = T('s2j.the_password_must_be_at_least_6_characters', 'كلمة المرور يجب أن تكون 6 أحرف على الأقل');
    statusEl.style.color = 'var(--offline)';
    return;
  }

  statusEl.textContent = T('s2j.saving', 'جارٍ الحفظ...');
  statusEl.style.color = 'var(--muted)';

  try {
    const r = await api('/api/auth/change-password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: current, new_password: newPass }),
    });
    if (r.success) {
      statusEl.textContent = T('s2j.password_changed_successfully', '✅ تم تغيير كلمة المرور بنجاح');
      statusEl.style.color = 'var(--online)';
      document.getElementById('change-password-form').reset();
    } else {
      statusEl.textContent = '❌ ' + (r.error || 'فشل تغيير كلمة المرور');
      statusEl.style.color = 'var(--offline)';
    }
  } catch (e) {
    statusEl.textContent = T('s2j.server_connection_error', '❌ خطأ في الاتصال بالخادم');
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

// ── v2.20.1 — إدارة المستخدمين (admin فقط؛ لأدوار أخرى تُخفى البطاقة) ──
(function bindUsersManagement() {
  const card = document.getElementById("users-card");
  const list = document.getElementById("usr-list");
  const status = document.getElementById("usr-status");
  function escName(v) { return String(v == null ? "" : v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;" }[c] || "&quot;")); }
  async function loadUsers() {
    if (!card) return;
    let r;
    try { r = await api("/api/auth/users"); } catch (e) { card.style.display = "none"; return; }
    if (!r || !r.success) { card.style.display = "none"; return; }
    card.style.display = "";
    const meR = await api("/api/auth/me").catch(() => null);
    const me = (meR && meR.success && meR.data && meR.data.username) || "";
    const rows = r.users || [];
    list.innerHTML = rows.map((u) =>
      "<div style=\"display:flex; justify-content:space-between; align-items:center; gap:0.6rem; padding:0.45rem 0.2rem; border-bottom:1px solid var(--border);\">" +
      "<span><b>" + escName(u.username) + "</b> <small style=\"color:var(--muted);\">(" + (u.role === 'admin' ? T('s2.admin', "مدير") : T('s2.viewer', "عرض فقط")) + ")</small></span>" +
      (u.username === me ? "<small style=\"color:var(--muted);\">(حسابك)</small>" : "<button class=\"btn btn-danger\" data-del-user=\"" + escName(u.username) + "\">🗑️</button>") +
      "</div>").join("");
    list.querySelectorAll("[data-del-user]").forEach((b) => b.addEventListener("click", () => deleteUser(b.getAttribute("data-del-user"))));
  }
  async function deleteUser(username) {
    if (!confirm("حذف المستخدم " + username + "؟")) return;
    const r = await api("/api/auth/users/" + encodeURIComponent(username), { method: "DELETE" });
    const st = document.getElementById("usr-status");
    if (st) { st.textContent = (r && r.success) ? "✅ تم الحذف" : "✗ " + ((r && r.error) || "فشل"); st.style.color = (r && r.success) ? "var(--online)" : "var(--offline)"; }
    loadUsers();
  }
  const addB = document.getElementById("usr-add-btn");
  if (addB) addB.addEventListener("click", async () => {
    const u = document.getElementById("usr-new-username").value.trim();
    const pw = document.getElementById("usr-new-password").value;
    const role = document.getElementById("usr-new-role").value;
    const st = document.getElementById("usr-status");
    const r = await api("/api/auth/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: u, password: pw, role }) });
    if (r && r.success) { document.getElementById("usr-new-username").value = ""; document.getElementById("usr-new-password").value = ""; }
    if (st) { st.textContent = (r && r.success) ? "✅ أُضيف " + u : "✗ " + ((r && r.error) || "فشل الإضافة"); st.style.color = (r && r.success) ? "var(--online)" : "var(--offline)"; }
    loadUsers();
  });
  loadUsers();
})();
