// scan.routes.js: API لاكتشاف الأجهزة في الشبكة (Network Discovery).
const express = require('express');
const { spawn } = require('child_process');
const ping = require('ping');
const portscanner = require('portscanner');
const macaddress = require('macaddress');
const dns = require('dns');
const SNMP = require('snmp-native');

const router = express.Router();
const db = require('../db');

// تخزين نتائج المسح لكل scanId (في الذاكرة)
const scanResults = {};
// v2.11.7 — آخر نتيجة مسح محفوظة على الخادم (لا تُحذف مثل scanResults) ⇒ تُخدَم عبر
// GET /api/scan/last، وعبر /results/:scanId كبديل احتياطي بعد انتهاء صلاحية scanResults (60ث).
let lastScan = null;

// التحقق من صحة CIDR
function isValidCIDR(cidr) {
  const regex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
  if (!regex.test(cidr)) return false;
  const [ip, mask] = cidr.split('/');
  const octets = ip.split('.').map(Number);
  if (octets.some(o => o < 0 || o > 255)) return false;
  if (Number(mask) < 1 || Number(mask) > 32) return false;
  return true;
}

// v2.16.1 — تشخيص الاسم لجهاز مفرد: يجرب الطرق الثلاث ويعيد النتائج الخام.
router.get('/name-diag', async (req, res) => {
  const ip = String(req.query.ip || '').trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    return res.status(400).json({ success: false, error: 'IP غير صالح' });
  }
  const out = {};
  const t0 = Date.now();
  out.nbns = await getNetBIOSName(ip, 1500);
  out.nbns_ms = Date.now() - t0;
  const t1 = Date.now();
  out.smb = await getSMBName(ip);
  out.smb_ms = Date.now() - t1;
  const t2 = Date.now();
  try {
    const hosts = await new Promise((resolve) => dns.reverse(ip, (err, h) => resolve(err ? null : h)));
    out.reverse_dns = hosts && hosts.length ? hosts[0] : null;
  } catch (e) { out.reverse_dns = null; }
  out.reverse_dns_ms = Date.now() - t2;
  out.resolved = out.nbns || out.smb || out.reverse_dns || null;
  res.json({ success: true, ip, ...out });
});

// تحويل CIDR إلى مصفوفة عناوين IP
function cidrToIPs(cidr) {
  const [ip, mask] = cidr.split('/');
  const octets = ip.split('.').map(Number);
  const ipNum = (octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3];
  const maskNum = ~((1 << (32 - Number(mask))) - 1);
  const network = ipNum & maskNum;
  const broadcast = network | ~maskNum;
  const ips = [];
  for (let i = network + 1; i < broadcast; i++) {
    ips.push(
      ((i >> 24) & 255) + '.' +
      ((i >> 16) & 255) + '.' +
      ((i >> 8) & 255) + '.' +
      (i & 255)
    );
  }
  return ips;
}

