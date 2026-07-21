// admin-theme.js: إدارة الوضع الليلي/النهاري في لوحة التحكم.
// مفتاح تخزين مستقل عن الصفحة العامة.
const THEME_STORAGE_KEY = 'nm.adminTheme';

function applyTheme(isDark) {
  if (isDark) {
    document.body.classList.add('dark');
  } else {
    document.body.classList.remove('dark');
  }
  var btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.textContent = isDark ? '\u2600\uFE0F \u0648\u0636\u0639 \u0646\u0647\u0627\u0631\u064a' : '\uD83C\uDF19 \u0648\u0636\u0639 \u0644\u064a\u0644\u064a';
  }
}

function toggleTheme() {
  var isDark = !document.body.classList.contains('dark');
  applyTheme(isDark);
  try { localStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light'); } catch (e) {}
}

// تطبيق الوضع المحفوظ عند تحميل الصفحة.
document.addEventListener('DOMContentLoaded', function () {
  try {
    var saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark') {
      applyTheme(true);
    } else {
      applyTheme(false);
    }
  } catch (e) {
    applyTheme(false);
  }

  var btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.addEventListener('click', toggleTheme);
  }
});