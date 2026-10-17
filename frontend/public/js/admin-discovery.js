// admin-discovery.js: منطق اكتشاف الأجهزة في لوحة التحكم.
// ملاحظة: esc و api مُعرّفتان في admin-utils.js (يُحمَّل أولاً).
let discoveryAbortController = null;

// v2.11.7 — حالة الشاشة: معرّف آخر مسح + صفوفه + عرض الجدول (بحث/فلترة/فرز).
// (الفرز والفلترة يعملان على DOM مباشرةً ⇒ لا تُفقد تعديلات المستخدم في الخلايا.)
let discoveryScanId = null;
let discoveryDevices = [];
const discoveryView = { search: '', filter: 'all', sortKey: '', sortDir: 1 };

// ========== CIDR History Management (localStorage) ==========
const CIDR_HISTORY_KEY = 'network_monitor_cidr_history';
const CIDR_LAST_USED_KEY = 'network_monitor_cidr_last_used';
const MAX_HISTORY = 10;

function loadCidrHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(CIDR_HISTORY_KEY) || '[]');
    return Array.isArray(history) ? history : [];
  } catch {
    return [];
  }
}

function getLastUsedCidr() {
  try {
    return localStorage.getItem(CIDR_LAST_USED_KEY) || '';
  } catch {
    return '';
  }
}

function saveLastUsedCidr(cidr) {
  if (!cidr) return;
  try {
    localStorage.setItem(CIDR_LAST_USED_KEY, cidr);
  } catch (e) {
    console.warn('Failed to save last used CIDR:', e);
  }
}

function saveCidrToHistory(cidr) {
  if (!cidr) return;
  const history = loadCidrHistory();
  // Remove if already exists
  const filtered = history.filter(item => item !== cidr);
  // Add to beginning
  filtered.unshift(cidr);
  // Limit size
  const limited = filtered.slice(0, MAX_HISTORY);
  localStorage.setItem(CIDR_HISTORY_KEY, JSON.stringify(limited));
  // Also save as last used
  saveLastUsedCidr(cidr);
  updateCidrDatalist();
}

function updateCidrDatalist() {
  const datalist = document.getElementById('cidr-history');
  if (!datalist) return;

  const history = loadCidrHistory();
  datalist.innerHTML = '';

  history.forEach(cidr => {
    const option = document.createElement('option');
    option.value = cidr;
    datalist.appendChild(option);
  });
}

// Add default CIDR options if no history
function initCidrDatalist() {
  const datalist = document.getElementById('cidr-history');
  const input = document.getElementById('discovery-cidr');
  if (!datalist || !input) return;

  const history = loadCidrHistory();
  // If no history, populate with defaults
  if (history.length === 0) {
    const defaults = ['192.168.1.0/24', '192.168.0.0/24', '10.0.0.0/24', '172.16.0.0/24'];
    defaults.forEach(cidr => {
      const option = document.createElement('option');
      option.value = cidr;
      datalist.appendChild(option);
    });
  } else {
    updateCidrDatalist();
  }

  // Restore last used CIDR as the input value
  const lastUsed = getLastUsedCidr();
  if (lastUsed) {
    input.value = lastUsed;
  }
}

// ========== v2.11.7 — مساعدات جديدة ==========
// تذكّر آخر موقع اختاره المستخدم (يُقترح افتراضيًّا لكل صف جديد ⇒ لا تعديل يدوي لاحق في الخريطة).
const DISCOVERY_LAST_LOC_KEY = 'nm.discoveryLastLocation';
function getLastDiscoveryLocation() {
  try { return localStorage.getItem(DISCOVERY_LAST_LOC_KEY) || ''; } catch (e) { return ''; }
}
function setLastDiscoveryLocation(value) {
  try {
    if (value) localStorage.setItem(DISCOVERY_LAST_LOC_KEY, String(value));
    else localStorage.removeItem(DISCOVERY_LAST_LOC_KEY);
  } catch (e) { /* تجاهل: التخزين المحلي قد يكون معطّلًا */ }
}

