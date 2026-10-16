// admin-assets.js (SpaceKit AST-03) — نافذة «الأصل»: هوية ثابتة + واجهات MAC + سجل IP + تعارضات.
//   GET  /api/assets/:id                 (يقبل NM-000123 أو رقم الجهاز — بجلسة)
//   POST /api/assets/:id/interfaces      (المدير) · .../interfaces/:id/deactivate (إيقاف بلا حذف)
//   POST /api/assets/:id/ip              (المدير) · POST /api/assets/conflicts/:id/resolve (قرار المدير)
// ملاحظة تصميم: القرارات هنا **يدوية بالكامل** — لا يوجد أي مسار دمج تلقائي (مطلب AST).
(function () {
  'use strict';

  let currentAssetKey = null; // NM-000123 أو رقم الجهاز
  let currentDetail = null;

  function el(id) { return document.getElementById(id); }

  function jsonApi(url, method, body) {
    return api(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
    });
  }

  function fmtTs(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString('ar');
  }

  function renderInterfaces(list) {
    const host = el('asset-interfaces');
    if (!host) return;
    if (!list.length) {
      host.innerHTML = '<span style="color:var(--muted);">لا واجهات مسجَّلة بعد — تُلتقط تلقائيًّا عند اعتماد جهاز من الاكتشاف، أو أضِفها يدويًّا.</span>';
      return;
    }
    host.innerHTML = list.map((i) => `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:.5rem; border:1px solid var(--border); border-radius:8px; padding:.35rem .55rem; margin-bottom:.3rem;">
        <span style="direction:ltr; font-family:monospace;">${esc(i.mac)}</span>
        <span style="color:var(--muted); font-size:.8rem;">
          ${esc(i.kind || 'غير معروف')} · ${esc(i.source)} · ثقة ${i.confidence}%
          ${i.is_active ? '' : ' · <b>موقوفة</b>'}
          ${i.first_seen_at ? ' · منذ ' + esc(fmtTs(i.first_seen_at)) : ''}
        </span>
        <span style="white-space:nowrap;">
          ${i.is_active ? `<button type="button" class="btn" data-iface-off="${i.id}" title="إيقاف الواجهة (يُحفظ السجل تاريخيًّا)">⏸</button>` : ''}
        </span>
      </div>`).join('');
  }

  function renderIps(list) {
    const host = el('asset-ips');
    if (!host) return;
    if (!list.length) {
      host.innerHTML = '<span style="color:var(--muted);">لا سجل عناوين بعد.</span>';
      return;
    }
    host.innerHTML = list.map((h) => `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:.5rem; border:1px solid var(--border); border-radius:8px; padding:.35rem .55rem; margin-bottom:.3rem;">
        <span style="direction:ltr; font-family:monospace;">${esc(h.ip)}</span>
        <span style="color:var(--muted); font-size:.8rem;">
          ${esc(h.source)} · ثقة ${h.confidence}%
          ${h.valid_to == null ? ' · <b style="color:#22c55e;">الحالي</b>' : ' · انتهى ' + esc(fmtTs(h.valid_to))}
        </span>
        <span style="color:var(--muted); font-size:.78rem;">من ${esc(fmtTs(h.valid_from || h.first_seen_at))}</span>
      </div>`).join('');
  }

  function renderConflicts(list) {
    const host = el('asset-conflicts');
    if (!host) return;
    if (!list.length) {
      host.innerHTML = '<span style="color:var(--muted);">لا تعارضات مفتوحة لهذا الأصل ✓</span>';
      return;
    }
    host.innerHTML = list.map((c) => {
      const kindAr = { suggested_merge: 'اقتراح ربط/دمج', ip_reused: 'إعادة استخدام عنوان', mac_duplicate: 'MAC مكرر' }[c.kind] || c.kind;
      const other = c.other ? `${esc(c.other.name)} (${esc(c.other.asset_id || '')})` : '—';
      const ev = c.evidence || {};
      return `
      <div style="border:1px solid #f59e0b; border-radius:8px; padding:.5rem .6rem; margin-bottom:.4rem; background:rgba(245,158,11,0.06);">
        <div><b>${kindAr}</b> — ضد: ${other}</div>
        <div style="color:var(--muted); font-size:.8rem;">
          الأدلة: ${ev.ip ? 'IP ' + esc(ev.ip) + ' · ' : ''}${ev.mac ? 'MAC ' + esc(ev.mac) + ' · ' : ''}${ev.source ? 'المصدر ' + esc(ev.source) + ' · ' : ''}ثقة ${ev.confidence != null ? ev.confidence : '—'}%
          ${ev.reasons ? ' · ' + esc([].concat(ev.reasons).join(', ')) : ''}
        </div>
        <div style="margin-top:.35rem; display:flex; gap:.4rem;">
          <button type="button" class="btn btn-primary" data-conflict-ok="${c.id}">✅ اعتماد (إرفاق الدليل)</button>
          <button type="button" class="btn" data-conflict-no="${c.id}">✖️ رفض</button>
        </div>
      </div>`;
    }).join('');
  }

  function renderDetail(detail) {
    currentDetail = detail;
    const title = el('asset-modal-title');
    if (title) title.textContent = '🔖 الأصل ' + (detail.asset_id || '') + ' — ' + (detail.name || '');
    const meta = el('asset-modal-meta');
    if (meta) {
      meta.textContent = 'الجهاز #' + detail.device_id
        + ' · IP الحالي: ' + (detail.ip || '—')
        + ' · الحالة: ' + (detail.overall_health || detail.current_status || '—')
        + (detail.is_active ? '' : ' · موقوف للمراقبة');
    }
    renderInterfaces(detail.interfaces || []);
    renderIps(detail.ip_history || []);
    renderConflicts(detail.conflicts || []);
  }

  async function refresh() {
    if (!currentAssetKey) return;
    const r = await api('/api/assets/' + encodeURIComponent(currentAssetKey));
    if (!r || !r.success) {
      const host = el('asset-interfaces');
      if (host) host.innerHTML = '<span style="color:#ef4444;">⚠️ ' + esc((r && r.error) || 'تعذّر جلب الأصل') + '</span>';
      return;
    }
    renderDetail(r.data);
  }

  async function addMac() {
    if (!currentDetail) return;
    const mac = el('asset-mac-input').value.trim();
    if (!mac) { showToast('أدخل عنوان MAC', { type: 'error' }); return; }
    const kind = el('asset-mac-kind').value || null;
    const r = await jsonApi('/api/assets/' + currentDetail.asset_id + '/interfaces', 'POST', { mac, kind });
    if (!r || !r.success) { showToast((r && r.error) || 'تعذّر إضافة الواجهة', { type: 'error' }); return; }
    el('asset-mac-input').value = '';
    showToast(r.data && r.data.conflict
      ? 'أُضيفت الواجهة — وأُنشئ تعارض هوية للمراجعة (لا دمج تلقائي)'
      : 'أُضيفت واجهة الشبكة ✓');
    refresh();
  }

  async function addIp() {
    if (!currentDetail) return;
    const ip = el('asset-ip-input').value.trim();
    if (!ip) { showToast('أدخل عنوان IP', { type: 'error' }); return; }
    const r = await jsonApi('/api/assets/' + currentDetail.asset_id + '/ip', 'POST', { ip, source: 'manual', confidence: 80 });
    if (!r || !r.success) { showToast((r && r.error) || 'تعذّر تسجيل العنوان', { type: 'error' }); return; }
    el('asset-ip-input').value = '';
    showToast(r.data && r.data.changed ? 'سُجِّل عنوان جديد وأُغلق السابق تاريخيًّا ✓' : 'العنوان مطابق للحالي — تم تحديث آخر ظهور ✓');
    refresh();
  }

  async function onBoxClick(e) {
    const offBtn = e.target.closest('button[data-iface-off]');
    if (offBtn && currentDetail) {
      const id = Number(offBtn.dataset.ifaceOff);
      const ok = await confirmAction({ message: 'إيقاف هذه الواجهة؟ (لن يُحذف السجل — يبقى في تاريخ الأصل)' });
      if (!ok) return;
      const r = await jsonApi('/api/assets/' + currentDetail.asset_id + '/interfaces/' + id + '/deactivate', 'POST');
      if (!r || !r.success) { showToast((r && r.error) || 'تعذّر الإيقاف', { type: 'error' }); return; }
      showToast('أُوقفت الواجهة (السجل محفوظ)');
      refresh();
      return;
    }
    const okBtn = e.target.closest('button[data-conflict-ok]');
    const noBtn = e.target.closest('button[data-conflict-no]');
    if (okBtn || noBtn) {
      const id = Number((okBtn || noBtn).dataset[okBtn ? 'conflictOk' : 'conflictNo']);
      const approve = !!okBtn;
      const ok = await confirmAction({
        message: approve
          ? 'اعتماد التعارض: سيُرفق دليل الجهاز الآخر بهذا الأصل (بلا حذف أي سجل تاريخي). متابعة؟'
          : 'رفض هذا التعارض؟ (لن يتغيّر أي شيء في البيانات)',
      });
      if (!ok) return;
      const r = await jsonApi('/api/assets/conflicts/' + id + '/resolve', 'POST', { action: approve ? 'approve' : 'reject' });
      if (!r || !r.success) { showToast((r && r.error) || 'تعذّر تنفيذ القرار', { type: 'error' }); return; }
      showToast(approve ? 'اعتُمد التعارض وأُرفق الدليل ✓ (مُسجَّل في التدقيق)' : 'رُفض التعارض ✓ (مُسجَّل في التدقيق)');
      refresh();
    }
  }

  function open(assetKey) {
    currentAssetKey = assetKey;
    const modal = el('asset-modal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
    }
    refresh();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const addBtn = el('asset-mac-add');
    if (addBtn) addBtn.addEventListener('click', addMac);
    const ipBtn = el('asset-ip-add');
    if (ipBtn) ipBtn.addEventListener('click', addIp);
    const box = el('asset-modal');
    if (box) {
      box.addEventListener('click', onBoxClick);
      const closeBtn = box.querySelector('.modal-close');
      if (closeBtn) closeBtn.addEventListener('click', () => box.classList.add('hidden'));
      box.addEventListener('click', (e) => { if (e.target === box) box.classList.add('hidden'); });
    }
  });

  window.AdminAssets = { open, refresh };
})();
