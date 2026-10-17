// live.routes.js (v2.8.7 · v2.33.0) — بثّ حالة الأجهزة لحظيًا عبر SSE (Server-Sent Events).
// GET /api/live/status — مسار **عام للقراءة فقط** (بلا auth) بنفس مستوى /api/topology:
//   • عند الاتصال: رسالة {type:'snapshot'} فيها حالات كل الأجهزة + العدّادات.
//   • بعدها: رسائل {type:'update'} بالتغييرات فقط (يُبثّها live.service بعد كل دورة فحص).
//   • نبض كل 25 ثانية (تعليق ': ping') لإبقاء الخط حيًّا عبر nginx/الجدران النارية.
// ملاحظة تشغيل: لا يوجد أي كتابة على هذه القناة — كل التعديلات تبقى على REST بجلسة الأدمن.
//
// v2.33.0 — الخطوط تُدار من الخدمة (live.service):
//   • حدود: حدّ عام (NM_SSE_MAX_CLIENTS، افتراضي 100) + حدّ لكل IP (افتراضي 10) ⇒ الردّ 503
//     (وEventSource يعيد المحاولة تلقائيًّا حسب retry).
//   • عميل بطيء لا يقرأ ⇒ يُسقطه السيرفر بدل تكديس الذاكرة (عدّاد droppedSlow).
//   • إعداد العرض العام يُحترم **لحظيًّا**: الوضع off يمنع الاتصال، وتغييره يُغلق الخطوط المفتوحة
//     فورًا بعد إرسال {type:'closed'} — فالشاشة توضّح السبب بدل أن تجمُد.
//   • الحمولة كما هي بلا IP/MAC/أسماء ⇒ الشاشات لا تحتاج أي تغيير في القراءة.
const express = require('express');
const router = express.Router();
const live = require('../services/live.service');
const publicDisplay = require('../services/public-display.service');

const HEARTBEAT_MS = 25000;

router.get('/status', (req, res) => {
  // SEC-02 — يحترم وضع العرض العام: 'off' ⇒ لا بثّ للمجهول.
  // (الحمولة لا تحوي IP/MAC أصلًا، لكن المالك قد يريد إيقاف العرض العام بالكامل.)
  if (publicDisplay.getMode() === 'off') {
    return res.status(403).json({ success: false, error: 'العرض العام معطّل من إعدادات المالك' });
  }

  // حجز خطّ (حدود عامة/لكل IP) — الرد 503 فيتولّى EventSource إعادة المحاولة تلقائيًّا.
  const client = live.addClient(req, res);
  if (!client || client.rejected) {
    const why = (client && client.rejected === 'policy')
      ? 'العرض العام معطّل من إعدادات المالك'
      : 'عدد خطوط البثّ وصل الحدّ الأقصى — أعد المحاولة بعد قليل';
    return res.status(503).set('Retry-After', '10').json({ success: false, error: why });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',   // يمنع nginx من تجميع الردود (buffering) فتعطل الوصول اللحظي
  });
  // مهلة إعادة الاتصال التلقائي في المتصفح (EventSource) عند أي انقطاع.
  live.writeRaw(client, 'retry: 3000\n\n');

  // 1) لقطة أولية عند الاتصال.
  try {
    live.sendEvent(client, live.snapshot());
  } catch (e) {
    live.sendEvent(client, { type: 'error', error: e.message });
  }

  // 2) نبض دوري (يمرّ بنفس حماية البطء ⇒ عميل لا يقرأ يُسقَط بدل تكديس الذاكرة).
  const heartbeat = setInterval(() => {
    if (client.closed) return;
    live.writeRaw(client, ': ping\n\n');
  }, HEARTBEAT_MS);

  // 3) تنظيف عند إغلاق الخطّ من العميل (تنقّل/إغلاق تاب/انقطاع شبكة).
  const cleanup = () => {
    clearInterval(heartbeat);
    live.removeClient(client);
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
});

module.exports = router;
