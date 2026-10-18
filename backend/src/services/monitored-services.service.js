// monitored-services.service.js (MON-02) — الخدمات المراقَبة: نموذج + تحقق + فحص + حالة.
// ═══════════════════════════════════════════════════════════════════════════
// المبدأ (المواصفة): «حالة المضيف» منفصلة تمامًا عن «حالة كل خدمة».
//   • المضيف متصل + خدمة متوقفة ⇒ overall_health = 'degraded' (وليس أخضر كاذبًا).
//   • فحص الخدمة يتبع **فاصلها الخاص** (وليس دورة الـ 10 ثوانٍ) واحترامًا لحد التزامن العام.
//   • كل خدمة لها عتبة فشل وحدث انقطاع/عودة خاص بها، وتاريخها في service_status_logs.
// الدوال النقية (statusMatcher/validate/intervalDue) قابلة للاختبار مباشرة.
'use strict';
const db = require('../db');
const { checkPort, checkServiceHttp } = require('./checkers');
const { decideHostTransition } = require('./health-state.service');
const { uiText } = require('./ui-text.service');

const KINDS = ['tcp', 'http', 'https'];
const DEFAULT_SERVICE_PROBES = { port: checkPort, http: checkServiceHttp };

// ── مُطابِق الحالة المتوقعة (نقي): '2xx' | '200' | '200-299' | '200,204,301' ──
function statusMatcher(spec) {
  const s = String(spec == null ? '2xx' : spec).trim().toLowerCase().replace(/\s+/g, '');
  if (!s || s === '2xx') return (code) => code >= 200 && code < 300;
  const ranges = [];
  for (const part of s.split(',')) {
    let m = /^(\d{3})$/.exec(part);
    if (m) { const v = Number(m[1]); ranges.push([v, v]); continue; }
    m = /^(\d{3})-(\d{3})$/.exec(part);
    if (m) {
      const a = Number(m[1]); const b = Number(m[2]);
      if (a > b || b > 599) return null;
      ranges.push([a, b]);
      continue;
    }
    return null;
  }
  if (!ranges.length) return null;
  return (code) => ranges.some(([a, b]) => code >= a && code <= b);
}

