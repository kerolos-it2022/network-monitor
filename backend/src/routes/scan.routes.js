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
async function pingSweep(ips, concurrency = 50) {
  const results = [];
  
  // معالجة دفعات متزامنة
  for (let i = 0; i < ips.length; i += concurrency) {
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
    
    // تنفيذ المسح في الخلفية مع تخزين النتائج
    try {
      await performScan(scanId, ips, shouldScanPorts, scanSNMP, snmpCommunity);
    } catch (scanError) {
      console.error('[SCAN] Scan error:', scanError);
      scanResults[scanId] = { error: scanError.message, completed: true };
    }
    
  } catch (error) {
    console.error('[SCAN] Scan subnet error:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'فشل في بدء المسح: ' + error.message });
    }
  }
});

// دالة تنفيذ المسح الفعلي مع تحديث التقدم
async function performScan(scanId, ips, shouldScanPorts, scanSNMP, snmpCommunity) {
  // تهيئة التخزين
  scanResults[scanId] = { progress: '', completed: false, devices: [] };
  
  try {
    // 1. Ping Sweep
    scanResults[scanId].progress = `جاري مسح ${ips.length} عنوان IP...`;
    console.log(`[SCAN] Starting ping sweep for ${ips.length} IPs`);
    const aliveHosts = await pingSweep(ips);
    scanResults[scanId].progress = `اكتمل مسح البنج: ${aliveHosts.length} جهاز مستجيب`;
    console.log(`[SCAN] Ping sweep complete: ${aliveHosts.length} alive hosts`);
    
    if (aliveHosts.length === 0) {
      scanResults[scanId].progress = 'لم يتم العثور على أجهزة مستجيبة';
      scanResults[scanId].completed = true;
      scanResults[scanId].devices = [];
      return;
    }
    
    // 2. لكل مضيف حي: مسح المنافذ، الحصول على MAC، تحديد النوع
    const detailedResults = [];
    
    for (let i = 0; i < aliveHosts.length; i++) {
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
      
      // الحصول على اسم SMB/NetBIOS (أولوية عالية)
      const smbName = await getSMBName(host.ip);
      
      // دالة ذكية لتوليد اسم الجهاز
      function generateDeviceName() {
        // 1. الأولوية الأولى: اسم SMB/NetBIOS (الأكثر دقة للأجهزة ويندوز)
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
    scanResults[scanId].completed = true;
    scanResults[scanId].devices = detailedResults;
    
    // أيضاً حفظ في lastScanResults للتوافق مع الكود القديم
    lastScanResults = detailedResults;
    
    console.log(`[SCAN] Network scan completed: ${detailedResults.length} devices found`);
  } catch (error) {
    console.error('[SCAN] Perform scan error:', error);
    scanResults[scanId] = { error: error.message, completed: true };
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
  
  function sendDone() {
    res.write('event: done\n');
    res.write('data: \n\n');
    res.end();
  }
  
  function sendError(err) {
    res.write('event: error\n');
    res.write('data: ' + JSON.stringify('خطأ: ' + err) + '\n\n');
    res.end();
  }
  
  // مراقبة النتائج
  const checkProgress = setInterval(() => {
    const result = scanResults[scanId];
    if (!result) {
      sendLine('في الانتظار...');
      return;
    }
    
    if (result.error) {
      sendError(result.error);
      clearInterval(checkProgress);
      return;
    }
    
    if (result.progress) {
      sendLine(result.progress);
    }
    
    if (result.completed) {
      if (result.devices) {
        sendLine('اكتمل المسح! تم العثور على ' + result.devices.length + ' جهاز');
      }
      sendDone();
      clearInterval(checkProgress);
      // تنظيف بعد دقيقة
      setTimeout(() => delete scanResults[scanId], 60000);
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
  
  if (!result) {
    return res.json({ success: true, data: [] });
  }
  
  if (result.error) {
    return res.status(500).json({ success: false, error: result.error });
  }
  
  res.json({ success: true, data: result.devices || [] });
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
      INSERT INTO devices (name, ip, device_type_id, location_id, check_protocol, port, check_interval_seconds, failure_threshold, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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

module.exports = router;