// اقتراح «طريقة الفحص» و«المنفذ» من المنافذ المفتوحة التي رصدها المسح (2.2):
// 443 ⇒ https · 80 ⇒ http · 22/161 ⇒ tcp · وإلّا ping (الأجهزة التي تحجب ICMP تحتاج غير ping).
function suggestCheck(d) {
  const ports = (d.openPorts || []).map(p => Number(p.port));
  if (ports.includes(443)) return { protocol: 'https', port: 443 };
  if (ports.includes(80)) return { protocol: 'http', port: 80 };
  if (ports.includes(22)) return { protocol: 'port', port: 22 };
  if (ports.includes(161)) return { protocol: 'port', port: 161 };
  return { protocol: 'ping', port: null };
}

function formatPorts(ports) {
  if (!ports || ports.length === 0) return '<span style="color:var(--muted);">—</span>';
  return ports.map(p => '<span style="background:var(--bg); padding:0.15rem 0.4rem; border-radius:4px; font-size:0.75rem;">' + p.port + '/' + p.service + '</span>').join(' ');
}

const cellInputStyle = 'width:100%; padding:0.3rem; border:1px solid var(--border); border-radius:4px; background:var(--card-bg); color:var(--text);';

function renderDiscoveryTable(devices) {
  const tbody = document.getElementById('discovery-table-body');
  if (!tbody) return;
  discoveryDevices = Array.isArray(devices) ? devices.slice() : [];
  tbody.innerHTML = '';

  if (discoveryDevices.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="6" style="text-align:center; color:var(--muted); padding:1rem;">' +
      'لم يُعثر على أجهزة مستجيبة في هذا النطاق.</td>';
    tbody.appendChild(tr);
    applyDiscoveryView();
    updateSelectionButtons();
    return;
  }

  const lastLoc = getLastDiscoveryLocation();

  for (const d of discoveryDevices) {
    const tr = document.createElement('tr');
    tr.dataset.ip = d.ip || '';
    tr.dataset.name = d.suggestedName || '';
    tr.dataset.vendor = d.macVendor || '';
    tr.dataset.existing = d.existsInDB ? '1' : '0';
    tr.dataset.time = (d.responseTime != null) ? String(d.responseTime) : '';

    const badge = d.existsInDB
      ? '<span style="background:var(--warning); color:#000; padding:0.1rem 0.4rem; border-radius:4px; font-size:0.7rem;">موجود في قاعدة البيانات</span>'
      : '<span style="background:var(--online); color:#fff; padding:0.1rem 0.4rem; border-radius:4px; font-size:0.7rem;">جديد</span>';
    const suggest = suggestCheck(d);

    tr.innerHTML = `
      <td><input type="checkbox" class="discovery-checkbox" data-ip="${esc(d.ip)}" ${d.existsInDB ? 'disabled' : ''} /></td>
      <td class="dsc-name-cell">
        <input type="text" class="discovery-name-input disco-name-input" value="${esc(d.suggestedName || d.ip || '')}" placeholder="اسم الجهاز" />
        <small>${badge}</small>
      </td>
      <td class="dsc-ip-cell">
        <b dir="ltr">${esc(d.ip)}</b>
        <small style="color:var(--muted); display:block;">${d.responseTime != null ? d.responseTime.toFixed(1) + ' ms' : '—'}</small>
      </td>
      <td class="dsc-vendor-cell">
        ${esc(d.macVendor || 'غير معروف')}
        ${d.mac ? '<small style="color:var(--muted); display:block;" dir="ltr">' + esc(d.mac) + '</small>' : ''}
      </td>
      <td class="dsc-adv">
        <select class="discovery-type-select" title="النوع"></select>
        <select class="discovery-location-select" title="الموقع"></select>
        <details><summary>فحص</summary>
          <div class="adv-row">
            <select class="discovery-proto-select" title="طريقة الفحص المقترحة">
              <option value="ping">ping</option>
              <option value="http">http</option>
              <option value="https">https</option>
              <option value="port">port (TCP)</option>
            </select>
            <input type="number" min="1" max="65535" class="discovery-port-input" value="${suggest.port || ''}" title="المنفذ" ${suggest.protocol === 'ping' ? 'disabled' : ''} />
          </div>
        </details>
      </td>
    `;
    tbody.appendChild(tr);

    // تعبئة قائمة الأنواع
    const typeSelect = tr.querySelector('.discovery-type-select');
    if (window.discoveryTypes) {
      for (const t of window.discoveryTypes) {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.name;
        if (t.name.toLowerCase() === (d.deviceType || '').toLowerCase()) opt.selected = true;
        typeSelect.appendChild(opt);
      }
    }

    // تعبئة قائمة المواقع (2.1): «— بدون —» + المواقع، مع تذكّر آخر اختيار كمُقترَح افتراضي.
    const locSelect = tr.querySelector('.discovery-location-select');
    if (locSelect) {
      const none = document.createElement('option');
      none.value = '';
      none.textContent = '— بدون —';
      locSelect.appendChild(none);
      (window.discoveryLocations || []).forEach(l => {
        const opt = document.createElement('option');
        opt.value = l.id;
        opt.textContent = l.name;
        if (lastLoc && String(l.id) === String(lastLoc)) opt.selected = true;
        locSelect.appendChild(opt);
      });
      locSelect.addEventListener('change', () => {
        if (locSelect.value) setLastDiscoveryLocation(locSelect.value);
      });
    }

    // طريقة الفحص + المنفذ (2.2)
    const protoSelect = tr.querySelector('.discovery-proto-select');
    const portInput = tr.querySelector('.discovery-port-input');
    if (protoSelect && portInput) {
      protoSelect.value = suggest.protocol;
      protoSelect.addEventListener('change', () => {
        const isPing = protoSelect.value === 'ping';
        portInput.disabled = isPing;
        if (isPing) {
          portInput.value = '';
        } else if (!portInput.value) {
          // اقتراح منفذ افتراضي حسب البروتوكول
          portInput.value = protoSelect.value === 'https' ? 443 : (protoSelect.value === 'http' ? 80 : 22);
        }
      });
    }

    // تعطيل الصف إذا كان موجود في قاعدة البيانات
    if (d.existsInDB) {
      tr.style.opacity = '0.6';
      tr.style.background = 'var(--bg)';
    }
  }

  applyDiscoveryView();
  updateSelectionButtons();
}

