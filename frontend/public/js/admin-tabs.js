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

  // ═══ v2.7.1 — sidebar: زرّ ☰ يَعمل في كل الأَحجام ═══
  // - حاسوب (>=768px): يَطوي/يَوسّع القائمة (rail mode = أَيقونات فقط عبر class
  //   `sidebar-collapsed` على <body>). الحالة محفُوظة في localStorage.
  // - موبايل (<768px): drawer كامل فوق الشاشة (السلوك القَديم يَبقى كما هو).
  const SIDEBAR_COLLAPSED_KEY = 'nm.adminSidebarCollapsed';
  const sidebar = document.getElementById('admin-sidebar');
  const toggle = document.getElementById('sidebar-toggle');
  const backdrop = document.getElementById('sidebar-backdrop');
  const isMobile = () => window.innerWidth <= 768;

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
  function applyCollapsedDesktop(collapsed) {
    if (collapsed) document.body.classList.add('sidebar-collapsed');
    else document.body.classList.remove('sidebar-collapsed');
    if (toggle) toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
  // اِسترجاع الحالة المحفوظة عند الإقلاع (حاسوب فقط).
  try {
    const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (saved === 'collapsed' && !isMobile()) applyCollapsedDesktop(true);
  } catch (_) {}

  if (toggle) toggle.addEventListener('click', () => {
    if (isMobile()) {
      if (sidebar && sidebar.classList.contains('open')) closeSidebarDrawer();
      else openSidebarDrawer();
    } else {
      const collapsed = !document.body.classList.contains('sidebar-collapsed');
      applyCollapsedDesktop(collapsed);
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? 'collapsed' : 'open'); } catch (_) {}
    }
  });
  // نقر الخلفية يُغلق الـ drawer (موبايل).
  if (backdrop) backdrop.addEventListener('click', closeSidebarDrawer);
  // اِختيار قسم في الموبايل يُغلق الـ drawer تلقائياً (لِـ تَجَنُّب التَرك مفتوحًا).
  Object.keys(TAB_TO_SECTION).forEach((tabId) => {
    const el = document.getElementById(tabId);
    if (el) el.addEventListener('click', () => {
      if (isMobile()) closeSidebarDrawer();
    });
  });
  // مفتاح ESC يُغلق الـ drawer (موبايل) — لا تأثير له على وضع rail في الحاسوب.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar && sidebar.classList.contains('open')) closeSidebarDrawer();
  });
  // اِستجابة لِـ تَغيير حجم النافذة: لو اِنتقلنا من الموبايل للحاسوب و الـ drawer مفتوح
  //، نُغلقه و نَترك rail-mode يَحكمه خادمه. لو العكس لا شَيء.
  window.addEventListener('resize', () => {
    if (!isMobile() && sidebar && sidebar.classList.contains('open')) closeSidebarDrawer();
  });
});