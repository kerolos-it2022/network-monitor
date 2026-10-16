// snmp.service.js (SpaceKit SNMP-01/02) — قراءة SNMP اختيارية للقراءة فقط (معطّلة افتراضيًّا).
// ═══════════════════════════════════════════════════════════════════════════
// المبادئ المُلزِمة من المواصفة:
//   • **opt-in صريح**: لا أي محاولة اتصال قبل تفعيل المالك للـ SNMP وللجهاز تحديدًا
//     (v2c يحتاج تفعيلًا إضافيًّا لأن الرسائل غير مشفّرة).
//   • **قراءة فقط**: استدعاءات get فقط — لا set ولا أي كتابة على الأجهزة.
//   • قياسات صادقة: عند تصفير/إعادة تشغيل العدّادات لا نُنتج معدّلًا مُختلَقًا (null) ولا قيمًا سالبة؛
//     ويُعالَج التفاف العدّادات 32/64-bit عبر BigInt.
//   • الواجهات غير المدعومة (PoE مثلًا) تُعلَن «غير مدعومة» ولا تُختلق لها أرقام.
// الدوال النقية (computeRate/parseOperStatus/oidKeyToIndex/formatBps) قابلة للاختبار مباشرة،
// وجلسة SNMP تُحقَن (sessionFactory) ⇒ الاختبار بلا أي جهاز حقيقي.
'use strict';
const db = require('../../db');

const OIDS = {
  ifName: '1.3.6.1.2.1.31.1.1.1.1',
  ifDescr: '1.3.6.1.2.1.2.2.1.2',
  ifOperStatus: '1.3.6.1.2.1.2.2.1.8',
  ifSpeed: '1.3.6.1.2.1.2.2.1.5',
  ifHighSpeed: '1.3.6.1.2.1.31.1.1.1.15',
  ifHCInOctets: '1.3.6.1.2.1.31.1.1.1.6',
  ifHCOutOctets: '1.3.6.1.2.1.31.1.1.1.10',
  ifInOctets: '1.3.6.1.2.1.2.2.1.10',
  ifOutOctets: '1.3.6.1.2.1.2.2.1.16',
  ifInErrors: '1.3.6.1.2.1.2.2.1.14',
  ifOutErrors: '1.3.6.1.2.1.2.2.1.20',
  ifInDiscards: '1.3.6.1.2.1.2.2.1.13',
  ifOutDiscards: '1.3.6.1.2.1.2.2.1.19',
  ifAlias: '1.3.6.1.2.1.31.1.1.1.18',
};

const OPER_STATUS = { 1: 'up', 2: 'down', 3: 'testing', 4: 'unknown', 5: 'dormant', 6: 'notPresent', 7: 'lowerLayerDown' };
function parseOperStatus(code) {
  return OPER_STATUS[Number(code)] || 'unknown';
}

// آخر رقم في OID = فهرس الواجهة (ifIndex).
function oidKeyToIndex(oidKey) {
  const parts = String(oidKey || '').split('.');
  const last = Number(parts[parts.length - 1]);
  return Number.isInteger(last) ? last : null;
}

// ═══ حساب المعدّل مع معالجة الالتفاف/التصفير (نقي) ═══
//   prev/curr: قيم العدّاد (رقم أو نص لأعداد 64-bit) · elapsedMs: الزمن بين القراءتين
//   bits: 32 أو 64. يُرجع بت/ثانية (عدد) أو null عند غياب دليل صالح.
//   القواعد: بلا قراءة سابقة أو بزمن غير موجب ⇒ null · تصفير/إعادة تشغيل ⇒ null (لا سبايك)
//   · التفاف (curr < prev) ⇒ يُحتسب الفرق داخل سعة العدّاد إن كان معقولًا، وإلا null · لا قيم سالبة.
function computeRate({ prev, curr, elapsedMs, bits = 64 }) {
  if (prev == null || curr == null) return null;
  if (!Number.isFinite(Number(elapsedMs)) || Number(elapsedMs) <= 0) return null;
  let p;
  let c;
  try {
    p = BigInt(String(prev).trim());
    c = BigInt(String(curr).trim());
  } catch (_) {
    return null;
  }
  if (p < 0n || c < 0n) return null;
  const wrapMax = bits === 32 ? (2n ** 32n) : (2n ** 64n);

  let delta;
  if (c >= p) {
    delta = c - p;
  } else {
    // curr < prev ⇒ إما التفاف وإما تصفير (إعادة تشغيل/إعادة ضبط العدّاد).
    const wrapped = wrapMax - p + c;
    // لو «الفرق بالالتفاف» أكبر من نصف سعة العدّاد فالأرجح تصفير ⇒ لا معدّل مُختلَق.
    if (wrapped > wrapMax / 2n) return null;
    delta = wrapped;
  }
  if (delta === 0n) return 0;
  const seconds = Number(elapsedMs) / 1000;
  const bitsPerSecond = (Number(delta) * 8) / seconds;
  if (!Number.isFinite(bitsPerSecond) || bitsPerSecond < 0) return null;
  return Math.round(bitsPerSecond);
}

