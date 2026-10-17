// admin-locations-types.js: إدارة المواقع وأنواع الأجهزة في لوحة التحكم (CRUD كامل عبر الواجهة).
// ملاحظة: esc و api مُعرّفتان في admin-utils.js (يُحمَّل أولاً).
let currentLocationsSort = 'name'; // متغير عام لتخزين الترتيب الحالي للمواقع
let currentTypesSort = 'name'; // متغير عام لتخزين الترتيب الحالي للأنواع

// دالة لتحويل اسم الأيقونة إلى إيموجي
// v2.15.2 — إصدار محسّن:
//   • لو القيمة المحفوظة إيموجي مباشرة تُعرض كما هي (كانت تتحول ❓ خطأً).
//   • لو الاسم غير معروف ⇒ استنتاج من **اسم النوع** نفسه (عربي/إنجليزي) ثم 🏷️ عامة — لا ❓.
function getIconEmoji(iconName) {
  if (!iconName) return '';
  const v = String(iconName).trim();
  if (v && !/^[a-z0-9 _-]+$/i.test(v)) return v;   // إيموجي محفوظ مباشرة
  const key = v.toLowerCase().replace(/[_\s-]+/g, '');
  const map = {
    server: '🖥️', router: '📶', switch: '🔌', firewall: '🛡️', printer: '🖨️',
    camera: '📷', nvr: '📹', dvr: '📹', 'accesspoint': '📡', ap: '📡', wifi: '📡',
    nas: '💾', ups: '🔋', sensor: '📟', phone: '📞', pc: '💻', laptop: '💻',
    workstation: '🖥️', vm: '☁️', cloud: '☁️', database: '🗄️', web: '🌐',
    scanner: '📠', gateway: '🌐', isp: '🌐', modem: '📶', tv: '📺',
  };
  if (map[key]) return map[key];
  return '';   // v2.15.2 — غير معروف ⇒ يُستنتج من اسم النوع في الاستدعاء
}
// v2.15.2 — استنتاج الأيقونة من اسم النوع (يُستعمل كذلك عند غياب أيقونة محفوظة).
function inferByName(typeName) {
  const n = String(typeName || '').toLowerCase();
  const has = (arr) => arr.some((w) => n.includes(w));
  if (has(['طابعة', 'طباعه', 'printer', 'ماسح', 'scanner', 'تصوير', 'plotter'])) return '🖨️';
  if (has(['كاميرا', 'camera', 'مراقبة', 'hikvision', 'dahua'])) return '📷';
  if (has(['nvr', 'dvr', 'تسجيل', 'recorder'])) return '📹';
  if (has(['سويتش', 'switch', 'موزع', 'موزّع'])) return '🔌';
  if (has(['راوتر', 'راوتر', 'رorter', 'router', 'مودم', 'modem'])) return '📶';
  if (has(['جدار', 'firewall', 'حماية', 'بوابة', 'gateway', 'sophos', 'ميكروتيك', 'mikrotik'])) return '🛡️';
  if (has(['واي فاي', 'واي-فاي', 'wifi', 'wi-fi', 'access point', 'نقطة', 'unifi', 'اكسس'])) return '📡';
  if (has(['سيرفر', 'سرفر', 'server', 'nas', 'خادم', 'synology', 'qnap', 'esxi', 'vmware'])) return '🖥️';
  if (has(['ups'])) return '🔋';
  if (has(['كمبيوتر', 'حاسب', 'pc', 'laptop', 'لاب'])) return '💻';
  if (has(['isp', 'خط', 'فايبر', 'fiber', 'gpon', 'ont', 'olt', 'إنترنت', 'انترنت'])) return '🌐';
  return '🏷️';
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
    o.textContent = `${kl.icon} ${kl.label} — ${l.name}`;
    sel.appendChild(o);
  }
  // أُعيد القيمة السابقة لو ما زالت موجُودة.
  if (prevValue && [...sel.options].some((o) => o.value === prevValue)) {
    sel.value = prevValue;
  }
}

