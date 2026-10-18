// labels.routes.js (v2.30.0 — مُنسَّقة v2.30.4) — 🏷️ ملصقات QR لكل جهاز: صفحة طباعة
// داخل اللوحة بهوية NOC (شاشة كحلية) + طباعة على أوراق بيضاء تلقائيًّا (@media print).
// كل ملصق: QR يشير لصفحة الجهاز (يُبنى من Host الوصول — النفق أو الشبكة المحلية)
// + الاسم + IP + النوع/الموقع. بلا أي اعتمادات: QR عبر api.qrserver.com.
const express = require('express');
const db = require('../db');
const { uiText } = require('../services/ui-text.service');

const router = express.Router();

function baseUrlOf(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return proto + '://' + host;
}

function buildLabelsHtml(origin) {
  const rows = db.prepare(`
    SELECT d.id, d.name, d.ip, t.name AS type_name, l.name AS loc_name
    FROM devices d
    LEFT JOIN device_types t ON t.id = d.device_type_id
    LEFT JOIN locations l ON l.id = d.location_id
    WHERE d.is_active = 1
    ORDER BY d.name COLLATE NOCASE
  `).all();

  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const cards = rows.map((d) => {
    const devUrl = origin + '/?dev=' + d.id;
    const qr = 'https://api.qrserver.com/v1/create-qr-code/?size=150x150&margin=0&data=' + encodeURIComponent(devUrl);
    return `
      <div class="label">
        <img src="${qr}" alt="QR" />
        <div class="info">
          <div class="nm">${esc(d.name)}</div>
          <div class="ip" dir="ltr">${esc(d.ip)}</div>
          <div class="mt">${esc(d.type_name || '')}${d.loc_name ? ' · ' + esc(d.loc_name) : ''}</div>
          <div class="mt" data-i18n="labels.card.scan">امسح لعرض تفاصيل الجهاز</div>
        </div>
      </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>🏷️ QR labels — devices (${rows.length})</title>
<script>/* ضبط اللغة قبل أول رسم (بلا وميض إنجليزي في الوضع العربي) — نفس نمط بقية الصفحات */
  try { if (localStorage.getItem('nm.lang') === 'ar') { document.documentElement.lang = 'ar'; document.documentElement.dir = 'rtl'; } } catch (e) {}</script>
<style>
  body { margin: 0; font-family: 'Segoe UI', Tahoma, sans-serif; background: #0a1122; color: #e2e8f0; }
  .topbar { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; padding: 0.8rem 1rem;
            background: #0d1730; border-bottom: 1px solid #2b3d63; position: sticky; top: 0; z-index: 5; }
  .topbar b { font-size: 1.05rem; }
  .topbar .hint { font-size: 0.8rem; color: #94a3b8; flex: 1; min-width: 240px; }
  button, a.noclink { text-decoration: none !important; padding: 0.5rem 1rem; border-radius: 8px;
            border: 1px solid #2b3d63; background: #16223b; color: #e2e8f0; cursor: pointer;
            font-family: inherit; font-weight: 600; font-size: 0.85rem; }
  button.primary { background: #1d4ed8; border-color: #1d4ed8; }
  button:hover, a.noclink:hover { background: #223459; }
  .wrap { padding: 1rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 0.7rem; }
  .label { display: flex; gap: 0.7rem; align-items: center; background: #101a30; border: 1px solid #2b3d63;
           border-radius: 12px; padding: 0.7rem; page-break-inside: avoid; box-shadow: 0 4px 14px rgba(0,0,0,0.35); }
  .label img { width: 92px; height: 92px; background: #fff; border: 4px solid #fff; border-radius: 6px; }
  .info { flex: 1; min-width: 0; }
  .nm { font-weight: 700; font-size: 0.95rem; color: #e2e8f0; }
  .ip { font-family: Consolas, monospace; font-size: 0.85rem; color: #93c5fd; }
  .mt { font-size: 0.72rem; color: #94a3b8; }
  @media print {
    body { background: #fff; color: #111; }
    .topbar { display: none; }
    .wrap { padding: 0.3cm; }
    .label { background: #fff; border: 1px solid #333; box-shadow: none; }
    .nm { color: #111; } .ip { color: #333; } .mt { color: #555; }
    .label img { border-width: 2px; }
  }
</style>
</head>
<body>
<div class="topbar">
  <b data-i18n="labels.heading">🏷️ ملصقات QR للأجهزة</b>
  <span class="hint" id="labels-hint">المسح بموبايل يفتح تفاصيل الجهاز في النظام — الملصقات لجميع الأجهزة المفعّلة (${rows.length})</span>
  <a class="noclink" href="/admin/dashboard.html" data-i18n="labels.back">← العودة للوحة التحكم</a>
  <button class="primary" onclick="window.print()" data-i18n="labels.print">🖨️ حفظ PDF / طباعة</button>
</div>
<div class="wrap">
  <div class="grid">${cards}</div>
</div>
<script src="/js/nm-format.js"></script>
<script src="/js/nm-i18n.js"></script>
<script src="/js/nm-i18n-en.js"></script>
<script src="/js/nm-lang.js"></script>
<script>
// النصوص التي تحمل عددًا ({n}) لا يستطيع مطبّق السمات تعبئتها ⇒ تُكتب من هنا بلغة الصفحة الحالية،
// وتُعاد كتابتها مع كل تغيير لغة (حدث nm:lang) — فيتبع العنوان والتلميح لغة اللوحة مثل بقية الصفحات.
(function () {
  const TOTAL = ${rows.length};
  function paint() {
    const n = window.NMI18N;
    if (!n) return;
    try { n.setLang(n.storedLang() || 'en', { persist: false }); } catch (e) {}
    document.title = n.t('labels.title', { n: TOTAL });
    const hint = document.getElementById('labels-hint');
    if (hint) hint.textContent = n.t('labels.hint', { n: TOTAL });
  }
  paint();
  document.addEventListener('nm:lang', paint);
})();
</script>
</body>
</html>`;
}

// GET /labels/devices — صفحة الملصقات (🔒 جلسة — غير مسجل يُحوَّل للدخول).
// ملاحظة v2.30.2: Router مُستخدَم كمعالج مباشر في app.get('/labels/devices') ⇒
// المسار الداخلي يجب أن يطابق المسار الكامل (درس مُوثَّق).
router.get(['/devices', '/labels/devices'], (req, res) => {
  if (!req.session || !req.session.user) return res.redirect('/admin/login.html');
  try {
    const origin = baseUrlOf(req);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(buildLabelsHtml(origin));
  } catch (e) {
    res.status(500).send(uiText('خطأ: ', 'Error: ') + e.message);
  }
});

module.exports = router;
