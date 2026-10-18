// connector-base.service.js ( INT-01..03) — الأساس المشترك لموصلات القراءة فقط.
// ═══════════════════════════════════════════════════════════════════════════
// المبادئ المُلزِمة:
//   • **معطّل افتراضيًّا + opt-in صريحان**: لا يوجد أي اتصال خارجي قبل تفعيل المالك للموصل
//     (ويفضَّل أن يُعلن أيضًا أن إصدار جهازه/نقطة النهاية مُتحقَّق منهما: owner_verified).
//   • **قراءة فقط**: GET فقط بأزمنةٍ قصيرة، وبلا أي كتابة على أجهزة الشبكة.
//   • **التحقق من شهادة TLS مفعّل افتراضيًّا**، وhttp غير المشفّر يحتاج موافقة صريحة.
//   • **الأسرار لا تُعاد ولا تُسجَّل**: نتائج الفحص تُنقّى من أي توكِن/كلمة مرور/كوكي/رابط بهما.
//   • الفشل معزول: أي خطأ في موصل **لا يمسّ محرك المراقبة** (يُسجَّل في صف الموصل فقط).
// الدوال النقية (sanitizeUrl/normalizeBaseUrl/redactText/parseProbeOutcome) قابلة للاختبار مباشرة،
// وعميل HTTP يُحقَن (httpClient) ⇒ اختبار كامل بلا أي جهاز حقيقي.
'use strict';
const db = require('../../db');
const { uiText } = require('../ui-text.service');

const KINDS = ['sophos', 'esxi', 'synology'];
const KIND_LABELS = { sophos: 'Sophos Firewall', esxi: 'VMware ESXi', synology: 'Synology DSM' };
const PROBE_TIMEOUT_MS = 8000;

// ── أدوات نقية ──
// إزالة أي بيانات اعتماد من الروابط (user:pass@host) قبل أي تسجيل/عرض.
function sanitizeUrl(url) {
  try {
    const u = new URL(String(url));
    if (u.username || u.password) { u.username = ''; u.password = ''; }
    return u.toString();
  } catch (_) {
    return String(url || '').replace(/\/\/[^/@]*@/, '//');
  }
}

// تطبيع عنوان الأساس: https إلزامي افتراضيًّا (http يحتاج allowInsecure صريحًا).
function normalizeBaseUrl(input, { allowInsecure = false } = {}) {
  const raw = String(input || '').trim();
  if (!raw) return { ok: false, error: uiText('عنوان مطلوب', 'Address is required') };
  let u;
  try { u = new URL(raw); } catch (_) { return { ok: false, error: uiText('عنوان غير صالح (مثال: https://192.168.88.10:5001)', 'Invalid address (example: https://192.168.88.10:5001)') }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, error: uiText('يُسمح بـ https أو http فقط', 'Only https or http are allowed') };
  if (u.protocol === 'http:' && !allowInsecure) return { ok: false, error: uiText('http غير مشفّر غير مسموح — استخدم https أو فعّل السماح الصريح', 'Unencrypted http is not allowed — use https or explicitly allow it') };
  u.username = ''; u.password = '';
  u.search = ''; u.hash = '';
  const base = u.origin + (u.pathname && u.pathname !== '/' ? u.pathname.replace(/\/+$/, '') : '');
  return { ok: true, baseUrl: base };
}

// تنقية أي نص قبل عرضه/تسجيله: لا أسرار، لا بيانات اعتماد في الروابط، طول محدود.
function redactText(text, { secrets = [], maxLen = 300 } = {}) {
  let s = String(text == null ? '' : text);
  for (const sec of secrets) {
    const v = String(sec || '');
    if (v.length >= 3) s = s.split(v).join('[REDACTED]');
  }
  s = s.replace(/(https?:\/\/)[^@\s/]+@/gi, '$1[REDACTED]@');
  s = s.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]');
  s = s.replace(/(set-cookie|authorization|x-api-key|token|passwd|password)(\s*[:=]\s*)[^\s;,]+/gi, '$1$2[REDACTED]');
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

