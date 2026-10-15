// labels.routes.js (v2.30.0) — 🏷️ ملصقات QR لكل جهاز: صفحة طباعة داخل اللوحة.
// كل ملصق: QR يشير لصفحة الجهاز في الشبكة/النفق الحالي (يُبنى من Host الوصول)
// + الاسم + IP + النوع/الموقع. الطباعة عبر حوار المتصفح (حفظ PDF أو ملصقات حقيقية).
// بلا أي اعتمادات جديدة: كود QR يُرسم عبر صيغة URL API مجاني (api.qrserver.com).
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

function baseUrlOf(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return proto + '://' + host;
}

function buildLabelsHtml(origin) {
  const rows = db.prepare(`
    SELECT d.id, d.name, d.ip, d.web_port, t.name AS type_name, l.name AS loc_name
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
          <div class="mt">امسح لعرض تفاصيل الجهاز</div>
        </div>
      </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>🏷️ ملصقات QR — الأجهزة (${rows.length})</title>
<style>
  body { font-family: 'Segoe UI', Tahoma, sans-serif; margin: 1rem; background: #fff; color: #111; }
  .toolbar { display: flex; gap: 0.6rem; margin-bottom: 1rem; }
  button { padding: 0.5rem 1rem; border: 1px solid #999; border-radius: 8px; background: #fff; cursor: pointer; font-family: inherit; }
  button.primary { background: #2563eb; color: #fff; border-color: #2563eb; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 0.6rem; }
  .label { display: flex; gap: 0.6rem; align-items: center; border: 1px dashed #9ca3af; border-radius: 10px; padding: 0.6rem; page-break-inside: avoid; }
  .label img { width: 92px; height: 92px; }
  .info { flex: 1; min-width: 0; }
  .nm { font-weight: 700; font-size: 0.95rem; }
  .ip { font-family: monospace; font-size: 0.85rem; }
  .mt { font-size: 0.72rem; color: #555; }
  @media print { .toolbar { display: none; } body { margin: 0.4cm; } .label { border-color: #333; } }
</style>
</head>
<body>
<div class="toolbar">
  <button class="primary" onclick="window.print()">🖨️ طباعة الملصقات</button>
  <span style="font-size:0.85rem;color:#555;">المسح بموبايل يفتح تفاصيل الجهاز — الملصقات بجميع الأجهزة المفعّلة (${rows.length})</span>
</div>
<div class="grid">${cards}</div>
</body>
</html>`;
}

// GET /labels/devices — صفحة طباعة ملصقات QR (🔒 جلسة — غير مسجل يُحوَّل للدخول).
router.get(['/', '/devices', '/labels/devices'], (req, res) => {
  if (!req.session || !req.session.user) return res.redirect('/admin/login.html');
  try {
    // بناء URL الملصقات من عنوان الوصول نفسه (يعمل عبر النفق وعبر الشبكة المحلية)
    const origin = baseUrlOf(req);
    const html = buildLabelsHtml(origin);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    res.status(500).send('خطأ: ' + e.message);
  }
});

module.exports = router;
