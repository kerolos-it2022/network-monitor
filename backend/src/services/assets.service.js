// assets.service.js (SpaceKit AST-01/02/03) — الهوية الثابتة للأصول: معرّف دائم + MAC + سجل IP + تعارضات.
// ═══════════════════════════════════════════════════════════════════════════
// القواعد المُلزِمة من المواصفة:
//   • devices.id يبقى المفتاح التقني الثابت؛ نُضيف **asset_id** خارجيًّا بشريًّا (NM-000123)
//     لا يتغيّر أبدًا ولا يُعاد استخدامه بعد حذف/أرشفة الجهاز (عدّاد متزايد في app_settings).
//   • جهاز واحد قد يملك عدة MAC (واي-فاي + إيثرنت + وهمي) — كلها في device_interfaces.
//   • سجل IP بتاريخ صلاحية (valid_from/valid_to): تغيّر العنوان يُغلق الفترة القديمة ويفتح أخرى.
//   • ⚠️ **لا دمج تلقائي أبدًا**: تشابه/تكرار IP لا يكفي — يُنشأ تعارض في قائمة مراجعة،
//     والقرار للمدير (approve/reject) مع تدقيق كامل. ولا تُحذف سجلات تاريخية — الإيقاف فقط.
// الدوال النقية (normalizeMac/isValidIpv4/decideEvidence) قابلة للاختبار مباشرة.
'use strict';
const db = require('../db');

const ASSET_SEQ_KEY = 'asset_id_seq';

// ── أدوات نقية ──
function normalizeMac(mac) {
  const hex = String(mac || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length !== 12) return null;
  return hex.match(/.{2}/g).join(':');
}

function isValidIpv4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || ''));
  if (!m) return false;
  return m.slice(1).every((p) => Number(p) <= 255 && String(Number(p)) === p);
}

function formatAssetId(seq) {
  return 'NM-' + String(seq).padStart(6, '0');
}

// خريطة أنواع الـ MAC الشائعة (OUI بسيط للتمييز — ليست تصنيفًا حاسمًا).
const VIRTUAL_OUI_PREFIXES = ['00:50:56', '00:0c:29', '00:05:69', '00:1c:14', '52:54:00', '02:42', '0a:00:27'];
function guessMacKind(mac) {
  const m = normalizeMac(mac);
  if (!m) return 'unknown';
  if (VIRTUAL_OUI_PREFIXES.some((p) => m.startsWith(p))) return 'virtual';
  return 'unknown'; // التمييز بين ethernet/wifi يحتاج بيانات إضافية من الاكتشاف
}

// قرار الأدلة (نقي): هل يتعلّق الاكتشاف بجهاز معروف؟ بأي ثقة؟
//   evidence: { ip, mac, hostname }
//   known: { byIp: Map(ip → [{device_id, valid_to}]), byMac: Map(mac → [{device_id, is_active}]) }
// يُرجع: { action: 'attach'|'review'|'new', deviceId, confidence, reasons:[] }
function decideEvidence({ ip, mac, hostname }, known) {
  const macNorm = normalizeMac(mac);
  const ipHits = ip ? (known.byIp.get(ip) || []) : [];
  const macHits = macNorm ? (known.byMac.get(macNorm) || []) : [];
  const reasons = [];

  const openIpHit = ipHits.find((r) => r.valid_to == null);
  const activeMacHit = macHits.find((r) => r.is_active);

  // MAC معروف ونشط + نفس الجهاز ⇒ إرفاق مباشر بثقة عالية (دليل قوي ثابت).
  if (activeMacHit && (!openIpHit || openIpHit.device_id === activeMacHit.device_id)) {
    reasons.push('mac_active_match');
    return { action: 'attach', deviceId: activeMacHit.device_id, confidence: 90, reasons };
  }
  // MAC معروف لجهاز، لكن الـ IP مفتوح على جهاز آخر ⇒ تعارض يستوجب المراجعة (لا دمج تلقائي).
  if (activeMacHit && openIpHit && openIpHit.device_id !== activeMacHit.device_id) {
    reasons.push('mac_ip_conflict');
    return { action: 'review', kind: 'suggested_merge', deviceId: openIpHit.device_id, otherDeviceId: activeMacHit.device_id, confidence: 60, reasons };
  }
  // الـ IP مفتوح على جهاز الآن — لكن بلا دليل MAC ⇒ إرفاق بثقة متوسطة (قد يكون DHCP أعاد التوزيع).
  if (openIpHit) {
    reasons.push('ip_open_match');
    if (macNorm) {
      // MAC مختلف تمامًا وجهاز معروف بنفس الـ IP ⇒ غالبًا **إعادة استخدام عنوان** (لا دمج).
      const macOnOther = known.byMac.get(macNorm) || [];
      const otherDevice = macOnOther.find((r) => r.device_id !== openIpHit.device_id && r.is_active);
      if (otherDevice) {
        reasons.push('ip_reused_by_other_mac');
        return { action: 'review', kind: 'ip_reused', deviceId: openIpHit.device_id, otherDeviceId: otherDevice.device_id, confidence: 40, reasons };
      }
    }
    return { action: 'attach', deviceId: openIpHit.device_id, confidence: 50, reasons };
  }
  // الـ IP مُغلق تاريخيًّا لجهاز آخر ⇒ إعادة استخدام عنوان (لا نربطه بالقديم).
  const closedIpHit = ipHits.find((r) => r.device_id != null);
  if (closedIpHit) {
    reasons.push('ip_historical_elsewhere');
    if (macNorm && (known.byMac.get(macNorm) || []).length) {
      return { action: 'review', kind: 'ip_reused', deviceId: closedIpHit.device_id, confidence: 40, reasons };
    }
    return { action: 'new', confidence: 50, reasons, historicalDeviceId: closedIpHit.device_id };
  }
  reasons.push('no_evidence');
  return { action: 'new', confidence: 30, reasons };
}

