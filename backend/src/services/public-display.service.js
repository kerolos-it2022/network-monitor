// public-display.service.js (SpaceKit SEC-02) — سياسة العرض العام + تنقية الحقول.
// ═══════════════════════════════════════════════════════════════════════════
// القاعدة الذهبية: أي استجابة يراها زائر بلا تسجيل دخول تُبنى من **قائمة بيضاء**
// (whitelist) صريحة هنا — لا تُمرَّر صفوف قاعدة البيانات كما هي أبدًا.
// لا تظهر في أي استجابة عامة: IP · MAC · اسم المضيف · السيريال · البروتوكول ·
// المنافذ · إعدادات الفحص · أي شهادة أو سرّ.
// الأوضاع (owner-configurable):
//   'lan'      (الافتراضي): الحقول الآمنة + حقول العرض اللازمة لشاشة NOC
//               (parent_id/pos_x/pos_y/الأسماء المعروضة) — بلا أي IP/MAC.
//   'minimal'  : الحقول الآمنة فقط، وبلا شجرة/إحداثيات (مقترح عند النشر العام/ngrok).
//   'off'      : إيقاف العرض العام بالكامل (403 لكل مسارات /api/public).
// الأولوية: إعداد قاعدة البيانات (app_settings) ← متغير البيئة NM_PUBLIC_DISPLAY ← الافتراضي.
'use strict';
const db = require('../db');

const MODES = ['lan', 'minimal', 'off'];
const DEFAULT_MODE = 'lan';
const SETTING_KEY = 'public_display_mode';

function readSetting(key) {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
    return row ? row.value : null;
  } catch (_) {
    return null; // قاعدة قديمة قبل إنشاء الجدول — نكمل بالافتراضي
  }
}

function writeSetting(key, value) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, now);
}

function getMode() {
  const raw = String(readSetting(SETTING_KEY) || process.env.NM_PUBLIC_DISPLAY || DEFAULT_MODE).toLowerCase();
  return MODES.includes(raw) ? raw : DEFAULT_MODE;
}

function getModeSource() {
  if (readSetting(SETTING_KEY)) return 'database';
  if (process.env.NM_PUBLIC_DISPLAY) return 'env';
  return 'default';
}

function setMode(mode) {
  const m = String(mode || '').toLowerCase();
  if (!MODES.includes(m)) {
    return { ok: false, error: 'قيمة غير صالحة — المسموح: lan | minimal | off' };
  }
  writeSetting(SETTING_KEY, m);
  return { ok: true, mode: m };
}

// ═══ SEC-02/MON-02 — وضع شاشة NOC الداخلية ═══
// 'off' (افتراضي وآمن): شاشة NOC تقرأ العرض العام المنقّى دائمًا (بلا عناوين).
// 'full': إن كانت الجلسة **مديرًا** تُقرأ المسارات الداخلية (مع IP) — للشاشة داخل الشبكة.
// غير المدراء (وزائر بلا جلسة) يبقون على المنقّى حتى لو كان الوضع 'full'.
const NOC_KEY = 'noc_internal_full';

function getNocMode() {
  return String(readSetting(NOC_KEY) || process.env.NM_NOC_INTERNAL || 'off').toLowerCase() === 'full' ? 'full' : 'off';
}

function setNocMode(mode) {
  const m = String(mode || '').toLowerCase();
  if (m !== 'full' && m !== 'off') return { ok: false, error: 'قيمة غير صالحة — المسموح: full | off' };
  writeSetting(NOC_KEY, m);
  return { ok: true, mode: m };
}

// الوضع الفعلي لطلب معيّن: 'full' فقط لو الإعداد كذلك **والجلسة مدير**.
function resolveNocMode(req) {
  if (getNocMode() !== 'full') return 'sanitized';
  const user = req && req.session && req.session.user;
  return user && user.role === 'admin' ? 'full' : 'sanitized';
}

