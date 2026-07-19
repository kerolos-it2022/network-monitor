// checkers.js: دوال فحص الأجهزة (Ping ICMP و TCP Port) — كلاهما يرجع { isOnline, responseTimeMs }.
const ping = require('ping');
const net = require('net');

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

// checkPort(ip, port, timeoutMs) — فتح اتصال TCP وتع Measuring زمن الاتصال.
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

module.exports = { checkPing, checkPort };
