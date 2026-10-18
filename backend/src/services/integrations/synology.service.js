// synology.service.js ( INT-03) — قراءة صحة التخزين من Synology DSM (قراءة فقط).
// ═══════════════════════════════════════════════════════════════════════════
// DSM يوفّر API رسميًّا للقراءة (SYNO.API.Info ثم SYNO.Storage.CGI.Storage / load_info).
// نستعمله بـ **قراءة فقط** (بلا أي set/تعديل)، وبوّابة التفعيل الصريحة في connector-base.
// كل القيم المُستخرَجة تُنقّى، والمقاييس **غير المتوفّرة تُعلَن غير مدعومة** ولا تُختلق لها أرقام
// (مثال: قيم SMART لا تُعرض إن لم يوفّرها DSM لهذا الطراز).
// الدوال النقية (parseStorageResponse/normalizeVolume/normalizeDisk) قابلة للاختبار مباشرة.
'use strict';
const base = require('./connector-base.service');
const { uiText, uiLangCode } = require('../ui-text.service');

// استخراج صحة التخزين من استجابة load_info (نقي — يتحمّل الحقول الناقصة بلا رمي).
function parseStorageResponse(json) {
  const data = (json && json.data) || {};
  const storage = data.storage || data;
  const volumes = Array.isArray(storage.volumes) ? storage.volumes : [];
  const disks = Array.isArray(storage.disks) ? storage.disks : [];

  return {
    volumes: volumes.map((v) => normalizeVolume(v)).filter(Boolean),
    disks: disks.map((d) => normalizeDisk(d)).filter(Boolean),
    // حقول لا يوفّرها كل إصدار: تُعلَن صراحةً بدل اختلاقها.
    smart_supported: disks.some((d) => Array.isArray(d.smart_status) && d.smart_status.length > 0),
  };
}

function normalizeVolume(v) {
  if (!v || typeof v !== 'object') return null;
  const totalBytes = numOrNull(v.size && v.size.total);
  const usedBytes = numOrNull(v.size && v.size.used);
  return {
    id: v.id != null ? String(v.id) : null,
    device_type: v.device_type || null,                       // shr | raid_1 | …
    status: v.status || 'unknown',                            // normal | crashed | degraded …
    is_degraded: !!(v.is_degraded || v.status === 'degraded'),
    is_crashed: !!(v.is_crashed || v.status === 'crashed'),
    total_bytes: totalBytes,
    used_bytes: usedBytes,
    used_percent: (totalBytes && usedBytes != null) ? Math.round((usedBytes / totalBytes) * 1000) / 10 : null,
  };
}

function normalizeDisk(d) {
  if (!d || typeof d !== 'object') return null;
  const disk = {
    id: d.id != null ? String(d.id) : null,
    name: d.name || d.disk_id || null,
    model: d.model || null,
    status: d.status || 'unknown',                            // normal | warning | critical
    temperature_c: numOrNull(d.temp),
    size_bytes: numOrNull(d.size_total != null ? d.size_total : d.size),
    smart_supported: Array.isArray(d.smart_status) && d.smart_status.length > 0,
  };
  if (disk.smart_supported) {
    disk.smart_status = d.smart_status.map((s) => ({ id: numOrNull(s && s.id), status: (s && (s.status || s.normal)) || 'unknown' }));
  }
  return disk;
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// قراءة فعلية (قراءة فقط) — httpClient يُحقَن في الاختبار.
async function readStorageHealth({ httpClient = base.defaultHttpClient, nowMs = Date.now() } = {}) {
  const row = base.ensureRow('synology');
  if (!base.isReady('synology')) return { ok: false, error: uiText('موصل Synology غير مُفعّل/ناقص البيانات — لا اتصال.', 'Synology connector is not enabled / incomplete — no connection.') };
  const root = (row.base_url || '').replace(/\/+$/, '');
  const url = root + '/webapi/entry.cgi?api=SYNO.Storage.CGI.Storage&version=1&method=load_info';
  try {
    const res = await httpClient({
      url, username: row.username, secret: row.secret, verifyTls: !!row.verify_tls, timeoutMs: base.PROBE_TIMEOUT_MS,
    });
    if (!res || !(res.status >= 200 && res.status < 300)) {
      const summary = base.parseProbeOutcome(res).summary;
      base.ensureRow('synology');
      require('../../db').prepare('UPDATE integration_settings SET last_probe_at = ?, last_error = ? WHERE kind = ?')
        .run(new Date(nowMs).toISOString(), base.redactText(summary, { secrets: [row.secret] }), 'synology');
      return { ok: false, error: summary };
    }
    let json = null;
    try { json = JSON.parse(res.body || '{}'); } catch (_) { return { ok: false, error: uiText('استجابة DSM ليست JSON صالحًا.', 'DSM response is not valid JSON.') }; }
    if (json && json.success === false) {
      const code = json.error && json.error.code;
      const codeText = code != null ? String(code) : (uiLangCode() === 'ar' ? 'غير معروف' : 'unknown');
      return { ok: false, error: uiText('رفض DSM القراءة (رمز ' + codeText + ') — تحقّق من الصلاحيات/الحساب.', 'DSM refused to read (code ' + codeText + ') — check permissions/account.') };
    }
    const parsed = parseStorageResponse(json);
    const nowIso = new Date(nowMs).toISOString();
    require('../../db').prepare(
      'UPDATE integration_settings SET last_probe_at = ?, last_ok_at = ?, last_error = NULL, capabilities_json = ? WHERE kind = ?'
    ).run(nowIso, nowIso, JSON.stringify({ storage: { at: nowIso, volumes: parsed.volumes.length, disks: parsed.disks.length } }), 'synology');
    return { ok: true, ...parsed, at: nowIso };
  } catch (e) {
    const timedOut = !!(e && (e.name === 'TimeoutError' || e.name === 'AbortError'));
    const outcome = base.parseProbeOutcome({ error: e && e.message, timedOut });
    return { ok: false, error: outcome.summary };
  }
}

module.exports = { parseStorageResponse, normalizeVolume, normalizeDisk, readStorageHealth };
