// public-dashboard.js: \u062c\u0644\u0628/\u0639\u0631\u0636 \u0627\u0644\u0623\u062c\u0647\u0632\u0629\u060c \u0627\u0644\u0641\u0644\u062a\u0631\u0629\u060c \u0627\u0644\u062a\u0631\u062a\u064a\u0628\u060c \u0627\u0644\u062a\u0628\u062f\u064a\u0644 \u0628\u064a\u0646 \u0646\u0645\u0637 \u0627\u0644\u0628\u0637\u0627\u0642\u0627\u062a \u0648\u0627\u0644\u062c\u062f\u0648\u0644\u060c \u0627\u0644\u062a\u062d\u062f\u064a\u062b \u0627\u0644\u062f\u0648\u0631\u064a\u060c \u062a\u0628\u062f\u064a\u0644 \u0627\u0644\u0648\u0636\u0639 \u0627\u0644\u0644\u064a\u0644\u064a.
let allDevices = [];
let currentChart = null;
let currentView = 'cards'; // v2.13.11 — 'cards' | 'table' (أُزيل 'map' — الخريطة في NOC)
// SEC-02 — الافتراضي صار «حسب الاسم» لأن العرض العام لم يعد يحمل عناوين IP
// (خيار «حسب IP» يبقى متاحًا لكنه يعود للترتيب بالاسم تلقائيًّا عند غياب العناوين).
let currentSort = 'name';  // 'name' | 'ip' | 'status' | 'type' | 'location' | 'last_checked'
const VIEW_STORAGE_KEY = 'nm.publicView';
const SORT_STORAGE_KEY = 'nm.publicSort';
const THEME_STORAGE_KEY = 'nm.publicTheme'; // 'dark' | 'light'

// ═══ قرار المالك (2026-10-17) — «العرض الداخلي» للمستخدمين المسجّلين ═══
// الصفحة العامة تعرض العناوين (IP) **لأي مستخدم مسجّل** (مدير أو عرض)، وتبقى منقّاة تمامًا للزائر
// بلا جلسة. القرار يُقرأ من الخادم (جلسة + إعداد المالك) عبر /api/settings/noc-mode — بلا أي تخمين
// في المتصفح، وبلا كشف أي عنوان قبل تأكيد الصلاحية.
let internalView = false;   // true ⇒ نقرأ المسارات الداخلية (تحوي IP) لأن الجلسة مسموح لها

// ═══ v2.33.0 — مواءمة عناصر الصفحة مع وضع العرض ═══
// الزائر لا يرى عناوين IP إطلاقًا ⇒ لا نَعِده بالبحث/الترتيب بعنوان لا وجود له،
// ونخفي خيار الترتيب «حسب IP» مع أي أثر بصري آخر (النص يتغيّر بدل أن يبقى مُضلِّلًا).
function applyDisplayModeUi() {
  var searchEl = document.getElementById('search-input');
  if (searchEl) {
    searchEl.placeholder = internalView ? 'بحث بالاسم أو IP…' : 'بحث بالاسم…';
  }
  var ipOption = document.querySelector('#filter-sort option[value="ip"]');
  if (ipOption) {
    ipOption.hidden = !internalView;
    ipOption.disabled = !internalView;
    if (!internalView && currentSort === 'ip') {
      currentSort = 'name';
      var sel = document.getElementById('filter-sort');
      if (sel) sel.value = 'name';
    }
  }
}

async function resolveDisplayMode() {
  try {
    const r = await fetch('/api/settings/noc-mode', { credentials: 'same-origin' });
    const j = await r.json();
    internalView = !!(j && j.success && j.data && j.data.mode === 'full');
    // لغة النظام (إعداد المالك) — تُرفَق في نفس الردّ فلا نحتاج طلبًا آخر.
    if (j && j.success && j.data && j.data.ui_language && window.NMI18N) {
      try { NMI18N.setLang(j.data.ui_language, { persist: true }); } catch (e) {}
    }
  } catch (_) {
    internalView = false;   // أي شك ⇒ العرض المنقّى (الأأمن)
  }
  // مسارات القراءة حسب الوضع: الداخلية (بجلسة، تحوي IP) أو العامة المنقّاة.
  return {
    list: internalView ? '/api/devices' : '/api/public/status',
    detail: (id) => internalView ? ('/api/devices/' + id) : ('/api/public/devices/' + id),
    history: (id, range) => internalView
      ? ('/api/devices/' + id + '/history?range=' + range)
      : ('/api/public/devices/' + id + '/history?range=' + range),
  };
}

let apiPaths = {
  list: '/api/public/status',
  detail: (id) => '/api/public/devices/' + id,
  history: (id, range) => '/api/public/devices/' + id + '/history?range=' + range,
};

// ====== \u062c\u0644\u0628 \u0648\u0639\u0631\u0636 \u0627\u0644\u0623\u062c\u0647\u0632\u0629 ======
async function fetchApi(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) {
      return { success: false, error: 'HTTP ' + r.status };
    }
    const text = await r.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      return { success: false, error: '\u0631\u062f \u063a\u064a\u0631 \u0635\u062d\u064a\u062d' };
    }
  } catch (e) {
    return { success: false, error: '\u062e\u0637\u0623 \u0641\u064a \u0627\u0644\u0627\u062a\u0635\u0627\u0644' };
  }
}

function statusText(status) {
  if (status === 'online') return T('status.online', T('s2x.online', '\u0645\u062a\u0635\u0644'));
  if (status === 'offline') return T('status.offline', T('s2x.offline', '\u0645\u062a\u0648\u0642\u0641'));
  return T('status.unknown', '\u063a\u064a\u0631 \u0645\u0639\u0631\u0648\u0641');
}