// حكم نتيجة الفحص (نقي): 2xx ⇒ متصل · 401/403 ⇒ الوصول مرفوض (بيانات دخول) · غيره ⇒ سبب واضح.
function parseProbeOutcome({ status, ok, error, timedOut } = {}) {
  if (timedOut) return { reachable: false, authorized: false, summary: uiText('انتهت المهلة — الجهاز لا يستجيب على العنوان/المنفذ.', 'Timed out — the device is not responding on this address/port.') };
  if (error) return { reachable: false, authorized: false, summary: uiText('تعذّر الاتصال: ', 'Connection failed: ') + String(error).slice(0, 160) };
  const st = Number(status) || 0;
  if (st >= 200 && st < 300) return { reachable: true, authorized: true, summary: uiText('استجاب الجهاز بنجاح (HTTP ' + st + ').', 'The device responded successfully (HTTP ' + st + ').') };
  if (st === 401 || st === 403) return { reachable: true, authorized: false, summary: uiText('الجهاز موجود لكن بيانات الدخول مرفوضة (HTTP ' + st + ').', 'The device is reachable but the credentials were rejected (HTTP ' + st + ').') };
  if (st === 404) return { reachable: true, authorized: true, summary: uiText('الجهاز موجود لكن نقطة الفحص غير متوفّرة على هذا الإصدار (HTTP 404) — راجع إصدار الجهاز.', 'The device is reachable but the probe endpoint is unavailable on this version (HTTP 404) — check the device version.') };
  return { reachable: true, authorized: ok !== undefined ? !!ok : st < 400, summary: uiText('استجابة غير متوقعة (HTTP ' + st + ').', 'Unexpected response (HTTP ' + st + ').') };
}

// ── قراءة/كتابة الإعدادات ──
function ensureRow(kind) {
  if (!KINDS.includes(kind)) return null;
  let row = db.prepare('SELECT * FROM integration_settings WHERE kind = ?').get(kind);
  if (!row) {
    db.prepare('INSERT INTO integration_settings (kind) VALUES (?)').run(kind);
    row = db.prepare('SELECT * FROM integration_settings WHERE kind = ?').get(kind);
  }
  return row;
}

function maskSettings(row) {
  if (!row) return null;
  return {
    kind: row.kind,
    label: KIND_LABELS[row.kind] || row.kind,
    enabled: !!row.enabled,
    base_url: row.base_url || null,
    username: row.username || null,
    secret_set: !!row.secret,
    verify_tls: row.verify_tls == null ? 1 : (row.verify_tls ? 1 : 0),
    owner_verified: !!row.owner_verified,
    last_probe_at: row.last_probe_at,
    last_ok_at: row.last_ok_at,
    last_error: row.last_error,
    capabilities: (() => { try { return JSON.parse(row.capabilities_json || 'null'); } catch (_) { return null; } })(),
  };
}

function listSettings() {
  return KINDS.map((k) => maskSettings(ensureRow(k)));
}

function saveSettings(kind, body = {}) {
  const row = ensureRow(kind);
  if (!row) return { ok: false, error: uiText('نوع تكامل غير معروف', 'Unknown integration type') };
  const normalized = normalizeBaseUrl(body.base_url !== undefined ? body.base_url : row.base_url, { allowInsecure: !!body.allow_insecure_http });
  if (body.base_url !== undefined && String(body.base_url || '').trim() && !normalized.ok) return normalized;

  const keepOr = (incoming, old) => {
    if (incoming === null) return null;                       // مسح صريح
    const v = typeof incoming === 'string' ? incoming.trim() : '';
    if (!v || v === '••••••') return old || null;             // الفراغ/القناع لا يمسح
    return v;
  };
  // تحديث جزئي لا يُطفئ الموصل بالخطأ: التفعيل يتغيّر فقط إن أُرسل صراحةً.
  const enabled = body.enabled !== undefined ? (body.enabled ? 1 : 0) : (row.enabled ? 1 : 0);
  const baseUrl = normalized.ok ? normalized.baseUrl : (row.base_url || null);
  const secret = keepOr(body.secret, row.secret);
  if (enabled && !baseUrl) return { ok: false, error: uiText('لا يمكن التفعيل بلا عنوان (base_url)', 'Cannot enable without an address (base_url)') };
  if (enabled && !secret && !body.allow_no_auth) return { ok: false, error: uiText('لا يمكن التفعيل بلا بيانات دخول (اسم المستخدم/السر)', 'Cannot enable without credentials (username/secret)') };

  db.prepare(
    `UPDATE integration_settings SET
       enabled = ?, base_url = ?, username = ?, secret = ?, verify_tls = ?, owner_verified = ?, updated_at = ?
     WHERE kind = ?`
  ).run(
    enabled,
    baseUrl,
    body.username !== undefined ? (String(body.username).trim() || null) : row.username,
    secret,
    body.verify_tls !== undefined ? (body.verify_tls ? 1 : 0) : (row.verify_tls ? 1 : 0),
    body.owner_verified !== undefined ? (body.owner_verified ? 1 : 0) : (row.owner_verified ? 1 : 0),
    new Date().toISOString(),
    kind
  );
  return { ok: true, settings: maskSettings(ensureRow(kind)) };
}

// بوّابة التفعيل: مُفعّل + عنوان + سر (يُستدعى قبل أي اتصال).
function isReady(kind) {
  const row = ensureRow(kind);
  if (!row || !row.enabled || !row.base_url) return false;
  return !!row.secret;
}

