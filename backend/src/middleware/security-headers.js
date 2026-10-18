// security-headers.js ( SEC-03) — هيدرز أمنية أساسية بلا أي اعتمادية جديدة.
// ═══════════════════════════════════════════════════════════════════════════
// ملاحظة مقصودة: لا نفرض CSP صارمة على السكربتات لأن واجهات المشروع الحالية تعتمد
// سكربتات/سمات داخلية (onclick) — نفرض فقط ما لا يكسر أي شاشة ولا يمنع ميزة:
//   frame-ancestors (منع التأطير) · base-uri · object-src (منع الإضافات) · nosniff ·
//   referrer / permissions policy. HSTS يُرسَل فقط على HTTPS (أو خلف بروكسي https).
'use strict';

function isHttps(req) {
  return !!req.secure;
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self'; base-uri 'self'; object-src 'none'");
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (isHttps(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
}

module.exports = { securityHeaders, isHttps };