function statusDotClass(d) {
  // MON-02 — مضيف متصل وخدمة متوقفة ⇒ تحذير (DEGRADED) لا أخضر.
  if (d.overall_health === 'degraded') return 'warning';
  if (d.current_status === 'online' && d.last_response_time_ms != null && d.last_response_time_ms > 500) {
    return 'warning';
  }
  return d.current_status || 'unknown';
}

// MON-02 — نص الحالة العامة (يشمل DEGRADED) بدل الاعتماد على حالة المضيف وحدها.
function overallStatusText(d) {
  if (d.overall_health === 'degraded') {
    var n = Number(d.services_down_count) || 0;
    return 'متصل — ' + (n > 0 ? n + ' خدمة متوقفة' : 'خدمة متوقفة');
  }
  return statusText(d.current_status);
}

function formatDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return T('status.unknown', '\u063a\u064a\u0631 \u0645\u0639\u0631\u0648\u0641');
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return s + ' \u062b\u0627\u0646\u064a\u0629';
  if (s < 3600) return Math.floor(s / 60) + ' \u062f\u0642\u064a\u0642\u0629';
  return Math.floor(s / 3600) + ' \u0633\u0627\u0639\u0629 ' + Math.floor((s % 3600) / 60) + ' \u062f\u0642\u064a\u0642\u0629';
}

// ====== \u062f\u0627\u0644\u0629 \u0627\u0644\u062a\u0631\u062a\u064a\u0628 ======
function sortDevices(devicesList) {
  const sorted = [...devicesList];
  sorted.sort((a, b) => {
    let valA, valB;
    switch (currentSort) {
      case 'ip': {
        // SEC-02 — العرض العام بلا IP (تغذية منقّاة): نرجع للترتيب بالاسم تلقائيًّا عند غياب العناوين.
        const ipa = String(a.ip || '');
        const ipb = String(b.ip || '');
        if (!ipa || !ipb) {
          return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
        }
        valA = ipa.split('.').map(Number);
        valB = ipb.split('.').map(Number);
        for (let i = 0; i < 4; i++) {
          if (valA[i] !== valB[i]) return valA[i] - valB[i];
        }
        return 0;
      }
      case 'status':
        const statusOrder = { offline: 0, unknown: 1, online: 2 };
        return (statusOrder[a.current_status] || 1) - (statusOrder[b.current_status] || 1);
      case 'type':
        valA = (a.device_type_name || '').toLowerCase();
        valB = (b.device_type_name || '').toLowerCase();
        return valA.localeCompare(valB, 'ar');
      case 'location':
        valA = (a.location_name || '').toLowerCase();
        valB = (b.location_name || '').toLowerCase();
        return valA.localeCompare(valB, 'ar');
      case 'last_checked':
        valA = a.last_checked_at ? new Date(a.last_checked_at).getTime() : 0;
        valB = b.last_checked_at ? new Date(b.last_checked_at).getTime() : 0;
        return valB - valA;
      case 'name':
      default:
        valA = (a.name || '').toLowerCase();
        valB = (b.name || '').toLowerCase();
        return valA.localeCompare(valB, 'ar');
    }
  });
  return sorted;
}

// ====== \u0646\u0645\u0637 \u0627\u0644\u0628\u0637\u0627\u0642\u0627\u062a ======
function renderDevices(devicesList) {
  const grid = document.getElementById('devices-grid');
  grid.innerHTML = '';
  if (!devicesList || devicesList.length === 0) {
    grid.innerHTML = '<p style="color:var(--muted);padding:1rem;">\u0644\u0627 \u062a\u0648\u062c\u062f \u0623\u062c\u0647\u0632\u0629 \u0645\u0637\u0627\u0628\u0642\u0629.</p>';
    return;
  }
  for (const d of devicesList) {
    const sc = statusDotClass(d);
    const statusClass = 'status-' + sc;
    const badgeClass = 'badge-' + sc;

    // بناء رابط الواجهة إذا كان الجهاز يدعم HTTP/HTTPS (فحص تلقائي)
    // v2.7.5 — web_port: لو مُحدَّد نَفتح على البورت المخصص (مثل 4444).
    var portSuffix = d.web_port ? ':' + d.web_port : '';
    var openBtnHtml = '';
    // SEC-02 — العرض العام بلا عناوين: زر «فتح» لا يظهر إلا لو توفّر IP (لا يتوفر للزوار).
    if (d.ip && d.https_accessible == 1) {
      var url = 'https://' + d.ip + portSuffix + '/';
      openBtnHtml = '<button class="btn btn-primary open-device-btn" data-url="' + escapeHtml(url) + '" title="فتح واجهة الجهاز (HTTPS' + (portSuffix ? ' على البورت ' + d.web_port : '') + ')" type="button">🔒 فتح HTTPS</button>';
    } else if (d.ip && d.http_accessible == 1) {
      var url = 'http://' + d.ip + portSuffix + '/';
      openBtnHtml = '<button class="btn btn-primary open-device-btn" data-url="' + escapeHtml(url) + '" title="فتح واجهة الجهاز (HTTP' + (portSuffix ? ' على البورت ' + d.web_port : '') + ')" type="button">🌐 فتح HTTP</button>';
    }

    const card = document.createElement('div');
    card.className = 'device-card ' + statusClass;
    card.dataset.id = d.id;   // v2.30.0 — لدعم بصمات QR (فتح الجهاز من الملصق)
    card.innerHTML =
      '<div class="name">' + escapeHtml(d.name) + '</div>' +
      (d.ip ? '<div class="ip">' + escapeHtml(d.ip) + '</div>' : '') +
      '<div class="meta">\u0627\u0644\u0646\u0648\u0639: ' + escapeHtml(d.device_type_name || '-') + '</div>' +
      '<div class="meta">\u0627\u0644\u0645\u0648\u0642\u0639: ' + escapeHtml(d.location_name || '-') + '</div>' +
      '<div class="meta">\u0622\u062e\u0631 \u0641\u062d\u0635: ' + (d.last_checked_at ? NMFormat.dateTime(d.last_checked_at) : '\u0644\u0645 \u064a\u0641\u062d\u0635 \u0628\u0639\u062f') + '</div>' +
      '<span class="status-badge ' + badgeClass + '">' + overallStatusText(d) + '</span>' +
      (openBtnHtml ? '<div class="card-actions">' + openBtnHtml + '</div>' : '');
    card.addEventListener('click', function (e) {
      // لا تفتح المودال إذا تم الضغط على زر الفتح
      if (e.target.closest('.open-device-btn')) return;
      if (typeof window.openDeviceModal === 'function') window.openDeviceModal(d.id);
    });
    grid.appendChild(card);
  }

  // إضافة مستمعي الأحداث لأزرار الفتح
  grid.querySelectorAll('.open-device-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      window.open(this.dataset.url, '_blank');
    });
  });
}