// عرض مقروء للمعدّل (لا تُختلق وحدات غير معروفة).
function formatBps(bps) {
  if (bps == null || !Number.isFinite(Number(bps))) return '—';
  const v = Number(bps);
  if (v < 1000) return v + ' bps';
  if (v < 1e6) return (v / 1e3).toFixed(1) + ' Kbps';
  if (v < 1e9) return (v / 1e6).toFixed(1) + ' Mbps';
  return (v / 1e9).toFixed(2) + ' Gbps';
}

// ── إعدادات SNMP (opt-in) ──
function getSettings() {
  try {
    return db.prepare('SELECT * FROM snmp_settings WHERE id = 1').get() || { enabled: 0, allow_v2c: 0, interval_seconds: 60 };
  } catch (_) {
    return { enabled: 0, allow_v2c: 0, interval_seconds: 60 };
  }
}

function isEnabled() {
  return !!getSettings().enabled;
}

// هدف جاهز للمحاولة؟ (الـ SNMP مفعّل عامًّا + الجهاز مفعّل + الإعدادات مكتملة + v2c مسموح إن لزم)
function isTargetReady(target) {
  const s = getSettings();
  if (!s.enabled || !target || !target.enabled) return false;
  if (String(target.version) === '2c') {
    if (!s.allow_v2c) return false;
    return !!(target.community && String(target.community).length);
  }
  return !!(target.security_name && target.auth_key && target.priv_key);
}

// ── CRUD للأهداف (الأسرار لا تُعاد أبدًا — تُقنَّع) ──
const MASK = '••••••';
function maskTarget(t) {
  if (!t) return null;
  return {
    id: t.id,
    device_id: t.device_id,
    version: t.version,
    enabled: !!t.enabled,
    security_name: t.security_name || null,
    auth_protocol: t.auth_protocol || null,
    priv_protocol: t.priv_protocol || null,
    community_set: !!t.community,
    auth_key_set: !!t.auth_key,
    priv_key_set: !!t.priv_key,
    last_poll_at: t.last_poll_at,
    last_error: t.last_error,
  };
}

function listTargets() {
  return db.prepare(
    `SELECT t.*, d.name AS device_name, d.ip AS device_ip
       FROM snmp_targets t LEFT JOIN devices d ON d.id = t.device_id ORDER BY t.id ASC`
  ).all().map((t) => Object.assign(maskTarget(t), { device_name: t.device_name, device_ip: t.device_ip }));
}

