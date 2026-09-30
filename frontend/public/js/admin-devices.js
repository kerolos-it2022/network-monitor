// admin-devices.js: إدارة الأجهزة في لوحة التحكم (جلب، إضافة، تعديل، حذف، تسجيل خروج، حماية الجلسة).
// ملاحظة: esc و api مُعرّفتان في admin-utils.js (يُحمَّل أولاً).

// v2.7.5 — حفظ ترتيب وفلتر الأجهزة في localStorage ليَبقيا بعد refresh/تبديل التبويبات.
const DEVICES_SORT_KEY = 'nm.adminDevicesSort';
const DEVICES_FILTER_KEY = 'nm.adminDevicesFilter';
const VALID_DEVICES_SORTS = ['name', 'ip', 'status', 'type', 'location', 'last_checked'];

let currentDevicesSort = (() => {
  try {
    const saved = localStorage.getItem(DEVICES_SORT_KEY);
    return VALID_DEVICES_SORTS.includes(saved) ? saved : 'name';
  } catch (_) { return 'name'; }
})();
let currentLocationFilter = (() => {
  try {
    return localStorage.getItem(DEVICES_FILTER_KEY) || '';
  } catch (_) { return ''; }
})();

const ad = {}; // مساحة أسماء صغيرة لتفادي التضارب.

function statusText(status) {
  if (status === 'online') return 'متصل';
  if (status === 'offline') return 'متوقف';
  return 'غير معروف';
}

