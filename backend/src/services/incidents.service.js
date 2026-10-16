// incidents.service.js (SpaceKit RCA-01/02) — أعطال مرتبطة بالشجرة (السبب الجذري).
// ═══════════════════════════════════════════════════════════════════════════
// القواعد المُلزِمة من المواصفة:
//   • عطل جهاز أعلى + تأثر أبنائه داخل نافذة ارتباط زمنية ⇒ **عطل مركزي واحد** بقائمة المتأثرين.
//   • الكتم يقع على **الإشعارات الصادرة فقط** — انقطاعات الأبناء تبقى مسجَّلة (downtime_events)
//     وحالاتهم تبقى ظاهرة في الشاشات ومخزَّنة في status_logs.
//   • إذا عاد الأب وما زال ابن منقطعًا ⇒ يُطلق **تنبيه مستقل** لذلك الابن ويُفتح له عطل خاص.
//   • بلا علاقة طوبولوجية ⇒ لا ندّعي سببية إطلاقًا (confidence = null ⇒ لا كتم).
//   • كل الحالة في القاعدة (survives restart) وnotified_at يمنع تكرار الإشعار بعد إعادة التشغيل.
// الدوال النقية (ancestorChain/pickRootCandidate) قابلة للاختبار مباشرة.
'use strict';
const db = require('../db');

const DEFAULT_WINDOW_MS = 120 * 1000; // نافذة ارتباط: دقيقتان (قابلة للضبط NM_RCA_WINDOW_MS)

function rcaWindowMs() {
  return Math.max(10000, parseInt(process.env.NM_RCA_WINDOW_MS, 10) || DEFAULT_WINDOW_MS);
}

// سلسلة الأسلاف لجهاز (الأقرب أولًا) عبر parent_id — مع حماية من الحلقات.
function ancestorChain(deviceId, byId) {
  const out = [];
  const seen = new Set([Number(deviceId)]);
  let cur = byId.get(Number(deviceId));
  while (cur && cur.parent_id != null) {
    const pid = Number(cur.parent_id);
    if (seen.has(pid)) break;
    seen.add(pid);
    const parent = byId.get(pid);
    if (!parent) break;
    out.push(parent);
    cur = parent;
  }
  return out;
}

// هل يوجد سلف منقطع يصلح سببًا جذريًّا؟ (نقي — بلا DB)
//   ancestors: [{id, name}] الأقرب أولًا · hostStatusById · offlineSinceById (ms)
//   يُرجع { rootId, rootName, confidence } أو null عند غياب أي علاقة سببية.
function pickRootCandidate({ deviceId, ancestors, hostStatusById, offlineSinceById, windowMs = DEFAULT_WINDOW_MS }) {
  const childStart = offlineSinceById.get(Number(deviceId)) ?? null;
  for (const anc of ancestors) {
    if (hostStatusById.get(Number(anc.id)) !== 'offline') continue;
    const ancStart = offlineSinceById.get(Number(anc.id)) ?? null;
    if (ancStart == null || childStart == null) {
      return { rootId: Number(anc.id), rootName: anc.name, confidence: 'medium' };
    }
    const delta = childStart - ancStart;          // موجب = الأب سبق ابنه (سببية أقوى)
    if (delta >= -windowMs) {
      // الأب سبق الابن: ثقة عالية إن كان الفارق داخل النافذة، وإلا متوسطة.
      const confidence = delta >= 0 && delta <= windowMs ? 'high' : 'medium';
      return { rootId: Number(anc.id), rootName: anc.name, confidence };
    }
  }
  return null;
}

// ── أدوات DB ──
function loadDeviceMap() {
  const rows = db.prepare('SELECT id, name, ip, parent_id, host_status, current_status, host_state_changed_at, last_checked_at FROM devices').all();
  const byId = new Map();
  for (const r of rows) byId.set(Number(r.id), r);
  return byId;
}