// ====== \u0646\u0645\u0637 \u0627\u0644\u062c\u062f\u0648\u0644 ======
// v2.13.6 — نصّ خلية «آخر انقطاع»: «منذ 2 س 5 د · دام 45 د» أو «—» لو لا انقطاع مسجل.
// المصدر: last_outage_ended_at / last_outage_seconds من GET /api/public/status (downtime_events).
function fmtLastOutage(d) {
  if (!d.last_outage_ended_at) return '\u2014';
  const started = new Date(d.last_outage_ended_at).getTime();
  if (isNaN(started)) return '\u2014';
  const mins = Math.max(0, Math.floor((Date.now() - started) / 60000));
  let ago;
  if (mins < 1) ago = '\u0627\u0644\u0622\u0646';
  else if (mins < 60) ago = '\u0645\u0646\u0630 ' + mins + ' \u062f';
  else if (mins < 1440) ago = '\u0645\u0646\u0630 ' + Math.floor(mins / 60) + ' \u0633 ' + (mins % 60) + ' \u062f';
  else ago = '\u0645\u0646\u0630 ' + Math.floor(mins / 1440) + ' \u064a\u0648\u0645';
  let dur = '';
  const s = d.last_outage_seconds;
  if (s != null && s >= 0) {
    dur = ' \u00b7 \u062f\u0627\u0645 ' + (s < 60 ? s + ' \u062b'
      : s < 3600 ? Math.floor(s / 60) + ' \u062f'
      : Math.floor(s / 3600) + ' \u0633 ' + Math.floor((s % 3600) / 60) + ' \u062f');
  }
  return ago + dur;
}

function renderTable(devicesList) {
  const tbody = document.getElementById('devices-table-body');
  tbody.innerHTML = '';
  if (!devicesList || devicesList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="is-empty">لا توجد أجهزة مطابقة — جرّب تغيير الفلاتر أو البحث.</td></tr>';
    return;
  }
  for (const d of devicesList) {
    const dot = statusDotClass(d);
    // بناء رابط الفتح للأجهزة التي تدعم HTTP/HTTPS (فحص تلقائي)
    // v2.7.5 — web_port: لو مُحدَّد نَفتح على البورت المخصص (مثل 4444).
    const tPortSuffix = d.web_port ? ':' + d.web_port : '';
    let openBtnHtml = '';
    // SEC-02 — بلا IP في العرض العام ⇒ لا زر فتح (نفس منطق البطاقات).
    if (d.ip && d.https_accessible == 1) {
      const url = 'https://' + d.ip + tPortSuffix + '/';
      openBtnHtml = '<button class="btn btn-sm open-device-btn" data-url="' + escapeHtml(url) + '" title="فتح الواجهة (HTTPS' + (tPortSuffix ? ' على البورت ' + d.web_port : '') + ')">🔒 فتح HTTPS</button>';
    } else if (d.ip && d.http_accessible == 1) {
      const url = 'http://' + d.ip + tPortSuffix + '/';
      openBtnHtml = '<button class="btn btn-sm open-device-btn" data-url="' + escapeHtml(url) + '" title="فتح الواجهة (HTTP' + (tPortSuffix ? ' على البورت ' + d.web_port : '') + ')">🌐 فتح HTTP</button>';
    }
    const tr = document.createElement('tr');
    tr.className = 'public-row';
    tr.innerHTML =
      '<td class="col-status"><span class="status-dot ' + dot + '" title="' + escapeHtml(overallStatusText(d)) + '"></span></td>' +
      '<td>' + escapeHtml(d.name) + '</td>' +
      '<td class="col-ltr">' + escapeHtml(d.ip || '—') + '</td>' +
      '<td>' + escapeHtml(d.device_type_name || '—') + '</td>' +
      '<td>' + escapeHtml(d.location_name || '—') + '</td>' +
      '<td class="col-ltr nm-muted">' + (d.last_checked_at ? NMFormat.dateTime(d.last_checked_at) : '—') + '</td>' +
      '<td class="col-center nm-muted">' + fmtLastOutage(d) + '</td>' +
      '<td class="col-actions">' + (openBtnHtml || '') + '</td>' +
      '<td class="col-actions"><button class="btn btn-sm" data-detail="' + d.id + '">تفاصيل</button></td>';
    // إضافة مستمع للزر التفاصيل
    tr.querySelector('[data-detail]').addEventListener('click', function (e) {
      e.stopPropagation();
      if (typeof window.openDeviceModal === 'function') window.openDeviceModal(d.id);
    });
    // إضافة مستمع لزر الفتح
    if (openBtnHtml) {
      tr.querySelector('.open-device-btn').addEventListener('click', function(e) {
        e.stopPropagation();
        window.open(this.dataset.url, '_blank');
      });
    }
    tr.addEventListener('click', function () {
      if (typeof window.openDeviceModal === 'function') window.openDeviceModal(d.id);
    });
    tbody.appendChild(tr);
  }
}