// v2.11.0 — قائمة «يتبع (خريطة المواقع)» (map_parent_id) — رابط مستقل تمامًا عن
// parent_id («متصل عبر» في سلسلة الشبكة). تستثني currentId لمنع الإشارة الذاتية.
function populateMapParentSelect(currentId) {
  const sel = document.getElementById('loc-map_parent_id');
  if (!sel) return;
  const prevValue = sel.value;
  sel.innerHTML = '<option value="">— بطاقة مستقلة (بلا أب في الخريطة) —</option>';
  for (const l of currentLocations) {
    if (currentId != null && Number(l.id) === Number(currentId)) continue;
    const kl = KIND_LABEL[l.kind] || { icon: '📍', label: l.kind || 'zone' };
    const o = document.createElement('option');
    o.value = l.id;
    o.textContent = `${kl.icon} ${kl.label} — ${l.name}`;
    sel.appendChild(o);
  }
  if (prevValue && [...sel.options].some((o) => o.value === prevValue)) {
    sel.value = prevValue;
  }
}

async function loadLocations() {
  const r = await api('/api/locations');
  const tbody = document.getElementById('locations-table-body');
  const emptyBox = document.getElementById('locations-empty');
  tbody.innerHTML = '';
  if (!r.success) { currentLocations = []; if (emptyBox) emptyBox.classList.add('hidden'); return; }
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

  // حالة فارغة صريحة
  if (emptyBox) emptyBox.classList.toggle('hidden', sortedData.length > 0);

  // خريطة id→name لِـ عرض اسم الأَب في الجدول.
  const nameById = new Map(r.data.map((l) => [l.id, l.name]));

  for (const l of sortedData) {
    const kl = KIND_LABEL[l.kind] || { icon: '📍', label: l.kind || 'zone' };
    const parentName = l.parent_id != null ? nameById.get(l.parent_id) : null;
    const sortOrderDisplay = (l.sort_order != null) ? esc(String(l.sort_order)) : '<span style="color:var(--muted);">—</span>';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="col-center">${l.id}</td>
      <td>${esc(l.name)}</td>
      <td>${kl.icon} ${kl.label}</td>
      <td>${parentName ? esc(parentName) : '<span class="nm-muted">—</span>'}</td>
      <td class="col-center">${sortOrderDisplay}</td>
      <td class="col-actions">
        <button class="btn" data-edit="${l.id}" title="${T('s2x.edit_the_location', "تعديل الموقع")}">${T('common.edit', '✏️ تعديل')}</button>
        <button class="btn btn-danger" data-del="${l.id}" title="${T('s2x.delete_the_location', "حذف الموقع")}">${T('common.delete', '🗑️ حذف')}</button>
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
  populateMapParentSelect(null); // v2.11.0 — «يتبع (خريطة المواقع)».
}

// v2.7.4 — فتح popup modal لإِضافة موقع جديد (بَدل form-card المضمّن).
function openLocationForm() {
  resetLocationForm();
  document.getElementById('location-form-title').textContent = 'إضافة موقع';
  openEditModal(document.getElementById('location-modal'), {
    focusSelector: '#loc-name',
    onClose: () => resetLocationForm(),
  });
}

async function editLocation(loc) {
  // v2.7.4 — نَقل النموذج من inline إلى popup modal: لا حاجة لتَأكيد قبل الفتح
  // (الـ popup بِأَصلِه نيّة تَعديل). نَعبّئ الحقول ثُمّ نَفتح modal.
  document.getElementById('location-form-id').value = loc.id;
  document.getElementById('loc-name').value = loc.name || '';
  const kindSel = document.getElementById('loc-kind');
  if (kindSel) kindSel.value = loc.kind || 'zone';
  populateParentSelect(loc.id);
  const parentSel = document.getElementById('loc-parent_id');
  if (parentSel) parentSel.value = loc.parent_id != null ? String(loc.parent_id) : '';
  // v2.11.0 — «يتبع (خريطة المواقع)» (map_parent_id) — رابط مستقل.
  populateMapParentSelect(loc.id);
  const mapParentSel = document.getElementById('loc-map_parent_id');
  if (mapParentSel) mapParentSel.value = loc.map_parent_id != null ? String(loc.map_parent_id) : '';
  // v2.7.1 — ملء حقل التَرتيب من بيانات الموقع.
  const sortEl = document.getElementById('loc-sort-order');
  if (sortEl) sortEl.value = (loc.sort_order != null) ? String(loc.sort_order) : '';
  document.getElementById('location-form-title').textContent = 'تعديل موقع #' + loc.id;
  openEditModal(document.getElementById('location-modal'), {
    focusSelector: '#loc-name',
    onClose: () => resetLocationForm(),
  });
}

async function saveLocation() {
  const id = document.getElementById('location-form-id').value;
  const name = document.getElementById('loc-name').value.trim();
  if (!name) { showToast(T('s2j.name_is_required', 'الاسم مطلوب'), { type: 'warning' }); return; }
  const kindSel = document.getElementById('loc-kind');
  const parentSel = document.getElementById('loc-parent_id');
  const sortEl = document.getElementById('loc-sort-order');
  const kind = kindSel ? kindSel.value : 'zone';
  // v2.7.1 — عند تعديل موقع موجود (PUT) نَطلب تَأكيد الحفظ (مَطلب 5).
  if (id) {
    const ok = await confirmAction({
      title: T('s2j.confirm_saving_the_changes', 'تَأكيد حفظ التعديل'),
      message: T('s2j.confirm_saving_the_location_changes', 'تَأكيد حفظ تعديل الموقع:') + ' ' + name + '؟',
      confirmText: '✓ تَأكيد الحفظ',
    });
    if (!ok) return;
  }
  // لو kind=internet فالأَب لا يَُهم (الخادم يَضبط parent_id=null بصمت). أَوَّلًا نُخبر المستخدم.
  if (kind === 'internet' && parentSel && parentSel.value) {
    const ok = await confirmAction({
      title: T('s2j.notice_the_internet_kind', 'تَنبيه: نوع «internet»'),
      message: T('s2j.the_internet_kind_is_always_the_top_of_the_p', 'نوع «internet» يَكون دائمًا قمة الهَرم (لا أَب). سيُتجاهل الموقع الأَب المُختار. مُتابعة؟'),
      confirmText: '✓ مُتابعة',
    });
    if (!ok) return;
  }
  const parentId = parentSel && parentSel.value ? Number(parentSel.value) : null;
  // v2.11.0 — «يتبع (خريطة المواقع)»: قيمة فارغة = null (بطاقة مستقلة في الخريطة).
  const mapParentSel = document.getElementById('loc-map_parent_id');
  const mapParentId = mapParentSel && mapParentSel.value ? Number(mapParentSel.value) : null;
  // v2.7.1 — قيمة sort_order: فارغة = نُرسِل '' (الخادم يَضبطها تلقائياً max+1 في POST
  //، أَو يُبقيها في PUT). رقم = نُرسله number.
  const sortOrderRaw = sortEl ? sortEl.value.trim() : '';
  const sortOrderVal = sortOrderRaw === '' ? '' : Number(sortOrderRaw);
  const url = id ? '/api/locations/' + id : '/api/locations';
  const method = id ? 'PUT' : 'POST';
  const r = await api(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, kind, parent_id: parentId, sort_order: sortOrderVal, map_parent_id: mapParentId }),
  });
  if (r.success) {
    resetLocationForm();
    closeEditModal(document.getElementById('location-modal'));
    await loadLocations();
    // تحديث قائمة المواقع في نموذج الجهاز + فلتر devices إن كان مُحمَّلاً.
    if (typeof window.__reloadFormOptions === 'function') window.__reloadFormOptions();
    showToast(T('s2j.location_saved', '✅ تَم حِفظ الموقع'), { type: 'success' });
  } else {
    showToast(r.error || 'فشل الحفظ', { type: 'error' });
  }
}

