// admin-locations-types.js: إدارة المواقع وأنواع الأجهزة في لوحة التحكم (CRUD كامل عبر الواجهة).
// ملاحظة: esc و api مُعرّفتان في admin-utils.js (يُحمَّل أولاً).
let currentLocationsSort = 'name'; // متغير عام لتخزين الترتيب الحالي للمواقع
let currentTypesSort = 'name'; // متغير عام لتخزين الترتيب الحالي للأنواع

// دالة لتحويل اسم الأيقونة إلى إيموجي
function getIconEmoji(iconName) {
  if (!iconName) return '❓';
  const iconMap = {
    'server': '🖥️',
    'router': '🌐',
    'switch': '🔀',
    'firewall': '🛡️',
    'printer': '🖨️',
    'camera': '📷',
    'nvr': '📹',
    'dvr': '📼',
    'access-point': '📡',
    'ap': '📡',
    'nas': '💾',
    'ups': '🔋',
    'sensor': '📟',
    'phone': '📞',
    'pc': '💻',
    'laptop': '💻',
    'workstation': '🖥️',
    'vm': '☁️',
    'cloud': '☁️',
    'database': '🗄️',
    'web': '🌐',
    'mail': '📧',
    'dns': '🔍',
    'dhcp': '🔢',
    'vpn': '🔐',
    'load-balancer': '⚖️',
    'proxy': '🔀',
    'gateway': '🚪',
    'modem': '📡',
    'bridge': '🌉',
    'repeater': '📶',
    'extender': '📶',
    'controller': '🎮',
    'iot': '🏠',
    'smart-home': '🏠',
    'tv': '📺',
    'display': '🖥️',
    'projector': '📽️',
    'scanner': '📄',
    'fax': '📠',
    'pos': '💳',
    'atm': '🏧',
    'kiosk': '🏪',
    'default': '📦',
    'network': '🌐',
    'wifi': '📶',
    'wireless': '📶',
    'shield': '🛡️',
  };
  const key = iconName.toLowerCase().trim();
  return iconMap[key] || iconMap['default'];
}

// ============ المواقع ============
// مخبأ لِـ قائمة المواقع الكاملة (يُستَعمل لِـ ملء قائمة parent_id وتحرير الجدول).
// مفتاح لنوع الموقع حسبّ kind خريطة أَيقونة + تسمية عربية قَصيرة.
const KIND_LABEL = {
  internet: { icon: '🌐', label: 'إنترنت' },
  zone: { icon: '📍', label: 'منطقة' },
  site: { icon: '🏛️', label: 'موقع' },
  building: { icon: '🏢', label: 'مبنى' },
  floor: { icon: '📐', label: 'طابق' },
  room: { icon: '🚪', label: 'غرفة' },
  rack: { icon: '🗄️', label: 'خزانة' },
};
let currentLocations = []; // نسخة من آخر قائمة locations لُكلها في parent_id.
let currentKindFilter = ''; // فلتر النوع الحالي (فارغ = الكل).

// يَبني خيار `<option>` لِـ parent_id (يَستثني currentId لِـ منع الإِشارة الذاتية).
function populateParentSelect(currentId) {
  const sel = document.getElementById('loc-parent_id');
  if (!sel) return;
  const prevValue = sel.value; // أُحافظ على الاختيار عند إِعادة التَعبئة.
  sel.innerHTML = '<option value="">— جذر (لا أَب) —</option>';
  for (const l of currentLocations) {
    if (currentId != null && Number(l.id) === Number(currentId)) continue; // منع ذاتي.
    const kl = KIND_LABEL[l.kind] || { icon: '📍', label: l.kind || 'zone' };
    const o = document.createElement('option');
    o.value = l.id;
    o.textContent = `${kl.icon} [${l.kind || 'zone'}] ${l.name}`;
    sel.appendChild(o);
  }
  // أُعيد القيمة السابقة لو ما زالت موجُودة.
  if (prevValue && [...sel.options].some((o) => o.value === prevValue)) {
    sel.value = prevValue;
  }
}