// ====== \u0645\u0644\u062e\u0635 \u0634\u0631\u064a\u0637 \u0639\u0644\u0648\u064a + \u0634\u0631\u064a\u0637 \u0646\u0650\u0633\u0628\u0629 \u0627\u0644\u062a\u064e\u0634\u063a\u064a\u0644 ======
function updateSummaryBar(devicesList) {
  const total = devicesList.length;
  const online = devicesList.filter(function (d) { return d.current_status === 'online'; }).length;
  const offline = devicesList.filter(function (d) { return d.current_status === 'offline'; }).length;
  document.getElementById('summary-bar').textContent =
    '\u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a: ' + total + '  \u2022  \u0645\u062a\u0635\u0644: ' + online + '  \u2022  \u0645\u062a\u0648\u0642\u0641: ' + offline;

  // v2.7.5 — تحديث شريط نِسبة التَشغيل في عرض البطاقات والجدول (نفس أسلوب map-uptime-bar).
  updateUptimeBars(total, online, offline);
}

function updateUptimeBars(total, online, offline) {
  var unknown = total - online - offline;
  var ids = ['cards-uptime-bar', 'table-uptime-bar'];
  for (var i = 0; i < ids.length; i++) {
    var bar = document.getElementById(ids[i]);
    if (!bar) continue;
    if (total <= 0) {
      bar.innerHTML = '<span class="uptime-text">\u0644\u0627 \u0623\u062c\u0647\u0632\u0629 \u0644\u0650\u0640 \u062d\u0650\u0633\u0627\u0628 \u0627\u0644\u0646\u0650\u0633\u0628\u0629.</span>';
      continue;
    }
    var pct = Math.round((online / total) * 1000) / 10;
    var pctClass = pct >= 90 ? '' : (pct >= 50 ? 'mid' : 'low');
    bar.innerHTML =
      '<div class="uptime-bar"><div class="uptime-fill" style="width:' + pct + '%"></div></div>' +
      '<span class="uptime-text">\u0646\u0650\u0633\u0628\u0629 \u0627\u0644\u062a\u064e\u0634\u063a\u064a\u0644: \ud83d\udfe2 <span class="uptime-pct ' + pctClass + '">' + pct + '%</span> ' +
      '(' + online + '/' + total + ' \u0645\u062a\u0635\u0644' +
      (offline > 0 ? ' \u2014 \ud83d\udd34 ' + offline + ' \u0645\u062a\u0648\u0642\u0641' : '') +
      (unknown > 0 ? ' \u2014 \u26aa ' + unknown + ' \u063a\u064a\u0631 \u0645\u0639\u0631\u0648\u0641' : '') +
      ')</span>';
  }
}

// ====== \u0627\u0644\u062a\u0628\u062f\u064a\u0644 \u0628\u064a\u0646 \u0627\u0644\u0646\u0645\u0637\u064a\u0646 ======
function switchView(view) {
  currentView = view;
  var cardsWrap = document.getElementById('devices-grid');
  var cardsBar = document.getElementById('cards-uptime-bar');
  var tableWrap = document.getElementById('devices-table-view');
  var cardsBtn = document.getElementById('view-cards-btn');
  var tableBtn = document.getElementById('view-table-btn');

  // v2.6.0: إِخفاء كُلّ الأَنماط أَوّلًا، ثُمّ إِظهار المُحدَّد.
  if (cardsWrap) cardsWrap.classList.add('hidden');
  if (cardsBar) cardsBar.classList.add('hidden');
  if (tableWrap) tableWrap.classList.add('hidden');
  if (cardsBtn) cardsBtn.classList.remove('active');
  if (tableBtn) tableBtn.classList.remove('active');

  if (view === 'table') {
    if (tableWrap) tableWrap.classList.remove('hidden');
    if (tableBtn) tableBtn.classList.add('active');
    applyFilters();
  } else {
    if (cardsWrap) cardsWrap.classList.remove('hidden');
    if (cardsBar) cardsBar.classList.remove('hidden');
    if (cardsBtn) cardsBtn.classList.add('active');
    applyFilters();
    if (window.PublicMapView) window.PublicMapView.deactivate();
  }
  try { localStorage.setItem(VIEW_STORAGE_KEY, view); } catch (e) {}
}

// ====== \u0627\u0644\u0641\u0644\u062a\u0631\u0629 \u0648\u0627\u0644\u062a\u0631\u062a\u064a\u0628 ======
function applyFilters() {
  var q = (document.getElementById('search-input').value || '').trim().toLowerCase();
  var type = document.getElementById('filter-type').value;
  var location = document.getElementById('filter-location').value;
  var status = document.getElementById('filter-status').value;

  var filtered = allDevices.filter(function (d) {
    if (q && !String(d.name).toLowerCase().includes(q) && !String(d.ip || '').toLowerCase().includes(q)) return false;
    if (type && d.device_type_id != +type) return false;
    if (location && d.location_id != +location) return false;
    if (status && d.current_status !== status) return false;
    return true;
  });

  filtered = sortDevices(filtered);

  if (currentView === 'table') {
    renderTable(filtered);
  } else {
    renderDevices(filtered);
  }
  updateSummaryBar(filtered);
}

