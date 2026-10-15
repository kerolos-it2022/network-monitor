// net-announce.service.js (v2.17.0) — «الاستماع بدل السؤال».
// ─────────────────────────────────────────────────────────────
// الأجهزة (ويندوز/طابعات/تلفزيونات/IoT) تُعلن أسماءها بنفسها عبر قنوات الإعلان،
// وجدران الحماية تسمح بالبث لأنه صادر من الجهاز نفسه — عكس الاستعلام الأحادي
// الذي يرفضه ويندوز من مصادر خارجية («Network» وAdvanced IP Scanner يشتغلان بذلك).
// القنوات المنفذة هنا (كلها Node خام — صفر اعتمادات):
//   1) mDNS (UDP 5353 — استعلام + استماع): خرائط hostname/IP وأسماء الخدمات.
//   2) WS-Discovery (UDP 3702 بثّ Probe): جرد أجهزة ويندوز (IP + محاولة استخراج الاسم).
//   3) SSDP (UDP 1900 M-SEARCH): أسماء ووصف لأجهزة UPnP (تلفزيونات/راوترات/طابعات).
// الناتج: Map من IP → أفضل اسم استُخرج، لتُستخدم في الاكتشاف بأولوية قصوى.
const dgram = require('dgram');

const MDNS_GROUP = '224.0.0.251';
const MDNS_PORT = 5353;
const WSD_ADDR = '239.255.255.250';
const WSD_PORT = 3702;
const SSDP_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;

// ── أدوات DNS ──
// encodeDnsName('a.b') → بايتات DNS (طول+جزء … 0)
function encodeDnsName(name) {
  const parts = String(name).replace(/\.$/, '').split('.');
  const chunks = [];
  for (const part of parts) {
    const bytes = Buffer.from(part, 'utf8');
    if (bytes.length > 63) return null;
    chunks.push(Buffer.from([bytes.length]), bytes);
  }
  chunks.push(Buffer.from([0]));
  return Buffer.concat(chunks);
}

// readDnsName(buf, offset): قراءة اسم مع دعم الضغط (مؤشرات 0xC0…)
function readDnsName(buf, offset, depth = 0) {
  let labels = [];
  let pos = offset;
  let jumped = false;
  let next = null;
  let guard = 0;
  while (guard++ < 60) {
    const len = buf[pos];
    if (len === 0) { if (!jumped) next = pos + 1; break; }
    if ((len & 0xC0) === 0xC0) {
      if (depth === 0) next = pos + 2;
      const ptr = ((len & 0x3F) << 8) | buf[pos + 1];
      pos = ptr;
      jumped = true;
      continue;
    }
    labels.push(buf.slice(pos + 1, pos + 1 + len).toString('utf8'));
    pos += len + 1;
  }
  return { name: labels.join('.'), next };
}

// parseMdnsPacket(msg, names): يقرأ الأسئلة والإجابات ويجمع خرائط ip→name واسم→ip
function parseMdnsPacket(msg, result) {
  if (msg.length < 12) return;
  const qd = msg.readUInt16BE(4);
  const an = msg.readUInt16BE(6);
  let pos = 12;
  for (let q = 0; q < qd && pos < msg.length; q++) {
    const r = readDnsName(msg, pos, 1);
    pos = r.next + 4; // type + class
  }
  const readRecord = (section) => {
    const r = readDnsName(msg, pos, 1);
    pos = r.next;
    if (pos + 10 > msg.length) return;
    const type = msg.readUInt16BE(pos); pos += 2;
    pos += 2; // class
    pos += 4; // ttl
    const rdlen = msg.readUInt16BE(pos); pos += 2;
    const rdata = msg.slice(pos, pos + rdlen);
    pos += rdlen;
    if (type === 1 && rdata.length === 4) {          // A
      const ip = rdata.join('.');
      if (!result.ipToName.has(ip) && r.name && r.name !== 'local') {
        result.ipToName.set(ip, r.name.replace(/\.local\.?$/i, ''));
        result.mdnsIps.add(ip);
      }
    } else if (type === 12 && rdata.length >= 2) {    // PTR — اسم النسخة/الجهاز
      const p = readDnsName(msg, pos - rdlen, 1);
      const instance = p.name.split('.')[0];
      if (instance && instance.length > 1) result.mdnsInstances.add(instance);
    }
  };
  for (let i = 0; i < an && pos < msg.length; i++) readRecord('answer');
  // إضافات إضافية (additional) فيها سجلات A نافعة أيضًا
  for (let i = 0; i < 12 && pos < msg.length; i++) readRecord('additional');
}