// ── الهوية الثابتة ──
function nextAssetSeq() {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(ASSET_SEQ_KEY);
  let seq = row ? parseInt(row.value, 10) || 0 : 0;
  // أمان إضافي: لا نقل عن أعلى معرّف موجود فعلًا (لو عُدّل العدّاد يدويًّا).
  const maxRow = db.prepare("SELECT MAX(CAST(SUBSTR(asset_id, 4) AS INTEGER)) AS m FROM devices WHERE asset_id LIKE 'NM-%'").get();
  if (maxRow && Number(maxRow.m) > seq) seq = Number(maxRow.m);
  return seq + 1;
}

function bumpAssetSeq(seq) {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(ASSET_SEQ_KEY, String(seq), new Date().toISOString());
}

function assignAssetId(deviceId) {
  const dev = db.prepare('SELECT id, asset_id FROM devices WHERE id = ?').get(deviceId);
  if (!dev) return null;
  if (dev.asset_id) return dev.asset_id;
  const seq = nextAssetSeq();
  db.prepare('UPDATE devices SET asset_id = ? WHERE id = ?').run(formatAssetId(seq), deviceId);
  bumpAssetSeq(seq);
  return formatAssetId(seq);
}

function getByAssetId(assetId) {
  return db.prepare('SELECT * FROM devices WHERE asset_id = ?').get(assetId);
}

// مهمة إقلاع idempotent: تمنح asset_id لكل جهاز بلا معرّف، وتُهيّئ سجل IP الابتدائي.
function ensureAssetIds({ nowIso = new Date().toISOString() } = {}) {
  const missing = db.prepare("SELECT id, ip, created_at FROM devices WHERE asset_id IS NULL OR asset_id = ''").all();
  let assigned = 0;
  let ipSeeded = 0;
  for (const d of missing) {
    assignAssetId(d.id);
    assigned += 1;
  }
  // سجل IP ابتدائي للجهاز الحالي (إن لم يكن له أي سجل) — مصدره manual بثقة عالية.
  const noHistory = db.prepare(
    `SELECT d.id, d.ip, d.created_at FROM devices d
      WHERE NOT EXISTS (SELECT 1 FROM device_ip_history h WHERE h.device_id = d.id)`
  ).all();
  for (const d of noHistory) {
    if (!isValidIpv4(d.ip)) continue;
    db.prepare(
      `INSERT INTO device_ip_history (device_id, ip, source, confidence, first_seen_at, last_seen_at, valid_from, valid_to)
       VALUES (?, ?, 'manual', 100, ?, ?, ?, NULL)`
    ).run(d.id, d.ip, d.created_at || nowIso, nowIso, d.created_at || nowIso);
    ipSeeded += 1;
  }
  // استيراد MAC من نتائج الاكتشاف المطابقة بالـ IP (دليل متوسط — بلا دمج أو حذف).
  const macsToSeed = db.prepare(
    `SELECT dd.ip, dd.mac FROM discovered_devices dd WHERE dd.mac IS NOT NULL AND dd.mac != ''`
  ).all();
  let ifaces = 0;
  for (const row of macsToSeed) {
    const mac = normalizeMac(row.mac);
    if (!mac) continue;
    const dev = db.prepare(
      `SELECT device_id FROM device_ip_history WHERE ip = ? AND valid_to IS NULL LIMIT 1`
    ).get(row.ip);
    if (!dev) continue;
    try {
      const info = db.prepare(
        `INSERT OR IGNORE INTO device_interfaces (device_id, mac, kind, source, confidence, notes)
         VALUES (?, ?, ?, 'scan', 60, 'مستورد من نتائج الاكتشاف عند الترقية')`
      ).run(dev.device_id, mac, guessMacKind(mac));
      if (info.changes) ifaces += 1;
    } catch (_) { /* تجاهل الصفوف المكررة */ }
  }
  return { assigned, ipSeeded, interfacesSeeded: ifaces };
}