// الحصول على MAC vendor من OUI
const OUI_DATABASE = {
  '00:50:56': 'VMware',
  '00:0C:29': 'VMware',
  '00:1C:42': 'Parallels',
  '08:00:27': 'VirtualBox',
  '00:15:5D': 'Microsoft Hyper-V',
  '00:03:FF': 'Microsoft',
  '00:1D:D8': 'Microsoft',
  '00:0D:3A': 'Microsoft',
  '00:17:FA': 'Microsoft',
  '3C:5A:B4': 'Google',
  '48:D7:05': 'Raspberry Pi Foundation',
  'B8:27:EB': 'Raspberry Pi Foundation',
  'DC:A6:32': 'Raspberry Pi Foundation',
  'E4:5F:01': 'Raspberry Pi Foundation',
  '28:CD:C1': 'Raspberry Pi Foundation',
  '00:1A:11': 'Google',
  '00:23:AE': 'Apple',
  '00:25:4B': 'Apple',
  '00:1B:63': 'Apple',
  '3C:07:54': 'Apple',
  'F0:D1:A9': 'Apple',
  'AC:BC:32': 'Apple',
  '00:1E:C2': 'Cisco',
  '00:1B:54': 'Cisco',
  '00:23:EB': 'Cisco',
  '00:1D:45': 'Cisco',
  '00:1A:6C': 'Cisco',
  '00:0C:29': 'VMware',
  '00:50:56': 'VMware',
  '00:05:69': 'VMware',
  '00:0C:29': 'VMware',
  '00:1C:14': 'VMware',
  '00:1D:D8': 'Microsoft',
  '00:15:5D': 'Microsoft Hyper-V',
  '00:22:48': 'Microsoft',
  '00:24:81': 'Microsoft',
  '00:26:B9': 'Microsoft',
  '00:1C:42': 'Parallels',
  '00:1F:D0': 'Parallels',
  '08:00:27': 'VirtualBox',
  '0A:00:27': 'VirtualBox',
  '00:16:3E': 'Xen',
  '52:54:00': 'QEMU/KVM',
  '00:1A:4D': 'Xen',
  '00:21:F6': 'Xen',
  '00:24:E8': 'Xen',
  '00:25:90': 'Xen',
  '00:1B:21': 'Intel Corporate',
  '00:1C:C0': 'Intel Corporate',
  '00:1E:67': 'Intel Corporate',
  '00:1F:16': 'Intel Corporate',
  '00:21:5A': 'Intel Corporate',
  '00:22:68': 'Intel Corporate',
  '00:23:54': 'Intel Corporate',
  '00:24:E8': 'Intel Corporate',
  '00:25:90': 'Intel Corporate',
  '00:26:55': 'Intel Corporate',
  '00:27:10': 'Intel Corporate',
  '00:1B:21': 'Intel Corporate',
  '00:1C:C4': 'Intel Corporate',
  '00:1E:0B': 'Intel Corporate',
  '00:1F:3A': 'Intel Corporate',
  '00:21:6A': 'Intel Corporate',
  '00:22:FB': 'Intel Corporate',
  '00:23:AE': 'Intel Corporate',
  '00:24:D7': 'Intel Corporate',
  '00:25:64': 'Intel Corporate',
  '00:26:B9': 'Intel Corporate',
  '00:27:0E': 'Intel Corporate',
  '00:1C:23': 'Dell',
  '00:1E:C9': 'Dell',
  '00:21:70': 'Dell',
  '00:22:19': 'Dell',
  '00:23:AE': 'Dell',
  '00:24:E8': 'Dell',
  '00:25:64': 'Dell',
  '00:26:B9': 'Dell',
  '00:1A:A0': 'HP',
  '00:1B:78': 'HP',
  '00:1C:C4': 'HP',
  '00:1E:0B': 'HP',
  '00:1F:29': 'HP',
  '00:21:5A': 'HP',
  '00:22:64': 'HP',
  '00:23:7D': 'HP',
  '00:24:81': 'HP',
  '00:25:B3': 'HP',
  '00:26:55': 'HP',
  '00:1E:68': 'Hikvision',
  '00:1F:E2': 'Hikvision',
  '00:22:68': 'Hikvision',
  '00:23:AE': 'Hikvision',
  '00:24:E8': 'Hikvision',
  '00:25:64': 'Hikvision',
  '00:26:B9': 'Hikvision',
  '00:1C:28': 'Dahua',
  '00:1E:68': 'Dahua',
  '00:1F:E2': 'Dahua',
  '00:22:68': 'Dahua',
  '00:23:AE': 'Dahua',
  '00:24:E8': 'Dahua',
  '00:25:64': 'Dahua',
  '00:26:B9': 'Dahua',
  '00:1B:21': 'Axis',
  '00:1C:C4': 'Axis',
  '00:1E:0B': 'Axis',
  '00:1F:3A': 'Axis',
  '00:21:6A': 'Axis',
  '00:22:FB': 'Axis',
  '00:23:AE': 'Axis',
  '00:24:D7': 'Axis',
  '00:25:64': 'Axis',
  '00:26:B9': 'Axis',
  '00:1C:B3': 'Ubiquiti',
  '00:1E:0B': 'Ubiquiti',
  '00:1F:3A': 'Ubiquiti',
  '00:21:6A': 'Ubiquiti',
  '00:22:FB': 'Ubiquiti',
  '00:23:AE': 'Ubiquiti',
  '00:24:D7': 'Ubiquiti',
  '00:25:64': 'Ubiquiti',
  '00:26:B9': 'Ubiquiti',
  '00:1A:2C': 'MikroTik',
  '00:1B:21': 'MikroTik',
  '00:1C:C4': 'MikroTik',
  '00:1E:0B': 'MikroTik',
  '00:1F:3A': 'MikroTik',
  '00:21:6A': 'MikroTik',
  '00:22:FB': 'MikroTik',
  '00:23:AE': 'MikroTik',
  '00:24:D7': 'MikroTik',
  '00:25:64': 'MikroTik',
  '00:26:B9': 'MikroTik',
  '00:1C:23': 'Synology',
  '00:1E:68': 'Synology',
  '00:1F:E2': 'Synology',
  '00:22:68': 'Synology',
  '00:23:AE': 'Synology',
  '00:24:E8': 'Synology',
  '00:25:64': 'Synology',
  '00:26:B9': 'Synology',
  '00:1B:21': 'QNAP',
  '00:1C:C4': 'QNAP',
  '00:1E:0B': 'QNAP',
  '00:1F:3A': 'QNAP',
  '00:21:6A': 'QNAP',
  '00:22:FB': 'QNAP',
  '00:23:AE': 'QNAP',
  '00:24:D7': 'QNAP',
  '00:25:64': 'QNAP',
  '00:26:B9': 'QNAP',
};

// تحديد الشركة المصنعة من MAC address
function getMacVendor(mac) {
  if (!mac) return 'غير معروف';
  const oui = mac.substring(0, 8).toUpperCase();
  return OUI_DATABASE[oui] || 'غير معروف';
}

// محاولة حل اسم المضيف (Reverse DNS Lookup)
async function resolveHostname(ip) {
  try {
    const { promisify } = require('dns');
    const reverse = promisify(require('dns').reverse);
    const hostnames = await reverse(ip);
    if (hostnames && hostnames.length > 0) {
      // إرجاع أول اسم مضيف صالح (إزالة النطاق إذا وجد)
      return hostnames[0].split('.')[0];
    }
  } catch (e) {
    // تجاهل أخطاء DNS
  }
  return null;
}

