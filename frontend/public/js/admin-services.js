// admin-services.js (MON-02) — إدارة الخدمات المراقَبة داخل نافذة تعديل الجهاز.
// يعتمد على esc() و api() من admin-utils.js (يُحمَّل قبله).
// الـ API: GET/POST /api/devices/:id/services · PUT/DELETE /api/devices/:id/services/:sid
// (القراءة بجلسة، والتعديل للمدير فقط — والخادم يتحقق مجددًا).
(function () {
  'use strict';

  let currentDeviceId = null;   // الجهاز المعروض في النافذة (null = إضافة جهاز جديد)
  let editingServiceId = null;  // خدمة قيد التعديل (null = إضافة)
  // v2.50.x — «إضافة خدمة» وأنت بتضيف جهازًا جديدًا (طلب المالك): الجهاز ليس له معرّف بعد، فتُحفظ
  // الخدمات في **قايمة مؤقتة** هنا، وتُرسَل كلها بعد نجاح إنشاء الجهاز (زرّ حفظ واحد للاثنين).
  let pending = [];             // خدمات لم تُحفَظ بعد (كل واحدة بمعرّف مؤقّت سالب للصفوف فقط)
  let pendingSeq = -1;
  let editingPendingIndex = null;   // موضع خدمة مؤقتة قيد التعديل في القايمة
  // وضع «القايمة المؤقّتة»: يبقى صحيحًا ما دامت هناك خدمات لم تُحفَظ — حتى بعد إنشاء الجهاز
  // (فقد صار له معرّف لكن الخدمات الفاشلة ما زالت معلّقة، وتعديلها يجب أن يبقى في الذاكرة لا على السيرفر).
  let pendingMode = false;

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
    if (!s.is_enabled) return `<span style="color:var(--muted);">⏸ ${T('svc.paused', 'موقوفة')}</span>`;
    if (s.status === 'online') return T('svc.working', '🟢 تعمل');
    if (s.status === 'offline') return T('svc.stopped', '🔴 متوقفة');
    return `<span style="color:var(--muted);">⚪ ${T('svc.notCheckedYet', 'بلا فحص بعد')}</span>`;
  }

  function renderList(services) {
    const host = el('df-services-list');
    if (!host) return;
    if (!services.length) {
      host.innerHTML = '<span style="color:var(--muted);font-size:0.85rem;">'
        + T('svc.empty', 'لا توجد خدمات مراقَبة بعد — أضف خدمة (مثل Odoo على منفذ 8069) ليظهر تمييز «خدمة متوقفة» عند تعطّلها.') + '</span>';
      return;
    }
    host.innerHTML = services.map((s) => `
      <div class="svc-row" data-sid="${s.id}" style="display:flex;gap:.5rem;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:.4rem .55rem;border:1px solid var(--border);border-radius:8px;margin-bottom:.35rem;font-size:.87rem;">
        <span>
          <b>${esc(s.name)}</b>
          <span style="color:var(--muted);"> · ${esc(kindLabel(s))}${s.is_critical ? ' · ' + T('device.services.critical', 'حرجة') : ''}</span>
        </span>
        <span>${statusChip(s)}
          ${s.last_error ? `<span style="color:var(--muted);font-size:.75rem;"> (${esc(String(s.last_error).slice(0, 48))})</span>` : ''}
        </span>
        <span style="white-space:nowrap;">
          <button type="button" class="btn" data-act="toggle" title="${s.is_enabled ? T('svc.pauseTitle', 'إيقاف مؤقت') : T('svc.enableTitle', 'تفعيل')}">${s.is_enabled ? '⏸' : '▶️'}</button>
          <button type="button" class="btn" data-act="edit" title="${T('frag.edit', 'تعديل')}">✏️</button>
          <button type="button" class="btn" data-act="del" title="${T('frag.delete', 'حذف')}">🗑️</button>
        </span>
      </div>`).join('');
  }

  // ── الوضع المؤقّت: خدمات جهاز **لم يُحفَظ بعد** — تُعرَض كصفوف عادية لكن بحالة «سيُحفظ مع الجهاز» ──
  function pendingTag() {
    return '<span style="color:var(--muted);">⏳ ' + T('svc.pendingTag', 'سيُحفظ مع الجهاز') + '</span>';
  }

  function renderPending() {
    const host = el('df-services-list');
    if (!host) return;
    const hint = '<div style="color:var(--muted);font-size:.78rem;margin-bottom:.35rem;">'
      + T('svc.pendingHint', 'هذه الخدمات ستُحفظ مع الجهاز عند الضغط على «حفظ» — ولا تُفحَص قبل ذلك.') + '</div>';
    if (!pending.length) {
      host.innerHTML = hint + '<span style="color:var(--muted);font-size:0.85rem;">'
        + T('svc.pendingEmpty', 'لم تُضف خدمات بعد — أضف خدمة الآن وستُحفظ مع الجهاز.') + '</span>';
      return;
    }
    host.innerHTML = hint + pending.map((s) => `
      <div class="svc-row" data-sid="${s.__tmp}" style="display:flex;gap:.5rem;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:.4rem .55rem;border:1px solid var(--border);border-radius:8px;margin-bottom:.35rem;font-size:.87rem;">
        <span>
          <b>${esc(s.name)}</b>
          <span style="color:var(--muted);"> · ${esc(kindLabel(s))}${s.is_critical ? ' · ' + T('device.services.critical', 'حرجة') : ''}</span>
        </span>
        <span>${pendingTag()}</span>
        <span style="white-space:nowrap;">
          <button type="button" class="btn" data-act="edit" title="${T('frag.edit', 'تعديل')}">✏️</button>
          <button type="button" class="btn" data-act="del" title="${T('frag.delete', 'حذف')}">🗑️</button>
        </span>
      </div>`).join('');
  }

  /** عدد الخدمات المؤقّتة (يستهلكه admin-devices.js قبل إنشاء الجهاز). */
  function pendingCount() { return pendingMode ? pending.length : 0; }

  /**
   * flushPending(deviceId) — يُرسل الخدمات المؤقّتة بعد نجاح إنشاء الجهاز، واحدة واحدة.
   * يعيد { ok, failed } و**يُبقي الفاشلة في القايمة** لمحاولة تانية، ويحوّل النافذة لوضع «تعديل جهاز»
   * حتى تُعرَض الخدمات المحفوظة فعلًا بحالتها الحقيقية.
   */
  async function flushPending(deviceId) {
    const id = Number(deviceId);
    const queue = pending.slice();
    const failed = [];
    let ok = 0;
    for (const s of queue) {
      const body = Object.assign({}, s);
      delete body.__tmp;
      const r = await jsonApi('/api/devices/' + id + '/services', 'POST', body);
      if (r && r.success) ok += 1;
      else failed.push({ service: s, error: (r && r.error) || '' });
    }
    pending = failed.map((f) => f.service);
    currentDeviceId = id;          // صار للجهاز معرّف ⇒ نكمل كوضع تعديل عادي
    pendingMode = pending.length > 0;   // لكن ما دامت هناك خدمات معلّقة نبقى في الوضع المؤقّت
    return { ok: ok, failed: failed };
  }

  async function refresh() {
    const host = el('df-services-list');
    if (!currentDeviceId) return;
    if (host) host.innerHTML = `<span style="color:var(--muted);font-size:0.85rem;">${T('common.loading', '…جارٍ التحميل')}</span>`;
    const r = await api('/api/devices/' + currentDeviceId + '/services');
    if (!r.success) {
      if (host) host.innerHTML = '<span style="color:#ef4444;font-size:0.85rem;">' + esc(r.error || T('svc.loadFailed', 'تعذّر جلب الخدمات')) + '</span>';
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
    editingPendingIndex = null;
    ['dfs-name', 'dfs-port', 'dfs-url_path', 'dfs-expect_status'].forEach((id) => { const e = el(id); if (e) e.value = ''; });
    el('dfs-kind').value = 'tcp';
    el('dfs-interval_seconds').value = '60';
    el('dfs-failure_threshold').value = '2';
    const crit = document.getElementById('dfs-is_critical'); if (crit) crit.checked = false;
    el('dfs-verify_tls').checked = true;
    el('dfs-save').textContent = T('s2j.add_the_service', T('device.services.addBtn', T('s2j.add_the_service', T('device.services.addBtn', T('s2j.add_the_service', T('device.services.addBtn', T('s2j.add_the_service', T('device.services.addBtn', T('s2j.add_the_service', T('device.services.addBtn', T('s2j.add_the_service', T('device.services.addBtn', T('s2j.add_the_service', T('device.services.addBtn', T('s2j.add_the_service', T('device.services.addBtn', T('s2j.add_the_service', T('device.services.addBtn', '➕ إضافة الخدمة'))))))))))))))))));
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
    const body = readForm();
    if (!body.name) { showToast(T('s2j.service_name_is_required', 'اسم الخدمة مطلوب'), { type: 'error' }); return; }

    // جهاز لم تُحفظ خدماته بعد ⇒ الخدمة تُحفظ في القايمة المؤقّتة وتُرسَل مع زرّ «حفظ» الجهاز.
    if (pendingMode) {
      if (editingPendingIndex != null && pending[editingPendingIndex]) {
        const tmp = pending[editingPendingIndex].__tmp;
        pending[editingPendingIndex] = Object.assign({ __tmp: tmp }, body);
      } else {
        pending.push(Object.assign({ __tmp: pendingSeq }, body));
        pendingSeq -= 1;
      }
      showToast(T('svc.pendingAdded', 'أُضيفت الخدمة مؤقّتًا — ستُحفظ مع الجهاز ✓'), { type: 'success' });
      resetForm();
      renderPending();
      return;
    }

    const r = editingServiceId
      ? await jsonApi('/api/devices/' + currentDeviceId + '/services/' + editingServiceId, 'PUT', body)
      : await jsonApi('/api/devices/' + currentDeviceId + '/services', 'POST', body);
    if (!r.success) { showToast(r.error || T('svc.saveFailed', 'تعذّر الحفظ'), { type: 'error' }); return; }
    showToast(editingServiceId ? T('svc.updated', 'تم تحديث الخدمة ✓') : T('svc.added', 'تمت إضافة الخدمة ✓ (ستُفحص خلال دقيقة تقريبًا)'));
    resetForm();
    refresh();
  }

  async function onListClick(e) {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const row = btn.closest('.svc-row');
    const sid = row ? Number(row.dataset.sid) : null;
    if (!sid) return;
    const act = btn.dataset.act;

    // صفّ مؤقّت (خدمة لم تُحفَظ بعد): التعديل والحذف في الذاكرة فقط — لا نداءات للخادم.
    if (pendingMode) {
      const idx = pending.findIndex((x) => x.__tmp === sid);
      if (idx === -1) return;
      if (act === 'del') {
        pending.splice(idx, 1);
        if (editingPendingIndex === idx) resetForm();
        else if (editingPendingIndex != null && editingPendingIndex > idx) editingPendingIndex -= 1;
        showToast(T('svc.pendingDropped', 'أُزيلت الخدمة من القايمة'));
        renderPending();
        return;
      }
      if (act === 'edit') { editingPendingIndex = idx; fillForm(Object.assign({ id: sid }, pending[idx])); return; }
      return;
    }

    if (act === 'del') {
      const ok = await confirmAction({ message: T('s2j.delete_this_service_permanently_the_service', T('s2j.delete_this_service_permanently_the_service', T('s2j.delete_this_service_permanently_the_service', T('s2j.delete_this_service_permanently_the_service', T('s2j.delete_this_service_permanently_the_service', T('s2j.delete_this_service_permanently_the_service', T('s2j.delete_this_service_permanently_the_service', T('s2j.delete_this_service_permanently_the_service', T('s2j.delete_this_service_permanently_the_service', T('s2j.delete_this_service_permanently_the_service', 'حذف هذه الخدمة نهائيًّا؟ (سيختفي تمييز «خدمة متوقفة» عنها)')))))))))) });
      if (!ok) return;
      const r = await jsonApi('/api/devices/' + currentDeviceId + '/services/' + sid, 'DELETE');
      if (!r.success) { showToast(r.error || T('svc.deleteFailed', 'تعذّر الحذف'), { type: 'error' }); return; }
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
      if (!r.success) { showToast(r.error || T('svc.changeFailed', 'تعذّر التغيير'), { type: 'error' }); return; }
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
  // في وضع «إضافة جهاز» صار القسم **ظاهرًا** بقايمة مؤقّتة (طلب المالك 2026-10-18): تضيف خدماتك
  // مع الجهاز، وزرّ «حفظ» الواحد يُنشئ الجهاز ثم يُرسل الخدمات.
  function mount(deviceId) {
    currentDeviceId = deviceId ? Number(deviceId) : null;
    pendingMode = !currentDeviceId;   // إضافة جهاز ⇒ قايمة مؤقّتة
    resetForm();
    pending = [];        // نافذة جديدة ⇒ لا نُبقي خدمات مؤقّتة من فتحة سابقة
    pendingSeq = -1;
    const section = el('df-services-section');
    if (!section) return;
    section.classList.remove('hidden');
    if (!currentDeviceId) { renderPending(); return; }
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

  window.AdminServices = { mount, refresh, renderPending, pendingCount, flushPending };
})();