// ── سجل IP ──
// recordIp(deviceId, ip, {source, confidence, atIso}): يُغلق أي عنوان مفتوح مختلف ويفتح الجديد.
function recordIp(deviceId, ip, { source = 'manual', confidence = 100, atIso = new Date().toISOString() } = {}) {
  if (!isValidIpv4(ip)) return { ok: false, error: 'IP غير صالح' };
  const current = db.prepare(
    'SELECT * FROM device_ip_history WHERE device_id = ? AND valid_to IS NULL ORDER BY id DESC LIMIT 1'
  ).get(deviceId);
  if (current && current.ip === ip) {
    db.prepare('UPDATE device_ip_history SET last_seen_at = ? WHERE id = ?').run(atIso, current.id);
    return { ok: true, changed: false, id: current.id };
  }
  if (current) {
    db.prepare('UPDATE device_ip_history SET valid_to = ?, last_seen_at = ? WHERE id = ?').run(atIso, atIso, current.id);
  }
  const info = db.prepare(
    `INSERT INTO device_ip_history (device_id, ip, source, confidence, first_seen_at, last_seen_at, valid_from, valid_to)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
  ).run(deviceId, ip, source, confidence, atIso, atIso, atIso);
  return { ok: true, changed: true, id: info.lastInsertRowid, previousIp: current ? current.ip : null };
}

function getIpTimeline(deviceId) {
  return db.prepare(
    `SELECT id, ip, source, confidence, first_seen_at, last_seen_at, valid_from, valid_to
       FROM device_ip_history WHERE device_id = ? ORDER BY COALESCE(valid_from, first_seen_at) DESC, id DESC`
  ).all(deviceId);
}

// ── الواجهات (MAC) ──
function addInterface(deviceId, mac, { kind = null, source = 'manual', confidence = 60, notes = null } = {}) {
  const norm = normalizeMac(mac);
  if (!norm) return { ok: false, error: 'صيغة MAC غير صالحة (مثال: AA:BB:CC:DD:EE:FF)' };
  const existing = db.prepare('SELECT * FROM device_interfaces WHERE device_id = ? AND mac = ?').get(deviceId, norm);
  if (existing) {
    db.prepare('UPDATE device_interfaces SET last_seen_at = ?, is_active = 1 WHERE id = ?').run(new Date().toISOString(), existing.id);
    return { ok: true, id: existing.id, reactivated: true };
  }
  const info = db.prepare(
    `INSERT INTO device_interfaces (device_id, mac, kind, source, confidence, notes)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(deviceId, norm, kind || guessMacKind(norm), source, confidence, notes);
  return { ok: true, id: info.lastInsertRowid };
}

function listInterfaces(deviceId) {
  return db.prepare(
    'SELECT * FROM device_interfaces WHERE device_id = ? ORDER BY is_active DESC, id ASC'
  ).all(deviceId);
}

// الإيقاف لا يحذف (تاريخ محفوظ) — AST-03.
function deactivateInterface(deviceId, interfaceId) {
  const row = db.prepare('SELECT * FROM device_interfaces WHERE id = ? AND device_id = ?').get(interfaceId, deviceId);
  if (!row) return { ok: false, error: 'الواجهة غير موجودة على هذا الجهاز' };
  db.prepare('UPDATE device_interfaces SET is_active = 0, last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), interfaceId);
  return { ok: true, mac: row.mac };
}

// ── التعارضات ──
function createConflict({ kind, subjectDeviceId, otherDeviceId = null, evidence = {} }) {
  // منع تكرار نفس التعارض المفتوح.
  const dup = db.prepare(
    "SELECT id FROM asset_conflicts WHERE status = 'open' AND kind = ? AND subject_device_id = ? AND IFNULL(other_device_id, 0) = IFNULL(?, 0)"
  ).get(kind, subjectDeviceId, otherDeviceId);
  if (dup) return { id: dup.id, duplicated: true };
  const info = db.prepare(
    `INSERT INTO asset_conflicts (kind, subject_device_id, other_device_id, evidence_json)
     VALUES (?, ?, ?, ?)`
  ).run(kind, subjectDeviceId, otherDeviceId, JSON.stringify(evidence || {}));
  return { id: info.lastInsertRowid, duplicated: false };
}

function listConflicts({ status = 'open', limit = 50 } = {}) {
  const lim = Math.min(200, Math.max(1, Number(limit) || 50));
  const rows = status === 'all'
    ? db.prepare('SELECT * FROM asset_conflicts ORDER BY id DESC LIMIT ?').all(lim)
    : db.prepare("SELECT * FROM asset_conflicts WHERE status = 'open' ORDER BY id DESC LIMIT ?").all(lim);
  const nameOf = new Map(
    db.prepare('SELECT id, name, ip, asset_id FROM devices').all().map((d) => [Number(d.id), d])
  );
  const describe = (id) => {
    const d = id != null ? nameOf.get(Number(id)) : null;
    return d ? { device_id: d.id, name: d.name, ip: d.ip, asset_id: d.asset_id } : null;
  };
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    subject: describe(r.subject_device_id),
    other: describe(r.other_device_id),
    evidence: (() => { try { return JSON.parse(r.evidence_json || '{}'); } catch (_) { return {}; } })(),
    created_at: r.created_at,
    resolved_at: r.resolved_at,
    resolved_by: r.resolved_by,
    resolution_note: r.resolution_note,
  }));
}