// محاولة الحصول على MAC address لجهاز (ARP)
async function getMacAddress(ip) {
  try {
    // في Windows: arp -a <ip>
    // في Linux: arp -n <ip> أو ip neigh show <ip>
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'arp' : 'arp';
    const args = isWin ? ['-a', ip] : ['-n', ip];
    
    return new Promise((resolve) => {
      const child = spawn(cmd, args);
      let output = '';
      child.stdout.on('data', (data) => { output += data.toString(); });
      child.on('close', () => {
        // تحليل المخرجات للعثور على MAC
        const lines = output.split('\n');
        for (const line of lines) {
          if (line.includes(ip)) {
            const macMatch = line.match(/([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}/);
            if (macMatch) {
              resolve(macMatch[0].replace(/-/g, ':'));
              return;
            }
          }
        }
        resolve(null);
      });
      child.on('error', () => resolve(null));
    });
  } catch (e) {
    return null;
  }
}

// فحص المنافذ الشائعة لتحديد نوع الجهاز
const COMMON_PORTS = {
  21: 'FTP',
  22: 'SSH',
  23: 'Telnet',
  25: 'SMTP',
  53: 'DNS',
  80: 'HTTP',
  110: 'POP3',
  135: 'RPC',
  139: 'NetBIOS',
  143: 'IMAP',
  443: 'HTTPS',
  445: 'SMB',
  993: 'IMAPS',
  995: 'POP3S',
  1723: 'PPTP',
  3306: 'MySQL',
  3389: 'RDP',
  5432: 'PostgreSQL',
  5900: 'VNC',
  8080: 'HTTP-Alt',
  8443: 'HTTPS-Alt',
  9100: 'Printer',
  554: 'RTSP (Camera)',
  8000: 'HTTP-Alt',
  8081: 'HTTP-Alt',
  8888: 'HTTP-Alt',
};

// مسح المنافذ لجهاز واحد
async function scanPorts(ip) {
  const openPorts = [];
  const portsToScan = Object.keys(COMMON_PORTS).map(Number);
  
  // مسح متزامن للمنافذ (أسرع بكثير)
  const promises = portsToScan.map(port => 
    new Promise((resolve) => {
      portscanner.checkPortStatus(port, ip, (error, status) => {
        resolve({ port, isOpen: status === 'open' });
      });
    })
  );
  
  const results = await Promise.all(promises);
  for (const { port, isOpen } of results) {
    if (isOpen) {
      openPorts.push({ port, service: COMMON_PORTS[port] });
    }
  }
  return openPorts;
}

// حل اسم المضيف (Reverse DNS Lookup)
function resolveHostname(ip) {
  return new Promise((resolve) => {
    dns.reverse(ip, (err, hostnames) => {
      if (err || !hostnames || hostnames.length === 0) {
        resolve(null);
      } else {
        // إرجاع أول hostname صالح (تنظيف النقطة في النهاية)
        const hostname = hostnames[0].replace(/\.$/, '');
        resolve(hostname);
      }
    });
  });
}

// محاولة الحصول على اسم SMB/NetBIOS
// ── v2.16.0 — استعلام NBNS مباشر (UDP 137) للحصول على الاسم الحقيقي من الجهاز نفسه ──
// لا يحتاج nbtstat/nmblookup ولا SMB مفتوحًا — يشتغل على أي جهاز ويندوز/سامبا تقريبًا.
const dgram = require('dgram');
function getNetBIOSName(ip, timeoutMs = 700) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    let done = false;
    const finish = (name) => { if (!done) { done = true; try { sock.close(); } catch (e) {} resolve(name); } };
    // بناء Node Status Query: اسم '*' مرمَّز بصيغة NetBIOS (كل نصف بايت + 'A')
    const hdr = Buffer.alloc(12);
    hdr.writeUInt16BE(Math.floor(Math.random() * 65535), 0);
    hdr.writeUInt16BE(0x0010, 2);   // flags: recursion desired
    hdr.writeUInt16BE(1, 4);        // QDCOUNT=1
    const nm = Buffer.alloc(16, 0x20); nm.write('*');
    let qname = '';
    for (const b of nm) {
      qname += String.fromCharCode(0x41 + ((b >> 4) & 0xF)) + String.fromCharCode(0x41 + (b & 0xF));
    }
    const qtail = Buffer.from([0x00, 0x00, 0x21, 0x00, 0x01]);   // null + QTYPE NBSTAT + IN
    const pkt = Buffer.concat([hdr, Buffer.from([32]), Buffer.from(qname, 'ascii'), qtail]);
    sock.on('message', (msg) => {
      try {
        if (msg.length < 60) return;
        // الإجابة: ... ptr(2) + TYPE 0x21 + CLASS 1 + TTL(4) + RDLEN(2) + RDATA(count=1 + 18 بايت للاسم)
        // نجد آخر تواجد لمؤشر النمط (TYPE NBSTAT = 00 21 00 01) ثم نقرأ RDATA منه.
        const pat = Buffer.from([0x00, 0x21, 0x00, 0x01]);
        let j = -1;
        for (let i = msg.length - 6; i >= 20; i--) {
          if (msg[i] === pat[0] && msg[i + 1] === pat[1] && msg[i + 2] === pat[2] && msg[i + 3] === pat[3]) { j = i; break; }
        }
        if (j === -1) return finish(null);
        const rdlen = msg.readUInt16BE(j + 8);
        const rdata = msg.slice(j + 10);
        const count = rdata[0];
        if (!count || rdlen < 19) return finish(null);
        // أول اسم نظام (suffix 0x00 = Workstation) وإلا الأول
        let chosen = null;
        for (let k = 0; k < count && (11 + k * 18 + 15) <= rdata.length; k++) {
          const raw = rdata.slice(11 + k * 18, 11 + k * 18 + 15).toString('ascii').replace(/[\s ]+$/g, '');
          const suffix = rdata[11 + k * 18 + 15];
          if (suffix === 0x00 && raw) { chosen = raw; break; }
          if (!chosen && raw) chosen = raw;
        }
        finish(chosen || null);
      } catch (e) { /* تجاهل — المهلة ستغلق */ }
    });
    sock.on('error', () => finish(null));
    sock.send(pkt, 137, ip, () => {});
    setTimeout(() => finish(null), timeoutMs);
  });
}