// v2.11.7 — بحث + فلترة + فرز على DOM مباشرةً (بلا إعادة بناء ⇒ لا تُفقد ما كتبه المستخدم).
function applyDiscoveryView() {
  const tbody = document.getElementById('discovery-table-body');
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll('tr')).filter(r => r.querySelector('.discovery-checkbox'));

  // الفرز: نُرتّب الصفوف ثم نُعيد إلحاقها بنفس الترتيب.
  if (discoveryView.sortKey) {
    const key = discoveryView.sortKey;
    const dir = discoveryView.sortDir;
    const num = (v) => (v === '' || v == null) ? Number.POSITIVE_INFINITY : Number(v);
    const ipToNum = (ip) => String(ip || '').split('.').reduce((acc, p) => acc * 256 + (parseInt(p, 10) || 0), 0);
    rows.sort((a, b) => {
      let va, vb;
      if (key === 'ip') { va = ipToNum(a.dataset.ip); vb = ipToNum(b.dataset.ip); }
      else if (key === 'time') { va = num(a.dataset.time); vb = num(b.dataset.time); }
      else { va = String(a.dataset.name || '').toLowerCase(); vb = String(b.dataset.name || '').toLowerCase(); }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    rows.forEach(r => tbody.appendChild(r));
  }

  // الإظهار/الإخفاء (بحث + فلتر جديد/موجود)
  const q = (discoveryView.search || '').trim().toLowerCase();
  const f = discoveryView.filter || 'all';
  let shown = 0;
  rows.forEach(r => {
    const hay = (r.dataset.ip + ' ' + (r.dataset.name || '') + ' ' + (r.dataset.vendor || '')).toLowerCase();
    const isExisting = r.dataset.existing === '1';
    const matchSearch = !q || hay.includes(q);
    const matchFilter = f === 'all' || (f === 'new' && !isExisting) || (f === 'existing' && isExisting);
    const visible = matchSearch && matchFilter;
    r.style.display = visible ? '' : 'none';
    if (visible) shown++;
  });

  updateDiscoverySummary(rows.length, shown);
}

function updateDiscoverySummary(total, shown) {
  const el = document.getElementById('discovery-summary');
  if (!el) return;
  const newCount = discoveryDevices.filter(d => !d.existsInDB).length;
  const oldCount = discoveryDevices.length - newCount;
  let txt = 'جديد ' + newCount + ' · موجود ' + oldCount;
  if (typeof shown === 'number' && shown !== total) txt += ' · معروض ' + shown + '/' + total;
  el.textContent = '· ' + txt;
}

function updateSelectionButtons() {
  const checkboxes = document.querySelectorAll('.discovery-checkbox:not(:disabled)');
  const checked = document.querySelectorAll('.discovery-checkbox:checked');
  const addBtn = document.getElementById('discovery-add-selected-btn');
  const selectAllCheckbox = document.getElementById('discovery-select-all-checkbox');

  if (addBtn) addBtn.disabled = checked.length === 0;
  if (selectAllCheckbox) selectAllCheckbox.indeterminate = checked.length > 0 && checked.length < checkboxes.length;
  if (selectAllCheckbox) selectAllCheckbox.checked = checked.length > 0 && checked.length === checkboxes.length;

  const countEl = document.getElementById('discovery-count');
  if (countEl) countEl.textContent = checked.length + ' محددة من ' + checkboxes.length + ' متاحة';
}

async function loadTypesAndLocations() {
  const r = await api('/api/scan/types');
  if (r.success) {
    window.discoveryTypes = r.data.types;
    window.discoveryLocations = r.data.locations;
  }
}

async function startDiscovery() {
  const cidr = document.getElementById('discovery-cidr').value.trim();
  const scanPorts = document.getElementById('discovery-scan-ports').checked;

  if (!cidr) {
    showToast('الرجاء إدخال نطاق الشبكة (CIDR)', { type: 'warning' });
    return;
  }

  // Save CIDR to history when starting scan
  saveCidrToHistory(cidr);

  // إخفاء النتائج السابقة
  document.getElementById('discovery-results').classList.add('hidden');
  document.getElementById('discovery-error').classList.add('hidden');
  document.getElementById('discovery-error').textContent = '';

  // إظهار شريط التقدم
  document.getElementById('discovery-progress').classList.remove('hidden');
  document.getElementById('discovery-progress-text').textContent = 'جاري بدء المسح...';
  document.getElementById('discovery-progress-count').textContent = '';

  const startBtn = document.getElementById('discovery-start-btn');
  startBtn.disabled = true;
  startBtn.textContent = '⏳ جاري المسح...';

  try {
    const r = await api('/api/scan/subnet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cidr, scanPorts })
    });

    if (!r.success) {
      throw new Error(r.error || 'فشل بدء المسح');
    }

    // استخدام SSE للتقدم المباشر
    const scanId = r.data.scanId;
    discoveryScanId = scanId;
    connectSSE(scanId);

  } catch (e) {
    showError(e.message);
    resetStartButton();
  }
}