async function deleteLocation(id, name) {
  const ok = await confirmAction({
    title: T('s2j.confirm_deleting_the_location', 'تَأكيد حذف الموقع'),
    message: T('s2j.confirm_deleting_the_location_2', 'تَأكيد حذف الموقع:') + ' ' + name + '؟\nملاحظة: الأَبناء يُصبحُون جذورًا، والأَجهزة المُرتبطة تُصبح غير مُعَيَّنة.',
    confirmText: T('common.delete', '🗑️ حذف'),
    danger: true,
  });
  if (!ok) return;
  const r = await api('/api/locations/' + id, { method: 'DELETE' });
  if (r.success) {
    await loadLocations();
    if (typeof window.__reloadFormOptions === 'function') window.__reloadFormOptions();
    showToast(T('s2j.location_deleted', '✅ تَم حَذف الموقع'), { type: 'success' });
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
  
  const emptyBox = document.getElementById('types-empty');
  if (emptyBox) emptyBox.classList.toggle('hidden', sortedData.length > 0);

  for (const t of sortedData) {
    const tr = document.createElement('tr');
    const iconEmoji = getIconEmoji(t.icon) || inferByName(t.name);
    tr.innerHTML = `
      <td class="col-center">${t.id}</td>
      <td>${esc(t.name)}</td>
      <td class="col-center" style="font-size:1.2rem;">${iconEmoji}</td>
      <td class="col-actions">
        <button class="btn btn-sm" data-edit="${t.id}" title="${T('s2x.edit_the_type', "تعديل النوع")}">${T('common.edit', '✏️ تعديل')}</button>
        <button class="btn btn-sm btn-danger" data-del="${t.id}" title="${T('s2x.delete_the_type', "حذف النوع")}">${T('common.delete', '🗑️ حذف')}</button>
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

// v2.7.4 — فتح popup modal لإِضافة نوع جديد (بَدل form-card المضمّن).
function openTypeForm() {
  resetTypeForm();
  document.getElementById('type-form-title').textContent = 'إضافة نوع';
  openEditModal(document.getElementById('type-modal'), {
    focusSelector: '#type-name',
    onClose: () => resetTypeForm(),
  });
}

async function editType(t) {
  // v2.7.4 — نَقل النموذج من inline إلى popup modal: لا حاجة لتَأكيد قبل الفتح.
  document.getElementById('type-form-id').value = t.id;
  document.getElementById('type-name').value = t.name;
  document.getElementById('type-icon').value = t.icon || '';
  document.getElementById('type-form-title').textContent = 'تعديل نوع #' + t.id;
  openEditModal(document.getElementById('type-modal'), {
    focusSelector: '#type-name',
    onClose: () => resetTypeForm(),
  });
}

async function saveType() {
  const id = document.getElementById('type-form-id').value;
  const name = document.getElementById('type-name').value.trim();
  const icon = document.getElementById('type-icon').value.trim();
  if (!name) { showToast(T('s2j.name_is_required', 'الاسم مطلوب'), { type: 'warning' }); return; }
  // v2.7.1 (مَطلب 5) — تَأكيد الحفظ فقط في وضع التعديل.
  if (id) {
    const ok = await confirmAction({
      title: T('s2j.confirm_saving_the_changes', 'تَأكيد حفظ التعديل'),
      message: T('s2j.confirm_saving_the_type_changes', 'تَأكيد حفظ تعديل النوع:') + ' ' + name + '؟',
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
    closeEditModal(document.getElementById('type-modal'));
    await loadTypes();
    if (typeof window.__reloadFormOptions === 'function') window.__reloadFormOptions();
    showToast(T('s2j.type_saved', '✅ تَم حِفظ النوع'), { type: 'success' });
  } else {
    showToast(r.error || 'فشل الحفظ', { type: 'error' });
  }
}

async function deleteType(id, name) {
  const ok = await confirmAction({
    title: T('s2j.confirm_deleting_the_type', 'تَأكيد حذف النوع'),
    message: T('s2j.confirm_deleting_the_type_2', 'تَأكيد حذف النوع:') + ' ' + name + '؟',
    confirmText: T('common.delete', '🗑️ حذف'),
    danger: true,
  });
  if (!ok) return;
  const r = await api('/api/device-types/' + id, { method: 'DELETE' });
  if (r.success) {
    await loadTypes();
    showToast(T('s2j.type_deleted', '✅ تَم حذف النوع'), { type: 'success' });
  } else {
    showToast(r.error || 'فشل الحذف', { type: 'error' });
  }
}

// ====== التهيئة ======
document.addEventListener('DOMContentLoaded', async () => {
  await loadLocations();
  await loadTypes();

  document.getElementById('loc-save-btn').addEventListener('click', saveLocation);
  document.getElementById('loc-cancel-btn').addEventListener('click', () => closeEditModal(document.getElementById('location-modal')));
  document.getElementById('type-save-btn').addEventListener('click', saveType);
  document.getElementById('type-cancel-btn').addEventListener('click', () => closeEditModal(document.getElementById('type-modal')));

  // v2.7.4 — أَزرار الإِضافة الجديدة تَفتح popup modal فارغ.
  const addLocationBtn = document.getElementById('add-location-btn');
  if (addLocationBtn) addLocationBtn.addEventListener('click', openLocationForm);
  const addTypeBtn = document.getElementById('add-type-btn');
  if (addTypeBtn) addTypeBtn.addEventListener('click', openTypeForm);

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