// قرار المدير على تعارض (approve = إرفاق الأدلة بالجهاز المعني | reject = رفض).
// لا حذف لأي سجل تاريخي في الحالتين.
// مرجع محلي للتطبيع (يُستعمل داخل resolveConflict قبل تصدير الوحدة).
const assetsNormalizeMac = normalizeMac;

function resolveConflict(conflictId, action, { actor = null, note = null } = {}) {
  const c = db.prepare('SELECT * FROM asset_conflicts WHERE id = ?').get(conflictId);
  if (!c) return { ok: false, error: 'التعارض غير موجود' };
  if (c.status !== 'open') return { ok: false, error: 'التعارض تمت معالجته بالفعل' };
  const nowIso = new Date().toISOString();
  const act = String(action || '').toLowerCase();
  if (act !== 'approve' && act !== 'reject') return { ok: false, error: 'القرار يجب أن يكون approve أو reject' };

  let applied = null;
  if (act === 'approve') {
    let evidence = {};
    try { evidence = JSON.parse(c.evidence_json || '{}'); } catch (_) { evidence = {}; }
    const subject = c.subject_device_id;
    // إرفاق **الدليل المذكور في التعارض فقط** (MAC) بالجهاز المعني — بلا حذف أي سجل.
    // (لا ننسخ كل واجهات الطرف الآخر: القرار يخص الدليل المعروض للمراجع تحديدًا.)
    if (c.kind === 'suggested_merge' && c.other_device_id) {
      const evidenceMac = assetsNormalizeMac(evidence.mac);
      if (evidenceMac) {
        const attached = addInterface(subject, evidenceMac, {
          source: 'manual',
          confidence: 80,
          notes: `أُرفق بقرار المدير من الجهاز #${c.other_device_id} (تعارض #${c.id})`,
        });
        applied = { attachedFromDevice: c.other_device_id, mac: evidenceMac, interfaceId: attached.id };
      } else {
        applied = { attachedFromDevice: null, note: 'لا يوجد دليل MAC في التعارض' };
      }
    }
    if (evidence.ip) {
      // تثبيت العنوان كسجل موثّق للجهاز المعني (يبقى سجل الجهاز القديم كما هو).
      db.prepare(
        `INSERT INTO device_ip_history (device_id, ip, source, confidence, first_seen_at, last_seen_at, valid_from, valid_to)
         VALUES (?, ?, 'manual', 80, ?, ?, ?, ?)`
      ).run(subject, evidence.ip, nowIso, nowIso, nowIso, c.kind === 'ip_reused' ? nowIso : null);
      applied = Object.assign(applied || {}, { ipRecorded: evidence.ip });
    }
  }

  db.prepare(
    'UPDATE asset_conflicts SET status = ?, resolved_at = ?, resolved_by = ?, resolution_note = ? WHERE id = ?'
  ).run(act === 'approve' ? 'approved' : 'rejected', nowIso, actor, note, conflictId);

  return { ok: true, status: act === 'approve' ? 'approved' : 'rejected', applied };
}