function connectSSE(scanId) {
  const eventSource = new EventSource('/api/scan/stream/' + scanId);

  // عدّاد الأخطاء العابرة — EventSource يُعيد الاتصال تلقائيًا، لكننا نتجاوز فقط بعد
  // عدد محدد من الأخطاء المتتالية دون استقبال أي حدث (احتمال انقطاع فعلي لا استرداد تام).
  let consecutiveErrors = 0;
  const MAX_SSE_ERRORS = 5;

  eventSource.addEventListener('start', (e) => {
    consecutiveErrors = 0;
    document.getElementById('discovery-progress-text').textContent = e.data;
  });

  eventSource.addEventListener('line', (e) => {
    consecutiveErrors = 0;
    const line = JSON.parse(e.data);
    document.getElementById('discovery-progress-text').textContent = line;
    document.getElementById('discovery-progress-count').textContent = '';
  });

  eventSource.addEventListener('done', (e) => {
    consecutiveErrors = 0;
    eventSource.close();
    // عرض عدد الأجهزة من بيانات الحدث (إن وُجد) — يَعطي feedback فوريًّا ولو فشل fetchResults لاحقًا
    try {
      const info = e.data ? JSON.parse(e.data) : null;
      if (info && typeof info.deviceCount === 'number') {
        document.getElementById('discovery-progress-text').textContent =
          '✅ اكتمل المسح! تم العثور على ' + info.deviceCount + ' جهاز';
      }
    } catch (err) { /* تجاهل: لا data أو ليست JSON — نَعتمد على fetchResults */ }
    // جلب النتائج الكاملة من /results/:scanId
    fetchResults(scanId);
  });

  eventSource.addEventListener('error', (e) => {
    // readyState === CLOSED يعني اتصالًا مغلقًا فعلاً (خادم رفض/انتهى) — خطأ جوهري.
    // خلاف ذلك EventSource يُعيد الاتصال تلقائيًا فلا نقطعه على الأخطاء العابرة (proxy idle-drop مثلاً).
    if (eventSource.readyState === EventSource.CLOSED) {
      eventSource.close();
      showError('انقطع الاتصال بالخادم');
      resetStartButton();
      return;
    }
    // عابر: نسمح EventSource بإعادة المحاولة، لكن نُحدّد سقفًا لتفادي التعليق الأبدي.
    consecutiveErrors += 1;
    if (consecutiveErrors >= MAX_SSE_ERRORS) {
      eventSource.close();
      showError('انقطع الاتصال بالخادم — تعذّرت إعادة الاتصال بعد عدة محاولات');
      resetStartButton();
    }
  });

  // تخزين reference للإيقاف
  discoveryAbortController = eventSource;
}

