// target-guard.js — بوابة أمان أهداف التشخيص (SEC-01).
// المسؤولية: التحقق الصارم من صيغة الهدف (IP/اسم مضيف) + التحقق من أنه داخل النطاقات
// المسموح بها فقط + حلّ الاسم إلى IP واعتماد الـ IP نفسه للتنفيذ (منع DNS rebinding).
// لا يتعامل هذا الملف مع Express ولا مع child_process — قابل للاختبار مباشرة.
'use strict';
const net = require('net');
const dns = require('dns');
const { ipToBytes, unwrapV4Mapped, parseCidrList, inCidr, DEFAULT_ALLOWED_CIDRS, formatBytes } = require('./net-utils');

// اسم مضيف صارم: ASCII فقط، تسميات 1-63، بلا شرطة في البداية/النهاية، بطول ≤253.
// يسمح بتسمية واحدة (أسماء الأجهزة المحلية مثل synology) لأن الشبكات المنزلية تعتمدها.
const HOSTNAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

// محارف ممنوعة صراحةً (محارف شل، اقتباس، مسافات/تحكم، Unicode، بدائل مسار ملفات).
// ملاحظة: تُطبَّق قبل أي تفسير آخر — أي هدف يخالفها يُرفض بلا استثناء.
const FORBIDDEN_CHARS_RE = /[^a-z0-9.\-:]/;
const CONTROL_OR_SPACE_RE = /[\s\x00-\x1f\x7f]/;

// التحقق الشكلي من الهدف. يُرجع:
//   { ok:true, kind:'ipv4'|'ipv6'|'hostname', value, bytes? }
//   { ok:false, error:'<رسالة عربية>' }
function validateTarget(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'IP/Host غير صالح' };
  const value = raw.trim();
  if (!value) return { ok: false, error: 'IP/Host غير صالح' };
  if (value.length > 253) return { ok: false, error: 'IP/Host أطول من المسموح' };
  if (CONTROL_OR_SPACE_RE.test(value)) {
    return { ok: false, error: 'IP/Host يحتوي مسافات أو محارف تحكم غير مسموحة' };
  }
  if (value.startsWith('-')) {
    return { ok: false, error: 'IP/Host لا يبدأ بشرطة' };
  }

  const fam = net.isIP(value);
  if (fam === 4 || fam === 6) {
    const parsed = ipToBytes(value);
    if (!parsed) return { ok: false, error: 'IP غير صالح' };
    return { ok: true, kind: fam === 4 ? 'ipv4' : 'ipv6', value, bytes: parsed.bytes };
  }

  const host = value.toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253) return { ok: false, error: 'اسم مضيف غير صالح' };
  if (FORBIDDEN_CHARS_RE.test(host)) {
    return { ok: false, error: 'اسم مضيف يحتوي محارف غير مسموحة (يُقبل ASCII فقط)' };
  }
  if (!host.includes('.') && /^\d+$/.test(host)) {
    return { ok: false, error: 'اسم مضيف غير صالح' };
  }
  // أرقام/نقاط فقط (مثل 1.2.3) — لبس مع IPv4 جزئي ⇒ رفض.
  if (/^[0-9.]+$/.test(host)) {
    return { ok: false, error: 'IP غير مكتمل — اكتب أربعة أجزاء أو اسم مضيف صحيح' };
  }
  if (!HOSTNAME_RE.test(host)) return { ok: false, error: 'اسم مضيف غير صالح' };
  if (host.split('.').some((label) => label.length > 63)) {
    return { ok: false, error: 'اسم مضيف غير صالح (تسمية أطول من 63)' };
  }
  return { ok: true, kind: 'hostname', value: host };
}

// قراءة قائمة النطاقات المسموح بها من البيئة (NM_TOOLS_ALLOWED_CIDRS)، وإلا الافتراضي الخاص.
function allowedCidrs(env = process.env) {
  const raw = env.NM_TOOLS_ALLOWED_CIDRS;
  if (raw && raw.trim()) {
    const list = parseCidrList(raw);
    if (list.length) return list;
  }
  return parseCidrList(DEFAULT_ALLOWED_CIDRS.join(','));
}

function allowPublicTargets(env = process.env) {
  return String(env.NM_TOOLS_ALLOW_PUBLIC || '') === '1';
}

// هل البايتات داخل النطاقات المسموح بها؟ (المطابقة تشمل IPv4-mapped IPv6)
function isAddressAllowed(bytes, cidrs) {
  let b = bytes;
  if (b.length === 16) {
    const v4 = unwrapV4Mapped(b);
    if (v4) b = v4;
  }
  return cidrs.some((cidr) => cidr.family === (b.length === 4 ? 4 : 6) && inCidr(b, cidr));
}

// المنطق الكامل للتصريح: شكل صحيح ⇒ حلّ الاسم (إن لزم) ⇒ كل العناوين داخل النطاق المسموح.
// عند النجاح يُعاد address = عنوان IP فعلي يُمرَّر للأمر (لا نمرّر الاسم أبدًا ⇒ لا rebinding).
async function authorizeTarget(raw, opts = {}) {
  const env = opts.env || process.env;
  const resolve = opts.resolve || ((host) => dns.promises.lookup(host, { all: true, verbatim: true }));
  const cidrs = opts.cidrs || allowedCidrs(env);
  const allowPublic = opts.allowPublic !== undefined ? opts.allowPublic : allowPublicTargets(env);

  const v = validateTarget(raw);
  if (!v.ok) return v;

  if (v.kind === 'ipv4' || v.kind === 'ipv6') {
    if (!allowPublic && !isAddressAllowed(v.bytes, cidrs)) {
      return { ok: false, error: 'العنوان خارج نطاقات الشبكة المسموح بها', code: 'TARGET_NOT_ALLOWED' };
    }
    return { ok: true, kind: v.kind, value: v.value, address: v.value };
  }

  let records;
  try {
    records = await resolve(v.value);
  } catch (e) {
    return { ok: false, error: 'تعذّر تحويل اسم المضيف إلى عنوان (DNS)', code: 'DNS_FAILED' };
  }
  if (!Array.isArray(records)) records = [records];
  const addrs = records
    .map((r) => (typeof r === 'string' ? { address: r } : r))
    .filter((r) => r && typeof r.address === 'string');
  if (!addrs.length) return { ok: false, error: 'تعذّر تحويل اسم المضيف إلى عنوان (DNS)', code: 'DNS_FAILED' };

  if (!allowPublic) {
    for (const r of addrs) {
      const parsed = ipToBytes(r.address);
      if (!parsed || !isAddressAllowed(parsed.bytes, cidrs)) {
        return { ok: false, error: 'اسم المضيف يحلّ إلى عنوان خارج النطاقات المسموح بها', code: 'TARGET_NOT_ALLOWED' };
      }
    }
  }
  return { ok: true, kind: 'hostname', value: v.value, address: formatBytes(ipToBytes(addrs[0].address).bytes) };
}

module.exports = {
  validateTarget,
  allowedCidrs,
  allowPublicTargets,
  isAddressAllowed,
  authorizeTarget,
  HOSTNAME_RE,
};
