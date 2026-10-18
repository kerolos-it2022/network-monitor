// reports.routes.js (v2.26.0) — 📄 التقرير الأسبوعي: ملخص جاهز للإدارة (7 أيام).
//   GET /api/reports/weekly?offset=0  → JSON (للعرض/البناء في أي مكان)
//   GET /reports/weekly?offset=0      → صفحة HTML مستقلة مزوّدة CSS طباعة
//     (زر «حفظ PDF» يستخدم حوار الطباعة في المتصفح — بلا أي مكتبات خادم إضافية).
const express = require('express');
const { buildWeeklyReport } = require('../services/weekly-report.service');
const requireAuth = require('../middleware/requireAuth');
const { uiText } = require('../services/ui-text.service');

const router = express.Router();

// GET /api/reports/weekly?offset=N 🔒
router.get('/weekly', requireAuth, (req, res) => {
  try {
    return res.json({ success: true, data: buildWeeklyReport(req.query.offset) });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, error: e.status === 400 ? e.message : uiText('خطأ داخلي في الخادم', 'Internal server error') });
  }
});

// ── htmlRouter — صفحة «📄 التقرير الأسبوعي» المزوّدة (جاهزة للطباعة/حفظ PDF) ──
// حماية بجلسة الأدمن: غير مسجل ⇒ توجيه لصفحة الدخول.
// v2.50.x — الصفحة بلغتين كبقية الواجهة: النصوص مفاتيح ترجمة تُطبَّق في المتصفح، والتواريخ والمُدد
// تُرسَل **خامًا** في سمات data-* ويُنسّقها NMFormat بلغة الصفحة — فلا تاريخ عربي ثابت في الـHTML.
const isoZ = (v) => {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) return s;
  // قيم SQLite بلا منطقة زمنية: نُلحق Z فتفسَّر UTC (نفس منطق timestamp() في weekly-report.service) —
  // وإلا قرأها المتصفح توقيتًا محليًّا فتُزاح الساعات.
  return s.replace(' ', 'T') + 'Z';
};
function weeklyPage(req, res) {
  if (!req.session || !req.session.user) return res.redirect('/admin/login.html');
  let rep;
  try { rep = buildWeeklyReport(req.query.offset); } catch (e) { return res.status(e.status || 500).send(e.status === 400 ? e.message : uiText('خطأ داخلي في الخادم', 'Internal server error')); }
  const escHtml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const worstRows = rep.per_device.map((p, i) =>
    '<tr><td>' + (i + 1) + '</td><td>' + escHtml(p.name) + '</td><td dir="ltr">' + escHtml(p.ip || '') + '</td><td>' + Math.round(p.min) + '</td><td>' + p.count + '</td></tr>'
  ).join('');
  const longRows = rep.longest_events.map((e) =>
    '<tr><td>' + escHtml(e.name) + '</td>' +
    '<td data-nm-date="' + escHtml(isoZ(e.started_at)) + '"></td>' +
    '<td>' + (e.ended_at
      ? '<span data-nm-date="' + escHtml(isoZ(e.ended_at)) + '"></span>'
      : '<span data-i18n="report.ongoing">مستمر</span>') + '</td>' +
    '<td>' + (e.minutes != null ? '<span data-nm-seconds="' + Math.round(e.minutes * 60) + '"></span>' : '—') + '</td></tr>'
  ).join('');
  const prevOffset = rep.offset + 1;
  const nextOffset = Math.max(0, rep.offset - 1);
  const html = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Weekly report</title>
<script>/* ضبط اللغة قبل أول رسم (بلا وميض إنجليزي في الوضع العربي) — نفس نمط بقية الصفحات */
  try { if (localStorage.getItem('nm.lang') === 'ar') { document.documentElement.lang = 'ar'; document.documentElement.dir = 'rtl'; } } catch (e) {}</script>
<style>
  body { font-family: 'Segoe UI', Tahoma, sans-serif; margin: 2rem; color: #111; background: #fff; }
  h1 { font-size: 1.4rem; margin: 0 0 0.2rem; }
  h2 { font-size: 1.05rem; margin: 1.4rem 0 0.5rem; border-bottom: 2px solid #ddd; padding-bottom: 0.3rem; }
  .sub { color: #555; font-size: 0.9rem; }
  .cards { display: flex; gap: 0.8rem; flex-wrap: wrap; margin: 1rem 0; }
  .card { border: 1px solid #ddd; border-radius: 10px; padding: 0.8rem 1.1rem; min-width: 150px; }
  .card .v { font-size: 1.5rem; font-weight: 700; }
  table { border-collapse: collapse; width: 100%; font-size: 0.88rem; }
  th, td { border: 1px solid #ddd; padding: 0.4rem 0.6rem; text-align: right; }
  th { background: #f3f4f6; }
  .toolbar { display: flex; gap: 0.6rem; margin-bottom: 1.2rem; flex-wrap: wrap; }
  button { padding: 0.5rem 1rem; border: 1px solid #999; border-radius: 8px; background: #fff; cursor: pointer; font-family: inherit; }
  button.primary { background: #2563eb; color: #fff; border-color: #2563eb; }
  /* الوضع الإنجليزي: محاذاة الخلايا إلى اليسار — والعربية تبقى كما كانت بلا dir */
  html[dir="ltr"] th, html[dir="ltr"] td { text-align: left; }
  @media print { .toolbar { display: none; } body { margin: 1cm; } }
</style>
</head>
<body>
<div class="toolbar">
  <button class="primary" onclick="window.print()" data-i18n="report.print">🖨️ حفظ PDF / طباعة</button>
  <button onclick="location='?offset=${prevOffset}'"><span data-i18n="report.prev">◀ الأسبوع الأقدم</span></button>
  <button onclick="location='?offset=${nextOffset}'"><span data-i18n="report.next">الأسبوع الأحدث ▶</span></button>
</div>
<h1 data-i18n="report.heading">📄 التقرير الأسبوعي لمراقبة الشبكة</h1>
<div class="sub" id="report-period"></div>
<div class="cards">
  <div class="card"><div class="sub" data-i18n="report.kpi.outages">انقطاعات الأسبوع</div><div class="v">${rep.events_count}</div></div>
  <div class="card"><div class="sub" data-i18n="report.kpi.minutes">إجمالي الدقائق</div><div class="v">${rep.total_minutes}</div></div>
  <div class="card"><div class="sub" data-i18n="report.kpi.uptime">نسبة التشغيل التقريبية</div><div class="v">${rep.uptime_percent}%</div></div>
  <div class="card"><div class="sub" data-i18n="report.kpi.devices">أجهزة مراقبة</div><div class="v">${rep.devices_active}</div></div>
  <div class="card"><div class="sub" data-i18n="report.kpi.open">انقطاعات ما تزال مفتوحة</div><div class="v">${rep.open_still}</div></div>
</div>
<h2 data-i18n="report.worst">أسوأ الأجهزة في الأسبوع (بإجمالي الدقائق)</h2>
<table><tr><th>#</th><th data-i18n="report.th.device">الجهاز</th><th>IP</th><th data-i18n="report.th.minutes">دقائق</th><th data-i18n="report.th.count">مرات</th></tr>${worstRows || '<tr><td colspan="5" data-i18n="report.empty">لا انقطاعات — أسبوع نظيف 🎉</td></tr>'}</table>
<h2 data-i18n="report.longest">أطول الانقطاعات</h2>
<table><tr><th data-i18n="report.th.device">الجهاز</th><th data-i18n="report.th.start">البداية</th><th data-i18n="report.th.end">النهاية</th><th data-i18n="report.th.duration">المدة</th></tr>${longRows || '<tr><td colspan="4">—</td></tr>'}</table>
<div class="sub" style="margin-top:1.2rem;" data-i18n="report.footnote">ملاحظة: نسبة التشغيل تقديرية (دقائق الانقطاع مقابل أجهزة المراقبة × 7 أيام). أُنشئ آليًّا بواسطة network-monitor.</div>
<script src="/js/nm-format.js"></script>
<script src="/js/nm-i18n.js"></script>
<script src="/js/nm-i18n-en.js"></script>
<script src="/js/nm-lang.js"></script>
<script>
// التواريخ والمُدد تُنسَّق هنا بلغة الصفحة (NMFormat) من قيم خام ⇒ ولا نصّ عربي ثابت في الـHTML،
// والعنوان وسطر الفترة يعيدان الرسم مع كل تغيير لغة (حدث nm:lang).
(function () {
  const START = ${JSON.stringify(rep.start || '')};
  const END = ${JSON.stringify(rep.end || '')};
  function paintValues() {
    const F = window.NMFormat;
    document.querySelectorAll('[data-nm-date]').forEach(function (el) {
      const v = el.getAttribute('data-nm-date');
      el.textContent = v ? (F ? F.dateTime(v) : v) : '—';
    });
    document.querySelectorAll('[data-nm-seconds]').forEach(function (el) {
      const s = Number(el.getAttribute('data-nm-seconds'));
      el.textContent = F ? F.duration(s) : String(s);
    });
  }
  function paint() {
    const n = window.NMI18N;
    if (!n) return;
    try { n.setLang(n.storedLang() || 'en', { persist: false }); } catch (e) {}
    const F = window.NMFormat;
    const day = function (v) { return (F && v) ? F.date(v) : (v || '—'); };
    document.title = n.t('report.title', { from: day(START) });
    const period = document.getElementById('report-period');
    if (period) {
      period.textContent = n.t('report.period', {
        from: day(START), to: day(END), created: F ? F.dateTime(new Date()) : '',
      });
    }
    paintValues();
  }
  paint();
  document.addEventListener('nm:lang', paint);
})();
</script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

module.exports = { router, weeklyPage, buildWeeklyReport };
