// admin-locations-types.js: إدارة المواقع وأنواع الأجهزة في لوحة التحكم (CRUD كامل عبر الواجهة).
let currentLocationsSort = 'name'; // متغير عام لتخزين الترتيب الحالي للمواقع
let currentTypesSort = 'name'; // متغير عام لتخزين الترتيب الحالي للأنواع

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, String.fromCharCode(38) + 'amp;')
    .replace(/</g, String.fromCharCode(38) + 'lt;')
    .replace(/>/g, String.fromCharCode(38) + 'gt;')
    .replace(/"/g, String.fromCharCode(38) + 'quot;')
    .replace(/'/g, String.fromCharCode(38) + '#39;');
}

async function api(url, opts) {
  const r = await fetch(url, opts);
  return r.json();
}

// ============ المواقع ============
async function loadLocations() {
  const r = await api('/api/locations');
  const tbody = document.getElementById('locations-table-body');
  tbody.innerHTML = '';
  if (!r.success) return;
  
  // تطبيق الترتيب
  const sortBy = currentLocationsSort;
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
  
  for (const l of sortedData) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${l.id}</td>
      <td>${esc(l.name)}</td>
      <td>
        <button class="btn" data-edit="${l.id}">تعديل</button>
        <button class="btn btn-danger" data-del="${l.id}">حذف</button>
      </td>
    `;
    tr.querySelector('[data-edit]').addEventListener('click', () => editLocation(l));
    tr.querySelector('[data-del]').addEventListener('click', () => deleteLocation(l.id, l.name));
    tbody.appendChild(tr);
  }
}

function resetLocationForm() {
  document.getElementById('location-form-id').value = '';
  document.getElementById('loc-name').value = '';
}

function editLocation(loc) {
  document.getElementById('location-form-id').value = loc.id;
  document.getElementById('loc-name').value = loc.name;
}

async function saveLocation() {
  const id = document.getElementById('location-form-id').value;
  const name = document.getElementById('loc-name').value.trim();
  if (!name) { alert('الاسم مطلوب'); return; }
  const url = id ? '/api/locations/' + id : '/api/locations';
  const method = id ? 'PUT' : 'POST';
  const r = await api(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parent_id: null }),
  });
  if (r.success) {
    resetLocationForm();
    await loadLocations();
    // تحديث قائمة المواقع في نموذج الجهاز إن كان مُحمَّلاً.
    if (typeof window.__reloadFormOptions === 'function') window.__reloadFormOptions();
  } else {
    alert(r.error || 'فشل الحفظ');
  }
}

async function deleteLocation(id, name) {
  if (!confirm('تأكيد حذف الموقع: ' + name + '؟')) return;
  const r = await api('/api/locations/' + id, { method: 'DELETE' });
  if (r.success) {
    await loadLocations();
  } else {
    alert(r.error || 'فشل الحذف');
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
    tr.innerHTML = `
      <td>${t.id}</td>
      <td>${esc(t.name)}</td>
      <td>${esc(t.icon || '-')}</td>
      <td>
        <button class="btn" data-edit="${t.id}">تعديل</button>
        <button class="btn btn-danger" data-del="${t.id}">حذف</button>
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

function editType(t) {
  document.getElementById('type-form-id').value = t.id;
  document.getElementById('type-name').value = t.name;
  document.getElementById('type-icon').value = t.icon || '';
}

async function saveType() {
  const id = document.getElementById('type-form-id').value;
  const name = document.getElementById('type-name').value.trim();
  const icon = document.getElementById('type-icon').value.trim();
  if (!name) { alert('الاسم مطلوب'); return; }
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
  } else {
    alert(r.error || 'فشل الحفظ');
  }
}

async function deleteType(id, name) {
  if (!confirm('تأكيد حذف النوع: ' + name + '؟')) return;
  const r = await api('/api/device-types/' + id, { method: 'DELETE' });
  if (r.success) {
    await loadTypes();
  } else {
    alert(r.error || 'فشل الحذف');
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

  // مستمع تغيير الترتيب للأنواع
  const sortTypesEl = document.getElementById('filter-sort-types');
  if (sortTypesEl) {
    sortTypesEl.addEventListener('change', (e) => {
      currentTypesSort = e.target.value;
      loadTypes();
    });
  }
});