function upsertTarget(deviceId, body = {}) {
  const dev = db.prepare('SELECT id FROM devices WHERE id = ?').get(deviceId);
  if (!dev) return { ok: false, error: 'الجهاز غير موجود' };
  const s = getSettings();
  const version = String(body.version || '3') === '2c' ? '2c' : '3';
  if (version === '2c' && !s.allow_v2c) {
    return { ok: false, error: 'SNMP v2c غير مسموح — فعّله صريحًا من إعدادات SNMP (رسائله غير مشفّرة).' };
  }
  const current = db.prepare('SELECT * FROM snmp_targets WHERE device_id = ?').get(deviceId) || {};
  // الأسرار: القيمة الفارغة/المقنّعة تُبقي القديمة (لا تمسحها بالخطأ).
  const keepOr = (incoming, old) => {
    if (incoming === null) return null;
    const v = typeof incoming === 'string' ? incoming.trim() : '';
    if (!v || v === MASK) return old || null;
    return v;
  };
  const row = {
    version,
    security_name: body.security_name !== undefined ? (String(body.security_name).trim() || null) : (current.security_name || null),
    auth_protocol: body.auth_protocol !== undefined ? (String(body.auth_protocol).trim() || null) : (current.auth_protocol || null),
    priv_protocol: body.priv_protocol !== undefined ? (String(body.priv_protocol).trim() || null) : (current.priv_protocol || null),
    auth_key: keepOr(body.auth_key, current.auth_key),
    priv_key: keepOr(body.priv_key, current.priv_key),
    community: keepOr(body.community, current.community),
    enabled: body.enabled ? 1 : 0,
  };
  db.prepare(
    `INSERT INTO snmp_targets (device_id, version, security_name, auth_protocol, auth_key, priv_protocol, priv_key, community, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(device_id) DO UPDATE SET
       version = excluded.version, security_name = excluded.security_name, auth_protocol = excluded.auth_protocol,
       auth_key = excluded.auth_key, priv_protocol = excluded.priv_protocol, priv_key = excluded.priv_key,
       community = excluded.community, enabled = excluded.enabled`
  ).run(
    deviceId, row.version, row.security_name, row.auth_protocol, row.auth_key,
    row.priv_protocol, row.priv_key, row.community, row.enabled
  );
  return { ok: true, target: maskTarget(db.prepare('SELECT * FROM snmp_targets WHERE device_id = ?').get(deviceId)) };
}

function removeTarget(deviceId) {
  const info = db.prepare('DELETE FROM snmp_targets WHERE device_id = ?').run(deviceId);
  db.prepare('DELETE FROM snmp_interfaces WHERE device_id = ?').run(deviceId);
  return { ok: true, removed: info.changes };
}

// ── واجهات مخزَّنة ──
function listInterfaces(deviceId) {
  return db.prepare(
    `SELECT if_index, if_name, if_descr, oper_status, speed_bps,
            in_octets, out_octets, in_rate_bps, out_rate_bps,
            in_errors, out_errors, in_discards, out_discards, polled_at
       FROM snmp_interfaces WHERE device_id = ? ORDER BY if_index ASC`
  ).all(deviceId).map((r) => Object.assign(r, {
    oper_status_text: parseOperStatus(r.oper_status),
    in_rate_text: formatBps(r.in_rate_bps),
    out_rate_text: formatBps(r.out_rate_bps),
    // PoE: غير مدعوم في هذه النسخة — يُعلَن صريحًا بدل اختلاق أرقام.
    poe_supported: false,
  }));
}

// ── الاستطلاع (القراءة) ──
// sessionFactory(snmpOptions) ⇒ جلسة بها get({oids:[...]}, cb) و close() — تُحقَن في الاختبار.
function defaultSessionFactory(options) {
  const snmp = require('snmp-native');
  return new snmp.Session(options);
}

function sessionOptionsFor(target, device) {
  const base = { host: device.ip, timeout: 5000, retries: 1 };
  if (String(target.version) === '2c') {
    return Object.assign(base, { version: '2c', community: target.community });
  }
  return Object.assign(base, {
    version: '3',
    username: target.security_name,
    authProtocol: target.auth_protocol || 'sha',
    authKey: target.auth_key,
    privProtocol: target.priv_protocol || 'aes',
    privKey: target.priv_key,
  });
}

function getVarbinds(session, oids) {
  return new Promise((resolve, reject) => {
    session.get({ oids }, (err, varbinds) => (err ? reject(err) : resolve(varbinds || [])));
  });
}