async function fetchResults(scanId, attempt) {
  attempt = attempt || 0;
  const MAX_FETCH_ATTEMPTS = 8;  // حد أقصى للمحاولات (~8 ثوانٍ) قبل الإعلان بالفشل
  try {
    const r = await api('/api/scan/results/' + scanId);
    const hasFlags = Object.prototype.hasOwnProperty.call(r, 'completed');

    // v2.11.7 — الخادم يُميّز الحالات ⇒ لا رسائل مضلّلة:
    //   known=false ⇒ لا سجل (معرّف خطأ/انتهت الصلاحية) · completed=true ⇒ انتهى فعلًا ولو بصفر أجهزة.
    if (r.success && hasFlags) {
      if (r.known === false) {
        showError('انتهت صلاحية نتائج هذا المسح (أو أُعيد تشغيل الخادم) — أعد المسح، أو اعرض «📄 آخر نتيجة مسح».');
        resetStartButton();
        return;
      }
      if (r.completed) {
        document.getElementById('discovery-progress').classList.add('hidden');
        document.getElementById('discovery-results').classList.remove('hidden');
        renderDiscoveryTable(r.data || []);
        resetStartButton();
        if ((r.data || []).length === 0) {
          showToast('✅ اكتمل المسح: لم يُعثر على أجهزة مستجيبة في هذا النطاق.', { type: 'info', duration: 6000 });
        }
        return;
      }
    } else if (r.success && r.data && r.data.length > 0) {
      // توافق رجعي: خادم أقدم لا يُرسل completed/known
      document.getElementById('discovery-progress').classList.add('hidden');
      document.getElementById('discovery-results').classList.remove('hidden');
      renderDiscoveryTable(r.data);
      resetStartButton();
      return;
    }

    // منع تكرار لانهائي: لو فشل عدد محدود من المحاولات، نُظهر رسالة ولو بدلاً من التعليق
    if (attempt >= MAX_FETCH_ATTEMPTS) {
      showError('النتائج لم تكتمل بعد تعذّر تحميلها من الخادم (8 محاولات). جرّب «📄 آخر نتيجة مسح» أو أعد المسح.');
      resetStartButton();
      return;
    }
    // إذا لم تكن النتائج جاهزة، ننتظر قليلاً ونحاول مرة أخرى
    setTimeout(() => fetchResults(scanId, attempt + 1), 1000);
  } catch (e) {
    console.error('Fetch results error:', e);
    if (attempt >= MAX_FETCH_ATTEMPTS) {
      showError('تعذّر الاتصال بالخادم لجلب النتائج: ' + (e.message || e));
      resetStartButton();
      return;
    }
    setTimeout(() => fetchResults(scanId, attempt + 1), 1000);
  }
}

