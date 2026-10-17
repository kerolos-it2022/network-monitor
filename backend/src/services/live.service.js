// live.service.js (v2.8.7 · v2.33.0 — إدارة خطوط SSE) — ناقل البثّ الحيّ (SSE) لشاشات العرض.
// ─────────────────────────────────────────────────────────────
// الفكرة: بدل أن تسأل كل شاشة السيرفر كل 10 ثواني (polling) وتاخد الشجرة كاملة كل مرة،
// السيرفر يبني الحالة الحقيقية ويقارنها بالحالة السابقة، ثم يبثّ **ما تغيّر فقط** على
// الخطوط المفتوحة (SSE). المصدر الحقيقي للحالة هو services/topology.service.js
// (نفس شجرة /api/topology وبنفس تمييز pathDown) ⇒ صفر ازدواج للمنطق.
//
// تُنادى scheduleRefresh() بعد كل كتابة لحالة جهاز في محرك المراقبة + في نهاية كل دورة فحص.
// التجميع (debounce) يمنع تكرار إعادة البناء عند فحص عشرات الأجهزة في نفس اللحظة.
//
// v2.33.0 — إدارة الخطوط (كانت مفقودة):
//   • حدّ أقصى عام (NM_SSE_MAX_CLIENTS، افتراضي 100) وحدّ لكل IP (NM_SSE_MAX_PER_IP، افتراضي 10)
//   • ضغط كتابة: عميل بطيء لا يقود لتضخّم الذاكرة — يُسقَط عند تجاوز حدّ المخزون
//     (NM_SSE_MAX_BUFFER، افتراضي 512KB) مع تسجيل وعدّاد
//   • احترام إعداد العرض **لحظيًّا**: تغيير الوضع إلى off يُغلق الخطوط المفتوحة فورًا
//   • إحصاءات (خطوط حالية · أقصى عدد · مُسقَطون · مقفولون بالسياسة · مرفوضون · بايتات)
//     تُعرض في /api/system/stats وتبويب «حالة النظام».
// ─────────────────────────────────────────────────────────────
const EventEmitter = require('events');
const { buildTopology } = require('./topology.service');
const db = require('../db');

const bus = new EventEmitter();
bus.setMaxListeners(0); // عدد الشاشات غير محدود عمليًّا (شاشة لكل قسم/تلفزيون)

let lastState = null;   // { devices:[{id,status,pathDown}], totals:{...} }
let pendingTimer = null;

// ─── حدود الخطوط (قابلة للضبط من البيئة) ───
const MAX_CLIENTS = Math.max(1, Number(process.env.NM_SSE_MAX_CLIENTS) || 100);
const MAX_PER_IP = Math.max(1, Number(process.env.NM_SSE_MAX_PER_IP) || 10);
const MAX_BUFFERED_BYTES = Math.max(64 * 1024, Number(process.env.NM_SSE_MAX_BUFFER) || 512 * 1024);

const clients = new Set();   // { res, ip, closed, startedAt }
const counters = {
  accepted: 0,        // خطوط قُبلت منذ الإقلاع
  peak: 0,            // أقصى عدد خطوط مفتوحة معًا
  droppedSlow: 0,     // أُسقطت لبطء العميل (لا يقرأ)
  closedByPolicy: 0,  // أُغلقت لأن العرض العام صار معطّلًا
  rejectedLimit: 0,   // رُفضت لتجاوز الحدود
  bytesSent: 0,
};

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

// ─── سياسة العرض: هل يُسمح بالبثّ الآن؟ ───
function policyAllows() {
  try {
    const publicDisplay = require('./public-display.service');
    return publicDisplay.getMode() !== 'off';
  } catch (e) {
    return true;   // عند أي شك: لا نُغيّر السلوك القديم
  }
}

// ─── كتابة على خطّ واحد مع حماية من البطء ───
function writeRaw(client, text) {
  if (!client || client.closed) return false;
  let ok = true;
  try { ok = client.res.write(text) !== false; } catch (e) { ok = false; }
  counters.bytesSent += Buffer.byteLength(text);
  // مخزون الكتابة: إن تجاوز الحدّ فالعميل بطيء (لا يقرأ) ⇒ نُسقطه بدل تكديس الذاكرة.
  const buffered = Number((client.res && client.res.writableLength) || 0);
  if (buffered > MAX_BUFFERED_BYTES) { dropClient(client, 'slow'); return false; }
  return ok;
}