// pollDevice(deviceId, { sessionFactory, nowMs }) — يقرأ الواجهات ويحدّث الجدول.
// يُرجع { ok, interfaces } أو { ok:false, error } — ولا يرمي أبدًا للخارج.
async function pollDevice(deviceId, { sessionFactory = defaultSessionFactory, nowMs = Date.now() } = {}) {
  const device = db.prepare('SELECT id, name, ip FROM devices WHERE id = ?').get(deviceId);
  if (!device) return { ok: false, error: 'الجهاز غير موجود' };
  const target = db.prepare('SELECT * FROM snmp_targets WHERE device_id = ?').get(deviceId);
  if (!isTargetReady(target)) return { ok: false, error: 'هدف SNMP غير جاهز (غير مفعّل أو إعداداته ناقصة)' };

  let session = null;
  const nowIso = new Date(nowMs).toISOString();
  try {
    session = sessionFactory(sessionOptionsFor(target, device));
    const oidList = [
      OIDS.ifName, OIDS.ifDescr, OIDS.ifOperStatus, OIDS.ifSpeed, OIDS.ifHighSpeed,
      OIDS.ifHCInOctets, OIDS.ifHCOutOctets, OIDS.ifInOctets, OIDS.ifOutOctets,
      OIDS.ifInErrors, OIDS.ifOutErrors, OIDS.ifInDiscards, OIDS.ifOutDiscards,
    ];
    const varbinds = await getVarbinds(session, oidList);

    // تجميع القيم لكل فهرس واجهة.
    const byIndex = new Map();
    const ensure = (idx) => {
      if (!byIndex.has(idx)) byIndex.set(idx, {});
      return byIndex.get(idx);
    };
    for (const vb of varbinds) {
      if (!vb || vb.value == null) continue;
      const key = String(vb.oid || '');
      const idx = oidKeyToIndex(key);
      if (idx == null) continue;
      const entry = ensure(idx);
      if (key.startsWith(OIDS.ifName + '.')) entry.if_name = String(vb.value);
      else if (key.startsWith(OIDS.ifDescr + '.')) entry.if_descr = String(vb.value);
      else if (key.startsWith(OIDS.ifOperStatus + '.')) entry.oper_status = Number(vb.value);
      else if (key.startsWith(OIDS.ifHighSpeed + '.')) entry.speed_bps = Number(vb.value) * 1e6;
      else if (key.startsWith(OIDS.ifSpeed + '.') && entry.speed_bps == null) entry.speed_bps = Number(vb.value);
      else if (key.startsWith(OIDS.ifHCInOctets + '.')) entry.in_octets = String(vb.value);
      else if (key.startsWith(OIDS.ifHCOutOctets + '.')) entry.out_octets = String(vb.value);
      else if (key.startsWith(OIDS.ifInOctets + '.') && entry.in_octets == null) entry.in_octets = String(vb.value);
      else if (key.startsWith(OIDS.ifOutOctets + '.') && entry.out_octets == null) entry.out_octets = String(vb.value);
      else if (key.startsWith(OIDS.ifInErrors + '.')) entry.in_errors = String(vb.value);
      else if (key.startsWith(OIDS.ifOutErrors + '.')) entry.out_errors = String(vb.value);
      else if (key.startsWith(OIDS.ifInDiscards + '.')) entry.in_discards = String(vb.value);
      else if (key.startsWith(OIDS.ifOutDiscards + '.')) entry.out_discards = String(vb.value);
    }

    const prevByIndex = new Map();
    for (const row of db.prepare('SELECT if_index, in_octets, out_octets, polled_at FROM snmp_interfaces WHERE device_id = ?').all(deviceId)) {
      prevByIndex.set(row.if_index, row);
    }

    const upsert = db.prepare(
      `INSERT INTO snmp_interfaces
         (device_id, if_index, if_name, if_descr, oper_status, speed_bps, in_octets, out_octets,
          in_rate_bps, out_rate_bps, in_errors, out_errors, in_discards, out_discards, polled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(device_id, if_index) DO UPDATE SET
         if_name = excluded.if_name, if_descr = excluded.if_descr, oper_status = excluded.oper_status,
         speed_bps = excluded.speed_bps, in_octets = excluded.in_octets, out_octets = excluded.out_octets,
         in_rate_bps = excluded.in_rate_bps, out_rate_bps = excluded.out_rate_bps,
         in_errors = excluded.in_errors, out_errors = excluded.out_errors,
         in_discards = excluded.in_discards, out_discards = excluded.out_discards, polled_at = excluded.polled_at`
    );

    let count = 0;
    const tx = db.transaction(() => {
      for (const [idx, e] of byIndex.entries()) {
        const prev = prevByIndex.get(idx) || null;
        const elapsedMs = prev && prev.polled_at ? (nowMs - new Date(prev.polled_at).getTime()) : null;
        const bits = e.in_octets != null && String(e.in_octets).length > 10 ? 64 : 32;  // HC (64-bit) إن توفّر
        const inRate = prev ? computeRate({ prev: prev.in_octets, curr: e.in_octets, elapsedMs, bits }) : null;
        const outRate = prev ? computeRate({ prev: prev.out_octets, curr: e.out_octets, elapsedMs, bits }) : null;
        upsert.run(
          deviceId, idx, e.if_name || null, e.if_descr || null,
          e.oper_status == null ? null : e.oper_status, e.speed_bps == null ? null : e.speed_bps,
          e.in_octets == null ? null : String(e.in_octets), e.out_octets == null ? null : String(e.out_octets),
          inRate, outRate,
          e.in_errors == null ? null : String(e.in_errors), e.out_errors == null ? null : String(e.out_errors),
          e.in_discards == null ? null : String(e.in_discards), e.out_discards == null ? null : String(e.out_discards),
          nowIso
        );
        count += 1;
      }
      db.prepare('UPDATE snmp_targets SET last_poll_at = ?, last_error = NULL WHERE device_id = ?').run(nowIso, deviceId);
    });
    tx();
    return { ok: true, interfaces: count, at: nowIso };
  } catch (e) {
    const msg = String(e && e.message ? e.message : e).slice(0, 200);
    try {
      db.prepare('UPDATE snmp_targets SET last_poll_at = ?, last_error = ? WHERE device_id = ?').run(nowIso, msg, deviceId);
    } catch (_) { /* تجاهل */ }
    return { ok: false, error: msg };
  } finally {
    try { if (session && typeof session.close === 'function') session.close(); } catch (_) { /* تجاهل */ }
  }
}