async function getSMBName(ip) {
  try {
    const isWin = process.platform === 'win32';
    if (isWin) {
      // Windows: استخدام nbtstat
      const { spawn } = require('child_process');
      return new Promise((resolve) => {
        const child = spawn('nbtstat', ['-A', ip]);
        let output = '';
        child.stdout.on('data', (data) => { output += data.toString(); });
        child.on('close', () => {
          // تحليل المخرجات للعثور على اسم NetBIOS
          const lines = output.split('\n');
          for (const line of lines) {
            // يبحث عن سطر يحتوي على اسم NetBIOS (عادة ما يكون أول سطر بعد IP)
            const match = line.match(/^\s+([A-Z0-9\-_]{1,15})\s+<\d+>\s+(?:UNIQUE|GROUP)/);
            if (match && match[1]) {
              resolve(match[1]);
              return;
            }
          }
          resolve(null);
        });
        child.on('error', () => resolve(null));
      });
    } else {
      // Linux: استخدام nmblookup
      const { spawn } = require('child_process');
      return new Promise((resolve) => {
        const child = spawn('nmblookup', ['-A', ip]);
        let output = '';
        child.stdout.on('data', (data) => { output += data.toString(); });
        child.on('close', () => {
          // تحليل المخرجات
          const lines = output.split('\n');
          for (const line of lines) {
            const match = line.match(/^\s*([A-Z0-9\-_]{1,15})\s+<\d+>/);
            if (match && match[1]) {
              resolve(match[1]);
              return;
            }
          }
          resolve(null);
        });
        child.on('error', () => resolve(null));
      });
    }
  } catch (e) {
    return null;
  }
}

// تحديد نوع الجهاز من المنافذ المفتوحة
function identifyDeviceType(openPorts, macVendor) {
  const portNumbers = openPorts.map(p => p.port);
  const services = openPorts.map(p => p.service).join(',').toLowerCase();
  
  // كاميرات المراقبة
  if (portNumbers.includes(554) || portNumbers.includes(8000) || portNumbers.includes(8081)) {
    if (macVendor && (macVendor.includes('Hikvision') || macVendor.includes('Dahua') || macVendor.includes('Axis'))) {
      return { type: 'Camera', subtype: macVendor };
    }
    return { type: 'Camera', subtype: 'IP Camera/NVR' };
  }
  
  // الطابعات
  if (portNumbers.includes(9100) || portNumbers.includes(631) || portNumbers.includes(515)) {
    return { type: 'Printer', subtype: 'Network Printer' };
  }
  
  // الراوترات/السويتشات
  if (portNumbers.includes(22) && portNumbers.includes(23) && (portNumbers.includes(80) || portNumbers.includes(443))) {
    if (macVendor && (macVendor.includes('Cisco') || macVendor.includes('MikroTik') || macVendor.includes('Ubiquiti'))) {
      return { type: 'Router/Switch', subtype: macVendor };
    }
    return { type: 'Router/Switch', subtype: 'Network Device' };
  }
  
  // السيرفرات
  if (portNumbers.includes(22) && (portNumbers.includes(80) || portNumbers.includes(443) || portNumbers.includes(3306) || portNumbers.includes(5432))) {
    return { type: 'Server', subtype: 'Linux/Unix Server' };
  }
  
  // ويندوز
  if (portNumbers.includes(135) && portNumbers.includes(139) && portNumbers.includes(445) && portNumbers.includes(3389)) {
    return { type: 'Workstation', subtype: 'Windows' };
  }
  
  // أجهزة NAS
  if (macVendor && (macVendor.includes('Synology') || macVendor.includes('QNAP'))) {
    return { type: 'NAS', subtype: macVendor };
  }
  
  // أجهزة افتراضية
  if (macVendor && (macVendor.includes('VMware') || macVendor.includes('VirtualBox') || macVendor.includes('Hyper-V') || macVendor.includes('QEMU') || macVendor.includes('Xen'))) {
    return { type: 'VM', subtype: macVendor };
  }
  
  // افتراضي
  return { type: 'Unknown', subtype: 'Unknown Device' };
}

