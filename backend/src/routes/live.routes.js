// live.routes.js (v2.8.7) — بثّ حالة الأجهزة لحظيًا عبر SSE (Server-Sent Events).
// GET /api/live/status — مسار **عام للقراءة فقط** (بلا auth) بنفس مستوى /api/topology:
//   • عند الاتصال: رسالة {type:'snapshot'} فيها حالات كل الأجهزة + العدّادات.
//   • بعدها: رسائل {type:'update'} بالتغييرات فقط (يُبثّها live.service بعد كل دورة فحص).
//   • نبض كل 25 ثانية (تعليق ': ping') لإبقاء الخط حيًّا عبر nginx/الجدران النارية.
// ملاحظة تشغيل: لا يوجد أي كتابة على هذه القناة — كل التعديلات تبقى على REST بجلسة الأدمن.
const express = require('express');
const router = express.Router();
const live = require('../services/live.service');
const publicDisplay = require('../services/public-display.service');

router.get('/status', (req, res) => {
  // SEC-02 — يحترم وضع العرض العام: 'off' ⇒ لا بثّ للمجهول.
  // (الحمولة لا تحوي IP/MAC أصلًا، لكن المالك قد يريد إيقاف العرض العام بالكامل.)
  if (publicDisplay.getMode() === 'off') {
    return res.status(403).json({ success: false, error: 'العرض العام معطّل من إعدادات المالك' });
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',   // يمنع nginx من تجميع الردود (buffering) فتعطل الوصول اللحظي
  });
  // مهلة إعادة الاتصال التلقائي في المتصفح (EventSource) عند أي انقطاع.
  res.write('retry: 3000\n\n');

  const send = (msg) => {
    try { res.write('data: ' + JSON.stringify(msg) + '\n\n'); } catch (_) {}
  };

  // 1) لقطة أولية عند الاتصال.
  try {
    send(live.snapshot());
  } catch (e) {
    send({ type: 'error', error: e.message });
  }

  // 2) التحديثات اللاحقة (تغييرات فقط).
  const off = live.onUpdate(send);

  // 3) نبض دوري.
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) {}
  }, 25000);

  const cleanup = () => {
    clearInterval(heartbeat);
    off();
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
});

module.exports = router;
