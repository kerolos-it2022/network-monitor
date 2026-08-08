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

  // v2.7.0 — sidebar drawer في < 768px: زرّ 🍔 يَفتح/يُغلق القائمة الجانبية المعتمة.
  const sidebar = document.getElementById('admin-sidebar');
  const toggle = document.getElementById('sidebar-toggle');
  const backdrop = document.getElementById('sidebar-backdrop');
  function openSidebar() {
    if (!sidebar) return;
    sidebar.classList.add('open');
    if (backdrop) backdrop.classList.add('open');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
  }
  function closeSidebar() {
    if (!sidebar) return;
    sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }
  if (toggle) toggle.addEventListener('click', () => {
    if (sidebar && sidebar.classList.contains('open')) closeSidebar();
    else openSidebar();
  });
  // نقر الخلفية يُغلق الـ drawer.
  if (backdrop) backdrop.addEventListener('click', closeSidebar);
  // اِختيار قسم في الموبايل يُغلق الـ drawer تلقائياً (لِـ تَجَنُّب التَرك مفتوحًا).
  Object.keys(TAB_TO_SECTION).forEach((tabId) => {
    const el = document.getElementById(tabId);
    if (el) el.addEventListener('click', () => {
      if (window.innerWidth <= 768) closeSidebar();
    });
  });
  // مفتاح ESC يُغلق الـ drawer.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar && sidebar.classList.contains('open')) closeSidebar();
  });
});