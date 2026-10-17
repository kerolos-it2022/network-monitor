// reports.routes.js (v2.26.0) — 📄 التقرير الأسبوعي: ملخص جاهز للإدارة (7 أيام).
//   GET /api/reports/weekly?offset=0  → JSON (للعرض/البناء في أي مكان)
//   GET /reports/weekly?offset=0      → صفحة HTML مستقلة مزوّدة CSS طباعة
//     (زر «حفظ PDF» يستخدم حوار الطباعة في المتصفح — بلا أي مكتبات خادم إضافية).
const express = require('express');
const { buildWeeklyReport } = require('../services/weekly-report.service');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// GET /api/reports/weekly?offset=N 🔒
router.get('/weekly', requireAuth, (req, res) => {
  try {
    return res.json({ success: true, data: buildWeeklyReport(req.query.offset) });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, error: e.status === 400 ? e.message : 'خطأ داخلي في الخادم' });
  }
});

// ── htmlRouter — صفحة «📄 التقرير الأسبوعي» المزوّدة (جاهزة للطباعة/حفظ PDF) ──
// حماية بجلسة الأدمن: غير مسجل ⇒ توجيه لصفحة الدخول.
const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString('ar-EG'); } catch (e) { return iso; } };
const fmtDT = (iso) => { try { return new Date(iso).toLocaleString('ar-EG'); } catch (e) { return iso; } };
function weeklyPage(req, res) {
  if (!req.session || !req.session.user) return res.redirect('/admin/login.html');
  let rep;
  try { rep = buildWeeklyReport(req.query.offset); } catch (e) { return res.status(e.status || 500).send(e.status === 400 ? e.message : 'خطأ داخلي في الخادم'); }
  const escHtml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const worstRows = rep.per_device.map((p, i) =>
    '<tr><td>' + (i + 1) + '</td><td>' + escHtml(p.name) + '</td><td dir="ltr">' + escHtml(p.ip || '') + '</td><td>' + Math.round(p.min) + '</td><td>' + p.count + '</td></tr>'
  ).join('');
  const longRows = rep.longest_events.map((e) =>
    '<tr><td>' + escHtml(e.name) + '</td><td>' + fmtDT(e.started_at) + '</td><td>' + (e.ended_at ? fmtDT(e.ended_at) : 'مستمر') + '</td><td>' + (e.minutes != null ? e.minutes + ' دقيقة' : '—') + '</td></tr>'
  ).join('');
  const prevOffset = rep.offset + 1;
  const nextOffset = Math.max(0, rep.offset - 1);
  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>التقرير الأسبوعي — ${fmtDate(rep.start)}</title>
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
  @media print { .toolbar { display: none; } body { margin: 1cm; } }
</style>
</head>
<body>
<div class="toolbar">
  <button class="primary" onclick="window.print()">🖨️ حفظ PDF / طباعة</button>
  <button onclick="location='?offset=${prevOffset}'">◀ الأسبوع الأقدم</button>
  <button onclick="location='?offset=${nextOffset}'">الأسبوع الأحدث ▶</button>
</div>
<h1>📄 التقرير الأسبوعي لمراقبة الشبكة</h1>
<div class="sub">الفترة: ${fmtDate(rep.start)} — ${fmtDate(rep.end)} · تم الإنشاء: ${new Date().toLocaleString('ar-EG')}</div>
<div class="cards">
  <div class="card"><div class="sub">انقطاعات الأسبوع</div><div class="v">${rep.events_count}</div></div>
  <div class="card"><div class="sub">إجمالي الدقائق</div><div class="v">${rep.total_minutes}</div></div>
  <div class="card"><div class="sub">نسبة التشغيل التقريبية</div><div class="v">${rep.uptime_percent}%</div></div>
  <div class="card"><div class="sub">أجهزة مراقبة</div><div class="v">${rep.devices_active}</div></div>
  <div class="card"><div class="sub">انقطاعات ما تزال مفتوحة</div><div class="v">${rep.open_still}</div></div>
</div>
<h2>أسوأ الأجهزة في الأسبوع (بإجمالي الدقائق)</h2>
<table><tr><th>#</th><th>الجهاز</th><th>IP</th><th>دقائق</th><th>مرات</th></tr>${worstRows || '<tr><td colspan="5">لا انقطاعات — أسبوع نظيف 🎉</td></tr>'}</table>
<h2>أطول الانقطاعات</h2>
<table><tr><th>الجهاز</th><th>البداية</th><th>النهاية</th><th>المدة</th></tr>${longRows || '<tr><td colspan="4">—</td></tr>'}</table>
<div class="sub" style="margin-top:1.2rem;">ملاحظة: نسبة التشغيل تقديرية (دقائق الانقطاع مقابل أجهزة المراقبة × 7 أيام). أُنشئ آليًّا بواسطة network-monitor.</div>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

module.exports = { router, weeklyPage, buildWeeklyReport };