// v2.11.7 — إلغاء حقيقي: نُبلغ الخادم ليتوقف خلال ثوانٍ، ثم نعرض ما وصل قبل الإلغاء.
async function stopDiscovery() {
  const scanId = discoveryScanId;
  if (discoveryAbortController) {
    discoveryAbortController.close();
    discoveryAbortController = null;
  }
  const stopBtn = document.getElementById('discovery-stop-btn');
  if (stopBtn) { stopBtn.disabled = true; stopBtn.textContent = '⏹ جارٍ الإلغاء…'; }

  let cancelRequested = false;
  if (scanId) {
    try {
      const r = await api('/api/scan/cancel/' + scanId, { method: 'POST' });
      cancelRequested = !!(r && r.success && r.data && (r.data.cancelRequested || r.data.alreadyDone));
    } catch (e) { /* غير حرج: نُكمل إخفاء شريط التقدّم */ }
  }

  document.getElementById('discovery-progress').classList.add('hidden');
  if (stopBtn) { stopBtn.disabled = false; stopBtn.textContent = '⏹ إيقاف'; }
  resetStartButton();

  if (cancelRequested) {
    showToast('⏹ أُلغِي المسح — تُعرض أي نتائج وصلت قبل الإلغاء.', { type: 'info', duration: 6000 });
    if (scanId) fetchResults(scanId);
  } else {
    showToast('أُخفي شريط التقدّم. قد يكون المسح اكتمل بالفعل — استخدم «📄 آخر نتيجة مسح».', { type: 'info', duration: 6000 });
  }
}

// v2.11.7 — عرض آخر نتيجة مسح محفوظة على الخادم (لا تُفقد بعد إعادة تحميل الصفحة).
async function loadLastScan() {
  const btn = document.getElementById('discovery-last-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري التحميل…'; }
  try {
    const r = await api('/api/scan/last');
    const data = (r && r.success) ? r.data : null;
    if (!data) {
      showToast('لا توجد نتيجة مسح محفوظة بعد — ابدأ مسحًا جديدًا.', { type: 'warning' });
      return;
    }
    discoveryScanId = data.scanId || null;
    document.getElementById('discovery-error').classList.add('hidden');
    document.getElementById('discovery-progress').classList.add('hidden');
    document.getElementById('discovery-results').classList.remove('hidden');
    renderDiscoveryTable(data.devices || []);
    const when = data.endedAt ? NMFormat.dateTime(data.endedAt) : '—';
    showToast((data.cancelled ? '📄 آخر نتيجة (مُلغى) — ' : '📄 آخر نتيجة مسح — ') +
      (data.cidr || '—') + ' · ' + (data.deviceCount || 0) + ' جهاز · ' + when,
      { type: 'info', duration: 7000 });
  } catch (e) {
    showToast('تعذّر تحميل آخر نتيجة: ' + (e.message || e), { type: 'error' });
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📄 آخر نتيجة مسح'; }
  }
}

function resetStartButton() {
  const startBtn = document.getElementById('discovery-start-btn');
  startBtn.disabled = false;
  startBtn.textContent = '🚀 بدء المسح';
}

function showError(message) {
  const errorEl = document.getElementById('discovery-error');
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
  document.getElementById('discovery-progress').classList.add('hidden');
}