// ── التحقق من مدخلات الخدمة (نقي) ──
function validateServiceInput(body, { partial = false } = {}) {
  const b = body || {};
  const out = {};
  const errors = [];
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  const need = (k) => !partial || has(k);

  if (need('name')) {
    const name = String(b.name == null ? '' : b.name).trim();
    if (!name || name.length > 100) errors.push(uiText('اسم الخدمة مطلوب (≤100 حرفًا)', 'Service name is required (≤100 characters)'));
    else out.name = name;
  }
  if (need('kind')) {
    const kind = String(b.kind == null ? '' : b.kind).trim().toLowerCase();
    if (!KINDS.includes(kind)) errors.push(uiText('نوع الخدمة يجب أن يكون tcp أو http أو https', 'Service kind must be tcp, http or https'));
    else out.kind = kind;
  }
  const kind = out.kind || String(b.kind || '').toLowerCase();

  if (need('port') || has('port')) {
    if (b.port == null || b.port === '') {
      if (kind === 'tcp') errors.push(uiText('منفذ الخدمة مطلوب لخدمات TCP', 'Service port is required for TCP services'));
      else out.port = null;
    } else {
      const port = Number(b.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push(uiText('منفذ غير صالح (1-65535)', 'Invalid port (1-65535)'));
      else out.port = port;
    }
  }

  if (has('url_path')) {
    const p = String(b.url_path == null ? '/' : b.url_path).trim() || '/';
    if (p.length > 200 || !p.startsWith('/') || /[\s\x00-\x1f]/.test(p)) {
      errors.push(uiText('المسار يجب أن يبدأ بـ / وبلا مسافات (≤200 حرفًا)', 'Path must start with / and contain no spaces (≤200 characters)'));
    } else out.url_path = p;
  } else if (need('url_path')) {
    out.url_path = '/';
  }

  if (kind === 'http' || kind === 'https') {
    const spec = has('expect_status') ? b.expect_status : (partial ? undefined : '2xx');
    if (spec !== undefined) {
      if (statusMatcher(spec) === null) errors.push(uiText("صيغة الحالة المتوقعة غير صالحة (أمثلة: '2xx' · '200' · '200-299' · '200,204')", "Invalid expected-status format (examples: '2xx' · '200' · '200-299' · '200,204')"));
      else out.expect_status = String(spec).trim();
    }
    if (has('verify_tls')) out.verify_tls = b.verify_tls ? 1 : 0;
  }

  if (has('interval_seconds')) {
    const v = Number(b.interval_seconds);
    if (!Number.isInteger(v) || v < 10 || v > 86400) errors.push(uiText('فاصل الفحص يجب أن يكون 10..86400 ثانية', 'Check interval must be 10..86400 seconds'));
    else out.interval_seconds = v;
  } else if (need('interval_seconds')) out.interval_seconds = 60;

  if (has('timeout_ms')) {
    const v = Number(b.timeout_ms);
    if (!Number.isInteger(v) || v < 500 || v > 60000) errors.push(uiText('المهلة يجب أن تكون 500..60000 مللي ثانية', 'Timeout must be 500..60000 milliseconds'));
    else out.timeout_ms = v;
  } else if (need('timeout_ms')) out.timeout_ms = 5000;

  if (has('failure_threshold')) {
    const v = Number(b.failure_threshold);
    if (!Number.isInteger(v) || v < 1 || v > 10) errors.push(uiText('عتبة الفشل يجب أن تكون 1..10', 'Failure threshold must be 1..10'));
    else out.failure_threshold = v;
  } else if (need('failure_threshold')) out.failure_threshold = 2;

  if (has('is_critical')) out.is_critical = b.is_critical ? 1 : 0;
  if (has('is_enabled')) out.is_enabled = b.is_enabled ? 1 : 0;

  if (errors.length) return { ok: false, error: errors.join(' · ') };
  return { ok: true, value: out };
}

// ── CRUD ──
function listByDevice(deviceId) {
  return db.prepare('SELECT * FROM monitored_services WHERE device_id = ? ORDER BY id ASC').all(deviceId);
}

function getById(id) {
  return db.prepare('SELECT * FROM monitored_services WHERE id = ?').get(id);
}

function deviceExists(deviceId) {
  return !!db.prepare('SELECT id FROM devices WHERE id = ?').get(deviceId);
}

function createForDevice(deviceId, body) {
  const v = validateServiceInput(body, { partial: false });
  if (!v.ok) return v;
  if (!deviceExists(deviceId)) return { ok: false, error: uiText('الجهاز غير موجود', 'Device not found') };
  const s = v.value;
  const info = db.prepare(
    `INSERT INTO monitored_services
       (device_id, name, kind, port, url_path, expect_status, verify_tls, interval_seconds, timeout_ms, failure_threshold, is_critical, is_enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    deviceId, s.name, s.kind, s.port == null ? null : s.port, s.url_path || '/',
    s.expect_status || '2xx', s.verify_tls == null ? 1 : s.verify_tls,
    s.interval_seconds, s.timeout_ms, s.failure_threshold,
    s.is_critical || 0, s.is_enabled == null ? 1 : s.is_enabled
  );
  return { ok: true, service: getById(info.lastInsertRowid) };
}

function updateById(id, body) {
  const existing = getById(id);
  if (!existing) return { ok: false, error: uiText('الخدمة غير موجودة', 'Service not found') };
  const v = validateServiceInput(body, { partial: true });
  if (!v.ok) return v;
  const fields = Object.keys(v.value);
  if (!fields.length) return { ok: true, service: existing };
  const sets = fields.map((f) => `${f} = ?`).join(', ');
  db.prepare(`UPDATE monitored_services SET ${sets} WHERE id = ?`).run(...fields.map((f) => v.value[f]), id);
  // تغيير الإعدادات يصفّر عداد الفشل حتى تُحكم العتبة الجديدة من الآن.
  if (fields.some((f) => ['kind', 'port', 'url_path', 'expect_status', 'timeout_ms', 'failure_threshold', 'verify_tls'].includes(f))) {
    db.prepare('UPDATE monitored_services SET consecutive_failures = 0, status = \'unknown\', last_error = NULL WHERE id = ?').run(id);
  }
  return { ok: true, service: getById(id) };
}

function removeById(id) {
  const existing = getById(id);
  if (!existing) return { ok: false, error: uiText('الخدمة غير موجودة', 'Service not found') };
  db.prepare('DELETE FROM monitored_services WHERE id = ?').run(id);
  return { ok: true, deviceId: existing.device_id };
}

// ── حالة الجهاز العامة (مضيف + خدمات) — مصدر واحد للحقيقة ──
function recomputeOverallHealth(deviceId) {
  db.prepare(
    `UPDATE devices SET overall_health = CASE
        WHEN host_status = 'offline' THEN 'offline'
        WHEN host_status IS NULL OR host_status = 'unknown' THEN 'unknown'
        WHEN (SELECT COUNT(*) FROM monitored_services s
                WHERE s.device_id = devices.id AND s.is_enabled = 1 AND s.status = 'offline') > 0 THEN 'degraded'
        ELSE 'online'
      END
     WHERE id = ?`
  ).run(deviceId);
}

// ── الفحص ──
// probeService(service, device, probes) ⇒ { ok, responseMs, error, protocol }
async function probeService(service, device, probes = DEFAULT_SERVICE_PROBES) {
  const ip = device.ip;
  if (service.kind === 'tcp') {
    const r = await probes.port(ip, service.port, service.timeout_ms);
    return { ok: !!r.isOnline, responseMs: r.responseTimeMs, error: r.isOnline ? null : `TCP ${service.port} ` + uiText('مغلق/غير مستجيب', 'closed/not responding'), protocol: 'tcp' };
  }
  const scheme = service.kind === 'https' ? 'https' : 'http';
  const expect = statusMatcher(service.expect_status) || ((c) => c >= 200 && c < 300);
  const r = await probes.http({
    ip,
    scheme,
    port: service.port || (scheme === 'https' ? 443 : 80),
    path: service.url_path || '/',
    expect,
    verifyTls: !!service.verify_tls,
    timeoutMs: service.timeout_ms || 5000,
  });
  return { ok: !!r.isOnline, responseMs: r.responseTimeMs, error: r.isOnline ? null : (r.error || uiText('فشل الطلب', 'Request failed')), protocol: scheme };
}

// هل حان فحص هذه الخدمة؟ (نقي — قابل للاختبار)
function intervalDue(lastCheckedAt, intervalSeconds, nowMs = Date.now()) {
  if (!lastCheckedAt) return true;
  const last = new Date(lastCheckedAt).getTime();
  if (!Number.isFinite(last)) return true;
  return (nowMs - last) >= Math.max(10, Number(intervalSeconds) || 60) * 1000;
}

function writeServiceState(service, transition, probe, nowIso) {
  db.prepare(
    `UPDATE monitored_services SET
       status = ?, consecutive_failures = ?, last_checked_at = ?,
       last_ok_at = CASE WHEN ? = 1 THEN ? ELSE last_ok_at END,
       last_response_ms = ?, last_error = ?
     WHERE id = ?`
  ).run(
    transition.hostStatus, transition.consecutiveFailures, nowIso,
    probe.ok ? 1 : 0, nowIso,
    probe.ok ? probe.responseMs : null,
    probe.ok ? null : String(probe.error || '').slice(0, 200),
    service.id
  );
  if (transition.hostStatus !== 'unknown') {
    db.prepare(
      'INSERT INTO service_status_logs (service_id, device_id, status, response_ms, error, checked_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      service.id, service.device_id,
      transition.hostStatus === 'offline' ? 'offline' : 'online',
      probe.ok ? probe.responseMs : null,
      probe.ok ? null : String(probe.error || '').slice(0, 200),
      nowIso
    );
  }
}

// الدورة: فحص كل الخدمات المستحقة الآن (وفق فاصل كل خدمة) بحد تزامن عام.
// يُرجع إحصاءات تُعرض في /api/health.
const inflightServices = new Set();
let activeServiceChecks = 0;

function maxConcurrent() {
  return Math.max(1, parseInt(process.env.NM_MAX_CONCURRENT_CHECKS, 10) || 10);
}

function checkDueServices({ probes = DEFAULT_SERVICE_PROBES, nowMs = Date.now(), notifier = null } = {}) {
  const due = db.prepare(
    `SELECT s.*, d.name AS device_name, d.ip AS device_ip, dt.name AS device_type_name
       FROM monitored_services s
       JOIN devices d ON d.id = s.device_id
       LEFT JOIN device_types dt ON dt.id = d.device_type_id
      WHERE s.is_enabled = 1
      ORDER BY s.id ASC`
  ).all();

  const cap = maxConcurrent();
  let started = 0;
  let deferred = 0;
  for (const service of due) {
    if (!intervalDue(service.last_checked_at, service.interval_seconds, nowMs)) continue;
    if (activeServiceChecks >= cap) { deferred += 1; continue; }
    if (inflightServices.has(service.id)) continue;
    inflightServices.add(service.id);
    activeServiceChecks += 1;
    started += 1;
    (async () => {
      const nowIso = new Date().toISOString();
      try {
        const probe = await probeService(service, { ip: service.device_ip }, probes);
        const transition = decideHostTransition({
          hostStatus: service.status,
          consecutiveFailures: service.consecutive_failures,
          failureThreshold: service.failure_threshold,
          probeOk: probe.ok,
        });
        writeServiceState(service, transition, probe, nowIso);
        recomputeOverallHealth(service.device_id);

        if (notifier) {
          const device = { id: service.device_id, name: service.device_name, ip: service.device_ip, device_type_name: service.device_type_name };
          try {
            if (transition.event === 'down') await notifier.notifyServiceDown(device, service);
            else if (transition.event === 'recovered') await notifier.notifyServiceRecovered(device, service);
          } catch (e) {
            console.error('[services] notify error:', e.message);
          }
        }
        try { require('./live.service').scheduleRefresh(); } catch (_) { /* البثّ الحيّ اختياري */ }
      } catch (e) {
        console.error('[services] check error:', e.message);
      } finally {
        inflightServices.delete(service.id);
        activeServiceChecks -= 1;
      }
    })();
  }
  return { checked: due.length, started, deferredConcurrency: deferred, maxConcurrent: cap };
}

// ملخص الخدمات لجهاز (للاستجابات العامة بلا أسماء/أسرار).
function servicesSummary(deviceId) {
  const row = db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END) AS down,
            SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) AS up
       FROM monitored_services WHERE device_id = ? AND is_enabled = 1`
  ).get(deviceId);
  return { total: row.total || 0, down: row.down || 0, up: row.up || 0 };
}

module.exports = {
  KINDS,
  statusMatcher,
  validateServiceInput,
  intervalDue,
  listByDevice,
  getById,
  deviceExists,
  createForDevice,
  updateById,
  removeById,
  recomputeOverallHealth,
  probeService,
  checkDueServices,
  servicesSummary,
  DEFAULT_SERVICE_PROBES,
};
