// noc.js (v2.13.9) — منطق شاشة NOC كامل، فُصل عن noc.html (كان 1459 سطرًا مضمَنًا).
// يُحمَّل نهاية <body> بنفس ترتيب التنفيذ السابق. ميزات حرجة هنا: الإنذار (صوت/شاشة) + SSE + خريطة/رسم.
(function() {
  'use strict';

  // ── State Variables ──
  let rawTopology = [];
  let allDevices = [];
  let allLocations = [];
  let locById = new Map();
  let devById = new Map();
  let searchFilter = '';
  let statusFilter = 'all'; // 'all', 'down', 'up'
  let currentView = 'all';   // 'all', 'hero', 'map', 'grid', 'draw'
  let mapZoomLevel = 1.0;
  // v2.8.6 — مفاتيح حفظ حالة العرض (التبويب المختار + مقياس «التخطيط المرسوم»)
  // حتى يبقيا كما هما بعد إعادة تحميل الصفحة (كانا في الذاكرة فقط ⇒ العودة لأوّل شاشة).
  const VIEW_STORAGE_KEY = 'nm.nocView';
  const ZOOM_STORAGE_KEY = 'nm.nocZoom';

  // v2.12.0 — حالة «التنبيه الصوتي» تُحفظ مثل التبويب والمقياس (كانت تُفقد مع كل إعادة تحميل).
  const AUDIO_STORAGE_KEY = 'nm.nocAudioAlert';
  // v2.8.7 — البثّ الحيّ (SSE) + polling تكيفي:
  //   • SSE متصل  ⇒ polling كل 60 ثانية (تحديث البنية فقط) + تحديث لحظي عند أي تغيّر حالة.
  //   • SSE مقطوع ⇒ polling كل 10 ثوانٍ (السلوك القديم) + إعادة اتصال تلقائية من المتصفح.
  let liveES = null;
  let liveConnected = false;
  let pollHandle = null;
  let pollIntervalMs = 10000;
  let liveRenderTimer = null;
  let audioAlertEnabled = false;
  let previousDownIds = new Set();
  let audioCtx = null;

  // ── Smart Default Layout Coordinates for Locations (Width: 330px per card) ──
  // If a location has pos_x/pos_y saved in DB, saved coords are used 100%.
  // If pos_x is null, these carefully planned non-overlapping positions are used.
  const DEFAULT_LOC_POS = {
    18: { x: 1280, y: 15 },   // Internet-Gateway (Center Top)
    19: { x: 1280, y: 120 },  // المبنى الادارى (Under Gateway)
    8:  { x: 890,  y: 380 },  // الادارة-الدور الارضى
    17: { x: 890,  y: 720 },  // غرفة الامن (Child of Floor 8)
    9:  { x: 1280, y: 380 },  // الادارة-الدور الثانى
    10: { x: 1670, y: 380 },  // الادارة-الدور الثالث (Main server cluster)
    16: { x: 1310, y: 720 },  // عنبر منعم
    13: { x: 1690, y: 700 },  // عنبر الكتاين (Admin saved pos)
    14: { x: 2020, y: 700 },  // البوفية (Admin saved pos)
    15: { x: 2350, y: 700 },  // عنبر المخزن (Admin saved pos)
    11: { x: 2020, y: 1040 }, // الورشة-1 (Child of Bofeh)
    12: { x: 2350, y: 1040 }, // الورشة-2 (Child of Warsha 1)
  };

  const TYPE_CONFIG = {
    'Firewall':     { icon: '🛡️', title: 'جدار الحماية والبوابات (Firewall & Gateways)', order: 1 },
    'Server':       { icon: '🖥️', title: 'الخوادم والأنظمة المركزية (Core Servers)', order: 2 },
    'Switch':       { icon: '🔀', title: 'السويتشات وموزعات الشبكة (Switches)', order: 3 },
    'Access Point': { icon: '📶', title: 'نقاط الواي فاي والشبكة اللاسلكية (Access Points)', order: 4 },
    'NVR/DVR':      { icon: '📹', title: 'كاميرات المراقبة وأجهزة التسجيل (NVR & DVR)', order: 5 },
    'Printer':      { icon: '🖨️', title: 'الطابعات وماكينات التصوير (Printers & Scanners)', order: 6 },
    'Other':        { icon: '📌', title: 'أجهزة وأنظمة أخرى (Other Devices)', order: 7 }
  };

  // v2.12.2 — تصنيف الأنواع بكلمات مفتاحية (بدل المطابقة الحرفية فقط).
  // جذر المشكلة: أي نوع غير مذكور حرفيًّا في TYPE_CONFIG يسقط في «أخرى» — ومنها «Router»
  // الموجود في مخطط المشروع نفسه — فتظهر الراوترات/البوابات في «أجهزة وأنظمة أخرى»
  // بدل «🛡️ جدار الحماية والبوابات». المطابقة الحرفية لها الأولوية، ثم الكلمات المفتاحية
  // (تشمل أنواعًا عربية/إنجليزية يضيفها المستخدم: MikroTik · Sophos · بوابة · راوتر…).
  // v2.12.3 — (طلب المستخدم: «أجهزة ISP مش بيدخلو تحت 🛡️ جدار الحماية والبوابات»): كلمات خط
  // الإنترنت أُضيفت إلى قسم الجدار — وبعضها قصير جدًّا (isp · ont · olt) فتُطابَق الكلمات
  // اللاتينية عند **بداية الكلمة** فقط (انظر typeKeywordHit) فلا تُصطاد داخل كلمات أخرى.
  const TYPE_KEYWORDS = [
    ['Firewall',     ['firewall', 'gateway', 'router', 'modem', 'isp', 'wan', 'uplink', 'internet', 'fiber', 'fibre', 'gpon', 'ont', 'olt', 'lte', 'sophos', 'mikrotik', 'fortigate', 'pfsense', 'edge router', 'جدار', 'بوابة', 'راوتر', 'موجه', 'موجّه', 'ميكروتيك', 'مودم', 'فايبر', 'ألياف', 'مزود الخدمة', 'خط الإنترنت', 'إنترنت']],
    ['Server',       ['server', 'سيرفر', 'خادم', 'synology', 'qnap', 'esxi', 'vmware', 'hypervisor', 'nas', 'domain controller', 'active directory']],
    ['Switch',       ['switch', 'سويتش', 'موزع', 'موزّع']],
    ['Access Point', ['access point', 'accesspoint', 'access-point', 'wifi', 'wi-fi', 'واي فاي', 'لاسلكي', 'unifi', 'omada']],
    ['NVR/DVR',      ['nvr', 'dvr', 'camera', 'كاميرا', 'hikvision', 'dahua', 'تسجيل']],
    ['Printer',      ['printer', 'scanner', 'plotter', 'طابعة', 'ماسح', 'تصوير']],
  ];

  // مطابقة كلمة مفتاحية واحدة: الكلمات اللاتينية تُطابَق عند **بداية الكلمة** فقط
  // (‏«isp» ⇒ ISP · ISP-Link · ISP Fiber) لا في وسطها (‏«Display» · «Dispatcher» لا تُطابق
  // isp، و«Front-Desk PC» لا تُطابق ont)، والكلمات العربية تُطابَق مباشرة («بوابة إنترنت» بها
  // «بوابة»). السبب: كلمات قصيرة مثل isp · ont · olt بلا هذا القيد كانت ستسحب أجهزة لا علاقة
  // لها بقسم الجدار.
  function typeKeywordHit(n, w) {
    if (!/^[a-z0-9 ._-]+$/.test(w)) return n.includes(w);
    let at = n.indexOf(w);
    while (at >= 0) {
      if (at === 0 || !/[a-z0-9]/.test(n.charAt(at - 1))) return true;
      at = n.indexOf(w, at + 1);
    }
    return false;
  }

  function resolveTypeKey(rawName) {
    if (!rawName) return 'Other';
    if (TYPE_CONFIG[rawName]) return rawName;   // مطابقة تامة (الأولوية للاسم المعروف)
    const n = String(rawName).toLowerCase();
    for (let i = 0; i < TYPE_KEYWORDS.length; i++) {
      const key = TYPE_KEYWORDS[i][0];
      if (TYPE_KEYWORDS[i][1].some((w) => typeKeywordHit(n, w))) return key;
    }
    return 'Other';
  }

  const KIND_LABELS = {
    'building': '🏢 مبنى إداري',
    'internet': '🌐 بوابة إنترنت',
    'floor':    '📐 طابق',
    'room':     '🚪 غرفة',
    'rack':     '🗄️ خزانة رك',
    'site':     '🏛️ موقع / عنبر',
    'zone':     '📍 منطقة'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ── v2.13.3 — غطاء إنذار الانقطاع + شارات «منقطع منذ …» ──
  // المصدر: offline_since يأتي من الخادم (downtime_events مفتوحة) عبر /api/topology وSSE.
  // offlineSinceById: خريطة جهاز → بداية الانقطاع — لأن أشجار الخريطة/الرسم لا تحمل الحقل.
  let offlineSinceById = new Map();   // Number(id) → ISO string|null
  let overlayDevices = [];            // أجهزة الغطاء الحالي (نضيف الجديد دون فقد القديم)

  function fmtDowntime(iso) {
    const t = Date.now() - new Date(iso).getTime();
    if (!isFinite(t) || t < 0) return 'الآن';
    const s = Math.floor(t / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d) return d + ' يوم ' + (h % 24) + ' ساعة';
    if (h) return h + ' ساعة ' + (m % 60) + ' دقيقة';
    if (m) return m + ' دقيقة ' + (s % 60) + ' ثانية';
    return 'لحظة — ' + s + ' ثانية';
  }
  function downtimeAge(iso) { return iso ? fmtDowntime(iso) : 'الآن'; }

  function showOutageOverlay(devs) {
    for (const d of devs || []) {
      if (!d) continue;
      if (!overlayDevices.some((x) => Number(x.id) === Number(d.id))) overlayDevices.push(d);
    }
    const list = document.getElementById('outage-overlay-list');
    if (!list) return;
    list.innerHTML = overlayDevices.map((d) => `
      <div class="oo-device">${esc((d.name || 'جهاز') + ' · ' + (d.ip || '—'))}
        <span class="oo-age">منقطع منذ ${esc(downtimeAge(d.offline_since))}</span>
      </div>`).join('');
    const ov = document.getElementById('outage-overlay');
    if (ov) ov.classList.add('show');
  }
  function hideOutageOverlay() {
    overlayDevices = [];   // الإخفاء يفرّغ القائمة: انقطاع لاحق جديد يظهر وحده
    const ov = document.getElementById('outage-overlay');
    if (ov) ov.classList.remove('show');
  }
  window.hideOutageOverlay = hideOutageOverlay;

  // ── v2.13.5 — مُقارِنة IP خالصة (طلب المستخدم: ترتيب موحّد بالـIP في NOC كلها). ──
  // كانت natCmp تُرجّح «رقم لاحق في الاسم» أولًا — صارت الآن بالأوكتِتات كاملة دائمًا،
  // والاسم يُستعمل كفاصل تعادل فقط (مثلاً جهازان يشتركان في IP خاطئ).
  const ipToNum = (ip) => String(ip || '').split('.').reduce((acc, p) => acc * 256 + (parseInt(p, 10) || 0), 0);
  function natCmp(a, b) {
    const d = ipToNum(a.ip) - ipToNum(b.ip);
    if (d) return d;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
  }


  // ── Audio Alert System ──
  // v2.12.0 — إعادة بناء التنبيه الصوتي (طلب المستخدم: «صوت أوضح وأقوى» · «يفضل مفعّل بعد
  // الريفريش» · «إصلاح الإنذار الكاذب»). التفاصيل في CHANGELOG [2.12.0].
  const AUDIO_PEAK = { alert: 0.22, test: 0.13 };   // كان 0.12 ثابتًا على موجة sawtooth حادّة

  // نغمة واحدة: موجة sine + طبقة أوكتاف أوطى «للجسم» + مغلّف ناعم (صعود 12ms يمنع الطقطقة،
  // وهبوط أُسّي يجعلها «جرسًا» لا «زفيرًا»). الجسم أهدأ (0.35) فيبقى الصوت نقيًّا لا مشوّشًا.
  function playTone(freq, startAt, dur, peak) {
    const osc = audioCtx.createOscillator();
    const body = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    const gBody = audioCtx.createGain();
    const t1 = startAt + dur;
    osc.type = 'sine';
    body.type = 'sine';
    osc.frequency.setValueAtTime(freq, startAt);
    body.frequency.setValueAtTime(freq / 2, startAt);
    gBody.gain.setValueAtTime(0.35, startAt);
    g.gain.setValueAtTime(0.0001, startAt);
    g.gain.linearRampToValueAtTime(peak, startAt + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t1);
    osc.connect(g);
    body.connect(gBody);
    gBody.connect(g);
    g.connect(audioCtx.destination);
    osc.start(startAt);
    body.start(startAt);
    osc.stop(t1 + 0.03);
    body.stop(t1 + 0.03);
  }

  // kind: 'alert' = انقطاع جديد (نغمتان صاعدتان 880 ثم 1174Hz) · 'test' = عند تفعيل الزر (نغمة قصيرة).
  function playAlertBeep(kind = 'alert') {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const peak = AUDIO_PEAK[kind] || AUDIO_PEAK.alert;
      const t0 = audioCtx.currentTime + 0.02;
      if (kind === 'test') { playTone(660, t0, 0.14, peak); return; }
      playTone(880, t0, 0.18, peak);
      playTone(1174, t0 + 0.20, 0.30, peak);
    } catch (_) {}
    // الصوت لم يُنشَّط بعد (المتصفح يمنع التشغيل قبل تفاعل المستخدم) ⇒ نُعيد شريط التنشيط بدل أن
    // يبقى التنبيه «صامتًا» ولا يدري أحد.
    if (audioAlertEnabled && audioCtx && audioCtx.state !== 'running') {
      setTimeout(() => {
        if (audioAlertEnabled && audioCtx && audioCtx.state !== 'running') armAudioUnlock();
      }, 700);
    }
  }

  // v2.12.0 — مزامنة زر «التنبيه الصوتي» مع الحالة (عند التبديل وعند الاسترجاع بعد إعادة التحميل).
  function syncAudioButton() {
    const btn = document.getElementById('btn-audio');
    const icon = document.getElementById('audio-icon');
    if (!btn || !icon) return;
    btn.classList.toggle('active', audioAlertEnabled);
    icon.textContent = audioAlertEnabled ? '🔊' : '🔔';
    btn.title = audioAlertEnabled
      ? 'التنبيه الصوتي مُفعَّل — يصفر عند انقطاع جهاز جديد (يبقى مفعّلًا بعد إعادة التحميل)'
      : 'تشغيل تنبيه صوتي عند انقطاع أي جهاز';
  }

  // v2.12.0 — تنشيط الصوت بعد إعادة التحميل: المتصفحات تمنع التشغيل قبل تفاعل المستخدم، فنطلب
  // نقرة/مفتاحًا واحدًا (عبر شريط أزرق) ثم يعمل التنبيه طبيعيًّا.
  let audioUnlockArmed = false;
  function showAudioHint(show) {
    const hint = document.getElementById('audio-hint');
    if (hint) hint.classList.toggle('show', !!show);
  }
  function unlockAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) {}
    audioUnlockArmed = false;
    showAudioHint(false);
  }
  function armAudioUnlock() {
    if (!audioAlertEnabled || audioUnlockArmed) return;
    audioUnlockArmed = true;
    showAudioHint(true);
    const once = () => {
      document.removeEventListener('pointerdown', once, true);
      document.removeEventListener('keydown', once, true);
      unlockAudio();
    };
    document.addEventListener('pointerdown', once, true);
    document.addEventListener('keydown', once, true);
  }

  window.toggleAudioAlert = function() {
    audioAlertEnabled = !audioAlertEnabled;
    try { localStorage.setItem(AUDIO_STORAGE_KEY, audioAlertEnabled ? '1' : '0'); } catch (e) {}
    syncAudioButton();
    if (!audioAlertEnabled) {
      audioUnlockArmed = false;
      showAudioHint(false);
      return;
    }
    unlockAudio();                 // تفاعل المستخدم الحالي كافٍ لتنشيط الصوت فورًا
    playAlertBeep('test');         // نغمة الاختبار — مميَّزة عن تنبيه الانقطاع الحقيقي
  };

  // ── Fullscreen Toggle ──
  window.toggleFullscreen = function() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
    }
  };

  // ── View Mode Switcher ──
  window.setViewMode = function(mode) {
    currentView = mode;
    document.querySelectorAll('.views-tabs .tab-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-view') === mode);
    });
    // v2.8.6 — نحفظ التبويب المختار حتى يبقى بعد إعادة التحميل.
    try { localStorage.setItem(VIEW_STORAGE_KEY, mode); } catch (e) {}
    const heroSec = document.getElementById('hero-section');
    const mapSec = document.getElementById('map-section');
    const catSec = document.getElementById('categories-section');
    const drawSec = document.getElementById('draw-section');

    heroSec.style.display = (mode === 'all' || mode === 'hero') ? 'block' : 'none';
    mapSec.style.display  = (mode === 'all' || mode === 'map')  ? 'block' : 'none';
    // v2.13.5 — قسم «الأجهزة حسب النوع» شُذ من «عرض شامل» (طلب المستخدم: «أشياء مكررة»).
    // كان يُعرض مع الخريطة فيظهر كل جهاز مرتين في نفس الشاشة؛ صار تبويبًا مستقلًا فقط.
    catSec.style.display  = (mode === 'grid') ? 'block' : 'none';
    // v2.8.6 — «التخطيط المرسوم» يُعرض عند اختياره فقط (لا يزدحم به «عرض شامل»).
    if (drawSec) drawSec.style.display = (mode === 'draw') ? 'block' : 'none';
    // v2.11.6 — أدوات الفلترة تظهر فقط في الشاشات التي تعمل فيها فعلًا.
    applyFilterBarVisibility(mode);
  };

  // ── v2.11.6 — نطاق عمل أدوات الفلترة حسب الشاشة (طلب المستخدم: «أي زر لا يعمل — اخفيه») ──
  //   الأجهزة حسب النوع / عرض شامل : البحث ✓ + فلتر الحالة ✓ (كلاهما في قسم «الأجهزة حسب النوع»)
  //   ✏️ التخطيط المرسوم          : البحث ✓ (يخفي صفوف الأجهزة داخل البطاقات) — فلتر الحالة ✗
  //   🗺️ خريطة المباني / 🔗 مسار الإنترنت : لا شيء ✗
  //   v2.13.5 — «عرض شامل» بلا قسم «حسب النوع» ⇒ لا أدوات فلترة له (لم تعد تُؤثّر على شيئ يُعرض).
  const FILTER_SCOPE = {
    all:  { search: false, status: false },
    grid: { search: true,  status: true  },
    draw: { search: true,  status: false },
    map:  { search: false, status: false },
    hero: { search: false, status: false },
  };
  window.applyFilterBarVisibility = function(mode) {
    const rule = FILTER_SCOPE[mode] || FILTER_SCOPE.all;
    const controls = document.querySelector('.filter-controls');
    if (controls) controls.style.display = (rule.search || rule.status) ? '' : 'none';
    const box = document.getElementById('search-input');
    if (box) box.style.display = rule.search ? '' : 'none';
    document.querySelectorAll('.filter-controls .filter-pill').forEach((p) => {
      p.style.display = rule.status ? '' : 'none';
    });
  };

  // ── Filter Controls ──
  window.setStatusFilter = function(st) {
    statusFilter = st;
    document.querySelectorAll('.filter-controls .filter-pill').forEach(p => {
      p.classList.toggle('active', p.getAttribute('data-st') === st);
    });
    renderAll();
  };

  window.onSearchOrFilterChange = function() {
    searchFilter = (document.getElementById('search-input').value || '').trim().toLowerCase();
    renderAll();
  };

  // ── Map Zoom Controls ──
  window.zoomMap = function(delta) {
    mapZoomLevel = Math.max(0.4, Math.min(1.8, mapZoomLevel + delta));
    applyMapTransform();
    anchorBoardToRight();   // v2.8.6 — الرسم يفضل على اليمين بعد أي تغيير للمقياس.
  };

  window.resetMapZoom = function() {
    mapZoomLevel = 1.0;
    applyMapTransform();
    anchorBoardToRight();   // v2.8.6 — نعود لبداية اللوحة (أعلى-يمين) بدل بقاء التمرير حيث كان.
  };

  // v2.8.6 — «ملاءمة الشاشة»: تقيس **الرسم المرسوم فعليًّا** (لا عرض اللوحة 2800) وتثبّته على
  // يمين اللوحة (بداية RTL) — بدل أن يتقلّص الرسم لليسار ويظهر في الوسط مع فراغ يمين.
  window.fitMapToScreen = function() {
    const wrap = document.getElementById('map-wrapper');
    if (!wrap) return;
    const cards = [...document.querySelectorAll('#map-cards-container .mv-card.loc')];
    let zoom = 1.1;
    if (cards.length) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const c of cards) {
        const x = parseFloat(c.style.left) || 0;
        const y = parseFloat(c.style.top) || 0;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x + c.offsetWidth);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y + c.offsetHeight);
      }
      const contentW = Math.max(400, (maxX - minX) + 60);
      const contentH = Math.max(300, (maxY - minY) + 60);
      zoom = Math.min(wrap.clientWidth / contentW, wrap.clientHeight / contentH);
    }
    mapZoomLevel = Math.max(0.4, Math.min(1.1, zoom));
    applyMapTransform();
    anchorBoardToRight();
  };

  function applyMapTransform() {
    const inner = document.getElementById('map-board-inner');
    if (inner) inner.style.transform = `scale(${mapZoomLevel})`;
    // v2.8.6 — نحفظ مقياس «التخطيط المرسوم» حتى يبقى بعد إعادة التحميل.
    try { localStorage.setItem(ZOOM_STORAGE_KEY, String(mapZoomLevel)); } catch (e) {}
  }

  // v2.8.6 — تثبيت العرض على بداية اللوحة: أعلى-يمين (بداية RTL).
  // ملاحظة: حسب CSSOM، قيمة scrollLeft = 0 تعني «بداية المحور المضمّن» = الحافة اليمنى في RTL.
  function anchorBoardToRight() {
    const wrap = document.getElementById('map-wrapper');
    if (!wrap) return;
    wrap.scrollLeft = 0;
    wrap.scrollTop = 0;
  }

  // ── Flatten Topology Tree ──
  function flattenTree(roots) {
    allDevices = [];
    allLocations = [];
    locById = new Map();
    devById = new Map();

    function walk(list) {
      for (const n of list) {
        if (n.type === 'location') {
          allLocations.push(n);
          locById.set(Number(n.location_id), n);
        } else if (n.type === 'device') {
          allDevices.push(n);
          devById.set(Number(n.id), n);
          // v2.13.3 — خريطة بدايات الانقطاع (تغذي بطاقات الخريطة/الرسم التي لا تحمل الحقل).
          offlineSinceById.set(Number(n.id), n.offline_since || null);
        }
        if (n.children && n.children.length) walk(n.children);
      }
    }
    walk(roots);
  }

  // ── Update Counters ──
  function updateCounters() {
    const total = allDevices.length;
    const up = allDevices.filter(d => d.status === 'online').length;
    const down = allDevices.filter(d => d.status === 'offline').length;
    const path = allDevices.filter(d => d.pathDown).length;

    const elUp = document.getElementById('c-up');
    const elDown = document.getElementById('c-down');
    const elPath = document.getElementById('c-path');
    const elLocs = document.getElementById('c-locs');
    const elTotal = document.getElementById('c-total');

    if (elUp) elUp.textContent = up;
    if (elDown) {
      elDown.textContent = down;
      elDown.classList.toggle('has-bad', down > 0);
    }
    if (elPath) elPath.textContent = path;
    if (elLocs) elLocs.textContent = allLocations.length;
    if (elTotal) elTotal.textContent = total;

    // v2.12.0 — تنبيه «الانقطاع الجديد» بخط أساس دائم — انظر checkNewOutages أدناه.
    checkNewOutages();
  }

  // ── v2.12.0 — كشف «الانقطاع الجديد» بخط أساس دائم ──
  //  العيب القديم: العدّاد previousDownIds كان يُحدَّث **فقط** والصوت مُفعَّل ⇒ أول تفعيل للصوت
  //  (أو أول دورة بعد إعادة التحميل) كان يصفّر لأجهزة واقعة من الأصل = إنذار كاذب.
  //  الآن: خط الأساس يُحدَّث دائمًا، وأول لقطة (أو لقطة بلا بيانات) خط أساس بلا تنبيه.
  //  السياسة القديمة محفوظة: صفارة واحدة مهما انقطع عدة أجهزة معًا (لا تكرار لنفس الانقطاع).
  let downBaselineReady = false;
  function checkNewOutages() {
    const currentDownIds = new Set(allDevices.filter((d) => d.status === 'offline').map((d) => d.id));
    const baselineOnly = !downBaselineReady || allDevices.length === 0;
    // v2.13.3 — نجمع كل الأجهزة الجديدة في الانقطاع (وليس أول واحد فقط) لعرضها على الغطاء.
    const freshDownDevices = [];
    if (!baselineOnly) {
      for (const id of currentDownIds) {
        if (!previousDownIds.has(id)) {
          freshDownDevices.push(devById.get(id));
        }
      }
    }
    previousDownIds = currentDownIds;
    downBaselineReady = allDevices.length > 0;
    if (!baselineOnly && freshDownDevices.length > 0) {
      // الغطاء البصري مستقل عن مفتاح الصوت: انقطاع = شاشة حمراء كاملة حتى «إخفاء التنبيه».
      showOutageOverlay(freshDownDevices);
      if (audioAlertEnabled) playAlertBeep('alert');
    }
  }

  // ── 1. RENDER HERO BACKBONE UPLINK ──
  function renderHero() {
    const container = document.getElementById('hero-chain-container');
    if (!container) return;

    // v2.8.5 — شارة القسم كانت ثابتة «نشط» في HTML: نربطها بوجود بيانات فعلية.
    const heroBadge = document.getElementById('hero-status-badge');
    if (heroBadge) heroBadge.textContent = (allDevices.length || allLocations.length) ? 'نشط' : 'غير مُهيَّأ';

    // 1. Find Gateway (v2.8.5 — بلا كائن وهمي: لو غير مُعرَّف نعرض حالة محايدة صريحة)
    const gateway = allLocations.find(l => l.kind === 'internet') || null;
    
    // 2. DNS Resolver — بطاقة «🌍 فحص الاتصال الخارجي» (البطاقة الأولى في السلسلة — v2.8.6)
    const dns = allDevices.find(d => d.name === 'DNS' || d.ip === '8.8.8.8');

    // 3. Find Primary Firewall (Sophos) — v2.8.6: أولوية للاسم/IP الحقيقيّين، ثم أي جهاز نوعه
    //    Firewall بشرط ألّا يكون هو نفسه جهاز بطاقة «فحص الاتصال الخارجي» (جهاز اسمه DNS
    //    ونوعه Firewall كان يُلتقط أولًا فيظهر الجهاز نفسه مرّتين في السلسلة).
    const firewall = allDevices.find(d => d.name && d.name.toLowerCase().includes('sophos'))
                  || allDevices.find(d => d.ip === '192.168.88.1')
                  || allDevices.find(d => d.device_type_name === 'Firewall' && !(dns && Number(d.id) === Number(dns.id)));

    // 4. Core Servers Pool
    const coreServers = allDevices.filter(d => d.device_type_name === 'Server');
    const serversDown = coreServers.filter(s => s.status === 'offline').length;
    const serversUp = coreServers.filter(s => s.status === 'online').length;

    let html = '';

    // Card 1 (v2.8.6) — 🌍 فحص الاتصال الخارجي: البطاقة **الأولى** في السلسلة (طلب المستخدم).
    if (dns) {
      const dnsDown = dns.status === 'offline';
      html += `
        <div class="hero-card ${dnsDown ? 'down' : 'up'}">
          <span class="role">🌍 فحص الاتصال الخارجي</span>
          <div class="nm">${esc(dns.name)}</div>
          <div class="meta">${esc(dns.ip)} — Google Public DNS</div>
          <div class="st-badge ${dnsDown ? 'down' : 'up'}">${dnsDown ? '🔴 انقطاع الاستجابة' : '🟢 اتصال إنترنت مستقر'}</div>
        </div>
      `;
      // الرابط بعد بطاقة الفحص: أحمر لو فشل الفحص نفسه (نفس دلالة اللون القديمة حين كانت أخيرة).
      html += `<div class="hero-link ${dnsDown ? 'down' : ''}"></div>`;
    }

    // Card 2: Internet Gateway
    html += `
      <div class="hero-card ${gateway ? 'up' : 'neutral'}">
        <span class="role">🌐 المدخل الرئيسي</span>
        <div class="nm">${gateway ? esc(gateway.name) : 'لا يوجد مدخل إنترنت مُعرَّف'}</div>
        <div class="meta">${gateway ? 'ISP Gateway · مزود الخدمة' : 'أضِف موقعًا نوعه internet من لوحة التحكم'}</div>
        <div class="st-badge ${gateway ? 'up' : 'neutral'}">${gateway ? '🟢 بوابة متصلة' : '⚪ غير مُهيَّأ'}</div>
      </div>
    `;

    // Link 2 -> 3
    const fwDown = firewall ? firewall.status === 'offline' : false;
    html += `<div class="hero-link ${fwDown ? 'down' : ''}"></div>`;

    // Card 3: Core Firewall (Sophos)
    if (firewall) {
      const isDown = firewall.status === 'offline';
      const isPath = !!firewall.pathDown;
      const cls = isDown ? 'down' : isPath ? 'warn' : 'up';
      const stLabel = isDown ? '🔴 منقطع عن الخدمة' : isPath ? '⛔ مسدود عبر المسار' : '🟢 متصل ومحمي';
      html += `
        <div class="hero-card ${cls}">
          <span class="role">🛡️ جدار الحماية المركزي</span>
          <div class="nm">${esc(firewall.name)}</div>
          <div class="meta">${esc(firewall.ip)} — ${esc(firewall.device_type_name || 'Firewall')}</div>
          <div class="st-badge ${cls}">${stLabel}</div>
        </div>
      `;
    }

    // Link 3 -> 4
    const srvClusterDown = serversDown > 0 && serversUp === 0;
    html += `<div class="hero-link ${srvClusterDown ? 'down' : ''}"></div>`;

    // Card 4: Servers Core Infrastructure (v2.8.5 — لا «جميع الخوادم تعمل» بلا خوادم مُعرَّفة)
    const noServers = coreServers.length === 0;
    const srvCls = noServers ? 'neutral' : (serversDown > 0 ? (serversUp === 0 ? 'down' : 'warn') : 'up');
    html += `
      <div class="hero-card ${srvCls}">
        <span class="role">🖥️ مجمع الخوادم المركزية</span>
        <div class="nm">خوادم الشبكة الرئيسية</div>
        <div class="meta">${coreServers.length} خوادم (Odoo · ESXi · SIS · Synology)</div>
        <div class="st-badge ${srvCls}">
          ${noServers ? '⚪ لا توجد خوادم مُعرَّفة' : (serversDown === 0 ? '🟢 جميع الخوادم تعمل' : `⚠️ ${serversDown} خوادم منقطعة`)}
        </div>
      </div>
    `;

    container.innerHTML = html;
  }

  // ══ 2a. v2.8.6 — «خريطة المباني» = نسخة مطابقة لـ«خريطة المواقع» في لوحة التحكم ══
  //   • نفس المصدر: GET /api/map/public/tree (نفس منطق شجرة لوحة التحكم: موقع internet
  //     واحد = الجذر، وأجهزته المباشرة تُجمع في بطاقة «أجهزة مدخل الإنترنت» أولًا).
  //   • نفس الترتيب: sort_order من الخادم (يتحكم به السحب والإفلات في «خريطة المواقع»)
  //     ⇒ نفس التتابع 01/02/03… ونفس سهم ↣ ونفس أماكن البطاقات في الشبكة.
  //   • نفس المحتوى: العدادات + صفوف الأجهزة (الاسم والنوع ونقطة الحالة) بنفس ترتيبها.
  //   • قراءة فقط: لا سحب/إفلات — والنقر على جهاز يفتح نافذة التفاصيل.
  const KIND_ICON = {
    root: '🌐', internet: '🌐', zone: '📍', site: '🏛️', building: '🏢',
    floor: '📐', room: '🚪', rack: '🗄️', unassigned: '📦', device: '🖥️',
  };
  let mapRootData = null;
  let nocMapInitialized = false;    // أول تحميل فقط (نفس سلوك «خريطة المواقع»)
  const nocCollapsed = new Set();   // البطاقات المطويّة (تبقى مطويّة بعد كل تحديث)

  function deviceIconByType(deviceType) {
    if (!deviceType) return '🖥️';
    const t = String(deviceType).toLowerCase();
    if (t.includes('router')) return '📶';
    if (t.includes('switch')) return '🔗';
    if (t.includes('firewall')) return '🧱';
    if (t.includes('printer')) return '🖨️';
    if (t.includes('server')) return '🖥️';
    if (t.includes('camera') || t.includes('nvr') || t.includes('dvr')) return '📹';
    if (t.includes('ap') || t.includes('wifi')) return '📡';
    return '🖥️';
  }

  // رقم الجهاز من عقدة الشجرة العامة (id = 'dev-<رقم>').
  function mapDevNum(node) {
    const m = /^dev-(\d+)$/.exec(String(node && node.id != null ? node.id : ''));
    return m ? Number(m[1]) : null;
  }
  // التسمية كما في «خريطة المواقع»: «الاسم (IP)» — الاسم يُدمج من /api/topology.
  function mapDevLabel(node) {
    const id = mapDevNum(node);
    const dev = id != null ? devById.get(id) : null;
    const name = (dev && dev.name) || '';
    const ip = node.ip || (dev && dev.ip) || '';
    if (name && ip) return `${name} (${ip})`;
    return name || ip || 'جهاز';
  }
  // مفتاح ترتيب صفوف الأجهزة = IP رقمي بالأوكتِتات (v2.13.5 — كان بالاسم واحدة).
  function mapDevSortKey(node) {
    return ipToNum(node.ip);
  }

  function zoneCardColor(kind) {
    switch (kind) {
      case 'internet':   return 'var(--mv-zone-internet-bg)';
      case 'zone':       return 'var(--mv-zone-bg)';
      case 'unassigned': return 'var(--mv-zone-unassigned-bg)';
      default:           return 'var(--mv-card-bg)';
    }
  }
  function zoneBorderColor(node) {
    if (!node) return 'var(--mv-border)';
    // v2.8.9 — انقطاع جزئي (متصل + منقطع) ⇒ برتقالي · كل الأجهزة واقعة ⇒ أحمر — مطابق لوحة الرسم
    if (node.offline > 0) return (node.online > 0) ? 'var(--mv-warn)' : 'var(--mv-offline)';
    if (node.device_count > 0 && node.online === node.device_count) return 'var(--mv-online)';
    return 'var(--mv-border)';
  }
  function zoneTooltip(node) {
    if (node.kind === 'device') {
      return `${mapDevLabel(node)}\nIP: ${node.ip || '—'}\nالنوع: ${node.device_type || '—'}\nالحالة: ${node.status}`;
    }
    return `${node.name}\nأجهزة: ${node.device_count} (🟢${node.online} 🔴${node.offline} ⚪${node.unknown})`;
  }

  // صف جهاز داخل الكارت — نفس markup «خريطة المواقع» بالضبط.
  function renderZoneDevice(node) {
    const status = node.status || 'unknown';
    const icon = deviceIconByType(node.device_type);
    // v2.13.3 — شارة عمر الانقطاع لصفوف بطاقات خريطة المباني (من offlineSinceById).
    const devNum = mapDevNum(node);
    const dtBadge = (status === 'offline' && devNum != null && offlineSinceById.get(devNum))
      ? `<span class="map-device-downtime">⏱ ${esc(downtimeAge(offlineSinceById.get(devNum)))}</span>` : '';
    return `
    <button type="button" class="map-zone-device" data-kind="device" data-status="${esc(status)}" data-id="${esc(String(node.id))}" title="${esc(zoneTooltip(node))}">
      <span class="map-device-dot" aria-hidden="true"></span>
      <span class="map-device-ic">${icon}</span>
      <span class="map-device-name">${esc(mapDevLabel(node))}</span>
      <span class="map-device-meta">${esc(node.device_type || 'جهاز')}</span>
      ${dtBadge}
    </button>`;
  }

  // ✅ v2.12.1 — قاعدتان في بناء شجرة الخريطة:
  //   1) الأب الفعّال لكل موقع: «يتبع» (map_parent_id) صراحةً ⇐ هو · وإلا **طابق/غرفة/خزانة** ⇐
  //      أب السلسلة (parent_id — العقدة التي تُحويه في شجرة الخادم) · وإلا (مبنى/موقع) ⇐ بطاقة مستقلة.
  //      السبب: بلا «يتبع» مضبوط كان كل موقع — حتى الطوابق — بطاقة مستقلة، فتبدو الخريطة مسطَّحة
  //      بينما العدّاد تراكمي على السلسلة.
  //   2) العدّاد يُعاد حسابه على شجرة الخريطة نفسها ⇒ الرقم فوق البطاقة = بالضبط ما داخلها.
  //   وترتيب الأشقّاء من sort_order ثم الاسم.
  const MAP_NESTED_KINDS = { floor: 1, room: 1, rack: 1 };

  function buildMapTree(list) {
    const all = [];
    // أب السلسلة لكل عقدة (كما هي مُتداخِلة في شجرة الخادم: parent_id) — يلزم لقاعدة الاحتواء الافتراضية.
    const chainParent = new Map();
    (function walk(nodes, parent) {
      for (const n of nodes) {
        if (!n || n.kind === 'device') continue;
        all.push(n);
        if (parent) chainParent.set(String(n.id), parent);
        walk(Array.isArray(n.children) ? n.children : [], n);
      }
    })(list || [], null);

    const byId = new Map(all.map((n) => [String(n.id), n]));

    // 1) الأب الفعّال: «يتبع» (map_parent_id) صراحةً ⇐ هو · وإلا **طابق/غرفة/خزانة** ⇐ أب السلسلة
    //    (فتدخل داخل بطاقة المبنى/الموقع كما كانت) · وإلا (مبنى/موقع…) ⇐ بطاقة مستقلة.
    const parentOf = new Map();
    for (const n of all) {
      const explicit = n.map_parent_id != null ? byId.get(String(n.map_parent_id)) : null;
      const chain = MAP_NESTED_KINDS[n.kind] ? chainParent.get(String(n.id)) : null;
      const p = (explicit && explicit !== n) ? explicit : (chain || null);
      parentOf.set(String(n.id), (p && p.kind !== 'device') ? p : null);
    }
    // كسر أي دائرة (موقع معلَّق تحت أحد أبنائه) ⇒ بطاقة مستقلة بدل حلقة لا تنتهي.
    for (const n of all) {
      const seen = new Set();
      let cur = n;
      while (cur && !seen.has(String(cur.id))) {
        seen.add(String(cur.id));
        cur = parentOf.get(String(cur.id)) || null;
      }
      if (cur) parentOf.set(String(n.id), null);
    }

    // 2) التجميع + الترتيب + إعادة حساب العدّادات قاعًا لأعلى: كل عقدة = أجهزتها المباشِرة + عدّادات
    //    أقسامها ⇒ الرقم فوق أي بطاقة = بالضبط عدد الأجهزة الظاهرة داخلها.
    const childrenOf = new Map();
    const roots = [];
    for (const n of all) {
      const p = parentOf.get(String(n.id));
      if (p) {
        if (!childrenOf.has(String(p.id))) childrenOf.set(String(p.id), []);
        childrenOf.get(String(p.id)).push(n);
      } else {
        roots.push(n);
      }
    }
    const byOrder = (a, b) => (Number(a.sort_order || 0) - Number(b.sort_order || 0))
      || String(a.name || '').localeCompare(String(b.name || ''), 'ar');
    const layout = (node) => {
      const devices = (Array.isArray(node.children) ? node.children : []).filter((c) => c && c.kind === 'device');
      const subs = (childrenOf.get(String(node.id)) || []).slice().sort(byOrder);
      node.children = devices.concat(subs);
      let dc = devices.length, on = 0, off = 0, unk = 0;
      for (const d of devices) {
        if (d.status === 'online') on += 1;
        else if (d.status === 'offline') off += 1;
        else unk += 1;
      }
      for (const s of subs) {
        const c = layout(s);
        dc += c.device_count; on += c.online; off += c.offline; unk += c.unknown;
      }
      node.device_count = dc; node.online = on; node.offline = off; node.unknown = unk;
      return node;
    };
    roots.forEach(layout);
    return roots.sort(byOrder);
  }

  // جسم الكارت: صفوف الأجهزة ثم الـ sub-zones المتداخلة (نفس منطق لوحة التحكم بلا فلترة).
  function renderZoneBody(node) {
    const kids = Array.isArray(node.children) ? node.children : [];
    if (kids.length === 0) {
      const dc = node.device_count || 0;
      if (dc === 0) return '<p class="map-zone-empty">لا أجهزة في هذا الموقع.</p>';
      return '';
    }
    const devices = [];
    const subzones = [];
    for (const c of kids) {
      if (c.kind === 'device') devices.push(c);
      // ✅ v2.11.0 — الأقسام الداخلية من شجرة «يتبع» (map_parent_id): أي موقع ابن هنا قسم داخل البطاقة.
      else subzones.push(c);
    }
    devices.sort((a, b) => {
      const A = mapDevSortKey(a);
      const B = mapDevSortKey(b);
      return A < B ? -1 : A > B ? 1 : 0;
    });
    let html = '';
    if (devices.length > 0) html += devices.map((d) => renderZoneDevice(d)).join('');
    // v2.10.10 — الطوابق/الغرف تُعرَض كأقسام **داخل** بطاقة المبنى (مفتوحة دائمًا، بلا طيّ)
    for (const sz of subzones) {
      const szIcon = KIND_ICON[sz.kind] || '📍';
      const szDc = sz.device_count || 0;
      const szOn = sz.online || 0;
      const szOff = sz.offline || 0;
      const szUnk = sz.unknown || 0;
      html += `
      <div class="map-subzone" data-id="${esc(String(sz.id))}" data-kind="${esc(sz.kind)}">
        <div class="map-subzone-title">
          <span>${szIcon}</span>
          <span class="map-subzone-name">${esc(sz.name || '')}</span>
          <span class="map-subzone-stats">🟢${szOn} · 🔴${szOff} · ⚪${szUnk} (${szDc})</span>
        </div>
        ${renderZoneBody(sz)}
      </div>`;
    }
    return html || '<p class="map-zone-empty">لا مُطابِقات.</p>';
  }

  // بطاقة موقع واحدة — نفس markup وألوان وحالات «خريطة المواقع».
  // v2.10.7 — parentName: اسم المبنى الأب (يُعرَض في سطر «متصل عبر» داخل البطاقة).
  function renderZoneCard(node, parentName) {
    const kind = node.kind || 'zone';
    const icon = KIND_ICON[kind] || '📍';
    const isUnassigned = kind === 'unassigned';
    const collapsedNow = nocCollapsed.has(String(node.id));
    const bg = zoneCardColor(kind);
    let border = zoneBorderColor(node);
    const borderW = (node.offline > 0) ? '2px' : '1px';
    if (kind === 'internet') border = 'var(--mv-accent)';
    if (kind === 'zone')     border = 'var(--mv-warning)';

    const dc = node.device_count || 0;
    const on = node.online || 0;
    const off = node.offline || 0;
    const unk = node.unknown || 0;
    const stats = dc > 0
      ? `🟢 ${on} · 🔴 ${off} · ⚪ ${unk} <span class="map-count">(${dc})</span>`
      : '—';
    const cls = `map-zone-card kind-${kind}${off > 0 ? ' has-offline' : ''}${(off > 0 && on === 0) ? ' has-all-offline' : ''}${(on > 0 && off === 0) ? ' has-online' : ''}${collapsedNow ? ' collapsed' : ''}${isUnassigned ? ' kind-unassigned' : ''}`;
    const body = renderZoneBody(node);

    // v2.10.7 — سطر «متصل عبر» (بدل الإدخال داخل بطاقة الأب)
    const parentLine = parentName
      ? `<div class="map-zone-parent">🧩 متصل عبر: ${esc(parentName)}</div>`
      : '';
    return `
    <article class="${cls}" data-id="${esc(String(node.id))}" data-kind="${esc(kind)}" role="listitem"
             style="--node-bg:${bg}; --node-border:${border}; --node-border-w:${borderW};">
      <div class="map-zone-header" title="${esc(zoneTooltip(node))}">
        <span class="map-zone-icon">${icon}</span>
        <span class="map-zone-name">${esc(node.name || '')}</span>
        <span class="map-zone-stats">${stats}</span>
        <button type="button" class="map-zone-toggle" aria-label="توسيع/طي" aria-expanded="${!collapsedNow}">▼</button>
      </div>
      ${parentLine}
      <div class="map-zone-body">${body}</div>
    </article>`;
  }

  // الشبكة: بطاقة «أجهزة مدخل الإنترنت» أولًا (لو وُجدت أجهزة مباشرة في الجذر) ثم بطاقات المواقع.
  function renderZonesGrid(rootData) {
    if (!rootData) return { html: '', zones: 0, devices: 0 };
    const kids = Array.isArray(rootData.children) ? rootData.children : [];
    const zoneKids = [];
    const orphanDevices = [];
    for (const c of kids) {
      if (c.kind === 'device') orphanDevices.push(c);
      else zoneKids.push(c);
    }
    let orphanHtml = '';
    if (orphanDevices.length > 0) {
      const orphanNode = {
        id: 'orphan-internet-devices',
        name: 'أَجهزة مَدخل الإنترنت',
        kind: 'unassigned',
        device_count: orphanDevices.length,
        online: orphanDevices.filter((d) => d.status === 'online').length,
        offline: orphanDevices.filter((d) => d.status === 'offline').length,
        unknown: orphanDevices.filter((d) => d.status === 'unknown').length,
        children: orphanDevices,
      };
      orphanHtml = renderZoneCard(orphanNode, '');
    }
    // ✅ v2.11.0 — البطاقات = كل المواقع بلا «يتبع» (map_parent_id = NULL)، وأبناء عقدة الجذر
    //   internet (حسب «يتبع») يصعدون لمستوى البطاقات — والسلسلة لا علاقة لها بها.
    const mapRoots = buildMapTree(zoneKids);
    const topNodes = [];
    for (const n of mapRoots) {
      if (String(n.kind) === 'internet') {
        for (const c of (Array.isArray(n.children) ? n.children : [])) {
          if (c && c.kind !== 'device') topNodes.push(c);
        }
      } else {
        topNodes.push(n);
      }
    }
    const cards = orphanHtml + topNodes.map((c) => renderZoneCard(c, '')).join('');
    return {
      html: cards,
      zones: topNodes.length + (orphanHtml ? 1 : 0),
      devices: rootData.device_count || 0,
    };
  }

  function renderMapGrid() {
    const grid = document.getElementById('noc-map-grid');
    if (!grid) return;
    const note = document.getElementById('map-empty-note');
    const badge = document.getElementById('map-locs-count');

    if (!mapRootData) {
      grid.innerHTML = '';
      if (note) { note.textContent = '⚠️ تعذّر جلب خريطة المباني — تَحقّق من الاتصال.'; note.hidden = false; }
      if (badge) badge.textContent = '—';
      return;
    }
    // نفس سلوك «خريطة المواقع»: أول تحميل فقط — طيّ «أجهزة غير مُعيَّن» لو فيها > 8 أجهزة.
    if (!nocMapInitialized && Array.isArray(mapRootData.children)) {
      const unassigned = mapRootData.children.find((c) => c.kind === 'unassigned');
      if (unassigned && unassigned.id === 'unassigned' && (unassigned.device_count || 0) > 8) {
        nocCollapsed.add('unassigned');
      }
      nocMapInitialized = true;
    }
    const res = renderZonesGrid(mapRootData);
    if (!res.html) {
      grid.innerHTML = '';
      if (note) { note.textContent = 'لا توجد مواقع أو أجهزة بعد — أضِفها من لوحة التحكم ← خريطة المواقع.'; note.hidden = false; }
      if (badge) badge.textContent = '—';
      return;
    }
    if (note) note.hidden = true;
    if (badge) badge.textContent = `${res.zones} منطقة · ${res.devices} جهاز`;
    grid.innerHTML = res.html;
    bindMapGridEvents();
  }

  // نقرة على الترويسة = طيّ/توسيع — ونقرة على جهاز = نافذة التفاصيل (كما في خريطة المواقع).
  let mapGridEventsBound = false;
  function bindMapGridEvents() {
    if (mapGridEventsBound) return;
    const grid = document.getElementById('noc-map-grid');
    if (!grid) return;
    mapGridEventsBound = true;
    grid.addEventListener('click', (event) => {
      const chip = event.target.closest('.map-zone-device');
      if (chip && chip.dataset.id) {
        const id = mapDevNum({ id: String(chip.dataset.id) });
        if (id != null) openDeviceDetails(id);
        return;
      }
      const card = event.target.closest('.map-zone-card');
      if (!card) return;
      const key = String(card.dataset.id);
      if (nocCollapsed.has(key)) nocCollapsed.delete(key);
      else nocCollapsed.add(key);
      card.classList.toggle('collapsed', nocCollapsed.has(key));
      const toggle = card.querySelector(':scope > .map-zone-header .map-zone-toggle');
      if (toggle) toggle.setAttribute('aria-expanded', String(!nocCollapsed.has(key)));
    });
  }

  // ══ v2.8.6 — نافذة تفاصيل الجهاز (نفس بيانات وحقول نافذة «خريطة المواقع») ══
  function fmtDateTime(s) {
    if (!s) return '—';
    try {
      const d = new Date(s);
      if (isNaN(d.getTime())) return String(s);
      return d.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
    } catch (_) { return String(s); }
  }
  function statusBadgeText(status) {
    return status === 'online' ? 'متصل' : (status === 'offline' ? 'متوقف' : 'غير معروف');
  }
  async function openDeviceDetails(deviceId) {
    const modal = document.getElementById('noc-device-modal');
    if (!modal) return;
    const fieldsEl = document.getElementById('noc-modal-fields');
    const nameEl = document.getElementById('noc-modal-name');
    const iconEl = document.getElementById('noc-modal-icon');
    const statusEl = document.getElementById('noc-modal-status');
    if (fieldsEl) fieldsEl.innerHTML = '<p class="details-placeholder">⏳ جَلب التفاصيل…</p>';
    if (nameEl) nameEl.textContent = '…';
    if (statusEl) { statusEl.className = 'details-status-badge'; statusEl.textContent = '—'; }
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    try {
      const res = await fetch('/api/devices/' + encodeURIComponent(deviceId), { credentials: 'same-origin' });
      const json = await res.json();
      if (!json || !json.success) throw new Error((json && json.error) || 'فشل الطلب');
      const d = json.data;
      if (nameEl) nameEl.textContent = d.name || ('#' + deviceId);
      if (iconEl) iconEl.textContent = deviceIconByType(d.device_type_name);
      if (statusEl) {
        statusEl.className = 'details-status-badge ' + (d.current_status || 'unknown');
        statusEl.textContent = statusBadgeText(d.current_status);
      }
      if (fieldsEl) {
        fieldsEl.innerHTML = `
          <div class="details-field"><span class="df-label">IP</span><span class="df-value">${esc(d.ip || '—')}</span></div>
          <div class="details-field"><span class="df-label">النوع</span><span class="df-value">${esc(d.device_type_name || '—')}</span></div>
          <div class="details-field"><span class="df-label">الموقع</span><span class="df-value">${esc(d.location_name || '—')}</span></div>
          <div class="details-field"><span class="df-label">طريقة الفحص</span><span class="df-value">${esc(d.check_protocol || 'ping')}</span></div>
          <div class="details-field"><span class="df-label">المنفذ</span><span class="df-value">${esc(d.port || '—')}</span></div>
          <div class="details-field"><span class="df-label">فترة الفحص</span><span class="df-value">${esc(d.check_interval_seconds ?? '—')} ث</span></div>
          <div class="details-field"><span class="df-label">حد التنبيه</span><span class="df-value">${esc(d.failure_threshold ?? '—')}</span></div>
          <div class="details-field"><span class="df-label">مفعّل</span><span class="df-value">${d.is_active ? 'نعم' : 'لا'}</span></div>
          <div class="details-field"><span class="df-label">زمن الاستجابة</span><span class="df-value">${d.last_response_time_ms != null ? esc(d.last_response_time_ms) + ' ms' : '—'}</span></div>
          <div class="details-field"><span class="df-label">آخر فحص</span><span class="df-value">${esc(fmtDateTime(d.last_checked_at))}</span></div>
        `;
      }
    } catch (e) {
      if (fieldsEl) fieldsEl.innerHTML = '<p class="details-placeholder">⚠️ تعذّر جلب تفاصيل الجهاز.</p>';
    }
  }
  function closeDeviceDetails() {
    const modal = document.getElementById('noc-device-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }

  // ── 2b. RENDER DRAW BOARD (التخطيط المرسوم — تبويب مستقل) ──
  function renderDrawBoard() {
    const cardsContainer = document.getElementById('map-cards-container');
    const svgLinks = document.getElementById('map-svg-links');
    if (!cardsContainer || !svgLinks) return;

    // Build position map for locations that have saved positions
    const posMap = new Map();
    for (const loc of allLocations) {
      const lid = Number(loc.location_id);
      if (loc.pos_x != null && loc.pos_y != null) {
        posMap.set(lid, { x: Number(loc.pos_x), y: Number(loc.pos_y) });
      }
    }

    // SVG Connection Lines (Parent Location -> Child Location)
    let linesSvg = '';
    for (const loc of allLocations) {
      if (!loc.parent_id) continue;
      const lid = Number(loc.location_id);
      const pid = Number(loc.parent_id);
      const childPos = posMap.get(lid);
      const parentPos = posMap.get(pid);

      if (childPos && parentPos) {
        const ax = childPos.x + 165, ay = childPos.y + 20;
        const bx = parentPos.x + 165, by = parentPos.y + 40;

        // Smooth cubic bezier or clean line
        const midY = (ay + by) / 2;
        const pathData = `M ${bx} ${by} C ${bx} ${midY}, ${ax} ${midY}, ${ax} ${ay}`;
        linesSvg += `
          <path class="mv-link" d="${pathData}" fill="none" stroke-width="2.5" stroke-dasharray="4 2" />
          <circle class="mv-dot-child" cx="${ax}" cy="${ay}" r="4" />
          <circle class="mv-dot-parent" cx="${bx}" cy="${by}" r="4" />
        `;
      }
    }
    svgLinks.innerHTML = linesSvg;

    // Render Location Cards
    let cardsHtml = '';
    let renderedLocs = 0; // v2.8.5 — عدد بطاقات المواقع المرسومة فعلًا (لشارة القسم).
    for (const loc of allLocations) {
      const lid = Number(loc.location_id);
      const pos = posMap.get(lid);
      if (!pos) continue;
      renderedLocs++;

      // Filter devices inside this location
      const directDevices = allDevices.filter(d => Number(d.location_id) === lid);
      const upCount = directDevices.filter(d => d.status === 'online').length;
      const downCount = directDevices.filter(d => d.status === 'offline').length;
      // v2.8.9 — انقطاع **جزئي** ⇒ برتقالي (warn) · **كل** الأجهزة واقعة ⇒ أحمر (down) — نفس إشارة «خريطة المباني»
      const borderCls = directDevices.length === 0
        ? 'neutral'
        : (downCount > 0 ? (upCount > 0 ? 'warn' : 'down') : 'up');

      // Filter rows if search query is active
      const visibleDevices = directDevices.filter(d => {
        if (!searchFilter) return true;
        return (d.name && d.name.toLowerCase().includes(searchFilter)) ||
               (d.ip && d.ip.includes(searchFilter));
      });

      const rowsHtml = visibleDevices.map(d => {
        const isDown = d.status === 'offline';
        const isPath = !!d.pathDown;
        // v2.13.3 — شارة عمر الانقطاع في صفوف «التخطيط المرسوم».
        const dtBadge = (isDown && d.offline_since) ? `<span class="mv-downtime">⏱ ${esc(fmtDowntime(d.offline_since))}</span>` : '';
        // v2.8.5 — لون النقطة صار صنفًا (يتبدّل مع الوضع النهاري/الليلي) بدل ستايل مضمّن.
        const dotCls = isDown ? 'down' : isPath ? 'path' : (d.status === 'paused' ? 'paused' : 'up');
        // v2.8.8 — الصف قابل للنقر: يفتح نفس نافذة تفاصيل الجهاز (كما في «خريطة المباني»).
        return `
          <div class="mv-inner-row ${isDown ? 'down' : ''}" data-device-id="${Number(d.id)}" role="button" tabindex="0"
               title="${esc(d.name)} — انقر لعرض التفاصيل">
            <span class="mv-dot ${dotCls}"></span>
            <span class="mv-inner-type">${esc(d.device_type_name || 'جهاز')}</span>
            <span class="mv-inner-nm" title="${esc(d.name)}">${esc(d.name)}</span>
            <span class="mv-inner-ip">${esc(d.ip)}</span>
            ${dtBadge}
          </div>
        `;
      }).join('');

      const kindName = KIND_LABELS[loc.kind] || '📍 موقع';

      cardsHtml += `
        <div class="mv-card loc ${borderCls}" style="left:${pos.x}px; top:${pos.y}px">
          <div class="mv-head">
            <span class="mv-nm">${esc(loc.name)}</span>
            <span class="mv-count">🟢 ${upCount} · 🔴 ${downCount}</span>
          </div>
          <div class="mv-subhead">
            <span>${kindName}</span>
            <span>${directDevices.length} جهاز</span>
          </div>
          ${directDevices.length ? `<div class="mv-inner">${rowsHtml}</div>` : `<div class="mv-empty">مبنى تنظيمي — لا أجهزة مباشرة</div>`}
        </div>
      `;
    }

    // v2.8.6 — شارة تبويب «التخطيط المرسوم» + ملاحظته (لم يعد يشارك شارة «خريطة المباني»).
    const locBadge = document.getElementById('draw-locs-count');
    if (locBadge) locBadge.textContent = `${renderedLocs} موقع`;
    const note = document.getElementById('draw-empty-note');
    if (note) note.hidden = renderedLocs > 0;
    cardsContainer.innerHTML = cardsHtml;
    bindDrawBoardEvents();
  }

  // v2.8.8 — نقر جهاز داخل «التخطيط المرسوم» يفتح **نفس** نافذة التفاصيل (كما في «خريطة المباني»):
  // نفس المسار GET /api/devices/:id ونفس الحقول، مع دعم لوحة المفاتيح (Enter/Space).
  let drawBoardEventsBound = false;
  function bindDrawBoardEvents() {
    if (drawBoardEventsBound) return;
    const container = document.getElementById('map-cards-container');
    if (!container) return;
    drawBoardEventsBound = true;
    const openFromRow = (row) => {
      const id = Number(row && row.dataset ? row.dataset.deviceId : NaN);
      if (Number.isInteger(id) && id > 0) openDeviceDetails(id);
    };
    container.addEventListener('click', (e) => {
      const row = e.target.closest('.mv-inner-row[data-device-id]');
      if (row) openFromRow(row);
    });
    container.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = e.target.closest('.mv-inner-row[data-device-id]');
      if (row) { e.preventDefault(); openFromRow(row); }
    });
  }

  // ── 3. RENDER CATEGORIZED DEVICES GRID ──
  function renderCategories() {
    const container = document.getElementById('categories-container');
    if (!container) return;

    // Group all devices by category
    const groups = new Map();
    let shownCount = 0; // v2.8.5 — عدد الأجهزة المعروضة فعلًا بعد الفلاتر (لشارة القسم).
    for (const d of allDevices) {
      // Apply search & status filters
      if (searchFilter) {
        const matchName = d.name && d.name.toLowerCase().includes(searchFilter);
        const matchIp = d.ip && d.ip.includes(searchFilter);
        const matchLoc = d.location_id && locById.get(Number(d.location_id)) && locById.get(Number(d.location_id)).name.toLowerCase().includes(searchFilter);
        if (!matchName && !matchIp && !matchLoc) continue;
      }
      if (statusFilter === 'down' && d.status !== 'offline') continue;
      if (statusFilter === 'up' && d.status !== 'online') continue;

      // v2.12.2 — تصنيف مرن: مطابقة تامة ثم كلمات مفتاحية (كانت الأنواع غير المذكورة
      // حرفيًّا — ومنها «Router» — تسقط في «أخرى»).
      const typeKey = resolveTypeKey(d.device_type_name);

      if (!groups.has(typeKey)) groups.set(typeKey, []);
      groups.get(typeKey).push(d);
      shownCount++;
    }

    // v2.8.5 — الشارة كانت ثابتة «39 جهاز» في HTML ولا يحدّثها أي كود (عدد وهمي).
    const devBadge = document.getElementById('devices-count-badge');
    if (devBadge) devBadge.textContent = `${shownCount} جهاز`;

    // Sort categories according to config order
    const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
      const orderA = (TYPE_CONFIG[a] && TYPE_CONFIG[a].order) || 99;
      const orderB = (TYPE_CONFIG[b] && TYPE_CONFIG[b].order) || 99;
      return orderA - orderB;
    });

    if (sortedKeys.length === 0) {
      // v2.8.5 — نفرّق بين «لا أجهزة أصلًا» (تثبيت جديد) و«لا نتائج للفلاتر».
      container.innerHTML = `
        <div style="text-align:center; padding:30px; color:#64748b; font-size:1.1rem">
          ${allDevices.length
            ? 'لا توجد أجهزة مطابقة لخيارات البحث أو الفلتر الحالية.'
            : 'لا توجد أجهزة بعد — أضِف أجهزة من لوحة التحكم وستظهر هنا تلقائيًّا.'}
        </div>
      `;
      return;
    }

    let html = '';
    for (const key of sortedKeys) {
      const cfg = TYPE_CONFIG[key] || { icon: '📌', title: key };
      const list = groups.get(key).sort(natCmp);
      const up = list.filter(d => d.status === 'online').length;
      const down = list.filter(d => d.status === 'offline').length;

      html += `
        <div class="category-group">
          <div class="category-head">
            <span class="cat-title">${cfg.icon} ${cfg.title}</span>
            <span class="cat-badge">${list.length} جهاز</span>
            <span class="cat-stats">🟢 ${up} متصل &nbsp;·&nbsp; 🔴 ${down} منقطع</span>
          </div>
          <div class="device-grid">
            ${list.map(d => {
              const isDown = d.status === 'offline';
              const isPath = !!d.pathDown;
              const isPaused = d.status === 'paused';
              const cardCls = isDown ? 'down' : isPath ? 'pathdown' : isPaused ? 'paused' : 'up';
              const badgeCls = isDown ? 'down' : isPath ? 'pathdown' : isPaused ? 'paused' : 'up';
              const badgeText = isDown ? '🔴 منقطع' : isPath ? '⛔ مسدود عبر الأب' : isPaused ? '⏸ موقوف' : '🟢 متصل';
              
              const loc = d.location_id ? locById.get(Number(d.location_id)) : null;
              const locName = loc ? loc.name : 'غير محدد';
              const parentDev = d.parent_id ? devById.get(Number(d.parent_id)) : null;

              return `
                <div class="dev-card ${cardCls}">
                  <div class="dev-card-top">
                    <span class="nm" title="${esc(d.name)}">${esc(d.name)}</span>
                    <span class="dev-badge ${badgeCls}">${badgeText}</span>
                  </div>
                  <div class="dev-card-meta">
                    <span class="ip">${esc(d.ip)}</span>
                    <span class="loc-tag" title="الموقع: ${esc(locName)}">📍 ${esc(locName)}</span>
                  </div>
                  ${d.status === 'offline' ? `<div class="dev-downtime">⏱ منقطع منذ ${esc(downtimeAge(d.offline_since))}</div>` : ''}
                  ${parentDev ? `<div class="parent-info">🔗 متصل عبر: <b>${esc(parentDev.name)}</b></div>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    container.innerHTML = html;
  }

  // ── Render All Sections ──
  function renderAll() {
    updateCounters();
    renderHero();
    renderMapGrid();     // v2.8.6 — خريطة المباني (نسخة مطابقة لـ«خريطة المواقع»)
    renderDrawBoard();   // v2.8.6 — التخطيط المرسوم (لوحة وضع الرسم — تبويب مستقل)
    renderCategories();
  }

  // ── v2.8.7 — التحديث الحيّ عبر SSE (بلا سؤال متكرر للسيرفر) ──
  function setPollInterval(ms) {
    if (pollHandle) clearInterval(pollHandle);
    pollIntervalMs = ms;
    pollHandle = setInterval(tick, ms);
  }

  // نصّ التذييل: يوضّح هل الشاشة لحظية (SSE) أو دورية (polling) — يفيد الدعم الفنّي.
  function refreshStatusText(serverOk) {
    const el = document.getElementById('update-status');
    if (!el) return;
    if (serverOk === false) {
      el.textContent = '⚠️ تعذر الوصول للخادم — إعادة المحاولة جارية...';
      return;
    }
    el.textContent = liveConnected
      ? 'مراقبة حية — تحديث فوري (SSE)'
      : 'مراقبة حية — تحديث دوري كل ' + Math.round(pollIntervalMs / 1000) + ' ثانية';
  }

  // تطبيق تحديث السيرفر على الحالة المحلّية (بلا طلب شبكة) ثم إعادة رسم واحدة مجمّعة.
  // ملاحظة: نُحدّث **المصدرين** معًا لأن الشاشة ترسم منهما:
  //   1) شجرة /api/topology (devById) — للعدّادات ومسار الإنترنت وبطاقات الأجهزة.
  //   2) شجرة «خريطة المباني» (mapRootData) — لصفوف الأجهزة داخل البطاقات.
  function applyLiveUpdate(msg) {
    if (!msg || !Array.isArray(msg.devices)) return;
    const statusMap = {};
    for (const d of msg.devices) statusMap[Number(d.id)] = d.status;

    // 1) شجرة السلسلة.
    let changed = 0;
    for (const d of msg.devices) {
      const dev = devById.get(Number(d.id));
      // v2.13.3 — مزامنة خريطة بدايات الانقطاع من SSE (offlineSince) لأي جهاز معروف.
      offlineSinceById.set(Number(d.id), d.offlineSince || null);
      if (!dev) continue;
      if (dev.status !== d.status || !!dev.pathDown !== !!d.pathDown) changed++;
      dev.status = d.status;
      dev.pathDown = !!d.pathDown;
      dev.offline_since = d.offlineSince || null;
    }

    // 2) شجرة خريطة المباني (عُقد الأجهزة id = 'dev-<رقم>').
    let mapChanged = 0;
    (function walk(list) {
      for (const n of list || []) {
        if (n.kind === 'device') {
          const s = statusMap[Number(String(n.id).replace(/^dev-/, ''))];
          if (s && n.status !== s) { n.status = s; mapChanged++; }
        } else if (n.children && n.children.length) {
          walk(n.children);
        }
      }
    })(mapRootData && mapRootData.children);

    if (!changed && !mapChanged) return;
    if (liveRenderTimer) clearTimeout(liveRenderTimer);
    liveRenderTimer = setTimeout(() => {
      liveRenderTimer = null;
      renderAll();
      const now = new Date();
      const el = document.getElementById('last-updated-time');
      if (el) el.textContent = 'آخر تحديث: ' + now.toLocaleTimeString('ar-EG') + ' (لحظي)';
    }, 150);
  }

  function connectLive() {
    if (typeof window.EventSource !== 'function') return;   // متصفح قديم ⇒ polling فقط
    try { liveES = new EventSource('/api/live/status'); } catch (_) { liveES = null; return; }
    liveES.onopen = () => {
      liveConnected = true;
      setPollInterval(60000);   // تخفيف الـ polling: للبنية فقط
      refreshStatusText(true);
    };
    liveES.onmessage = (ev) => {
      try { applyLiveUpdate(JSON.parse(ev.data)); } catch (_) {}
    };
    liveES.onerror = () => {
      // EventSource يعيد المحاولة تلقائيًّا — ونرجّع الـ polling لـ 10 ثوانٍ فورًا حتى يعود الخط.
      liveConnected = false;
      if (pollIntervalMs !== 10000) setPollInterval(10000);
      refreshStatusText(true);
    };
  }

  // منفذ تشخيص صغير (سكربت الفحص + الدعم الفنّي): حالة البثّ، مدة الـ polling، وإغلاق الخط.
  window.__nocLive = {
    connected: () => liveConnected,
    pollMs: () => pollIntervalMs,
    close: () => {
      if (liveES) { liveES.close(); liveES = null; }
      liveConnected = false;
      setPollInterval(10000);
      refreshStatusText(true);
    },
  };

  // ── v2.11.9 — مؤشر صحّة محرك المراقبة (بانر من /api/health) ──
  let engineFetchFails = 0;
  function showEngineAlert(text) {
    const el = document.getElementById('engine-alert');
    if (el) { el.textContent = text; el.classList.add('show'); }
  }
  function hideEngineAlert() {
    const el = document.getElementById('engine-alert');
    if (el) el.classList.remove('show');
  }
  async function updateEngineAlertFromHealth(healthRes) {
    if (!healthRes || !healthRes.ok) {
      engineFetchFails += 1;
      if (engineFetchFails >= 2) showEngineAlert('⚠️ تعذر الاتصال بخادم المراقبة — تحقّق من حالة الجهاز.');
      return;
    }
    engineFetchFails = 0;
    let json = null;
    try { json = await healthRes.json(); } catch (e) { json = null; }
    // v2.13.8 — رأس الشاشة يعرض الإصدار من الخادم (بدل نصّ ثابت قديم كان يظهر لسنوات).
    const vtag = document.getElementById('noc-version-tag');
    if (vtag) vtag.textContent = 'Network Operations Center' + (json && json.version ? ' — v' + json.version : '');
    const eng = json ? json.engine : null;
    if (!eng || eng.notStarted) { hideEngineAlert(); return; }
    const sec = Math.round((eng.lastTickAgeMs || 0) / 1000);
    const fmt = sec >= 60 ? Math.round(sec / 60) + ' دقيقة' : sec + ' ثانية';
    if (eng.stalled) {
      showEngineAlert('⚠️ محرك المراقبة متوقف منذ ' + fmt + ' — البيانات المعروضة قد تكون قديمة!');
    } else if (eng.stuckChecks > 0) {
      showEngineAlert('⚠️ يوجد ' + eng.stuckChecks + ' فحص عالق — بعض الأجهزة قد لا تتحدّث حالتها.');
    } else {
      hideEngineAlert();
    }
  }

  // ── Fetch Topology API ──
  async function tick() {
    const updateStatusEl = document.getElementById('update-status');
    try {
      // v2.8.6 — مصدران: السلسلة (للأسماء والأجهزة) + شجرة «خريطة المواقع» العامة (الترتيب والتشكيل).
      const [topoRes, treeRes, healthRes] = await Promise.all([
        fetch('/api/topology', { credentials: 'same-origin' }),
        fetch('/api/map/public/tree', { credentials: 'same-origin' }),
        // v2.11.9 — صحّة محرك المراقبة (لبانر التحذير).
        fetch('/api/health', { credentials: 'same-origin' }).catch(() => null),
      ]);
      const json = await topoRes.json();
      let treeJson = null;
      try { treeJson = await treeRes.json(); } catch (_) {}
      if (json.success && Array.isArray(json.data)) {
        rawTopology = json.data;
        flattenTree(rawTopology);
        if (treeJson && treeJson.success && treeJson.data) mapRootData = treeJson.data;
        renderAll();
        
        const now = new Date();
        document.getElementById('last-updated-time').textContent = 
          'آخر تحديث: ' + now.toLocaleTimeString('ar-EG');
        if (updateStatusEl) refreshStatusText(true);
        updateEngineAlertFromHealth(healthRes);
      }
    } catch (err) {
      refreshStatusText(false);
      engineFetchFails += 1;
      if (engineFetchFails >= 2) showEngineAlert('⚠️ تعذر الاتصال بخادم المراقبة — تحقّق من حالة الجهاز.');
    }
  }

  // ── Live Clock ──
  function clock() {
    const d = new Date();
    const timeStr = d.toLocaleTimeString('ar-EG', { hour12: true });
    const dateStr = d.toLocaleDateString('ar-EG', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    const clockEl = document.getElementById('clock');
    if (clockEl) clockEl.textContent = `${dateStr}  ·  ${timeStr}`;
  }

  // ── v2.8.5 — الوضع النهاري: تفضيل مشترك مع الصفحة العامة (nm.publicTheme) ──
  const THEME_STORAGE_KEY = 'nm.publicTheme';
  function applyNocTheme(isDay) {
    document.documentElement.classList.toggle('noc-day', !!isDay);
    const btn = document.getElementById('noc-theme-toggle');
    if (btn) btn.textContent = isDay ? '🌙 وضع ليلي' : '☀️ وضع نهاري';
  }
  window.nocToggleTheme = function () {
    const isDay = !document.documentElement.classList.contains('noc-day');
    applyNocTheme(isDay);
    try { localStorage.setItem(THEME_STORAGE_KEY, isDay ? 'light' : 'dark'); } catch (e) {}
  };
  // مزامنة نص الزر مع الوضع الذي طُبِّق مسبقًا من <head> (قبل أول رسم).
  applyNocTheme(document.documentElement.classList.contains('noc-day'));

  // ── Initialization ──
  clock();
  setInterval(clock, 1000);
  // v2.8.6 — استرجاع التبويب المختار ومقياس «التخطيط المرسوم» بعد إعادة التحميل
  // (كانا يعودان للحالة الافتراضية: أوّل شاشة «عرض شامل» ومقياس 100%).
  (function restoreSavedView() {
    let savedView = 'all';
    try { savedView = localStorage.getItem(VIEW_STORAGE_KEY) || 'all'; } catch (e) {}
    if (['all', 'hero', 'map', 'grid', 'draw'].indexOf(savedView) === -1) savedView = 'all';
    setViewMode(savedView);
    let savedZoom = 1.0;
    try { savedZoom = parseFloat(localStorage.getItem(ZOOM_STORAGE_KEY)); } catch (e) {}
    if (isFinite(savedZoom) && savedZoom > 0) {
      mapZoomLevel = Math.max(0.4, Math.min(1.8, savedZoom));
      applyMapTransform();
    }
  })();
  // v2.8.6 — ربط نافذة تفاصيل الجهاز (إغلاق بزر ✕ / بالنقر خارجها / بمفتاح Escape).
  (function bindDeviceModal() {
    const modal = document.getElementById('noc-device-modal');
    if (!modal) return;
    const closeBtn = document.getElementById('noc-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeDeviceDetails);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeDeviceDetails(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDeviceDetails(); });
  })();
  // v2.13.3 — زر إخفاء غطاء إنذار الانقطاع (الإخفاء به فقط — لا زر Escape ولا نقر خارج).
  (function bindOutageOverlay() {
    const btn = document.getElementById('outage-overlay-close');
    if (btn) btn.addEventListener('click', hideOutageOverlay);
  })();
  tick();
  // v2.12.0 — استرجاع حالة «التنبيه الصوتي» المحفوظة (كانت تُفقد مع كل إعادة تحميل ⇒ تفعيل يدوي كل مرة).
  (function restoreAudioAlert() {
    let saved = '0';
    try { saved = localStorage.getItem(AUDIO_STORAGE_KEY) || '0'; } catch (e) {}
    audioAlertEnabled = (saved === '1');
    syncAudioButton();
    if (audioAlertEnabled) armAudioUnlock();   // الصوت يحتاج تفاعلًا واحدًا بعد إعادة التحميل
  })();

  // v2.8.7 — polling أوّلي 10 ثوانٍ + خط بثّ حيّ (SSE) يضبط الإيقاع حسب حالة الاتصال.
  setPollInterval(10000);
  connectLive();
})();