function sendEvent(client, obj) {
  return writeRaw(client, 'data: ' + JSON.stringify(obj) + '\n\n');
}

function dropClient(client, reason) {
  if (!client || client.closed) return;
  client.closed = true;
  clients.delete(client);
  if (reason === 'slow') counters.droppedSlow += 1;
  if (reason === 'policy') counters.closedByPolicy += 1;
  try { client.res.end(); } catch (e) { /* الخط مقفول أصلًا */ }
}

// إغلاق كل الخطوط غير المسموح بها الآن (يُنادى من مسار إعدادات العرض + من كل بثّ كحزام أمان).
function applyPolicyNow() {
  if (policyAllows()) return 0;
  let closed = 0;
  for (const c of [...clients]) {
    sendEvent(c, { type: 'closed', reason: 'public-display-off', message: 'أوقف المالك العرض العام — أُغلق البثّ.' });
    dropClient(c, 'policy');
    closed += 1;
  }
  if (closed) console.log(`[live] أُغلقت ${closed} خط بثّ بعد تعطيل العرض العام`);
  return closed;
}

function countForIp(ip) {
  let n = 0;
  for (const c of clients) if (c.ip === ip) n += 1;
  return n;
}

// تسجيل خطّ جديد — يُعيد كائن العميل، أو { rejected } (سياسة/حدود). لا يكتب شيئًا بنفسه.
function addClient(req, res) {
  if (!policyAllows()) return { rejected: 'policy' };
  const ip = String((req && (req.ip || (req.socket && req.socket.remoteAddress))) || 'unknown');
  if (clients.size >= MAX_CLIENTS) { counters.rejectedLimit += 1; return { rejected: 'max-clients', limit: MAX_CLIENTS }; }
  if (countForIp(ip) >= MAX_PER_IP) { counters.rejectedLimit += 1; return { rejected: 'max-per-ip', limit: MAX_PER_IP }; }
  const client = { res, ip, closed: false, startedAt: Date.now() };
  clients.add(client);
  counters.accepted += 1;
  if (clients.size > counters.peak) counters.peak = clients.size;
  return client;
}

function removeClient(client) {
  if (!client || client.closed) return;
  client.closed = true;
  clients.delete(client);
}

function stats() {
  return {
    clients: clients.size,
    peak: counters.peak,
    accepted: counters.accepted,
    droppedSlow: counters.droppedSlow,
    closedByPolicy: counters.closedByPolicy,
    rejectedLimit: counters.rejectedLimit,
    bytesSent: counters.bytesSent,
    maxClients: MAX_CLIENTS,
    maxPerIp: MAX_PER_IP,
    maxBufferedBytes: MAX_BUFFERED_BYTES,
  };
}

// إعادة بناء + مقارنة + بثّ التغييرات فقط.
function refreshLive() {
  if (!policyAllows()) { applyPolicyNow(); return; }   // لا بثّ بعد إيقاف العرض العام
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

// اشتراك/إلغاء اشتراك على مستوى الناقل (للاختبارات والاستخدامات الداخلية).
function onUpdate(fn) {
  bus.on('update', fn);
  return () => bus.off('update', fn);
}

// بثّ داخلي: يوزّع تحديثات الناقل على الخطوط المفتوحة عبر نفس منطق حماية البطء.
bus.on('update', (msg) => {
  const payload = 'data: ' + JSON.stringify(msg) + '\n\n';
  for (const c of [...clients]) writeRaw(c, payload);
});

module.exports = {
  snapshot,
  refreshLive,
  scheduleRefresh,
  onUpdate,
  computeState,
  // v2.33.0 — إدارة الخطوط
  addClient,
  removeClient,
  sendEvent,
  writeRaw,
  applyPolicyNow,
  stats,
  policyAllows,
};