// ====== \u0641\u062a\u062d \u062a\u0641\u0627\u0635\u064a\u0644 \u0627\u0644\u062c\u0647\u0627\u0632 (\u0627\u0644\u0645\u0648\u062f\u0627\u0644) ======
window.openDeviceModal = async function (deviceId) {
  var modal = document.getElementById('device-modal');
  if (currentChart && typeof currentChart.destroy === 'function') {
    try { currentChart.destroy(); } catch (e) {}
    currentChart = null;
  }
  try {
    var devRes = await fetchApi(apiPaths.detail(deviceId));
    if (!devRes || !devRes.success) { alert(devRes && devRes.error ? devRes.error : 'تعذّر جلب بيانات الجهاز'); return; }
    var dev = devRes.data;
    document.getElementById('modal-device-name').textContent = dev.name;

    // ── حالة الاتصال بالاستدلال (v2.31.0):
    //    الارتكاز = الأجهزة المبثوقة على موقع «إنترنت» (مثل DNS 1.1.1.1) —
    //    إن سقطت ⇒ الخط الخارجي واقع (محلي فقط)؛ إن شغالت ⇒ النفاذ متوقع.
    var list = allDevices || [];
    var anchors = list.filter(function (x) { return x.location_kind === 'internet' && x.ip && x.ip.indexOf('192.168.') !== 0; });
    var lineDown = anchors.length > 0 && anchors.every(function (a) { return a.current_status !== 'online'; });
    var chip = {
      badge: '', color: ''
    };
    if (dev.current_status === 'online') {
      if (lineDown) { chip.badge = '🟡 متصل بالشبكة المحلية فقط — الخط الخارجي منقطع'; chip.color = '#f59e0b'; }
      else { chip.badge = '🟢 متصل — النفاذ للإنترنت متوقع (الخط الخارجي يعمل)'; chip.color = '#22c55e'; }
    } else {
      if (lineDown) { chip.badge = '🔴 منقطع — والخط الخارجي منقطع أيضًا (عطل خارجي رجّع الشبكة)'; chip.color = '#ef4444'; }
      else { chip.badge = '🔴 منقطع محليًّا — الخط الخارجي يعمل فالعطل بالجهاز/توصيله'; chip.color = '#ef4444'; }
    }
    var chipEl = document.getElementById('device-connect-chip');
    chipEl.textContent = chip.badge;
    chipEl.style.color = chip.color;

    // ── المودال يعرض نافذة افتراضية 7 أيام + أزرار تبديل (24/7/30) ──
    var currentRange = '7d';
    var loadRange = async function (range) {
      var his = await fetchApi(apiPaths.history(deviceId, range));
      if (!his || !his.success) { alert(his && his.error ? his.error : 'تعذّر جلب سجل الجهاز'); return; }
      var data = his.data;
      var rangeNames = { '24h': 'آخر 24 ساعة', '7d': 'آخر 7 أيام', '30d': 'آخر 30 يوم' };
      document.getElementById('modal-uptime').textContent = 'نسبة التشغيل (' + rangeNames[range] + '): ' + NMFormat.pct(data.uptime_percentage) + '';
      var canvas = document.getElementById('modal-chart-canvas');
      if (typeof window.renderDeviceChart === 'function') {
        try { currentChart = window.renderDeviceChart(canvas, data.status_points); } catch (e) { console.error(e); }
      }
      var listEl = document.getElementById('modal-downtime-list');
      listEl.innerHTML = '';
      if (!data.downtime_events || data.downtime_events.length === 0) {
        listEl.innerHTML = '<li>لا توجد انقطاعات خلال الفترة.</li>';
      } else {
        for (var i = 0; i < data.downtime_events.length; i++) {
          var ev = data.downtime_events[i];
          var li = document.createElement('li');
          var ended = ev.ended_at ? NMFormat.dateTime(ev.ended_at) : 'مستمرة الآن';
          li.textContent = 'من ' + NMFormat.dateTime(ev.started_at) + ' إلى ' + ended + ' — المدة: ' + NMFormat.duration(ev.duration_seconds);
          listEl.appendChild(li);
        }
      }
    };
    await loadRange('7d');

    // أزرار الفترة المدمجة داخل المودال (يُنشأن مرة واحدة).
    var chipEl0 = document.getElementById('device-connect-chip');
    var rangesRow = document.getElementById('modal-ranges-row');
    if (!rangesRow) {
      rangesRow = document.createElement('div');
      rangesRow.id = 'modal-ranges-row';
      rangesRow.style.cssText = 'display:flex; gap:0.4rem; flex-wrap:wrap; margin:0.4rem 0;';
      rangesRow.innerHTML = '<button data-r="24h" type="button">24 ساعة</button>' +
        '<button data-r="7d" type="button">7 أيام</button>' +
        '<button data-r="30d" type="button">30 يوم</button>';
      chipEl0.insertAdjacentElement('afterend', rangesRow);
      rangesRow.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-r]');
        if (!b || String(b.dataset.r) === String(currentRange)) return;
        currentRange = b.dataset.r;
        loadRange(currentRange);
      });
    }
    if (dev.web_port) {
      chipEl0.insertAdjacentHTML('beforeend', '<span style="font-size:0.7rem; color:var(--muted);"> · ويب بورت: ' + dev.web_port + '</span>');
    }

    modal.classList.remove('hidden');
  } catch (e) {
    console.error('openDeviceModal error', e);
    alert('خطأ في جلب تفاصيل الجهاز: ' + (e && e.message ? e.message : ''));
  }
};