// ── تنقية جهاز واحد (صف من devices + JOINs) ──
function deviceDto(d, mode) {
  const dto = {
    id: d.id,
    name: d.name,
    status: d.current_status,
    // MON-01 — الحالة العامة (online|degraded|offline|unknown): تُمكِّن الشاشات من تمييز
    // «مضيف متصل لكن خدمة متوقفة» بدل الأخضر الكاذب. (degraded تُنتَج مع خدمات MON-02.)
    overall_health: d.overall_health || d.current_status || 'unknown',
    // MON-02 — عدد الخدمات المتوقفة (رقم فقط، بلا أسماء/منافذ) لعرض شارة DEGRADED.
    services_down_count: d.services_down_count == null ? 0 : Number(d.services_down_count),
    services_total: d.services_total == null ? 0 : Number(d.services_total),
    is_active: !!d.is_active,
    device_type_id: d.device_type_id == null ? null : d.device_type_id,
    device_type_name: d.device_type_name || null,
    location_id: d.location_id == null ? null : d.location_id,
    location_name: d.location_name || null,
    location_kind: d.location_kind || null,
    response_time_ms: d.last_response_time_ms == null ? null : d.last_response_time_ms,
    last_checked_at: d.last_checked_at || null,
    http_accessible: d.http_accessible ? 1 : 0,
    https_accessible: d.https_accessible ? 1 : 0,
    last_outage_ended_at: d.last_outage_ended_at || null,
    last_outage_seconds: d.last_outage_seconds == null ? null : d.last_outage_seconds,
  };
  if (mode === 'lan') {
    // حقول العرض (شاشة NOC / الخريطة) — بنية الشبكة الداخلية بلا عناوين:
    dto.parent_id = d.parent_id == null ? null : d.parent_id;
    dto.parent_location_id = d.parent_location_id == null ? null : d.parent_location_id;
    dto.pos_x = d.pos_x == null ? null : d.pos_x;
    dto.pos_y = d.pos_y == null ? null : d.pos_y;
  }
  return dto;
}

// ── تنقية عقدة شجرة التوبولوجي (من topology.service.buildTopology) ──
function treeNodeDto(node, mode) {
  if (node.type === 'location') {
    const out = {
      type: 'location',
      id: node.id,
      location_id: node.location_id,
      name: node.name,
      kind: node.kind,
      status: null,
      children: [],
    };
    if (mode === 'lan') {
      out.parent_id = node.parent_id == null ? null : node.parent_id;
      out.map_parent_id = node.map_parent_id == null ? null : node.map_parent_id;
      out.pos_x = node.pos_x == null ? null : node.pos_x;
      out.pos_y = node.pos_y == null ? null : node.pos_y;
    }
    out.children = (node.children || []).map((c) => treeNodeDto(c, mode));
    return out;
  }
  const out = {
    type: 'device',
    id: node.id,
    name: node.name,
    device_type_name: node.device_type_name || null,
    status: node.status,
    overall_health: node.overall_health || node.status,
    pathDown: !!node.pathDown,
    offline_since: node.offline_since || null,
    children: [],
  };
  if (mode === 'lan') {
    out.parent_id = node.parent_id == null ? null : node.parent_id;
    out.location_id = node.location_id == null ? null : node.location_id;
    out.pos_x = node.pos_x == null ? null : node.pos_x;
    out.pos_y = node.pos_y == null ? null : node.pos_y;
  }
  out.children = (node.children || []).map((c) => treeNodeDto(c, mode));
  return out;
}

// في الوضع 'minimal' لا نُرسل بنية الشجرة — قائمة أجهزة مسطّحة بلا إحداثيات.
function flattenDeviceNodes(nodes, acc = []) {
  for (const n of nodes || []) {
    if (n.type === 'device') acc.push(treeNodeDto({ ...n, children: [] }, 'minimal'));
    if (n.children && n.children.length) flattenDeviceNodes(n.children, acc);
  }
  return acc;
}

function sanitizeTopology(roots, mode) {
  if (mode === 'minimal') return flattenDeviceNodes(roots);
  return (roots || []).map((n) => treeNodeDto(n, mode));
}

// أداة اختبار/تدقيق: أسماء الحقول الممنوعة التي يجب ألا تظهر في أي استجابة عامة.
const FORBIDDEN_PUBLIC_KEYS = ['ip', 'mac', 'mac_address', 'hostname', 'serial', 'port', 'web_port', 'check_protocol', 'password', 'token'];

function assertNoForbiddenKeys(value, path = '$') {
  const found = [];
  (function walk(v, p) {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, p + '[' + i + ']'));
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        if (FORBIDDEN_PUBLIC_KEYS.includes(k)) found.push(p + '.' + k);
        walk(val, p + '.' + k);
      }
    }
  })(value, path);
  return found;
}

module.exports = {
  MODES,
  DEFAULT_MODE,
  getMode,
  getModeSource,
  setMode,
  getNocMode,
  setNocMode,
  resolveNocMode,
  deviceDto,
  treeNodeDto,
  sanitizeTopology,
  assertNoForbiddenKeys,
  FORBIDDEN_PUBLIC_KEYS,
};
