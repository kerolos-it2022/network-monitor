// admin-tabs.js: التبديل بين أقسام لوحة التحكم (إظهار واحد، إخفاء البقية).
const TAB_TO_SECTION = {
  'tab-devices': 'section-devices',
  'tab-locations': 'section-locations',
  'tab-types': 'section-types',
  'tab-discovery': 'section-discovery',
  'tab-discovered': 'section-discovered',
  'tab-scheduler': 'section-scheduler',
  'tab-map': 'section-map',
  'tab-notifications': 'section-notifications',
  'tab-logs': 'section-logs',
  'tab-profile': 'section-profile',
  'tab-backup': 'section-backup',
  'tab-updates': 'section-updates',
};

function showSection(tabId) {
  // تحديث الأزرار.
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  const btn = document.getElementById(tabId);
  if (btn) btn.classList.add('active');

  // إظهار القسم المقابل وإخفاء البقية.
  const target = TAB_TO_SECTION[tabId];
  Object.values(TAB_TO_SECTION).forEach((secId) => {
    const s = document.getElementById(secId);
    if (!s) return;
    if (secId === target) s.classList.remove('hidden');
    else s.classList.add('hidden');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  Object.keys(TAB_TO_SECTION).forEach((tabId) => {
    const el = document.getElementById(tabId);
    if (el) el.addEventListener('click', () => showSection(tabId));
  });
  // افتراضياً: قسم الأجهزة ظاهر (أول تبويب).
  showSection('tab-devices');

  // ═══ v2.7.2 — sidebar بحالتين على الحاسوب + drawer للموبايل ═══
  // - حاسوب (>=768px): زرّ ☰ يَدور بين حالتين:
  //     open   → القائمة كاملة (أَيقونات + نصوص، عرض 242px).
  //     rail   → مَطويةّ (أَيقونات فقط، عرض 60px، tooltip عبر title) — class
  //              `sidebar-collapsed` على <body>.
  //   (تمّ إلغاء حالة hidden بناءً على طلب المستخدم — الدورة الآن open ⇄ rail فقط.)
  //   الحالة محفُوظة في localStorage (نفس مفتاح v2.7.1 لِـ التوافق الرجعي).
  // - موبايل (<768px): drawer كامل فوق الشاشة مع خلفية معتمة (كما v2.7.1 — لا تغيير).
  const SIDEBAR_STATE_KEY = 'nm.adminSidebarCollapsed'; // اِسم تاريخيّ (نتائج: open/collapsed)
  const sidebar = document.getElementById('admin-sidebar');
  const toggle = document.getElementById('sidebar-toggle');
  const backdrop = document.getElementById('sidebar-backdrop');
  const isMobile = () => window.innerWidth <= 768;

  // نصوص عربية تَعكس حالة الزرّ على الحاسوب (تُحدَّث ديناميكياً في title/aria-label).
  const STATE_TITLES = {
    open:   'القائمة مفتوحة — اِضغط للطيّ',
    rail:   'القائمة مطويةّ — اِضغط للتَوسيع',
  };

  function openSidebarDrawer() {
    if (!sidebar) return;
    sidebar.classList.add('open');
    if (backdrop) backdrop.classList.add('open');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
  }
  function closeSidebarDrawer() {
    if (!sidebar) return;
    sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  // تَطبيق حالة الـ sidebar على الحاسوب (open/rail) عبر classes على <body>.
  // ملاحظة: نُبقي إِزالة `sidebar-hidden` احتياطاً لِمَن تَرِكة قيمة 'hidden'
  // في localStorage من إِصدار سابق — حتى لا تَبقى القائمة مَخفيةّ بالخطأ.
  function applyDesktopState(state) {
    document.body.classList.remove('sidebar-collapsed', 'sidebar-hidden');
    if (state === 'rail') document.body.classList.add('sidebar-collapsed');
    document.body.setAttribute('data-sidebar-state', state);
    if (toggle) {
      // open/rail = القائمة ظاهرة → expanded=true.
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-pressed', 'false');
      toggle.title = STATE_TITLES[state] || STATE_TITLES.open;
      toggle.setAttribute('aria-label', STATE_TITLES[state] || STATE_TITLES.open);
    }
  }

  // اِسترجاع الحالة الحالية من <body> (data-sidebar-state)؛ الافتراضي open.
  function currentDesktopState() {
    return document.body.getAttribute('data-sidebar-state') || 'open';
  }
  // الدورة: open → rail → open ... (تمّ إلغاء حالة hidden).
  function nextDesktopState(state) {
    if (state === 'open') return 'rail';
    return 'open';
  }
  // تَطبيع القيمة المَقروءة من localStorage لِـ التوافق الرجعي مع v2.7.1
  // (التي كانت تَستخدم 'collapsed'/'open' فقط). قيمة 'hidden' من إِصدار سابق
  // تُربَط آمناً على 'open' (تمّ إلغاء حالة الإِخفاء).
  function normalizeSavedState(raw) {
    if (raw === 'collapsed' || raw === 'rail') return 'rail';
    return 'open'; // يشمل 'open' و'hidden' وغياب القيمة وأي قيمة غير معروفة.
  }

  // اِسترجاع الحالة المحفوظة عند الإقلاع (حاسوب فقط).
  try {
    const saved = localStorage.getItem(SIDEBAR_STATE_KEY);
    const state = normalizeSavedState(saved);
    if (!isMobile()) applyDesktopState(state);
  } catch (_) {}

  if (toggle) toggle.addEventListener('click', () => {
    if (isMobile()) {
      if (sidebar && sidebar.classList.contains('open')) closeSidebarDrawer();
      else openSidebarDrawer();
    } else {
      const next = nextDesktopState(currentDesktopState());
      applyDesktopState(next);
      // خَزن القيمة بشكل متوافق: rail = 'collapsed' (كما v2.7.1)، open = 'open'.
      const stored = next === 'rail' ? 'collapsed' : next;
      try { localStorage.setItem(SIDEBAR_STATE_KEY, stored); } catch (_) {}
    }
  });
  // نقر الخلفية يُغلق الـ drawer (موبايل).
  if (backdrop) backdrop.addEventListener('click', closeSidebarDrawer);
  // اِختيار قسم في الموبايل يُغلق الـ drawer تلقائياً (لِـ تَجَنُّب التَرك مفتوحًا).
  // على الحاسوب: لا تأثير (القائمة تَبقى في حالتها open/rail).
  Object.keys(TAB_TO_SECTION).forEach((tabId) => {
    const el = document.getElementById(tabId);
    if (el) el.addEventListener('click', () => {
      if (isMobile()) closeSidebarDrawer();
    });
  });
  // مفتاح ESC يُغلق الـ drawer (موبايل) — لا تأثير له على حالات الحاسوب.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar && sidebar.classList.contains('open')) closeSidebarDrawer();
  });
  // اِستجابة لِـ تَغيير حجم النافذة: لو اِنتقلنا من الموبايل للحاسوب و الـ drawer مفتوح
  //، نُغلقه و نَترك حالات الحاسوب (open/rail) تَحكمها localStorage. لو العكس لا شَيء.
  window.addEventListener('resize', () => {
    if (!isMobile() && sidebar && sidebar.classList.contains('open')) closeSidebarDrawer();
  });
});