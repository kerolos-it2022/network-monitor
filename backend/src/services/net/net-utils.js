// net-utils.js — دوال نقية للتعامل مع عناوين IPv4/IPv6 وCIDR (بلا I/O — قابلة للاختبار مباشرة).
// تُستخدم في بوابة أمان أدوات التشخيص (SEC-01) لمنع أي عنوان خارج النطاقات المسموح بها.
'use strict';
const net = require('net');

// تحويل IPv4 صارم إلى 4 بايتات. يرفض الصيغ الغامضة (أصفار بادئة مثل 010، أو أجزاء ناقصة).
function parseIPv4(str) {
  if (typeof str !== 'string') return null;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(str);
  if (!m) return null;
  const out = Buffer.alloc(4);
  for (let i = 0; i < 4; i++) {
    const part = m[i + 1];
    // منع الصيغة الثمانية الضمنية (010 = 8 عند بعض الأنظمة) — لبس أمني معروف.
    if (part.length > 1 && part[0] === '0') return null;
    const v = Number(part);
    if (v > 255) return null;
    out[i] = v;
  }
  return out;
}

// تحويل IPv6 إلى 16 بايتًا. يرفض zone id (%eth0) ويقبل الصيغة المضغوطة :: والـ IPv4 المدمج.
function parseIPv6(str) {
  if (typeof str !== 'string' || !str || str.includes('%')) return null;
  if (net.isIP(str) !== 6) return null;

  let s = str;
  let tailV4 = null;
  if (s.includes('.')) {
    const idx = s.lastIndexOf(':');
    if (idx === -1) return null;
    tailV4 = parseIPv4(s.slice(idx + 1));
    if (!tailV4) return null;
    const hi = ((tailV4[0] << 8) | tailV4[1]).toString(16);
    const lo = ((tailV4[2] << 8) | tailV4[3]).toString(16);
    s = s.slice(0, idx + 1) + hi + ':' + lo;
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null;

  let groups;
  if (tail === null) {
    groups = head;
    if (groups.length !== 8) return null;
  } else {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null;
    groups = head.concat(new Array(fill).fill('0'), tail);
  }

  const bytes = Buffer.alloc(16);
  for (let i = 0; i < 8; i++) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(groups[i])) return null;
    const v = parseInt(groups[i], 16);
    bytes[i * 2] = v >> 8;
    bytes[i * 2 + 1] = v & 0xff;
  }
  return bytes;
}

// عنوان → { family, bytes } أو null.
function ipToBytes(ip) {
  if (typeof ip !== 'string') return null;
  const fam = net.isIP(ip);
  if (fam === 4) {
    const bytes = parseIPv4(ip);
    return bytes ? { family: 4, bytes } : null;
  }
  if (fam === 6) {
    const bytes = parseIPv6(ip);
    return bytes ? { family: 6, bytes } : null;
  }
  return null;
}

// إذا كان العنوان IPv6 مُمَثِّلًا لعنوان IPv4 (::ffff:a.b.c.d) نُرجع بايتات IPv4.
function unwrapV4Mapped(bytes) {
  if (!bytes || bytes.length !== 16) return null;
  for (let i = 0; i < 10; i++) if (bytes[i] !== 0) return null;
  if (bytes[10] !== 0xff || bytes[11] !== 0xff) return null;
  return Buffer.from(bytes.slice(12));
}

// CIDR أو عنوان مفرد → { family, bytes, prefix } أو null.
function parseCidr(str) {
  if (typeof str !== 'string') return null;
  const s = str.trim();
  if (!s) return null;
  const slash = s.lastIndexOf('/');
  const addr = slash === -1 ? s : s.slice(0, slash);
  const fam = net.isIP(addr);
  if (!fam) return null;
  let prefix = fam === 4 ? 32 : 128;
  if (slash !== -1) {
    const p = s.slice(slash + 1);
    if (!/^\d{1,3}$/.test(p)) return null;
    prefix = Number(p);
    if (prefix > (fam === 4 ? 32 : 128)) return null;
  }
  const bytes = fam === 4 ? parseIPv4(addr) : parseIPv6(addr);
  if (!bytes) return null;
  return { family: fam, bytes, prefix };
}

// هل تقع البايتات داخل نطاق CIDR؟ (مقارنة بتّية على طول البادئة)
function inCidr(bytes, cidr) {
  if (!bytes || !cidr || bytes.length !== cidr.bytes.length) return false;
  const fullBytes = cidr.prefix >> 3;
  const restBits = cidr.prefix & 7;
  for (let i = 0; i < fullBytes; i++) {
    if (bytes[i] !== cidr.bytes[i]) return false;
  }
  if (restBits) {
    const mask = 0xff << (8 - restBits);
    if ((bytes[fullBytes] & mask) !== (cidr.bytes[fullBytes] & mask)) return false;
  }
  return true;
}

// النطاقات الخاصة/المحلية الافتراضية: RFC1918 + loopback + link-local + CGNAT + ULA (IPv6).
const DEFAULT_ALLOWED_CIDRS = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '100.64.0.0/10',
  'fc00::/7',
  'fe80::/10',
  '::1/128',
];

// هل العنوان خاص/محلي؟ (يُستعمل للتوثيق والتقارير — الفلترة الفعلية عبر قائمة CIDR)
function isPrivate(ipOrBytes) {
  let bytes;
  if (Buffer.isBuffer(ipOrBytes)) bytes = ipOrBytes;
  else {
    const parsed = ipToBytes(ipOrBytes);
    if (!parsed) return false;
    bytes = parsed.bytes;
  }
  if (bytes.length === 16) {
    const v4 = unwrapV4Mapped(bytes);
    if (v4) bytes = v4;
  }
  if (bytes.length === 4) {
    return DEFAULT_ALLOWED_CIDRS.some((c) => {
      const cidr = parseCidr(c);
      return cidr && cidr.family === 4 && inCidr(bytes, cidr);
    });
  }
  return DEFAULT_ALLOWED_CIDRS.some((c) => {
    const cidr = parseCidr(c);
    return cidr && cidr.family === 6 && inCidr(bytes, cidr);
  });
}

// تحليل قائمة CIDR نصية (مفصولة بفواصل) — تتجاهل الفارغ/غير الصالح.
function parseCidrList(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseCidr)
    .filter(Boolean);
}

// تمثيل نصي مختصر لعنوان IPv6 (للسجلات) — لا يلزم أن يكون الصيغة القياسية المضغوطة تمامًا.
function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes.length === 4) return Array.from(bytes).join('.');
  const groups = [];
  for (let i = 0; i < 8; i++) groups.push(bytes.readUInt16BE(i * 2).toString(16));
  return groups.join(':');
}

module.exports = {
  parseIPv4,
  parseIPv6,
  ipToBytes,
  unwrapV4Mapped,
  parseCidr,
  parseCidrList,
  inCidr,
  isPrivate,
  formatBytes,
  DEFAULT_ALLOWED_CIDRS,
};
