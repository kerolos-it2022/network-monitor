// checkers.js: دوال فحص الأجهزة (Ping ICMP، TCP Port، HTTP، HTTPS) — كلها ترجع { isOnline, responseTimeMs }.
const ping = require('ping');
const net = require('net');
const axios = require('axios');

// checkPing(ip) — يستخدم مكتبة ping لتنفيذ ICMP probe.
async function checkPing(ip) {
  try {
    const res = await ping.promise.probe(ip);
    return {
      isOnline: !!res.alive,
      responseTimeMs: res.alive && res.time != null ? Number(res.time) : null,
    };
  } catch (e) {
    return { isOnline: false, responseTimeMs: null };
  }
}

// checkPort(ip, port, timeoutMs) — فتح اتصال TCP وقياس زمن الاتصال.
function checkPort(ip, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    if (!ip || !port) {
      return resolve({ isOnline: false, responseTimeMs: null });
    }
    const socket = new net.Socket();
    const start = Date.now();
    let settled = false;

    const finish = (isOnline) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch (_) {}
      if (isOnline) {
        resolve({ isOnline: true, responseTimeMs: Date.now() - start });
      } else {
        resolve({ isOnline: false, responseTimeMs: null });
      }
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
    socket.connect(port, ip);
  });
}

// checkHttp(ip, port, timeoutMs) — فحص HTTP على http://ip:port/
async function checkHttp(ip, port, timeoutMs = 5000) {
  if (!ip) {
    return { isOnline: false, responseTimeMs: null };
  }
  const target = `http://${ip}:${port || 80}/`;
  const start = Date.now();
  try {
    const res = await axios.get(target, {
      timeout: timeoutMs,
      validateStatus: (status) => status >= 200 && status < 300, // 2xx = متصل
    });
    return { isOnline: true, responseTimeMs: Date.now() - start };
  } catch (e) {
    return { isOnline: false, responseTimeMs: null };
  }
}

// checkHttps(ip, port, timeoutMs) — فحص HTTPS على https://ip:port/
async function checkHttps(ip, port, timeoutMs = 5000) {
  if (!ip) {
    return { isOnline: false, responseTimeMs: null };
  }
  const target = `https://${ip}:${port || 443}/`;
  const start = Date.now();
  try {
    const https = require('https');
    const agent = new https.Agent({ rejectUnauthorized: false });
    const res = await axios.get(target, {
      timeout: timeoutMs,
      validateStatus: (status) => status >= 200 && status < 300,
      httpsAgent: agent,
    });
    return { isOnline: true, responseTimeMs: Date.now() - start };
  } catch (e) {
    return { isOnline: false, responseTimeMs: null };
  }
}

// checkAllProtocols(ip) — يفحص جميع البروتوكولات ويعيد نتيجة موحدة
// الجهاز "متصل" إذا نجح أي فحص
async function checkAllProtocols(ip) {
  // نفذ جميع الفحوصات بالتوازي
  const [pingResult, httpResult, httpsResult] = await Promise.all([
    checkPing(ip),
    checkHttp(ip, 80),
    checkHttps(ip, 443),
  ]);

  // الجهاز متصل إذا نجح أي فحص
  const isOnline = pingResult.isOnline || httpResult.isOnline || httpsResult.isOnline;

  // وقت الاستجابة = أقل وقت استجابة بين الفحوصات الناجحة
  const responseTimes = [
    pingResult.isOnline ? pingResult.responseTimeMs : null,
    httpResult.isOnline ? httpResult.responseTimeMs : null,
    httpsResult.isOnline ? httpsResult.responseTimeMs : null,
  ].filter(t => t !== null);

  const responseTimeMs = responseTimes.length > 0 ? Math.min(...responseTimes) : null;

  // معلومات تفصيلية لكل بروتوكول
  return {
    isOnline,
    responseTimeMs,
    protocols: {
      ping: pingResult,
      http: httpResult,
      https: httpsResult,
    },
  };
}

module.exports = { checkPing, checkPort, checkHttp, checkHttps, checkAllProtocols };