// ====== \u062a\u0647\u064a\u0626\u0629 \u0627\u0644\u0635\u0641\u062d\u0629 ======
async function init() {
  // قرار العرض أولًا: مسجَّل ⇒ مسارات داخلية (بالعناوين) · زائر ⇒ التغذية العامة المنقّاة.
  // مهم: لا يُطلب أي بيانات قبل معرفة الوضع، فلا يظهر عنوان للزائر إطلاقًا.
  apiPaths = await resolveDisplayMode();
  applyDisplayModeUi();

  var results = await Promise.all([
    fetchApi(apiPaths.list),
  ]);
  var devs = results[0];
  allDevices = devs.success ? devs.data : [];

  fillSelectFromDevices('filter-type', allDevices, 'device_type_id', 'device_type_name');
  fillSelectFromDevices('filter-location', allDevices, 'location_id', 'location_name');

  try {
    var savedView = localStorage.getItem(VIEW_STORAGE_KEY);
    if (savedView === 'table' || savedView === 'cards') currentView = savedView; // 'map' أُزيل في v2.13.11
    var savedSort = localStorage.getItem(SORT_STORAGE_KEY);
    if (savedSort) {
      currentSort = savedSort;
      document.getElementById('filter-sort').value = savedSort;
    }
  } catch (e) {}
  switchView(currentView);

  document.getElementById('search-input').addEventListener('input', applyFilters);
  document.getElementById('filter-type').addEventListener('change', applyFilters);
  document.getElementById('filter-location').addEventListener('change', applyFilters);
  document.getElementById('filter-status').addEventListener('change', applyFilters);
  document.getElementById('filter-sort').addEventListener('change', function () {
    currentSort = this.value;
    try { localStorage.setItem(SORT_STORAGE_KEY, currentSort); } catch (e) {}
    applyFilters();
  });

  document.getElementById('view-cards-btn').addEventListener('click', function () { switchView('cards'); });
  document.getElementById('view-table-btn').addEventListener('click', function () { switchView('table'); });

  document.getElementById('modal-close-btn').addEventListener('click', function () {
    document.getElementById('device-modal').classList.add('hidden');
  });

  // --- قسم أدوات الشبكة (بث مباشر SSE) ---
  var toolsOutput = document.getElementById('tools-output');
  var toolsStatus = document.getElementById('tools-status');
  var toolsStatusText = document.getElementById('tools-status-text');
  var toolsStopBtn = document.getElementById('tools-stop-btn');
  var toolsClearBtn = document.getElementById('tools-clear-btn');
  var toolsPingBtn = document.getElementById('tools-ping-btn');
  var toolsTracertBtn = document.getElementById('tools-tracert-btn');
  var currentAbortController = null; // للإلغاء

  document.getElementById('tools-ping-btn').addEventListener('click', function () {
    runTool('ping');
  });
  document.getElementById('tools-tracert-btn').addEventListener('click', function () {
    runTool('tracert');
  });
  document.getElementById('tools-stop-btn').addEventListener('click', function () {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
    toolsStatusText.textContent = T('s2j.stopped', 'تم الإيقاف');
    finishTool();
  });
  document.getElementById('tools-clear-btn').addEventListener('click', function () {
    toolsOutput.textContent = '';
    toolsOutput.classList.add('hidden');
    toolsClearBtn.classList.add('hidden');
  });

  function startToolUI() {
    toolsOutput.textContent = '';
    toolsOutput.classList.remove('hidden');
    toolsStatus.classList.remove('hidden');
    toolsStatusText.textContent = T('s2j.working', 'جاري التنفيذ...');
    toolsStopBtn.classList.remove('hidden');
    toolsPingBtn.disabled = true;
    toolsTracertBtn.disabled = true;
    toolsPingBtn.style.opacity = '0.5';
    toolsTracertBtn.style.opacity = '0.5';
  }

  function finishTool() {
    toolsStatus.classList.add('hidden');
    toolsStopBtn.classList.add('hidden');
    toolsClearBtn.classList.remove('hidden');
    toolsPingBtn.disabled = false;
    toolsTracertBtn.disabled = false;
    toolsPingBtn.style.opacity = '1';
    toolsTracertBtn.style.opacity = '1';
  }

  async function runTool(tool) {
    var target = document.getElementById('tools-ip-input').value.trim();
    if (!target) {
      alert('من فضلك أدخل IP أو اسم مضيف');
      return;
    }
    if (!/^[a-zA-Z0-9.\-_]+$/.test(target)) {
      alert('حروف غير مسموحة في IP/اسم المضيف');
      return;
    }

    startToolUI();

    // إلغاء أي طلب سابق
    if (currentAbortController) currentAbortController.abort();
    currentAbortController = new AbortController();

    try {
      var response = await fetch('/api/tools/' + tool + '?ip=' + encodeURIComponent(target), {
        signal: currentAbortController.signal,
      });

      if (!response.ok) {
        // SEC-01: أدوات التشخيص صارت للمدير (أو المشغّل) فقط — رسائل واضحة بدل HTTP خام.
        var friendly = {
          401: '🔒 أداة التشخيص تتطلب تسجيل دخول المدير',
          403: '🔒 هذا الهدف غير مسموح أو صلاحيتك لا تتيح استخدام أدوات التشخيص',
          429: '⏳ محاولات كثيرة — انتظر قليلًا ثم أعد المحاولة',
        };
        var msg = friendly[response.status] || ('⚠️ خطأ: HTTP ' + response.status);
        try {
          // الرسالة العربية التفصيلية من الخادم (هدف غير صالح/خارج النطاق...) إن وُجدت.
          var errBody = await response.json();
          if (response.status !== 401 && errBody && errBody.error) msg = '⚠️ ' + errBody.error;
        } catch (e) { /* الاستجابة ليست JSON */ }
        toolsOutput.textContent = msg;
        finishTool();
        return;
      }

      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var sseBuffer = '';

      while (true) {
        var result = await reader.read();
        if (result.done) break;

        sseBuffer += decoder.decode(result.value, { stream: true });
        var parts = sseBuffer.split('\n\n');
        sseBuffer = parts.pop() || '';

        for (var i = 0; i < parts.length; i++) {
          var block = parts[i].trim();
          if (!block) continue;

          var eventType = '';
          var data = '';
          var lines = block.split('\n');
          for (var j = 0; j < lines.length; j++) {
            if (lines[j].indexOf('event:') === 0) {
              eventType = lines[j].substring(6).trim();
            } else if (lines[j].indexOf('data:') === 0) {
              data = lines[j].substring(5).trim();
            }
          }

          if (eventType === 'start') {
            toolsStatusText.textContent = T('s2j.running', 'جاري') + ' ' + (tool === 'ping' ? 'Ping' : 'Tracert') + ' إلى ' + target + '...';
          } else if (eventType === 'line') {
            try {
              var lineText = JSON.parse(data);
              toolsOutput.textContent += lineText + '\n';
            } catch (e) {
              toolsOutput.textContent += data + '\n';
            }
            // التمرير التلقائي لآخر سطر
            toolsOutput.scrollTop = toolsOutput.scrollHeight;
          } else if (eventType === 'error') {
            try {
              var errMsg = JSON.parse(data);
              toolsOutput.textContent += '\n❌ ' + errMsg + '\n';
            } catch (e) {
              toolsOutput.textContent += '\n❌ ' + data + '\n';
            }
          } else if (eventType === 'done') {
            toolsStatusText.textContent = T('s2j.done', 'اكتمل ✓');
            finishTool();
            return;
          }
        }
      }
      finishTool();
    } catch (e) {
      if (e.name === 'AbortError') {
        // المستخدم أوقف العملية — تم التعامل أعلاه
        finishTool();
      } else {
        toolsOutput.textContent += '\n❌ خطأ: ' + e.message + '\n';
        finishTool();
      }
    }
  }
  // --- نهاية قسم أدوات الشبكة ---

  var themeBtn = document.getElementById('theme-toggle');
  // تطبيق الوضع الليلي المحفوظ عند الإقلاع.
  try {
    if (localStorage.getItem(THEME_STORAGE_KEY) === 'dark') {
      document.body.classList.add('dark');
      themeBtn.textContent = '\u2600\uFE0F \u0648\u0636\u0639 \u0646\u0647\u0627\u0631\u064a';
    }
  } catch (e) {}
  themeBtn.addEventListener('click', function () {
    document.body.classList.toggle('dark');
    var isDark = document.body.classList.contains('dark');
    themeBtn.textContent = isDark ? '\u2600\uFE0F \u0648\u0636\u0639 \u0646\u0647\u0627\u0631\u064a' : '\uD83C\uDF19 \u0648\u0636\u0639 \u0644\u062a\u064a\u0644\u064a';
    try { localStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light'); } catch (e) {}
  });
  // ===== زر تفعيل إشعارات الموبايل (Web Push + VAPID) =====
  var notifyBtn = document.getElementById('notify-btn');
  if (notifyBtn) {
    function updateNotifyBtnState() {
      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        notifyBtn.disabled = true;
        notifyBtn.textContent = "🔕 الإشعارات غير مدعومة";
        return;
      }
      if (Notification.permission === "granted") {
        notifyBtn.textContent = "🔔 الإشعارات مفعّلة";
        notifyBtn.style.color = "var(--online)";
      } else if (Notification.permission === "denied") {
        notifyBtn.disabled = true;
        notifyBtn.textContent = "🔕 الإشعارات محجوبة";
      } else {
        notifyBtn.textContent = "🔔 تفعيل الإشعارات";
      }
    }
    updateNotifyBtnState();

    notifyBtn.addEventListener("click", async function () {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        alert("متصفحك لا يدعم الإشعارات");
        return;
      }
      var permission = await Notification.requestPermission();
      if (permission !== "granted") {
        alert("تم رفض الإذن. لتلقي الإشعارات يجب السماح بها من إعدادات المتصفح.");
        updateNotifyBtnState();
        return;
      }
      try {
        var vRes = await fetchApi("/api/notifications/vapid-public");
        if (!vRes.success || !vRes.data || !vRes.data.publicKey) {
          // v2.13.0 — الخادم يولّد مفاتيح VAPID ويحفظها تلقائيًّا عند غيابها، فوصل هذه
          // الرسالة يعني أن التوليد نفسه لم ينجح (صلاحيات ملف الإعدادات/مساحة قرص) —
          // لِذا نُوجّه المدير إلى سجل الخدمة لا إلى خطوة يدوية مجهولة.
          alert("⚠️ إشعارات الموبايل غير مُهيّأة على الخادم: لا توجد مفاتيح VAPID ولم يتيسّر توليدها تلقائيًّا.\nاطلب من المدير مراجعة سجل الخدمة ثم إضافة VAPID_PUBLIC_KEY و VAPID_PRIVATE_KEY إلى ملف إعدادات الخدمة وإعادة التشغيل.");
          updateNotifyBtnState();
          return;
        }
        var vapidPublicKey = vRes.data.publicKey;
        function urlBase64ToUint8Array(base64String) {
          var padding = "=".repeat((4 - (base64String.length % 4)) % 4);
          var base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
          var rawData = atob(base64);
          var arr = new Uint8Array(rawData.length);
          for (var i = 0; i < rawData.length; i++) arr[i] = rawData.charCodeAt(i);
          return arr;
        }
        var reg = await navigator.serviceWorker.ready;
        var subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });
        await fetch("/api/notifications/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: JSON.stringify(subscription),
            platform: "web",
            deviceInfo: navigator.userAgent || "",
          }),
        });
        notifyBtn.textContent = "✅ تم التفعيل بنجاح";
        notifyBtn.style.color = "var(--online)";
        reg.showNotification("🔔 تم تفعيل الإشعارات", {
          body: "ستصلك إشعارات فورية عند انقطاع أي جهاز أو عودته.",
          icon: "/icon-192.png",
        });
      } catch (e) {
        console.error("Push subscribe error", e);
        alert("❌ فشل تفعيل الإشعارات: " + (e.message || "خطأ غير معروف"));
      }
      updateNotifyBtnState();
    });
  }


  // v2.8.7 — polling تكيفي + بثّ حيّ (SSE): كل 60 ثانية مع الخط المفتوح، وكل 10 ثوانٍ بدونه.
  setPollInterval(10000);
  connectPublicLive();
}