async function addSelectedDevices() {
  const checkboxes = document.querySelectorAll('.discovery-checkbox:checked:not(:disabled)');
  if (checkboxes.length === 0) {
    showToast('لم يتم تحديد أي أجهزة', { type: 'warning' });
    return;
  }

  const devices = [];
  for (const cb of checkboxes) {
    const tr = cb.closest('tr');
    const nameInput = tr.querySelector('.discovery-name-input');
    const typeSelect = tr.querySelector('.discovery-type-select');
    const locSelect = tr.querySelector('.discovery-location-select');
    const protoSelect = tr.querySelector('.discovery-proto-select');
    const portInput = tr.querySelector('.discovery-port-input');

    if (!nameInput.value.trim()) {
      showToast('الرجاء إدخال اسم للجهاز: ' + cb.dataset.ip, { type: 'warning' });
      nameInput.focus();
      return;
    }
    if (!typeSelect.value) {
      showToast('الرجاء اختيار نوع للجهاز: ' + cb.dataset.ip, { type: 'warning' });
      typeSelect.focus();
      return;
    }

    const protocol = protoSelect ? protoSelect.value : 'ping';
    const port = protocol === 'ping' ? null : (portInput && portInput.value ? Number(portInput.value) : null);
    if (protocol !== 'ping' && !port) {
      showToast('حدّد المنفذ لطريقة الفحص: ' + cb.dataset.ip, { type: 'warning' });
      if (portInput) portInput.focus();
      return;
    }

    devices.push({
      ip: cb.dataset.ip,
      name: nameInput.value.trim(),
      device_type_id: typeSelect.value,
      location_id: (locSelect && locSelect.value) ? Number(locSelect.value) : null,
      check_protocol: protocol,
      port: port,
      web_port: (protocol === 'http' || protocol === 'https') ? port : null,
      check_interval_seconds: 30,
      failure_threshold: 3,
      is_active: 1
    });
  }

  const btn = document.getElementById('discovery-add-selected-btn');
  btn.disabled = true;
  btn.textContent = '⏳ جاري الإضافة...';

  try {
    const r = await api('/api/scan/bulk-add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ devices })
    });

    if (r.success) {
      const { imported, skipped, errors } = r.data;
      let msg = '✅ تم إضافة ' + imported + ' جهاز بنجاح';
      if (skipped > 0) msg += '، تم تخطي ' + skipped;
      if (errors.length > 0) msg += '\n\nأخطاء:\n' + errors.join('\n');
      showToast(msg, { type: imported > 0 ? 'success' : 'warning', duration: 6000 });

      // تحديث الجدول - تعليم الأجهزة المضافة كموجودة
      for (const cb of checkboxes) {
        cb.disabled = true;
        cb.checked = false;
        const tr = cb.closest('tr');
        tr.style.opacity = '0.6';
        tr.style.background = 'var(--bg)';
      }

      // إعادة تحميل «آخر نتيجة» (v2.11.7 — كان يستدعي /api/scan/results بلا معرّف وهو خطأ)
      const r2 = await api('/api/scan/last');
      if (r2 && r2.success && r2.data) renderDiscoveryTable(r2.data.devices || []);

      // تحديث تبويب الأجهزة أيضاً
      if (typeof window.loadDevices === 'function') {
        await window.loadDevices();
      }
    } else {
      showToast('❌ فشل الإضافة: ' + (r.error || 'خطأ غير معروف'), { type: 'error' });
    }
  } catch (e) {
    showToast('❌ خطأ: ' + e.message, { type: 'error' });
  } finally {
    btn.disabled = false;
    btn.textContent = '✅ إضافة المحددة للمراقبة';
    updateSelectionButtons();
  }
}

function toggleSelectAll() {
  const selectAllCheckbox = document.getElementById('discovery-select-all-checkbox');
  const checkboxes = document.querySelectorAll('.discovery-checkbox:not(:disabled)');
  checkboxes.forEach(cb => { cb.checked = selectAllCheckbox.checked; });
  updateSelectionButtons();
}

function clearSelection() {
  const checkboxes = document.querySelectorAll('.discovery-checkbox:checked');
  checkboxes.forEach(cb => { cb.checked = false; });
  const selectAllCheckbox = document.getElementById('discovery-select-all-checkbox');
  if (selectAllCheckbox) selectAllCheckbox.checked = false;
  updateSelectionButtons();
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadTypesAndLocations();

  // تهيئة سجل CIDR (input + datalist)
  initCidrDatalist();

  document.getElementById('discovery-start-btn').addEventListener('click', startDiscovery);
  document.getElementById('discovery-stop-btn').addEventListener('click', stopDiscovery);
  document.getElementById('discovery-last-btn').addEventListener('click', loadLastScan);
  document.getElementById('discovery-add-selected-btn').addEventListener('click', addSelectedDevices);
  document.getElementById('discovery-select-all-btn').addEventListener('click', () => {
    const selectAllCheckbox = document.getElementById('discovery-select-all-checkbox');
    selectAllCheckbox.checked = true;
    toggleSelectAll();
  });
  document.getElementById('discovery-clear-selection-btn').addEventListener('click', clearSelection);
  document.getElementById('discovery-select-all-checkbox').addEventListener('change', toggleSelectAll);

  // v2.11.7 — شريط البحث والفلترة + فرز الأعمدة (2.3)
  const searchBox = document.getElementById('discovery-search');
  if (searchBox) {
    searchBox.addEventListener('input', () => {
      discoveryView.search = searchBox.value || '';
      applyDiscoveryView();
    });
  }
  const filterSelect = document.getElementById('discovery-filter');
  if (filterSelect) {
    filterSelect.addEventListener('change', () => {
      discoveryView.filter = filterSelect.value || 'all';
      applyDiscoveryView();
    });
  }
  document.querySelectorAll('#section-discovery th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort');
      if (discoveryView.sortKey === key) {
        discoveryView.sortDir *= -1;
      } else {
        discoveryView.sortKey = key;
        discoveryView.sortDir = 1;
      }
      document.querySelectorAll('#section-discovery th.sortable').forEach((t) => {
        const base = t.getAttribute('data-label') || t.textContent.replace(/[↕▲▼]/g, '').trim();
        t.textContent = base + (t === th ? (discoveryView.sortDir === 1 ? ' ▲' : ' ▼') : ' ↕');
      });
      applyDiscoveryView();
    });
  });

  // تحديث أزرار التحديد عند تغيير أي checkbox
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('discovery-checkbox')) {
      updateSelectionButtons();
    }
  });
});

