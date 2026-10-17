// admin-services.js (SpaceKit MON-02) — إدارة الخدمات المراقَبة داخل نافذة تعديل الجهاز.
// يعتمد على esc() و api() من admin-utils.js (يُحمَّل قبله).
// الـ API: GET/POST /api/devices/:id/services · PUT/DELETE /api/devices/:id/services/:sid
// (القراءة بجلسة، والتعديل للمدير فقط — والخادم يتحقق مجددًا).
(function () {
  'use strict';

  let currentDeviceId = null;   // الجهاز المعروض في النافذة (null = إضافة جهاز جديد)
  let editingServiceId = null;  // خدمة قيد التعديل (null = إضافة)

  function el(id) { return document.getElementById(id); }

  // نداء كتابة JSON (api() تمرّر الخيارات كما هي إلى fetch ⇒ نضبط الترويسة والجسم صراحةً).
  function jsonApi(url, method, body) {
    return api(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
    });
  }

  function kindLabel(s) {
    if (s.kind === 'tcp') return 'TCP ' + s.port;
    return String(s.kind).toUpperCase() + ' ' + (s.port || (s.kind === 'https' ? 443 : 80)) + (s.url_path || '/');
  }

  function statusChip(s) {
    if (!s.is_enabled) return `<span style="color:var(--muted);">⏸ ${T('status.paused', 'موقوف')}ة</span>`;
    if (s.status === 'online') return '🟢 تعمل';
    if (s.status === 'offline') return '🔴 متوقفة';
    return `<span style="color:var(--muted);">⚪ ب${T('common.no', 'لا')} ${T('frag.not_checked_yet', 'فحص بعد')}</span>`;
  }

  function renderList(services) {
    const host = el('df-services-list');
    if (!host) return;
    if (!services.length) {
      host.innerHTML = '<span style="color:var(--muted);font-size:0.85rem;">لا توجد خدمات مراقَبة بعد — '
        + 'أضف خدمة (مثل Odoo على منفذ 8069) ليظهر تمييز «خدمة متوقفة» عند تعطّلها.</span>';
      return;
    }
    host.innerHTML = services.map((s) => `
      <div class="svc-row" data-sid="${s.id}" style="display:flex;gap:.5rem;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:.4rem .55rem;border:1px solid var(--border);border-radius:8px;margin-bottom:.35rem;font-size:.87rem;">
        <span>
          <b>${esc(s.name)}</b>
          <span style="color:var(--muted);"> · ${esc(kindLabel(s))}${s.is_critical ? ' · حرجة' : ''}</span>
        </span>
        <span>${statusChip(s)}
          ${s.last_error ? `<span style="color:var(--muted);font-size:.75rem;"> (${esc(String(s.last_error).slice(0, 48))})</span>` : ''}
        </span>
        <span style="white-space:nowrap;">
          <button type="button" class="btn" data-act="toggle" title="${s.is_enabled ? 'إيقاف مؤقت' : 'تفعيل'}">${s.is_enabled ? '⏸' : '▶️'}</button>
          <button type="button" class="btn" data-act="edit" title="${T('frag.edit', 'تعديل')}">✏️</button>
          <button type="button" class="btn" data-act="del" title="${T('frag.delete', 'حذف')}">🗑️</button>
        </span>
      </div>`).join('');
  }

  async function refresh() {
    const host = el('df-services-list');
    if (!currentDeviceId) return;
    if (host) host.innerHTML = `<span style="color:var(--muted);font-size:0.85rem;">${T('common.loading', '…جارٍ التحميل')}</span>`;
    const r = await api('/api/devices/' + currentDeviceId + '/services');
    if (!r.success) {
      if (host) host.innerHTML = '<span style="color:#ef4444;font-size:0.85rem;">' + esc(r.error || 'تعذّر جلب الخدمات') + '</span>';
      return;
    }
    renderList(r.data || []);
  }

  function readForm() {
    return {
      name: el('dfs-name').value.trim(),
      kind: el('dfs-kind').value,
      port: el('dfs-port').value ? Number(el('dfs-port').value) : null,
      url_path: el('dfs-url_path').value.trim() || '/',
      expect_status: el('dfs-expect_status').value.trim() || '2xx',
      interval_seconds: Number(el('dfs-interval_seconds').value) || 60,
      failure_threshold: Number(el('dfs-failure_threshold').value) || 2,
      is_critical: el('dfs-is_critical').checked ? 1 : 0,
      verify_tls: el('dfs-verify_tls').checked ? 1 : 0,
      is_enabled: 1,
    };
  }

  function resetForm() {
    editingServiceId = null;
    ['dfs-name', 'dfs-port', 'dfs-url_path', 'dfs-expect_status'].forEach((id) => { const e = el(id); if (e) e.value = ''; });
    el('dfs-kind').value = 'tcp';
    el('dfs-interval_seconds').value = '60';
    el('dfs-failure_threshold').value = '2';
    const crit = document.getElementById('dfs-is_critical'); if (crit) crit.checked = false;
    el('dfs-verify_tls').checked = true;
    el('dfs-save').textContent = T('s2j.add_the_service', T('device.services.addBtn', T('s2j.add_the_service', T('device.services.addBtn', T('s2j.add_the_service', T('device.services.addBtn', T('s2j.add_the_service', T('device.services.addBtn', T('s2j.add_the_service', T('device.services.addBtn', T('s2j.add_the_service', T('device.services.addBtn', '➕ إضافة الخدمة'))))))))))));
    el('dfs-cancel-edit').classList.add('hidden');
  }

  function fillForm(s) {
    editingServiceId = s.id;
    el('dfs-name').value = s.name || '';
    el('dfs-kind').value = s.kind || 'tcp';
    el('dfs-port').value = s.port || '';
    el('dfs-url_path').value = s.url_path || '';
    el('dfs-expect_status').value = s.expect_status || '2xx';
    el('dfs-interval_seconds').value = s.interval_seconds || 60;
    el('dfs-failure_threshold').value = s.failure_threshold || 2;
    const crit = document.getElementById('dfs-is_critical'); if (crit) crit.checked = !!s.is_critical;
    el('dfs-verify_tls').checked = !!s.verify_tls;
    el('dfs-save').textContent = T('s2j.save_changes', '💾 حفظ التعديلات');
    el('dfs-cancel-edit').classList.remove('hidden');
    const det = el('df-service-add'); if (det) det.open = true;
  }

  async function save() {
    if (!currentDeviceId) return;
    const body = readForm();
    if (!body.name) { showToast(T('s2j.service_name_is_required', 'اسم الخدمة مطلوب'), { type: 'error' }); return; }
    const r = editingServiceId
      ? await jsonApi('/api/devices/' + currentDeviceId + '/services/' + editingServiceId, 'PUT', body)
      : await jsonApi('/api/devices/' + currentDeviceId + '/services', 'POST', body);
    if (!r.success) { showToast(r.error || 'تعذّر الحفظ', { type: 'error' }); return; }
    showToast(editingServiceId ? 'تم تحديث الخدمة ✓' : 'تمت إضافة الخدمة ✓ (ستُفحص خلال دقيقة تقريبًا)');
    resetForm();
    refresh();
  }

  async function onListClick(e) {
    const btn = e.target.closest('button[data-act]');
    if (!btn || !currentDeviceId) return;
    const row = btn.closest('.svc-row');
    const sid = row ? Number(row.dataset.sid) : null;
    if (!sid) return;
    const act = btn.dataset.act;

    if (act === 'del') {
      const ok = await confirmAction({ message: T('s2j.delete_this_service_permanently_the_service', T('s2j.delete_this_service_permanently_the_service', T('s2j.delete_this_service_permanently_the_service', T('s2j.delete_this_service_permanently_the_service', T('s2j.delete_this_service_permanently_the_service', T('s2j.delete_this_service_permanently_the_service', T('s2j.delete_this_service_permanently_the_service', 'حذف هذه الخدمة نهائيًّا؟ (سيختفي تمييز «خدمة متوقفة» عنها)'))))))) });
      if (!ok) return;
      const r = await jsonApi('/api/devices/' + currentDeviceId + '/services/' + sid, 'DELETE');
      if (!r.success) { showToast(r.error || 'تعذّر الحذف', { type: 'error' }); return; }
      showToast(T('s2j.service_deleted', 'تم حذف الخدمة'));
      refresh();
      return;
    }

    if (act === 'toggle') {
      const list = await api('/api/devices/' + currentDeviceId + '/services');
      const s = (list.data || []).find((x) => Number(x.id) === sid);
      if (!s) return;
      const r = await jsonApi('/api/devices/' + currentDeviceId + '/services/' + sid, 'PUT', {
        is_enabled: s.is_enabled ? 0 : 1,
      });
      if (!r.success) { showToast(r.error || 'تعذّر التغيير', { type: 'error' }); return; }
      refresh();
      return;
    }

    if (act === 'edit') {
      const list = await api('/api/devices/' + currentDeviceId + '/services');
      const s = (list.data || []).find((x) => Number(x.id) === sid);
      if (s) fillForm(s);
    }
  }

  // mount(deviceId|null): يُنادى من admin-devices.js عند فتح نافذة الجهاز.
  function mount(deviceId) {
    currentDeviceId = deviceId ? Number(deviceId) : null;
    resetForm();
    const section = el('df-services-section');
    if (!section) return;
    if (!currentDeviceId) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');
    refresh();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const saveBtn = el('dfs-save');
    if (saveBtn) saveBtn.addEventListener('click', save);
    const cancelBtn = el('dfs-cancel-edit');
    if (cancelBtn) cancelBtn.addEventListener('click', resetForm);
    const list = el('df-services-list');
    if (list) list.addEventListener('click', onListClick);
  });

  window.AdminServices = { mount, refresh };
})();