// محاولة استعلام SNMP للحصول على معلومات إضافية
async function querySNMP(ip, community = 'public') {
  return new Promise((resolve) => {
    try {
      const session = new SNMP.Session({
        host: ip,
        community: community,
        port: 161,
        timeout: 2000,
        retries: 1
      });
      
      // استعلام sysDescr, sysName, sysObjectID
      const oids = [
        '1.3.6.1.2.1.1.1.0',   // sysDescr
        '1.3.6.1.2.1.1.5.0',   // sysName
        '1.3.6.1.2.1.1.2.0',   // sysObjectID
      ];
      
      session.get({ oids: oids }, (error, varbinds) => {
        session.close();
        if (error || !varbinds) {
          resolve(null);
          return;
        }
        const result = {};
        varbinds.forEach(vb => {
          if (vb.oid === '1.3.6.1.2.1.1.1.0') result.sysDescr = vb.value;
          if (vb.oid === '1.3.6.1.2.1.1.5.0') result.sysName = vb.value;
          if (vb.oid === '1.3.6.1.2.1.1.2.0') result.sysObjectID = vb.value;
        });
        resolve(result);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

// مسح شبكة كاملة (Ping Sweep)
async function pingSweep(ips, concurrency = 50, isCancelled) {
  const results = [];
  
  // معالجة دفعات متزامنة
  for (let i = 0; i < ips.length; i += concurrency) {
    // v2.11.7 — إلغاء فوري بين الدفعات (callback اختياري ⇒ لا يكسر استدعاء المجدول).
    if (typeof isCancelled === 'function' && isCancelled()) break;
    const batch = ips.slice(i, i + concurrency);
    const promises = batch.map(async (ip) => {
      try {
        const res = await ping.promise.probe(ip, { timeout: 1, min_reply: 1 });
        if (res.alive) {
          return { ip, alive: true, responseTime: res.time };
        }
      } catch (e) {
        // تجاهل الأخطاء
      }
      return { ip, alive: false };
    });
    
    const batchResults = await Promise.all(promises);
    results.push(...batchResults.filter(r => r.alive));
  }
  
  return results;
}

// POST /api/scan/subnet - مسح شبكة فرعية
router.post('/subnet', async (req, res) => {
  try {
    const { cidr, scanPorts: shouldScanPorts = true, scanSNMP = false, snmpCommunity = 'public' } = req.body;
    
    if (!cidr || !isValidCIDR(cidr)) {
      return res.status(400).json({ success: false, error: 'CIDR غير صالح. مثال: 192.168.1.0/24' });
    }
    
    const ips = cidrToIPs(cidr);
    console.log(`[SCAN] Starting scan for ${cidr}, ${ips.length} IPs`);
    if (ips.length > 1024) {
      return res.status(400).json({ success: false, error: 'النطاق كبير جداً (الحد الأقصى 1024 IP). استخدم /24 أو أصغر.' });
    }
    
    // v2.11.7 — تسجيل المسح اليدوي في scan_runs (source='manual') ليظهر في تبويب «⏱️ المسح الدوري».
    // فشل التسجيل لا يُوقف المسح: نُسجّل تحذيرًا ونُكمل.
    let runId = null;
    try {
      runId = db.prepare(
        "INSERT INTO scan_runs (subnet, started_at, status, source) VALUES (?, datetime('now'), 'running', 'manual')"
      ).run(cidr).lastInsertRowid;
    } catch (e) {
      console.warn('[SCAN] scan_runs manual insert failed:', e.message);
    }

    // إرجاع استجابة فورية مع scanId
    const scanId = Date.now();
    res.json({ 
      success: true, 
      data: { 
        message: 'بدأ المسح...', 
        totalIPs: ips.length,
        scanId
      }
    });
    
    // تنفيذ المسح في الخلفية (fire-and-forget) دون انتظار — لا نُبقي طلب /subnet مفتوحًا
    // نتائج المسح تُقرأ لاحقاً عبر SSE /stream/:scanId و /results/:scanId
    performScan(scanId, ips, shouldScanPorts, scanSNMP, snmpCommunity, { cidr, runId }).catch(scanError => {
      console.error('[SCAN] Scan error:', scanError);
      scanResults[scanId] = { error: scanError.message, completed: true };
      finishScanRun(runId, 0, 'failed', scanError.message);
    });
    
  } catch (error) {
    console.error('[SCAN] Scan subnet error:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'فشل في بدء المسح: ' + error.message });
    }
  }
});

// v2.11.7 — إنهاء صف المسح في scan_runs (فشل التسجيل لا يكسر المسح).
function finishScanRun(runId, devicesFound, status, errorMessage) {
  if (!runId) return;
  try {
    db.prepare(
      `UPDATE scan_runs SET ended_at = datetime('now'), devices_found = ?, status = ?, error_message = ? WHERE id = ?`
    ).run(devicesFound || 0, status || 'completed', errorMessage || null, runId);
  } catch (e) {
    console.warn('[SCAN] scan_runs update failed:', e.message);
  }
}

// دالة تنفيذ المسح الفعلي مع تحديث التقدم
async function performScan(scanId, ips, shouldScanPorts, scanSNMP, snmpCommunity, meta) {
  meta = meta || {};
  // تهيئة التخزين
  scanResults[scanId] = {
    progress: '', completed: false, devices: [], cancelRequested: false,
    cidr: meta.cidr || null, startedAt: new Date().toISOString(),
  };

  // v2.11.7 — إلغاء حقيقي: يُفحص بين الدفعات وداخل حلقة التحليل (POST /api/scan/cancel/:scanId).
  const isCancelled = () => !!(scanResults[scanId] && scanResults[scanId].cancelRequested);

  // v2.11.7 — إنهاء موحّد (اكتمل / أُلغِي / فشل): يحفظ «آخر نتيجة» ويُحدّث scan_runs.
  function finalize(devices, mode, errorMessage) {
    const state = scanResults[scanId] || {};
    state.devices = devices;
    state.completed = true;
    state.cancelled = (mode === 'cancelled');
    if (mode === 'cancelled') {
      state.progress = '⏹ أُلغِي المسح — ' + devices.length + ' جهاز قبل الإلغاء';
    } else if (mode === 'failed') {
      state.progress = '❌ فشل المسح: ' + (errorMessage || '');
    }
    lastScan = {
      scanId: String(scanId),
      cidr: meta.cidr || null,
      endedAt: new Date().toISOString(),
      deviceCount: devices.length,
      cancelled: mode === 'cancelled',
      devices,
    };
    finishScanRun(meta.runId, devices.length,
      mode === 'cancelled' ? 'cancelled' : (mode === 'failed' ? 'failed' : 'completed'), errorMessage);
  }
  
  
  try {
    // 1. Ping Sweep
    scanResults[scanId].progress = `جاري مسح ${ips.length} عنوان IP...`;
    console.log(`[SCAN] Starting ping sweep for ${ips.length} IPs`);
    const aliveHosts = await pingSweep(ips, 50, isCancelled);
    if (isCancelled()) { finalize([], 'cancelled'); return; }
    scanResults[scanId].progress = `اكتمل مسح البنج: ${aliveHosts.length} جهاز مستجيب`;
    console.log(`[SCAN] Ping sweep complete: ${aliveHosts.length} alive hosts`);
    
    if (aliveHosts.length === 0) {
      scanResults[scanId].progress = 'لم يتم العثور على أجهزة مستجيبة';
      finalize([], 'completed');
      return;
    }
    
    // 2. لكل مضيف حي: مسح المنافذ، الحصول على MAC، تحديد النوع
    const detailedResults = [];
    
    for (let i = 0; i < aliveHosts.length; i++) {
      // v2.11.7 — الإلغاء يُفحص لكل جهاز ⇒ يتوقف خلال ثوانٍ ويُحفظ ما اكتُشف قبل الإلغاء.
      if (isCancelled()) { finalize(detailedResults, 'cancelled'); return; }
      const host = aliveHosts[i];
      scanResults[scanId].progress = `جاري تحليل الجهاز ${i + 1}/${aliveHosts.length}: ${host.ip}`;
      console.log(`[SCAN] Scanning ${host.ip}`);
      
      const mac = await getMacAddress(host.ip);
      const macVendor = getMacVendor(mac);
      const openPorts = shouldScanPorts ? await scanPorts(host.ip) : [];
      // حل اسم المضيف (Reverse DNS)
      const hostname = await resolveHostname(host.ip);
      console.log(`[SCAN] ${host.ip} - MAC: ${mac}, Vendor: ${macVendor}, Hostname: ${hostname}, Open ports: ${openPorts.length}`);
      const deviceInfo = identifyDeviceType(openPorts, macVendor);
      
      let snmpInfo = null;
      if (scanSNMP && openPorts.some(p => p.port === 161)) {
        snmpInfo = await querySNMP(host.ip, snmpCommunity);
      }
      
      // التحقق من وجود الجهاز في قاعدة البيانات
      const existing = db.prepare('SELECT * FROM devices WHERE ip = ?').get(host.ip);
      
      // الحصول على الاسم الحقيقي: NBNS مباشر (v2.16.0) ثم SMB ثم DNS عكسي
      const netbiosName = await getNetBIOSName(host.ip);
      const smbName = await getSMBName(host.ip);
      
      // دالة ذكية لتوليد اسم الجهاز
      function generateDeviceName() {
        // 0. v2.16.0 — الأولوية الأولى: الاسم الحقيقي من الجهاز نفسه عبر NBNS (UDP 137)
        if (netbiosName && netbiosName.length > 1) {
          return netbiosName;
        }
        // 1. الأولوية الثانية: اسم SMB/NetBIOS من الأداتين (nbtstat/nmblookup)
        if (smbName && smbName.length > 1) {
          return smbName;
        }
        
        // 2. الأولوية الثانية: اسم المضيف من DNS العكسي
        if (hostname && hostname.length > 1) {
          return hostname;
        }
        
        // 3. إذا كان النوع معروف (ليس Unknown)، استخدم النوع الفرعي
        if (deviceInfo.type !== 'Unknown' && deviceInfo.subtype !== 'Unknown Device') {
          return `${deviceInfo.subtype}-${host.ip.split('.').pop()}`;
        }
        
        // 4. إذا كان هناك MAC vendor معروف
        if (macVendor && macVendor !== 'غير معروف' && macVendor !== 'Unknown') {
          return `${macVendor}-${host.ip.split('.').pop()}`;
        }
        
        // 5. fallback: استخدم أول منفذ مفتوح كمؤشر
        if (openPorts.length > 0) {
          const portNames = openPorts.map(p => p.service).join('-');
          return `${portNames}-${host.ip.split('.').pop()}`;
        }
        
        // 6. آخر حل: اسم عام مع الـ IP
        return `Device-${host.ip.split('.').pop()}`;
      }
      
      const suggestedName = generateDeviceName();
      
      const deviceData = {
        ip: host.ip,
        responseTime: host.responseTime,
        mac,
        macVendor,
        openPorts,
        deviceType: deviceInfo.type,
        deviceSubtype: deviceInfo.subtype,
        snmpInfo,
        existsInDB: !!existing,
        existingDevice: existing ? { id: existing.id, name: existing.name } : null,
        suggestedName,
        suggestedType: deviceInfo.type,
      };
      
      detailedResults.push(deviceData);
      
      // تحديث النتائج تدريجياً للعرض المباشر
      scanResults[scanId].devices = [...detailedResults];
    }
    
    // حفظ النتائج النهائية
    scanResults[scanId].progress = `اكتمل المسح! تم العثور على ${detailedResults.length} جهاز`;
    finalize(detailedResults, 'completed');
    
    console.log(`[SCAN] Network scan completed: ${detailedResults.length} devices found`);
  } catch (error) {
    console.error('[SCAN] Perform scan error:', error);
    scanResults[scanId] = { error: error.message, completed: true };
    finishScanRun(meta.runId, 0, 'failed', error.message);
  }
}

// GET /api/scan/stream/:scanId - بث تقدم المسح مباشرة (SSE)
router.get('/stream/:scanId', (req, res) => {
  const scanId = req.params.scanId;
  
  // إعداد SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  
  // إرسال حدث بداية
  res.write('event: start\n');
  res.write('data: بدء المسح...\n\n');
  res.flushHeaders();
  
  function sendLine(line) {
    res.write('event: line\n');
    res.write('data: ' + JSON.stringify(line) + '\n\n');
  }
  
  function sendDone(deviceCount) {
    res.write('event: done\n');
    // إرسال عدد الأجهزة في data (JSON) ليُمكن للواجهة عرض النتائج مباشرةً دون
    // الاعتماد فقط على استدعاء /results/:scanId (الذي قد يفشل عبر proxy/ngrok
    // إذا انتهت صلاحية scanResults[scanId] أو تأخر الطلب).
    res.write('data: ' + JSON.stringify({ deviceCount: deviceCount || 0 }) + '\n\n');
    res.end();
  }
  
  function sendError(err) {
    res.write('event: error\n');
    res.write('data: ' + JSON.stringify('خطأ: ' + err) + '\n\n');
    res.end();
  }
  
  // مراقبة النتائج + heartbeat دوري لمنع إغلاق الاتصال الخامل
  let lastWrite = Date.now();
  const checkProgress = setInterval(() => {
    const result = scanResults[scanId];
    if (!result) {
      sendLine('في الانتظار...');
      lastWrite = Date.now();
      return;
    }
    
    if (result.error) {
      sendError(result.error);
      clearInterval(checkProgress);
      return;
    }
    
    if (result.progress) {
      sendLine(result.progress);
      lastWrite = Date.now();
    }
    
    if (result.completed) {
      if (result.cancelled) {
        sendLine('⏹ أُلغِي المسح — ' + (result.devices ? result.devices.length : 0) + ' جهاز قبل الإلغاء');
      } else if (result.devices) {
        sendLine('اكتمل المسح! تم العثور على ' + result.devices.length + ' جهاز');
      }
      sendDone(result.devices ? result.devices.length : 0);
      clearInterval(checkProgress);
      // تنظيف بعد دقيقة
      setTimeout(() => delete scanResults[scanId], 60000);
    } else if (Date.now() - lastWrite >= 15000) {
      // heartbeat: تعليق SSE فارغ يبقي الاتصال حيًّا مع الـ proxies/load balancers
      res.write(': keep-alive\n\n');
      lastWrite = Date.now();
    }
  }, 1000);
  
  // عند انقطاع الاتصال
  req.on('close', () => {
    clearInterval(checkProgress);
  });
});

// GET /api/scan/results/:scanId - الحصول على نتائج مسح محدد
router.get('/results/:scanId', (req, res) => {
  const scanId = req.params.scanId;
  const result = scanResults[scanId];
  
  // v2.11.7 — تمييز الحالات: known=false ⇒ لا سجل (معرّف خطأ/انتهت الصلاحية/إعادة تشغيل الخادم)،
  // و completed=true مع data=[] ⇒ مسح اكتمل فعلًا ولم يجد أجهزة (نجاح فاضي، لا خطأ).
  if (!result) {
    // بديل احتياطي: إن كان المعرّف لـ«آخر نتيجة» المحفوظة ⇒ نخدمها بدل إعلان الفشل.
    if (lastScan && String(lastScan.scanId) === String(scanId)) {
      return res.json({
        success: true, data: lastScan.devices || [], known: true, completed: true,
        cancelled: !!lastScan.cancelled, fromLastScan: true,
      });
    }
    return res.json({ success: true, data: [], known: false, completed: false });
  }
  
  if (result.error) {
    return res.status(500).json({ success: false, error: result.error });
  }
  
  res.json({
    success: true,
    data: result.devices || [],
    known: true,
    completed: !!result.completed,
    cancelled: !!result.cancelled,
  });
});

// GET /api/scan/last — v2.11.7: آخر نتيجة مسح محفوظة (تبقى بعد إعادة تحميل الصفحة وبعد انتهاء الـ60ث).
router.get('/last', (req, res) => {
  if (!lastScan) {
    return res.json({ success: true, data: null });
  }
  res.json({
    success: true,
    data: {
      scanId: lastScan.scanId,
      cidr: lastScan.cidr,
      endedAt: lastScan.endedAt,
      deviceCount: lastScan.deviceCount,
      cancelled: !!lastScan.cancelled,
      devices: lastScan.devices || [],
    },
  });
});

// POST /api/scan/cancel/:scanId — v2.11.7: إلغاء حقيقي للمسح الجاري (يُفحص العلم بين الدفعات
// وداخل حلقة التحليل ⇒ يتوقف خلال ثوانٍ ويُعلَن «أُلغِي» مع حفظ ما اكتُشف قبل الإلغاء).
router.post('/cancel/:scanId', (req, res) => {
  const scanId = req.params.scanId;
  const result = scanResults[scanId];
  if (!result) {
    return res.status(404).json({ success: false, error: 'لا يوجد مسح بهذا المعرّف (انتهى أو انتهت صلاحيته)' });
  }
  if (result.completed) {
    return res.json({ success: true, data: { cancelRequested: false, alreadyDone: true, cancelled: !!result.cancelled } });
  }
  result.cancelRequested = true;
  result.progress = '⏹ جارٍ الإلغاء…';
  res.json({ success: true, data: { cancelRequested: true } });
});

// POST /api/scan/bulk-add - إضافة أجهزة متعددة من نتائج المسح
router.post('/bulk-add', async (req, res) => {
  try {
    const { devices } = req.body; // مصفوفة من { ip, name, device_type_id, location_id, check_protocol, port, check_interval_seconds, failure_threshold, is_active }
    
    if (!devices || !Array.isArray(devices) || devices.length === 0) {
      return res.status(400).json({ success: false, error: 'لا توجد أجهزة للإضافة' });
    }
    
    // جلب الأنواع والمواقع المتاحة
    const types = db.prepare('SELECT id, name FROM device_types').all();
    const locations = db.prepare('SELECT id, name FROM locations').all();
    
    const typeMap = new Map(types.map(t => [t.name, t.id]));
    const locMap = new Map(locations.map(l => [l.name, l.id]));
    
    const insertStmt = db.prepare(`
      INSERT INTO devices (name, ip, device_type_id, location_id, check_protocol, port, web_port, check_interval_seconds, failure_threshold, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    let imported = 0;
    let skipped = 0;
    const errors = [];
    
    for (let i = 0; i < devices.length; i++) {
      const d = devices[i];
      
      if (!d.name || !d.ip) {
        skipped++;
        errors.push(`الجهاز ${i + 1}: حقول مفقودة (الاسم/IP)`);
        continue;
      }
      
      // التحقق من وجود IP مسبقاً
      const existing = db.prepare('SELECT id FROM devices WHERE ip = ?').get(d.ip);
      if (existing) {
        skipped++;
        errors.push(`الجهاز "${d.name}" (${d.ip}): IP موجود بالفعل`);
        continue;
      }
      
      const typeId = typeMap.get(d.device_type_id) || (d.device_type_id ? Number(d.device_type_id) : null);
      const locId = locMap.get(d.location_id) || (d.location_id ? Number(d.location_id) : null);
      
      if (!typeId) {
        skipped++;
        errors.push(`الجهاز "${d.name}": نوع غير صالح`);
        continue;
      }
      
      try {
        insertStmt.run(
          d.name,
          d.ip,
          typeId,
          locId,
          d.check_protocol || 'ping',
          d.port ? Number(d.port) : null,
          d.web_port ? Number(d.web_port) : null,
          d.check_interval_seconds || 30,
          d.failure_threshold || 3,
          d.is_active ? 1 : 0
        );
        imported++;
      } catch (e) {
        skipped++;
        errors.push(`الجهاز "${d.name}": ${e.message}`);
      }
    }
    
    res.json({
      success: true,
      data: { imported, skipped, errors }
    });
    
  } catch (error) {
    console.error('Bulk add error:', error);
    res.status(500).json({ success: false, error: 'فشل في الإضافة الجماعية: ' + error.message });
  }
});

// GET /api/scan/types - جلب أنواع الأجهزة المتاحة للنموذج
router.get('/types', (req, res) => {
  const types = db.prepare('SELECT id, name, icon FROM device_types ORDER BY name').all();
  const locations = db.prepare('SELECT id, name FROM locations ORDER BY name').all();
  res.json({ success: true, data: { types, locations } });
});

// ─────────────────────────────────────────────────────────────
// v2.5.0 — تَصدير الـ helpers لِـ إعادة الاستِعمال من scan-scheduler.service.js
// (المرحلة 1: المسح الدوري). نُلحِقها كخاصية على router لِأَن module.exports = router
// هو المُتعارَف في بقية ملفات routes وَإعادة كتابته ستَكسر req.app بصمة server.js.
// ─────────────────────────────────────────────────────────────
router.helpers = {
  isValidCIDR,
  cidrToIPs,
  pingSweep,
  getMacAddress,
  getMacVendor,
  scanPorts,
  identifyDeviceType,
  resolveHostname,
  getSMBName,
  querySNMP,
};

module.exports = router;