// ── v2.16.1 — اختبار استخراج الاسم لجهاز مفرد (NBNS/SMB/DNS عكسي) ──
(function bindNameDiag() {
  const btn = document.getElementById('discovery-name-diag-btn');
  const ipIn = document.getElementById('discovery-name-diag-ip');
  const out = document.getElementById('discovery-name-diag-out');
  if (!btn || !ipIn || !out) return;
  btn.addEventListener('click', async () => {
    const ip = (ipIn.value || '').trim();
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) { out.textContent = '✗ أدخل IP صالحًا مثل 192.168.88.3'; out.style.color = 'var(--offline)'; return; }
    out.textContent = '⏳ جارٍ اختبار الطرق الثلاث على ' + ip + ' … (حتى ~4 ثوانٍ)';
    out.style.color = 'var(--muted)';
    try {
      const r = await api('/api/scan/name-diag?ip=' + encodeURIComponent(ip));
      if (!r || !r.success) throw new Error((r && r.error) || 'فشل');
      const d = r;
      const parts = [
        'NBNS: ' + (d.nbns ? '✅ ' + d.nbns : '✗ (' + d.nbns_ms + 'ms)'),
        'SMB: ' + (d.smb ? '✅ ' + d.smb : '✗'),
        'DNS عكسي: ' + (d.reverse_dns ? '✅ ' + d.reverse_dns : '✗'),
      ];
      out.textContent = (d.resolved ? '✅ الاسم: ' + d.resolved + ' ← [مسار ' + (d.nbns ? 'NBNS' : d.smb ? 'SMB' : 'DNS') + '] · ' : '') + parts.join(' · ');
      out.style.color = d.resolved ? 'var(--online)' : 'var(--offline)';
    } catch (e) {
      out.textContent = '✗ فشل الاتصال: ' + (e.message || e);
      out.style.color = 'var(--offline)';
    }
  });
})();

// ═══ v2.27.2 — الشرائح الموحّدة (فحص الآن · بانتظار الاعتماد · الجدولة) ═══
let currentDiscSub = 'scan';
const SUB_SECTIONS = { scan: 'section-discovery-content', discovered: 'section-discovered', sched: 'section-scheduler' };
function showDiscSub(sub) {
  currentDiscSub = sub;
  for (const [key, secId] of Object.entries(SUB_SECTIONS)) {
    const sec = document.getElementById(secId);
    if (sec) sec.classList.toggle('hidden', key !== sub);
  }
  for (const btn of document.querySelectorAll('#disc-segments button')) {
    const active = btn.dataset.sub === sub;
    btn.classList.toggle('btn-primary', active);
  }
  // تحميل ذكي مرة عند أول فتح لكل شريحة.
  if (sub === 'discovered' && typeof loadDiscovered === 'function') loadDiscovered();
  if (sub === 'sched' && typeof loadSchedulerSettings === 'function') {
    try { loadSchedulerSettings(); loadSchedulerStatus(); loadSchedulerRuns(); } catch (e) {}
  }
}
document.addEventListener('DOMContentLoaded', () => {
  const bar = document.getElementById('disc-segments');
  if (!bar) return;
  bar.querySelectorAll('button[data-sub]').forEach((b) => b.addEventListener('click', () => showDiscSub(b.dataset.sub)));
  // عند فتح تبويب الاكتشاف: اعرض شريحة الفحص وأخفِ الأخريين (admin-tabs لا يدير أخريها بعد الدمج).
  const tabBtn = document.getElementById('tab-discovery');
  if (tabBtn) tabBtn.addEventListener('click', () => showDiscSub('scan'));
});