async function loadDevices() {
  const r = await api('/api/devices');
  const tbody = document.getElementById('devices-table-body');
  tbody.innerHTML = '';
  if (!r.success) return;

  // تَصفية client-side حسب location_id لو الفلتر فعّال (نَتفادى تَعديل SELECT في الخادم).
  const locFilter = currentLocationFilter ? Number(currentLocationFilter) : null;
  const filtered = locFilter != null
    ? r.data.filter((d) => Number(d.location_id) === locFilter)
    : r.data;

  // تطبيق الترتيب
  const sortBy = currentDevicesSort;
  const sortedData = [...filtered].sort((a, b) => {
    let valA, valB;
    switch (sortBy) {
      case 'name':
        valA = (a.name || '').toLowerCase();
        valB = (b.name || '').toLowerCase();
        break;
      case 'ip':
        valA = a.ip || '';
        valB = b.ip || '';
        break;
      case 'status':
        valA = a.current_status || '';
        valB = b.current_status || '';
        break;
      case 'type':
        valA = (a.device_type_name || '').toLowerCase();
        valB = (b.device_type_name || '').toLowerCase();
        break;
      case 'location':
        valA = (a.location_name || '').toLowerCase();
        valB = (b.location_name || '').toLowerCase();
        break;
      case 'last_checked':
        valA = a.last_checked ? new Date(a.last_checked).getTime() : 0;
        valB = b.last_checked ? new Date(b.last_checked).getTime() : 0;
        break;
      default:
        return 0;
    }
    if (valA < valB) return -1;
    if (valA > valB) return 1;
    return 0;
  });

  for (const d of sortedData) {
    // زر الفتح للأجهزة التي تدعم HTTP/HTTPS (فحص تلقائي)
    // v2.7.5 — web_port: لو مُحدَّد نَفتح على البورت المخصص (مثل 4444)، وإلا الافتراضي.
    const portSuffix = d.web_port ? ':' + d.web_port : '';
    let openBtn = '';
    if (d.https_accessible == 1) {
      const url = 'https://' + d.ip + portSuffix + '/';
      openBtn = '<button class="btn open-device-btn" data-url="' + esc(url) + '" title="فتح الواجهة (HTTPS' + (portSuffix ? ' على البورت ' + d.web_port : '') + ')">🔒 فتح HTTPS</button>';
    } else if (d.http_accessible == 1) {
      const url = 'http://' + d.ip + portSuffix + '/';
      openBtn = '<button class="btn open-device-btn" data-url="' + esc(url) + '" title="فتح الواجهة (HTTP' + (portSuffix ? ' على البورت ' + d.web_port : '') + ')">🌐 فتح HTTP</button>';
    }
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(d.name)}</td>
      <td>${esc(d.ip)}</td>
      <td>${esc(d.device_type_name || '-')}</td>
      <td>${esc(d.location_name || '-')}</td>
      <td>${esc(statusText(d.current_status))}</td>
      <td>
        ${openBtn}
        <button class="btn" data-edit="${d.id}" title="تعديل الجهاز">✏️ تعديل</button>
        <button class="btn btn-danger" data-del="${d.id}" title="حذف الجهاز">🗑️ حذف</button>
      </td>
    `;
    // مستمع زر الفتح
    if (openBtn) {
      tr.querySelector('.open-device-btn').addEventListener('click', function(e) {
        e.stopPropagation();
        window.open(this.dataset.url, '_blank');
      });
    }
    tr.querySelector('[data-edit]').addEventListener('click', () => startEditDevice(d.id));
    tr.querySelector('[data-del]').addEventListener('click', () => deleteDevice(d.id, d.name));
    tbody.appendChild(tr);
  }
}

// خريطة kind → (أيقونة, تسمية قَصيرة) لِـ عرض الخيارات في القائمة الهرمية.
const DEVICE_LOC_KIND = {
  internet: '🌐', zone: '📍', site: '🏛️', building: '🏢',
  floor: '📐', room: '🚪', rack: '🗄️',
};

async function loadFormOptions() {
  const [types, locs] = await Promise.all([
    api('/api/device-types'),
    api('/api/locations'),
  ]);
  const typeSel = document.getElementById('df-device_type_id');
  const locSel = document.getElementById('df-location_id');
  const filterLocSel = document.getElementById('filter-location-devices');
  typeSel.innerHTML = '';
  locSel.innerHTML = '<option value="">— بدون —</option>';
  // فلتر الجدول: خيار "كل المواقع" + خيارات هرمية لِـ كل موقع.
  if (filterLocSel) {
    filterLocSel.innerHTML = '<option value="">📍 كل المواقع</option>';
  }
  for (const t of types.success ? types.data : []) {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = t.name;
    typeSel.appendChild(o);
  }
  for (const l of locs.success ? locs.data : []) {
    const icon = DEVICE_LOC_KIND[l.kind] || '📍';
    const disp = `${icon} ${l.name}`;
    // خيار نموذج الجهاز (يَعرض الاسم مع أَيقونة النوع).
    const o = document.createElement('option');
    o.value = l.id;
    o.textContent = disp;
    locSel.appendChild(o);
    // خيار فلتر الجدول (نفس العرض).
    if (filterLocSel) {
      const f = document.createElement('option');
      f.value = l.id;
      f.textContent = disp;
      filterLocSel.appendChild(f);
    }
  }
  // إِعادة ضبط قيمة الفلتر لو ما زالت موجُودة (بَعْد إِعادة التَحميل من admin-locations).
  if (filterLocSel && currentLocationFilter) {
    if ([...filterLocSel.options].some((o) => o.value === currentLocationFilter)) {
      filterLocSel.value = currentLocationFilter;
    } else {
      // الموقع غير موجُود بعد (حُذِف) ← نَنظّف الذاكرة و localStorage لِـ تَجَنُّب بقاء قيمة غير صالحة.
      currentLocationFilter = '';
      filterLocSel.value = '';
      try { localStorage.removeItem(DEVICES_FILTER_KEY); } catch (_) {}
    }
  }
}

// إتاحة إعادة التحميل من ملف المواقع/الأنواع (يُستدعى تلقائياً بعد تغييرهما).
window.__reloadFormOptions = loadFormOptions;

function resetDeviceForm() {
  document.getElementById('device-form').reset();
  document.getElementById('device-form-id').value = '';
  document.getElementById('device-form-title').textContent = 'إضافة جهاز';
  document.getElementById('df-is_active').checked = true;
  document.getElementById('df-check_protocol').value = 'ping';
  document.getElementById('df-check_interval_seconds').value = 30;
  document.getElementById('df-failure_threshold').value = 3;
}

function openDeviceForm() {
  resetDeviceForm();
  document.getElementById('device-form-title').textContent = 'إضافة جهاز';
  openEditModal(document.getElementById('device-modal'), {
    // onClose يُطلق عند ✕/ESC/backdrop → نَضمن reset النموذج لِـ تَجنب بقاء بيانات قديمة.
    onClose: () => resetDeviceForm(),
  });
}

async function startEditDevice(id) {
  // v2.7.4 — نَقل النموذج من inline إلى popup modal: لا حاجة لتَأكيد قبل الفتح
  // (الـ popup بِأَصلِه نيّة تَعديل). نَكتفي بِـ جلب البيانات + تَعبئة + تَأكيد الحفظ لاحقًا.
  const r = await api('/api/devices/' + id);
  if (!r.success) { showToast(r.error || 'تعذر جلب الجهاز', { type: 'error' }); return; }
  const d = r.data;
  document.getElementById('device-form-id').value = d.id;
  document.getElementById('df-name').value = d.name;
  document.getElementById('df-ip').value = d.ip;
  document.getElementById('df-device_type_id').value = d.device_type_id;
  document.getElementById('df-location_id').value = d.location_id || '';
  document.getElementById('df-check_protocol').value = d.check_protocol;
  document.getElementById('df-port').value = d.port || '';
  document.getElementById('df-web_port').value = d.web_port || '';
  document.getElementById('df-check_interval_seconds').value = d.check_interval_seconds;
  document.getElementById('df-failure_threshold').value = d.failure_threshold;
  document.getElementById('df-is_active').checked = !!d.is_active;
  document.getElementById('device-form-title').textContent = 'تعديل جهاز #' + d.id;
  openEditModal(document.getElementById('device-modal'), {
    focusSelector: '#df-name',
    // onClose يُطلق عند ✕/ESC/backdrop → نَضمن reset النموذج لِـ تَجنب بقاء بيانات التعديل.
    onClose: () => resetDeviceForm(),
  });
}

async function submitDeviceForm(e) {
  e.preventDefault();
  const id = document.getElementById('device-form-id').value;
  const body = {
    name: document.getElementById('df-name').value.trim(),
    ip: document.getElementById('df-ip').value.trim(),
    device_type_id: Number(document.getElementById('df-device_type_id').value),
    location_id: document.getElementById('df-location_id').value
      ? Number(document.getElementById('df-location_id').value)
      : null,
    check_protocol: document.getElementById('df-check_protocol').value,
    port: document.getElementById('df-port').value
      ? Number(document.getElementById('df-port').value)
      : null,
    web_port: document.getElementById('df-web_port').value
      ? Number(document.getElementById('df-web_port').value)
      : null,
    check_interval_seconds: Number(document.getElementById('df-check_interval_seconds').value),
    failure_threshold: Number(document.getElementById('df-failure_threshold').value),
    is_active: document.getElementById('df-is_active').checked ? 1 : 0,
  };

  // v2.7.1 (مَطلب 5) — تَأكيد الحفظ فقط في وضع التعديل (id موجود). للإِضافة لا يَلزم.
  if (id) {
    const ok = await confirmAction({
      title: 'تَأكيد حفظ التعديل',
      message: 'تَأكيد حفظ تعديل الجهاز: ' + (body.name || '#' + id) + '؟',
      confirmText: '✓ تَأكيد الحفظ',
    });
    if (!ok) return;
  }

  const url = id ? '/api/devices/' + id : '/api/devices';
  const method = id ? 'PUT' : 'POST';
  const r = await api(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (r.success) {
    closeEditModal(document.getElementById('device-modal'));
    await loadDevices();
    showToast('✅ تَم حِفظ الجهاز', { type: 'success' });
  } else {
    // لو الخطأ يتعلق بتكرار IP، نظهر رسالة واضحة بدلاً من toast عام.
    const errMsg = r.error || 'فشل الحفظ';
    if (errMsg.includes('IP') || errMsg.includes('مسجّل')) {
      showToast('⚠️ ' + errMsg, { type: 'warning', duration: 6000 });
      // تظليل حقل IP لflutterattention المستخدم.
      const ipField = document.getElementById('df-ip');
      if (ipField) { ipField.focus(); ipField.select(); }
    } else {
      showToast(errMsg, { type: 'error' });
    }
  }
}

async function deleteDevice(id, name) {
  const ok = await confirmAction({
    title: 'تَأكيد حذف الجهاز',
    message: 'تَأكيد حذف الجهاز: ' + name + '؟',
    confirmText: '🗑️ حذف',
    danger: true,
  });
  if (!ok) return;
  const r = await api('/api/devices/' + id, { method: 'DELETE' });
  if (r.success) {
    await loadDevices();
    showToast('✅ تَم حَذف الجهاز', { type: 'success' });
  } else {
    showToast(r.error || 'فشل الحذف', { type: 'error' });
  }
}

async function exportDevicesExcel() {
  try {
    const r = await fetch('/api/devices/export/excel', { credentials: 'include' });
    if (!r.ok) throw new Error('فشل التصدير');
    const blob = await r.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'devices.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    showToast('✅ تَم تَصدير الملف', { type: 'success' });
  } catch (e) {
    showToast('خطأ في التصدير: ' + e.message, { type: 'error' });
  }
}

async function importDevicesExcel(file) {
  const formData = new FormData();
  formData.append('file', file);

  try {
    const r = await fetch('/api/devices/import/excel', {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });
    const data = await r.json();
    if (data.success) {
      const { imported, skipped, errors } = data.data;
      let msg = `تم الاستيراد: ${imported} جهاز، تم التخطي: ${skipped}`;
      if (errors.length) msg += '\nأخطاء:\n' + errors.join('\n');
      showToast(msg, { type: imported > 0 ? 'success' : 'warning', duration: 6000 });
      await loadDevices();
    } else {
      showToast('فشل الاستيراد: ' + (data.error || 'خطأ غير معروف'), { type: 'error' });
    }
  } catch (e) {
    showToast('خطأ في الاستيراد: ' + e.message, { type: 'error' });
  }
}

async function logoutNow() {
  await api('/api/auth/logout', { method: 'POST' });
  window.location.href = 'login.html';
}

// ====== تهيئة عند تحميل الصفحة ======
document.addEventListener('DOMContentLoaded', async () => {
  // التحقق من الجلسة.
  try {
    const me = await api('/api/auth/me');
    if (!me.success) { window.location.href = 'login.html'; return; }
  } catch (e) {
    window.location.href = 'login.html';
    return;
  }

  await loadFormOptions();
  await loadDevices();

  // اِستماع لِـ حدث «اِنتقاء موقع من شجرة المواقع» (من admin-map.js).
  // ضَبط فلتر الموقع في الجدول + إعادة تَحميل الأَجهزة + تنظيف الـ hash.
  window.addEventListener('map:filter-location', async (ev) => {
    const filterLocSel = document.getElementById('filter-location-devices');
    const locId = ev?.detail?.location_id;
    if (filterLocSel && locId != null) {
      currentLocationFilter = String(locId);
      try { localStorage.setItem(DEVICES_FILTER_KEY, currentLocationFilter); } catch (_) {}
      if ([...filterLocSel.options].some((o) => o.value === currentLocationFilter)) {
        filterLocSel.value = currentLocationFilter;
      } else {
        // الموقع غير موجُود في قائمة الفلتر → نُعيد تَعبئتها ثم نَضبط القيمة.
        await loadFormOptions();
        if ([...filterLocSel.options].some((o) => o.value === currentLocationFilter)) {
          filterLocSel.value = currentLocationFilter;
        }
      }
      loadDevices();
    }
    // تَنظيف الـ hash لِـ تجنّب التَكرار.
    if (window.location.hash.startsWith('#tab-devices')) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  });

  document.getElementById('add-device-btn').addEventListener('click', openDeviceForm);
  document.getElementById('device-form').addEventListener('submit', submitDeviceForm);
  document.getElementById('device-form-cancel').addEventListener('click', () => {
    closeEditModal(document.getElementById('device-modal'));
  });
  document.getElementById('logout-btn').addEventListener('click', logoutNow);

  // مستمع تغيير الترتيب للأجهزة — نَحفظ القيمة في localStorage ليَبقى بعد refresh.
  const sortDevicesEl = document.getElementById('filter-sort-devices');
  if (sortDevicesEl) {
    // تطبيق القيمة المحفوظة على القائمة عند الإقلاع (الخيارات ثابتة في HTML).
    if (VALID_DEVICES_SORTS.includes(currentDevicesSort)) {
      sortDevicesEl.value = currentDevicesSort;
    }
    sortDevicesEl.addEventListener('change', (e) => {
      currentDevicesSort = e.target.value;
      try { localStorage.setItem(DEVICES_SORT_KEY, currentDevicesSort); } catch (_) {}
      loadDevices();
    });
  }

  // مستمع فلتر الموقع للجدول (client-side filter على location_id) — نَحفظ القيمة أيضاً.
  const filterLocDeviceEl = document.getElementById('filter-location-devices');
  if (filterLocDeviceEl) {
    filterLocDeviceEl.addEventListener('change', (e) => {
      currentLocationFilter = e.target.value || '';
      try { localStorage.setItem(DEVICES_FILTER_KEY, currentLocationFilter); } catch (_) {}
      loadDevices();
    });
  }

  // تحديث placeholder حقل المنفذ حسب البروتوكول المختار
  const protoSel = document.getElementById('df-check_protocol');
  const portInput = document.getElementById('df-port');
  function updatePortPlaceholder() {
    const proto = protoSel.value;
    if (proto === 'http') {
      portInput.placeholder = '80';
      portInput.title = 'منفذ HTTP (افتراضي 80)';
    } else if (proto === 'https') {
      portInput.placeholder = '443';
      portInput.title = 'منفذ HTTPS (افتراضي 443)';
    } else if (proto === 'port') {
      portInput.placeholder = 'مثلاً 8080';
      portInput.title = 'منفذ TCP';
    } else {
      portInput.placeholder = '';
      portInput.title = '';
    }
  }
  protoSel.addEventListener('change', updatePortPlaceholder);
  // تطبيق البداية
  updatePortPlaceholder();

  // تصدير/استيراد
  document.getElementById('export-devices-btn').addEventListener('click', exportDevicesExcel);
  document.getElementById('import-devices-file').addEventListener('change', (e) => {
    if (e.target.files[0]) importDevicesExcel(e.target.files[0]);
    e.target.value = ''; // السماح بإعادة نفس الملف
  });
});
