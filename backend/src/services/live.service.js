// live.service.js (v2.8.7) — ناقل البثّ الحيّ (SSE) لشاشات العرض.
// ─────────────────────────────────────────────────────────────
// الفكرة: بدل أن تسأل كل شاشة السيرفر كل 10 ثواني (polling) وتاخد الشجرة كاملة كل مرة،
// السيرفر يبني الحالة الحقيقية ويقارنها بالحالة السابقة، ثم يبثّ **ما تغيّر فقط** على
// الخطوط المفتوحة (SSE). المصدر الحقيقي للحالة هو services/topology.service.js
// (نفس شجرة /api/topology وبنفس تمييز pathDown) ⇒ صفر ازدواج للمنطق.
//
// تُنادى scheduleRefresh() بعد كل كتابة لحالة جهاز في محرك المراقبة + في نهاية كل دورة فحص.
// التجميع (debounce) يمنع تكرار إعادة البناء عند فحص عشرات الأجهزة في نفس اللحظة.
const EventEmitter = require('events');
const { buildTopology } = require('./topology.service');
const db = require('../db');

const bus = new EventEmitter();
bus.setMaxListeners(0); // عدد الشاشات غير محدود عمليًّا (شاشة لكل قسم/تلفزيون)

let lastState = null;   // { devices:[{id,status,pathDown}], totals:{...} }
let pendingTimer = null;

// تسطيح الشجرة إلى قائمة أجهزة (id/status/pathDown/offlineSince) — نفس ما تعرضه الشاشات.
// v2.13.3: offlineSince = بداية الانقطاع المفتوح (ISO) — تصل للشاشات عبر snapshot/updates.
function flattenDevices(roots) {
  const out = [];
  (function walk(list) {
    for (const n of list) {
      if (n.type === 'device') {
        out.push({
          id: Number(n.id),
          status: n.status,
          pathDown: !!n.pathDown,
          offlineSince: n.offline_since || null,
        });
      }
      if (n.children && n.children.length) walk(n.children);
    }
  })(roots || []);
  return out;
}

// الحالة الحالية + العدّادات (نفس عدّادات NOC: إجمالي/متصل/منقطع/موقوف/مسدود عبر المسار).
function computeState() {
  const devices = flattenDevices(buildTopology());
  return {
    devices,
    totals: {
      total: devices.length,
      up: devices.filter((d) => d.status === 'online').length,
      down: devices.filter((d) => d.status === 'offline').length,
      paused: devices.filter((d) => d.status === 'paused').length,
      path: devices.filter((d) => d.pathDown).length,
    },
  };
}

// لقطة كاملة — تُرسل مرة واحدة عند اتصال أي شاشة (ترتسم فورًا بلا انتظار poll).
function snapshot() {
  const s = computeState();
  lastState = s;
  let nocAlert = true;
  try {
    const r = db.prepare('SELECT noc_alert_screen_enabled AS f FROM notification_settings WHERE id = 1').get();
    if (r && r.f !== undefined && r.f !== null) nocAlert = !!Number(r.f);
  } catch (e) { /* الافتراضي مفعل */ }
  return { type: 'snapshot', devices: s.devices, totals: s.totals, at: new Date().toISOString(), settings: { noc_alert_screen: nocAlert } };
}

// إعادة بناء + مقارنة + بثّ التغييرات فقط.
function refreshLive() {
  const next = computeState();
  if (!lastState) { lastState = next; return; }   // أول تشغيل: نكتفي بحفظ الأساس.
  const prevMap = new Map(lastState.devices.map((d) => [d.id, d]));
  const changed = [];
  for (const d of next.devices) {
    const p = prevMap.get(d.id);
    if (!p || p.status !== d.status || p.pathDown !== d.pathDown || p.offlineSince !== d.offlineSince) changed.push(d);
  }
  const totalsChanged = JSON.stringify(next.totals) !== JSON.stringify(lastState.totals);
  lastState = next;
  if (!changed.length && !totalsChanged) return;   // لا ضجيج بلا تغيير
  bus.emit('update', {
    type: 'update',
    devices: changed,
    totals: next.totals,
    at: new Date().toISOString(),
  });
}

// جدولة تحديث بعد (delay) مللي ثانية — تُستدعى كثيرًا فتتجمّع في تحديث واحد.
function scheduleRefresh(delay = 400) {
  if (pendingTimer) return;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    try {
      refreshLive();
    } catch (e) {
      console.error('[live] refresh error:', e.message);
    }
  }, delay);
  if (pendingTimer.unref) pendingTimer.unref();   // لا يمنع إغلاق العملية
}

// اشتراك/إلغاء اشتراك خط SSE.
function onUpdate(fn) {
  bus.on('update', fn);
  return () => bus.off('update', fn);
}

module.exports = { snapshot, refreshLive, scheduleRefresh, onUpdate, computeState };