async function loadLocations() {
  const r = await api('/api/locations');
  const tbody = document.getElementById('locations-table-body');
  tbody.innerHTML = '';
  if (!r.success) { currentLocations = []; return; }
  currentLocations = r.data;

  // فلتر النوع (client-side).
  const filteredData = currentKindFilter
    ? r.data.filter((l) => l.kind === currentKindFilter)
    : r.data;

  // تطبيق الترتيب
  const sortBy = currentLocationsSort;
  const sortedData = [...filteredData].sort((a, b) => {
    let valA, valB;
    switch (sortBy) {
      case 'name':
        valA = (a.name || '').toLowerCase();
        valB = (b.name || '').toLowerCase();
        break;
      case 'id':
        valA = a.id || 0;
        valB = b.id || 0;
        break;
      case 'sort_order':
        // v2.7.1 — تَرتيب حسب sort_order أَوّلاً (نفس ترتيب خريطة المواقع) ثُمّ id لِـ ثَبات.
        valA = (a.sort_order ?? 0);
        valB = (b.sort_order ?? 0);
        if (valA !== valB) return valA - valB;
        return (a.id || 0) - (b.id || 0);
      default:
        return 0;
    }
    if (valA < valB) return -1;
    if (valA > valB) return 1;
    return 0;
  });

  // خريطة id→name لِـ عرض اسم الأَب في الجدول.
  const nameById = new Map(r.data.map((l) => [l.id, l.name]));

  for (const l of sortedData) {
    const kl = KIND_LABEL[l.kind] || { icon: '📍', label: l.kind || 'zone' };
    const parentName = l.parent_id != null ? nameById.get(l.parent_id) : null;
    const sortOrderDisplay = (l.sort_order != null) ? esc(String(l.sort_order)) : '<span style="color:var(--muted);">—</span>';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${l.id}</td>
      <td>${esc(l.name)}</td>
      <td>${kl.icon} ${kl.label} <span style="color:var(--muted); font-size:0.85em;">(${l.kind || 'zone'})</span></td>
      <td>${parentName ? esc(parentName) : '<span style="color:var(--muted);">—</span>'}</td>
      <td style="text-align:center;">${sortOrderDisplay}</td>
      <td>
        <button class="btn" data-edit="${l.id}" title="تعديل الموقع">✏️ تعديل</button>
        <button class="btn btn-danger" data-del="${l.id}" title="حذف الموقع">🗑️ حذف</button>
      </td>
    `;
    tr.querySelector('[data-edit]').addEventListener('click', () => editLocation(l));
    tr.querySelector('[data-del]').addEventListener('click', () => deleteLocation(l.id, l.name));
    tbody.appendChild(tr);
  }

  // أُعيد تَعبئة parent_id (يَستثني null = إِضافة جديدة، فلا تَستثني أحدًا).
  populateParentSelect(document.getElementById('location-form-id').value);
}

function resetLocationForm() {
  document.getElementById('location-form-id').value = '';
  document.getElementById('loc-name').value = '';
  const kindSel = document.getElementById('loc-kind');
  if (kindSel) kindSel.value = 'zone';
  // v2.7.1 — تصفير حقل التَرتيب (قيمة فارغة = تَرتيب تلقائي عند الإِضافة).
  const sortEl = document.getElementById('loc-sort-order');
  if (sortEl) sortEl.value = '';
  populateParentSelect(null); // لإِضافة جديد: لا تَستثني أَحدًا.
}

async function editLocation(loc) {
  // v2.7.1 (مَطلب 5) — تَأكيد قبل فتح نموذج التعديل.
  const ok = await confirmAction({
    title: 'تَأكيد التعديل',
    message: 'هل تريد تعديل الموقع: ' + (loc.name || ('#' + loc.id)) + '؟',
    confirmText: '✓ متابعة التعديل',
  });
  if (!ok) return;
  document.getElementById('location-form-id').value = loc.id;
  document.getElementById('loc-name').value = loc.name || '';
  const kindSel = document.getElementById('loc-kind');
  if (kindSel) kindSel.value = loc.kind || 'zone';
  populateParentSelect(loc.id);
  const parentSel = document.getElementById('loc-parent_id');
  if (parentSel) parentSel.value = loc.parent_id != null ? String(loc.parent_id) : '';
  // v2.7.1 — ملء حقل التَرتيب من بيانات الموقع.
  const sortEl = document.getElementById('loc-sort-order');
  if (sortEl) sortEl.value = (loc.sort_order != null) ? String(loc.sort_order) : '';
}

async function saveLocation() {
  const id = document.getElementById('location-form-id').value;
  const name = document.getElementById('loc-name').value.trim();
  if (!name) { showToast('الاسم مطلوب', { type: 'warning' }); return; }
  const kindSel = document.getElementById('loc-kind');
  const parentSel = document.getElementById('loc-parent_id');
  const sortEl = document.getElementById('loc-sort-order');
  const kind = kindSel ? kindSel.value : 'zone';
  // v2.7.1 — عند تعديل موقع موجود (PUT) نَطلب تَأكيد الحفظ (مَطلب 5).
  if (id) {
    const ok = await confirmAction({
      title: 'تَأكيد حفظ التعديل',
      message: 'تَأكيد حفظ تعديل الموقع: ' + name + '؟',
      confirmText: '✓ تَأكيد الحفظ',
    });
    if (!ok) return;
  }
  // لو kind=internet فالأَب لا يَُهم (الخادم يَضبط parent_id=null بصمت). أَوَّلًا نُخبر المستخدم.
  if (kind === 'internet' && parentSel && parentSel.value) {
    const ok = await confirmAction({
      title: 'تَنبيه: نوع «internet»',
      message: 'نوع «internet» يَكون دائمًا قمة الهَرم (لا أَب). سيُتجاهل الموقع الأَب المُختار. مُتابعة؟',
      confirmText: '✓ مُتابعة',
    });
    if (!ok) return;
  }
  const parentId = parentSel && parentSel.value ? Number(parentSel.value) : null;
  // v2.7.1 — قيمة sort_order: فارغة = نُرسِل '' (الخادم يَضبطها تلقائياً max+1 في POST
  //، أَو يُبقيها في PUT). رقم = نُرسله number.
  const sortOrderRaw = sortEl ? sortEl.value.trim() : '';
  const sortOrderVal = sortOrderRaw === '' ? '' : Number(sortOrderRaw);
  const url = id ? '/api/locations/' + id : '/api/locations';
  const method = id ? 'PUT' : 'POST';
  const r = await api(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, kind, parent_id: parentId, sort_order: sortOrderVal }),
  });
  if (r.success) {
    resetLocationForm();
    await loadLocations();
    // تحديث قائمة المواقع في نموذج الجهاز + فلتر devices إن كان مُحمَّلاً.
    if (typeof window.__reloadFormOptions === 'function') window.__reloadFormOptions();
    showToast('✅ تَم حِفظ الموقع', { type: 'success' });
  } else {
    showToast(r.error || 'فشل الحفظ', { type: 'error' });
  }
}

async function deleteLocation(id, name) {
  const ok = await confirmAction({
    title: 'تَأكيد حذف الموقع',
    message: 'تَأكيد حذف الموقع: ' + name + '؟\nملاحظة: الأَبناء يُصبحُون جذورًا، والأَجهزة المُرتبطة تُصبح غير مُعَيَّنة.',
    confirmText: '🗑️ حذف',
    danger: true,
  });
  if (!ok) return;
  const r = await api('/api/locations/' + id, { method: 'DELETE' });
  if (r.success) {
    await loadLocations();
    if (typeof window.__reloadFormOptions === 'function') window.__reloadFormOptions();
    showToast('✅ تَم حَذف الموقع', { type: 'success' });
  } else {
    showToast(r.error || 'فشل الحذف', { type: 'error' });
  }
}


// ============ الأنواع ============
async function loadTypes() {
  const r = await api('/api/device-types');
  const tbody = document.getElementById('types-table-body');
  tbody.innerHTML = '';
  if (!r.success) return;
  
  // تطبيق الترتيب
  const sortBy = currentTypesSort;
  const sortedData = [...r.data].sort((a, b) => {
    let valA, valB;
    switch (sortBy) {
      case 'name':
        valA = (a.name || '').toLowerCase();
        valB = (b.name || '').toLowerCase();
        break;
      case 'id':
        valA = a.id || 0;
        valB = b.id || 0;
        break;
      default:
        return 0;
    }
    if (valA < valB) return -1;
    if (valA > valB) return 1;
    return 0;
  });
  
  for (const t of sortedData) {
    const tr = document.createElement('tr');
    const iconEmoji = getIconEmoji(t.icon);
    tr.innerHTML = `
      <td>${t.id}</td>
      <td>${esc(t.name)}</td>
      <td style="text-align:center; font-size:1.2rem;">${iconEmoji}</td>
      <td>
        <button class="btn" data-edit="${t.id}" title="تعديل النوع">✏️ تعديل</button>
        <button class="btn btn-danger" data-del="${t.id}" title="حذف النوع">🗑️ حذف</button>
      </td>
    `;
    tr.querySelector('[data-edit]').addEventListener('click', () => editType(t));
    tr.querySelector('[data-del]').addEventListener('click', () => deleteType(t.id, t.name));
    tbody.appendChild(tr);
  }
}

function resetTypeForm() {
  document.getElementById('type-form-id').value = '';
  document.getElementById('type-name').value = '';
  document.getElementById('type-icon').value = '';
}

async function editType(t) {
  // v2.7.1 (مَطلب 5) — تَأكيد قبل فتح نموذج التعديل.
  const ok = await confirmAction({
    title: 'تَأكيد التعديل',
    message: 'هل تريد تعديل النوع: ' + (t.name || ('#' + t.id)) + '؟',
    confirmText: '✓ متابعة التعديل',
  });
  if (!ok) return;
  document.getElementById('type-form-id').value = t.id;
  document.getElementById('type-name').value = t.name;
  document.getElementById('type-icon').value = t.icon || '';
}

async function saveType() {
  const id = document.getElementById('type-form-id').value;
  const name = document.getElementById('type-name').value.trim();
  const icon = document.getElementById('type-icon').value.trim();
  if (!name) { showToast('الاسم مطلوب', { type: 'warning' }); return; }
  // v2.7.1 (مَطلب 5) — تَأكيد الحفظ فقط في وضع التعديل.
  if (id) {
    const ok = await confirmAction({
      title: 'تَأكيد حفظ التعديل',
      message: 'تَأكيد حفظ تعديل النوع: ' + name + '؟',
      confirmText: '✓ تَأكيد الحفظ',
    });
    if (!ok) return;
  }
  const url = id ? '/api/device-types/' + id : '/api/device-types';
  const method = id ? 'PUT' : 'POST';
  const r = await api(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, icon: icon || 'server' }),
  });
  if (r.success) {
    resetTypeForm();
    await loadTypes();
    if (typeof window.__reloadFormOptions === 'function') window.__reloadFormOptions();
    showToast('✅ تَم حِفظ النوع', { type: 'success' });
  } else {
    showToast(r.error || 'فشل الحفظ', { type: 'error' });
  }
}

async function deleteType(id, name) {
  const ok = await confirmAction({
    title: 'تَأكيد حذف النوع',
    message: 'تَأكيد حذف النوع: ' + name + '؟',
    confirmText: '🗑️ حذف',
    danger: true,
  });
  if (!ok) return;
  const r = await api('/api/device-types/' + id, { method: 'DELETE' });
  if (r.success) {
    await loadTypes();
    showToast('✅ تَم حذف النوع', { type: 'success' });
  } else {
    showToast(r.error || 'فشل الحذف', { type: 'error' });
  }
}

// ====== التهيئة ======
document.addEventListener('DOMContentLoaded', async () => {
  await loadLocations();
  await loadTypes();

  document.getElementById('loc-save-btn').addEventListener('click', saveLocation);
  document.getElementById('loc-cancel-btn').addEventListener('click', resetLocationForm);
  document.getElementById('type-save-btn').addEventListener('click', saveType);
  document.getElementById('type-cancel-btn').addEventListener('click', resetTypeForm);

  // مستمع تغيير الترتيب للمواقع
  const sortLocationsEl = document.getElementById('filter-sort-locations');
  if (sortLocationsEl) {
    sortLocationsEl.addEventListener('change', (e) => {
      currentLocationsSort = e.target.value;
      loadLocations();
    });
  }

  // مستمع فلتر النوع للمواقع (client-side filter على kind).
  const kindFilterEl = document.getElementById('filter-kind-locations');
  if (kindFilterEl) {
    kindFilterEl.addEventListener('change', (e) => {
      currentKindFilter = e.target.value;
      loadLocations();
    });
  }

  // مستمع تغيير الترتيب للأنواع
  const sortTypesEl = document.getElementById('filter-sort-types');
  if (sortTypesEl) {
    sortTypesEl.addEventListener('change', (e) => {
      currentTypesSort = e.target.value;
      loadTypes();
    });
  }
});
