// admin-tabs.js: التبديل بين أقسام لوحة التحكم (إظهار واحد، إخفاء البقية).
const TAB_TO_SECTION = {
  'tab-devices': 'section-devices',
  'tab-locations': 'section-locations',
  'tab-types': 'section-types',
  'tab-discovery': 'section-discovery',
  'tab-notifications': 'section-notifications',
  'tab-logs': 'section-logs',
  'tab-profile': 'section-profile',
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
});