// استطلاع كل الأهداف الجاهزة (يُنادى من المجدول) — بحد تزامن صغير.
async function pollAll({ sessionFactory = defaultSessionFactory, nowMs = Date.now() } = {}) {
  const s = getSettings();
  if (!s.enabled) return { skipped: true, reason: 'snmp-disabled' };
  const targets = db.prepare('SELECT * FROM snmp_targets WHERE enabled = 1').all();
  const results = [];
  for (const t of targets) {
    if (!isTargetReady(t)) { results.push({ device_id: t.device_id, ok: false, error: 'غير جاهز' }); continue; }
    // eslint-disable-next-line no-await-in-loop — تسلسل مقصود (حمل منخفض على الأجهزة)
    results.push(Object.assign({ device_id: t.device_id }, await pollDevice(t.device_id, { sessionFactory, nowMs })));
  }
  return { skipped: false, polled: results.length, results };
}

// المجدول: كل interval_seconds ثانية (يُنادى من server.js — يصمت تمامًا إن كان معطّلًا).
let timer = null;
function startScheduler() {
  if (timer) return;
  const tick = async () => {
    const s = getSettings();
    if (!s.enabled) return;
    try {
      const r = await pollAll();
      if (r.polled) console.log(`[snmp] polled ${r.polled} target(s)`);
    } catch (e) {
      console.error('[snmp] poll error:', e.message);
    }
  };
  const every = Math.max(30, Number(getSettings().interval_seconds) || 60) * 1000;
  timer = setInterval(tick, every);
  if (timer.unref) timer.unref();
  console.log(`SNMP scheduler started (every ${every / 1000}s · معطّل ما لم يُفعّل المالك أهدافًا).`);
}

module.exports = {
  OIDS,
  parseOperStatus,
  oidKeyToIndex,
  computeRate,
  formatBps,
  getSettings,
  isEnabled,
  isTargetReady,
  maskTarget,
  listTargets,
  upsertTarget,
  removeTarget,
  listInterfaces,
  pollDevice,
  pollAll,
  startScheduler,
};