// buildMdnsQuery(name, type): رسالة سؤال mDNS بسيطة
function buildMdnsQuery(name, type) {
  const hdr = Buffer.alloc(12);
  hdr.writeUInt16BE(0, 0);        // id=0 (mDNS: صفر)
  hdr.writeUInt16BE(0, 2);        // flags
  hdr.writeUInt16BE(1, 4);        // QDCOUNT=1
  const q = encodeDnsName(name);
  const tail = Buffer.from([0, type & 0xFF, 0, 1]); // QTYPE + IN
  return Buffer.concat([hdr, q, tail]);
}

// ── المجمّع الرئيسي ──
// collectAnnouncementNames(timeoutMs): يفتح مقابس الاستماع في آن واحد ويحقن الاستعلامات،
// وبعد انتهاء المهلة يعيد { ipToName: Map, mdnsIps: Set, wsdIps: Set, ssdp: [names] }.
async function collectAnnouncementNames(timeoutMs = 6000) {
  const result = { ipToName: new Map(), mdnsIps: new Set(), wsdIps: new Set(), ssdp: [] };

  // 1) mDNS — مقبس على 5353 مع اشتراك المجموعة
  const mdns = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  try {
    mdns.bind(MDNS_PORT, () => {
      try { mdns.addMembership(MDNS_GROUP); } catch (e) {}
    });
    mdns.on('message', (msg) => parseMdnsPacket(msg, result));
    mdns.on('error', () => {});
    // سؤال meta (+ الأنواع الشائعة مباشرة لتسريع الرد)
    const queries = [
      buildMdnsQuery('_services._dns-sd._udp.local', 12),
      buildMdnsQuery('_workstation._tcp.local', 12),
      buildMdnsQuery('_smb._tcp.local', 12),
      buildMdnsQuery('_device-information._tcp.local', 12),
      buildMdnsQuery('_ipp._tcp.local', 12),
      buildMdnsQuery('_printer._tcp.local', 12),
      buildMdnsQuery('_http._tcp.local', 12),
    ];
    setTimeout(() => {
      for (const q of queries) { try { mdns.send(q, MDNS_PORT, MDNS_GROUP); } catch (e) {} }
    }, 300);
  } catch (e) { try { mdns.close(); } catch (e2) {} }

  // 2) WS-Discovery — بث Probe على 3702 (IPات أجهزة الويندوز + محاولة استخراج اسم)
  const wsd = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  try {
    wsd.bind(() => {
      wsd.on('message', (msg, rinfo) => {
        try {
          const xml = msg.toString('utf8');
          if (!/ProbeMatch/i.test(xml)) return;
          result.wsdIps.add(rinfo.address);
          // بعض الردود تحتوي اسم الجهاز نصًّا (FriendlyName/ادراجه) — نلتقط أول اسم لاتيني نافع
          if (!result.ipToName.has(rinfo.address)) {
            const m = xml.match(/<pnpx:HardwareId>([^<]{2,60})<\//i)
                  || xml.match(/>([A-Za-z0-9][A-Za-z0-9\-_ ]{2,40})<\/pnpx:DeviceDescription>/i);
            if (m) result.ipToName.set(rinfo.address, m[1].trim());
          }
        } catch (e) {}
      });
      wsd.on('error', () => {});
      const guid = 'urn:uuid:' + '12345678-1234-1234-1234-123456789abc';
      const probe =
        '<?xml version="1.0" encoding="utf-8"?>' +
        '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" ' +
        'xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing" ' +
        'xmlns:wsd="http://schemas.xmlsoap.org/ws/2005/04/discovery">' +
        '<soap:Header><wsa:Action>http://schemas.xmlsoap.org/ws/2004/08/discovery/Probe</wsa:Action>' +
        '<wsa:MessageID>' + guid + '</wsa:MessageID>' +
        '<wsa:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</wsa:To></soap:Header>' +
        '<soap:Body><wsd:Probe><wsd:Types>wsdp:Device</wsd:Types></wsd:Probe></soap:Body></soap:Envelope>';
      wsd.send(probe, WSD_PORT, WSD_ADDR, () => {});
    });
  } catch (e) { try { wsd.close(); } catch (e2) {} }

  // 3) SSDP — M-SEARCH على 1900 (أسماء أجهزة UPnP)
  const ssdp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  try {
    ssdp.bind(() => {
      ssdp.on('message', (msg, rinfo) => {
        try {
          const text = msg.toString('utf8');
          const server = (text.match(/SERVER:\s*([^\r\n]+)/i) || [])[1] || '';
          const usn = (text.match(/USN:\s*([^\r\n]+)/i) || [])[1] || '';
          if (server || usn) result.ssdp.push({ ip: rinfo.address, server: server.trim(), usn: usn.trim() });
        } catch (e) {}
      });
      ssdp.on('error', () => {});
      const msearch = 'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n';
      ssdp.send(msearch, SSDP_PORT, SSDP_ADDR, () => {});
    });
  } catch (e) { try { ssdp.close(); } catch (e2) {} }

  // انتظار المهلة ثم إغلاق المقابس
  await new Promise((r) => setTimeout(r, timeoutMs));
  try { mdns.close(); } catch (e) {}
  try { wsd.close(); } catch (e) {}
  try { ssdp.close(); } catch (e) {}

  // تدفّق SSDP/أسماء الأنواع في الخريطة إن لم يكن لـ IP اسم أفضل
  for (const s of result.ssdp) {
    if (!result.ipToName.has(s.ip) && s.server) {
      const nice = String(s.server).split('/')[0].trim();
      if (nice && !/^unknown/i.test(nice)) result.ipToName.set(s.ip, nice);
    }
  }
  return result;
}

module.exports = { collectAnnouncementNames, deviceIconKeys: true };

// ═════════════════════════════════════════════════════════════
// v2.27.0 — المستمع الدائم (Persistent Listener): بدل 6 ثوانٍ أثناء
// المسح فقط، نسمع باستمرار بثّ mDNS (وإشعارات SSDP) ونُخزّن كل اسم
// يُسمَع في جدول discovery_names (ip → name) — نفس آلية عمل «الشبكة»
// في ويندوز وAdvanced IP Scanner: الأسماء تتراكم لوحدها طول اليوم.
// ═════════════════════════════════════════════════════════════
const db = require('../db');

let persistentStarted = false;

// recordName(ip, name, source): كتابة في الكاش — الاسم الأطول (الأغنى) يفوز.
function recordName(ip, name, source) {
  try {
    const clean = String(name || '').trim();
    if (!ip || !clean || clean.length < 2) return;
    if (/^[0-9]+(\.[0-9]+){3}$/.test(clean)) return; // لا نخزّن IP كاسم
    db.prepare(
      "INSERT INTO discovery_names (ip, name, source, updated_at) VALUES (?, ?, ?, datetime('now')) " +
      "ON CONFLICT(ip) DO UPDATE SET name = CASE WHEN length(excluded.name) > length(discovery_names.name) THEN excluded.name ELSE discovery_names.name END, updated_at = datetime('now')"
    ).run(String(ip), clean, String(source || 'listener'));
  } catch (e) { /* كاش الأسماء لا يُفشل شيئًا أبدًا */ }
}

function startPersistentListener() {
  if (persistentStarted) return;
  persistentStarted = true;
  // ── mDNS (UDP 5353) — استماع سلبي بصمت: إجابات/إعلانات الأجهزة ──
  try {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('error', () => { try { sock.close(); } catch (_) {} });
    sock.on('message', (msg, rinfo) => {
      try {
        const result = { ipToName: new Map(), nameToIp: new Map(), ssdp: [] };
        parseMdnsPacket(msg, result);
        for (const [ip, name] of result.ipToName) recordName(ip, name, 'mdns');
        for (const [name, ip] of result.nameToIp) recordName(ip, name, 'mdns');
      } catch (_) {}
    });
    sock.bind(MDNS_PORT, () => { try { sock.addMembership(MDNS_GROUP); } catch (_) {} });
  } catch (e) {
    console.error('[net-announce] تعذّر بدء المستمع الدائم (mDNS):', e.message);
  }
  // ── SSDP (UDP 1900) — إشعارات NOTIFY السلبية من أجهزة UPnP ──
  try {
    const ssdp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    ssdp.on('error', () => { try { ssdp.close(); } catch (_) {} });
    ssdp.on('message', (msg, rinfo) => {
      try {
        const text = msg.toString('utf8');
        const pick = (key) => {
          const i = text.toLowerCase().indexOf(key);
          if (i === -1) return null;
          let v = text.slice(i + key.length).replace(/^[ \t:]+/, '');
          const j = v.search(/\r|\n/);
          if (j !== -1) v = v.slice(0, j);
          return v.trim();
        };
        let name = pick('server:');
        const loc = pick('location:');
        if (loc) {
          try { const u = new URL(loc); const h = u.hostname; if (!/^[0-9]/.test(h)) name = h; } catch (_) {}
        }
        if (name) recordName(rinfo.address, name, 'ssdp');
      } catch (_) {}
    });
    ssdp.bind(SSDP_PORT, () => { try { ssdp.addMembership(SSDP_ADDR); } catch (_) {} });
  } catch (e) { /* SSDP اختياري */ }
  console.log('[net-announce] المستمع الدائم يعمل — أسماء الأجهزة تتراكم في discovery_names');
}

// getNameForIp(ip): أفضل اسم معروف لهذا العنوان (من الكاش الدائم).
function getNameForIp(ip) {
  try {
    const r = db.prepare('SELECT name FROM discovery_names WHERE ip = ?').get(String(ip));
    return r && r.name ? String(r.name) : null;
  } catch (e) { return null; }
}

module.exports.persistent = { startPersistentListener, getNameForIp, recordName };