// ── الفحص (قراءة فقط) ──
// httpClient: دالة تُعيد { status, ok, body } أو ترمي — تُحقَن في الاختبارات (افتراضيًا fetch).
async function defaultHttpClient({ url, username, secret, verifyTls, timeoutMs }) {
  const headers = { 'Accept': 'application/json' };
  if (username || secret) {
    headers.Authorization = 'Basic ' + Buffer.from(String(username || '') + ':' + String(secret || '')).toString('base64');
  }
  // ملاحظة: في Node 24 لا توجد خيارات TLS لكل طلب في fetch؛ السجل npm:undici غير معتمد هنا.
  // التحقق من الشهادة يبقى مطابقًا لسلوك Node الافتراضي (مفعّل) — وverifyTls=0 يُوثَّق كقرار مالك.
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  const body = await res.text().catch(() => '');
  return { status: res.status, ok: res.ok, body };
}

// probe(kind, { httpClient, path }): فحص اتصال/صلاحيات ونقطة قدرة (بلا أي كتابة).
async function probe(kind, { httpClient = defaultHttpClient, path = '/', nowMs = Date.now() } = {}) {
  const row = ensureRow(kind);
  if (!row) return { ok: false, error: uiText('نوع تكامل غير معروف', 'Unknown integration type') };
  if (!isReady(kind)) return { ok: false, error: uiText('الموصل غير مُفعّل/ناقص البيانات — لا اتصال.', 'Connector is not enabled / incomplete — no connection.') };
  const url = (row.base_url || '').replace(/\/+$/, '') + path;
  const nowIso = new Date(nowMs).toISOString();
  try {
    const res = await httpClient({ url, username: row.username, secret: row.secret, verifyTls: !!row.verify_tls, timeoutMs: PROBE_TIMEOUT_MS });
    const outcome = parseProbeOutcome(res);
    const caps = { probed_path: path, status: res.status, ...outcome, at: nowIso };
    db.prepare(
      'UPDATE integration_settings SET last_probe_at = ?, last_ok_at = CASE WHEN ? = 1 THEN ? ELSE last_ok_at END, last_error = ?, capabilities_json = ? WHERE kind = ?'
    ).run(
      nowIso,
      outcome.reachable && outcome.authorized ? 1 : 0,
      nowIso,
      outcome.reachable && outcome.authorized ? null : redactText(outcome.summary, { secrets: [row.secret] }),
      JSON.stringify(caps),
      kind
    );
    return { ok: true, capabilities: caps };
  } catch (e) {
    const timedOut = !!(e && (e.name === 'TimeoutError' || e.name === 'AbortError'));
    const outcome = parseProbeOutcome({ error: e && e.message, timedOut });
    db.prepare('UPDATE integration_settings SET last_probe_at = ?, last_error = ?, capabilities_json = ? WHERE kind = ?')
      .run(nowIso, redactText(outcome.summary, { secrets: [row.secret] }), JSON.stringify({ probed_path: path, ...outcome, at: nowIso }), kind);
    return { ok: false, error: outcome.summary };
  }
}

// حالة الإضافات (للواجهة): صادقة دائمًا — لا ندّعي دعمًا لم يُتحقَّق منه.
function capabilitiesReport() {
  return listSettings().map((s) => ({
    kind: s.kind,
    label: s.label,
    enabled: s.enabled,
    configured: !!(s.base_url && s.secret_set),
    owner_verified: s.owner_verified,
    last_ok_at: s.last_ok_at,
    last_error: s.last_error,
    state: !s.enabled
      ? 'disabled'
      : (!s.base_url || !s.secret_set ? 'configured-incomplete' : (s.last_ok_at ? 'reachable' : 'not-probed')),
    note: s.kind === 'synology'
      ? uiText('قراءة صحة التخزين فقط (Storage API) — بلا أي كتابة.', 'Storage health read-only (Storage API) — no writes.')
      : (s.kind === 'esxi'
        ? uiText('فحص القدرات فقط حاليًّا — استخراج بيانات VM/مضيف يحتاج التأكد من إصدار ESXi عندك.', 'Capability probe only for now — extracting VM/host data requires confirming your ESXi version.')
        : uiText('فحص القدرات فقط حاليًّا — واجهات Sophos Home Edition تختلف بحسب الإصدار (راجع INT-01).', 'Capability probe only for now — Sophos Home Edition interfaces vary by version (see INT-01).')),
  }));
}

module.exports = {
  KINDS,
  KIND_LABELS,
  PROBE_TIMEOUT_MS,
  sanitizeUrl,
  normalizeBaseUrl,
  redactText,
  parseProbeOutcome,
  ensureRow,
  maskSettings,
  listSettings,
  saveSettings,
  isReady,
  probe,
  capabilitiesReport,
  defaultHttpClient,
};