// ═══ AST-02 — ربط نتائج الاكتشاف بالأصول (بأدلة، وبلا دمج تلقائي) ═══
// observeDiscovery({ ip, mac, hostname, source }): يقرأ الأدلة الحالية ويعيد قرارًا **بلا تعديل**
// (attach ⇒ يُستدعى recordIp/addInterface من الطبقة العليا | review ⇒ يُنشأ تعارض للمراجعة).
function observeDiscovery({ ip = null, mac = null, hostname = null, source = 'scan' } = {}) {
  const byIp = new Map();
  for (const row of db.prepare('SELECT device_id, ip, valid_to FROM device_ip_history').all()) {
    if (!byIp.has(row.ip)) byIp.set(row.ip, []);
    byIp.get(row.ip).push(row);
  }
  const byMac = new Map();
  for (const row of db.prepare('SELECT device_id, mac, is_active FROM device_interfaces').all()) {
    if (!byMac.has(row.mac)) byMac.set(row.mac, []);
    byMac.get(row.mac).push(row);
  }
  const decision = decideEvidence({ ip, mac, hostname }, { byIp, byMac });
  if (decision.action === 'review') {
    const created = createConflict({
      kind: decision.kind || 'suggested_merge',
      subjectDeviceId: decision.deviceId,
      otherDeviceId: decision.otherDeviceId != null ? decision.otherDeviceId : null,
      evidence: { ip, mac: normalizeMac(mac), hostname, source, confidence: decision.confidence, reasons: decision.reasons },
    });
    return Object.assign({}, decision, { conflictId: created.id, conflictDuplicated: !!created.duplicated });
  }
  return decision;
}

// ربط فعلي (يُستدعى عند اعتماد جهاز من الاكتشاف أو إضافة جماعية):
function attachObservation(deviceId, { ip = null, mac = null, source = 'scan', confidence = 60 } = {}) {
  const out = { ip: null, mac: null };
  if (ip) out.ip = recordIp(deviceId, ip, { source, confidence });
  if (mac) out.mac = addInterface(deviceId, mac, { source, confidence });
  return out;
}

// تفاصيل الأصل الكاملة (AST-03) — للواجهة الإدارية.
function getAssetDetail(assetIdOrDeviceId) {
  const dev = /^NM-\d+$/.test(String(assetIdOrDeviceId))
    ? getByAssetId(String(assetIdOrDeviceId))
    : db.prepare('SELECT * FROM devices WHERE id = ?').get(Number(assetIdOrDeviceId));
  if (!dev) return null;
  const assetId = dev.asset_id || assignAssetId(dev.id);
  return {
    device_id: dev.id,
    asset_id: assetId,
    name: dev.name,
    ip: dev.ip,
    device_type_id: dev.device_type_id,
    location_id: dev.location_id,
    parent_id: dev.parent_id,
    is_active: dev.is_active,
    current_status: dev.current_status,
    host_status: dev.host_status,
    overall_health: dev.overall_health,
    interfaces: listInterfaces(dev.id),
    ip_history: getIpTimeline(dev.id),
    conflicts: listConflicts({ status: 'open' }).filter(
      (c) => (c.subject && c.subject.device_id === dev.id) || (c.other && c.other.device_id === dev.id)
    ),
  };
}

module.exports = {
  normalizeMac,
  isValidIpv4,
  formatAssetId,
  guessMacKind,
  decideEvidence,
  ensureAssetIds,
  assignAssetId,
  getByAssetId,
  recordIp,
  getIpTimeline,
  addInterface,
  listInterfaces,
  deactivateInterface,
  createConflict,
  listConflicts,
  resolveConflict,
  observeDiscovery,
  attachObservation,
  getAssetDetail,
};