// ═══ v2.8.7 — التحديث الحيّ (SSE) في الصفحة العامة ═══
// نفس مسار شاشة NOC: /api/live/status — لقطة أوّلية ثم التغييرات فقط، مع polling احتياطي.
let publicPollHandle = null;
let publicPollMs = 10000;
let publicLiveES = null;

async function pollDevices() {
  try {
    const r = await fetchApi(apiPaths.list);
    if (r.success) {
      allDevices = r.data;
      applyFilters();
    }
  } catch (e) {
    console.error('polling error', e);
  }
}

function setPollInterval(ms) {
  if (publicPollHandle) clearInterval(publicPollHandle);
  publicPollMs = ms;
  publicPollHandle = setInterval(pollDevices, ms);
}

// تطبيق الحالة القادمة من البثّ (بلا طلب شبكة) ثم إعادة رسم واحدة.
function applyLiveStatus(msg) {
  if (!msg || !Array.isArray(msg.devices)) return;
  const st = {};
  for (const d of msg.devices) st[Number(d.id)] = d.status;
  let changed = 0;
  for (const dev of allDevices) {
    const s = st[Number(dev.id)];
    if (s === undefined) continue;
    if (dev.current_status !== s) changed++;
    dev.current_status = s;
  }
  if (changed) applyFilters();
}