function offlineSinceMap() {
  const out = new Map(); // device_id → ms بداية الانقطاع المفتوح
  for (const row of db.prepare('SELECT device_id, started_at FROM downtime_events WHERE ended_at IS NULL').all()) {
    const t = new Date(row.started_at).getTime();
    if (Number.isFinite(t)) out.set(Number(row.device_id), t);
  }
  return out;
}

function getOpenIncidentForDevice(deviceId) {
  return db.prepare(
    "SELECT * FROM incidents WHERE status = 'open' AND root_device_id = ? ORDER BY id DESC LIMIT 1"
  ).get(deviceId);
}

function parseAffected(incident) {
  if (!incident) return [];
  try {
    const arr = JSON.parse(incident.affected_json || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function setAffected(incidentId, list) {
  db.prepare('UPDATE incidents SET affected_json = ? WHERE id = ?').run(JSON.stringify(list), incidentId);
}

function createIncident({ rootDeviceId, kind, confidence, startedAt, affected }) {
  const info = db.prepare(
    `INSERT INTO incidents (root_device_id, kind, status, confidence, started_at, affected_json)
     VALUES (?, ?, 'open', ?, ?, ?)`
  ).run(rootDeviceId, kind, confidence || null, startedAt, JSON.stringify(affected || []));
  return db.prepare('SELECT * FROM incidents WHERE id = ?').get(info.lastInsertRowid);
}

function markNotified(incidentId, atIso) {
  db.prepare('UPDATE incidents SET notified_at = ? WHERE id = ?').run(atIso, incidentId);
}

function closeIncidentsForRoot(deviceId, endedAtIso) {
  const rows = db.prepare("SELECT id FROM incidents WHERE status = 'open' AND root_device_id = ?").all(deviceId);
  for (const r of rows) {
    db.prepare("UPDATE incidents SET status = 'closed', ended_at = ? WHERE id = ?").run(endedAtIso, r.id);
  }
  return rows.map((r) => r.id);
}

// ═══ الأحداث ═══
// handleDeviceDown(device, { nowMs }): يُستدعى عند تسجيل انقطاع فعلي لجهاز.
// يُرجع: { suppressed, incidentId, rootId, confidence, grouped } — والقرار للتكامل مع المُشعِر.
function handleDeviceDown(device, { nowMs = Date.now() } = {}) {
  const byId = loadDeviceMap();
  const ancestors = ancestorChain(device.id, byId);
  const hostStatusById = new Map([...byId.values()].map((d) => [Number(d.id), d.host_status || d.current_status]));
  const since = offlineSinceMap();
  const startedAtIso = new Date(since.get(Number(device.id)) ?? nowMs).toISOString();

  const candidate = ancestors.length
    ? pickRootCandidate({ deviceId: device.id, ancestors, hostStatusById, offlineSinceById: since, windowMs: rcaWindowMs() })
    : null;

  if (!candidate) {
    // لا علاقة سببية ⇒ عطل مستقل عادي (نبثّ الإشعار كما هو معتاد).
    let inc = getOpenIncidentForDevice(device.id);
    if (!inc) inc = createIncident({ rootDeviceId: device.id, kind: 'single', confidence: null, startedAt: startedAtIso, affected: [] });
    return { suppressed: false, incidentId: inc.id, rootId: null, confidence: null, grouped: false };
  }

  // يوجد سلف منقطع ⇒ انضمّ إلى عطله المركزي (أو أنشئه إن لم يوجد) واكتم الإشعار الخارجي.
  let rootIncident = getOpenIncidentForDevice(candidate.rootId);
  const affected = parseAffected(rootIncident);
  if (!rootIncident) {
    rootIncident = createIncident({
      rootDeviceId: candidate.rootId, kind: 'root_cause', confidence: candidate.confidence,
      startedAt: new Date(since.get(candidate.rootId) ?? nowMs).toISOString(), affected: [],
    });
  } else if (rootIncident.kind !== 'root_cause') {
    db.prepare("UPDATE incidents SET kind = 'root_cause', confidence = ? WHERE id = ?").run(candidate.confidence, rootIncident.id);
  }
  const alreadyListed = affected.some((a) => Number(a.device_id) === Number(device.id));
  if (!alreadyListed) {
    affected.push({ device_id: Number(device.id), name: device.name, started_at: startedAtIso });
    setAffected(rootIncident.id, affected);
  }
  return {
    suppressed: true,
    incidentId: rootIncident.id,
    rootId: candidate.rootId,
    rootName: candidate.rootName,
    confidence: candidate.confidence,
    grouped: true,
  };
}

// handleDeviceRecovered(device, { nowMs, notifyIndependent })
//   • يُغلق عطل الجهاز نفسه، وإن كان جذرًا لعطل مركزي يُغلقه أيضًا.
//   • أي ابن كان مكتومًا وما زال منقطعًا ⇒ يُعاد إطلاقه **كتنبيه مستقل** + عطل خاص (RCA-02).
//   notifyIndependent(childDevice) تُستدعى من الطبقة العليا لإرسال التنبيه الفعلي.
function handleDeviceRecovered(device, { nowMs = Date.now(), notifyIndependent = null } = {}) {
  const nowIso = new Date(nowMs).toISOString();
  const closedOwn = closeIncidentsForRoot(device.id, nowIso);

  // الأبناء المتأثرون في الأعطال المركزية التي كان هذا الجهاز جذرها.
  const affectedChildren = [];
  const incidents = db.prepare(
    "SELECT * FROM incidents WHERE root_device_id = ? AND kind = 'root_cause' ORDER BY id DESC LIMIT 5"
  ).all(device.id);
  for (const inc of incidents) {
    for (const a of parseAffected(inc)) {
      if (!affectedChildren.some((x) => x.device_id === a.device_id)) affectedChildren.push(a);
    }
  }

  const reopened = [];
  if (affectedChildren.length) {
    const byId = loadDeviceMap();
    for (const a of affectedChildren) {
      const child = byId.get(Number(a.device_id));
      const stillOffline = child && (child.host_status || child.current_status) === 'offline';
      if (!stillOffline) continue;
      // الابن ما زال منقطعًا بعد عودة الأب ⇒ عطل مستقل ظاهر + تنبيه خاص به.
      let inc = getOpenIncidentForDevice(child.id);
      if (!inc) {
        inc = createIncident({
          rootDeviceId: child.id, kind: 'single', confidence: null,
          startedAt: a.started_at || nowIso, affected: [],
        });
      }
      if (typeof notifyIndependent === 'function') {
        try { notifyIndependent(child, inc); } catch (_) { /* الإشعار لا يكسر المنطق */ }
      }
      reopened.push({ device_id: child.id, name: child.name, incidentId: inc.id });
    }
  }
  return { closedIncidents: closedOwn, reopened };
}

// قائمة الأعطال للواجهات (قراءة فقط؛ بلا أسرار).
function listIncidents({ status = 'open', limit = 50 } = {}) {
  const lim = Math.min(200, Math.max(1, Number(limit) || 50));
  const rows = status === 'all'
    ? db.prepare('SELECT * FROM incidents ORDER BY id DESC LIMIT ?').all(lim)
    : db.prepare("SELECT * FROM incidents WHERE status = 'open' ORDER BY id DESC LIMIT ?").all(lim);
  const nameOf = new Map(db.prepare('SELECT id, name, ip FROM devices').all().map((d) => [Number(d.id), d]));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    confidence: r.confidence,
    started_at: r.started_at,
    ended_at: r.ended_at,
    root_device_id: r.root_device_id,
    root_name: r.root_device_id != null && nameOf.has(Number(r.root_device_id)) ? nameOf.get(Number(r.root_device_id)).name : null,
    affected: parseAffected(r),
    affected_count: parseAffected(r).length,
    notified_at: r.notified_at,
  }));
}

module.exports = {
  DEFAULT_WINDOW_MS,
  rcaWindowMs,
  ancestorChain,
  pickRootCandidate,
  handleDeviceDown,
  handleDeviceRecovered,
  listIncidents,
  parseAffected,
  getOpenIncidentForDevice,
  markNotified,
};