// v2.33.0 — «أوقف المالك العرض العام»: السيرفر يرسل {type:'closed'} قبل إغلاق الخطّ، فنوقف
// إعادة المحاولة السريعة ونعرض السبب بدل أن تبدو الشاشة متجمّدة، ثم نُعيد المحاولة كل دقيقة
// (فلو أعاد المالك التشغيل، تعود الشاشة لحظيًّا من نفسها بلا تحديث يدوي).
let publicLiveClosed = false;
let publicLiveRetry = null;

function schedulePublicLiveRetry() {
  if (publicLiveRetry) return;
  publicLiveRetry = setTimeout(() => { publicLiveRetry = null; connectPublicLive(); }, 60000);
}

function handlePublicLiveClosed() {
  publicLiveClosed = true;
  if (publicLiveES) { publicLiveES.close(); publicLiveES = null; }
  setPollInterval(600000);   // لا نبض سريع أثناء الإيقاف (بلا ضجيج على السيرفر)
  const el = document.getElementById('summary-bar');
  if (el) el.textContent = '⛔ أوقف المالك العرض العام — تُعرض آخر حالة معروفة (إعادة محاولة كل دقيقة)';
  schedulePublicLiveRetry();
}

function connectPublicLive() {
  if (typeof window.EventSource !== 'function') return;   // متصفح قديم ⇒ polling فقط
  try { publicLiveES = new EventSource('/api/live/status'); } catch (_) { publicLiveES = null; return; }
  publicLiveES.onopen = () => {
    // عودة الخطّ بعد إيقاف المالك ⇒ نرسم البيانات فورًا فنمسح تنبيه الإيقاف بدل بقائه بلا داعٍ
    const wasClosed = publicLiveClosed;
    publicLiveClosed = false;
    setPollInterval(60000);
    if (wasClosed) { try { pollDevices(); } catch (_) {} }
  };
  publicLiveES.onmessage = (ev) => {
    let msg = null;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }
    if (msg && msg.type === 'closed') { handlePublicLiveClosed(); return; }
    try { applyLiveStatus(msg); } catch (_) {}
  };
  publicLiveES.onerror = () => {
    if (publicLiveClosed) { schedulePublicLiveRetry(); return; }   // موقوف من المالك ⇒ محاولة كل دقيقة
    if (publicPollMs !== 10000) setPollInterval(10000);
  };
}

function fillSelect(selectId, items) {
  var sel = document.getElementById(selectId);
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var opt = document.createElement('option');
    opt.value = it.id;
    opt.textContent = it.name;
    sel.appendChild(opt);
  }
}

// SEC-02 — بناء قائمة فلترة (النوع/الموقع) من قائمة الأجهزة المنقّاة نفسها
// بدل الاعتماد على /api/device-types و/api/locations المحميين بجلسة.
function fillSelectFromDevices(selectId, devices, idKey, nameKey) {
  var sel = document.getElementById(selectId);
  if (!sel) return;
  var seen = {};
  var pairs = [];
  for (var i = 0; i < (devices || []).length; i++) {
    var it = devices[i];
    var id = it[idKey];
    var name = it[nameKey];
    if (id == null || !name || seen[id]) continue;
    seen[id] = true;
    pairs.push({ id: id, name: name });
  }
  pairs.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'ar'); });
  for (var j = 0; j < pairs.length; j++) {
    var opt = document.createElement('option');
    opt.value = pairs[j].id;
    opt.textContent = pairs[j].name;
    sel.appendChild(opt);
  }
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', init);

// ═══ v2.30.0 — ملصقات QR: الرابط الممسوح من الملصق (/#dev=ID أو /?dev=ID)
// يفتح تفاصيل الجهاز ويبرز بطاقته على الصفحة العامة ═══
function openFromHash() {
  const m = (location.hash || location.search).match(/dev=(\d+)/);
  if (!m) return;
  const id = Number(m[1]);
  const t = setInterval(() => {
    const card = document.querySelector('.device-card[data-id="' + id + '"]');
    if (card) {
      clearInterval(t);
      card.scrollIntoView({ block: 'center', behavior: 'smooth' });
      card.style.boxShadow = '0 0 0 3px var(--accent)';
      if (typeof window.openDeviceModal === 'function') window.openDeviceModal(id);
    }
  }, 300);
  setTimeout(() => clearInterval(t), 20000);
}
document.addEventListener('DOMContentLoaded', openFromHash);
