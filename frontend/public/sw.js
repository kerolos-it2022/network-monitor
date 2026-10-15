// sw.js: Service Worker — يدعم تثبيت PWA + استقبال إشعارات FCM Push + كاش وقت التشغيل (v2.13.6).
// تاريخ الاسم مهم: يُترك كما هو، وترقيته (v2→v3…) مع كل تغيير بنيوي في الملفات المُسبقة
// هو ما يجبر العملاء على التخلص من الكاش القديم عند activate.
const CACHE_NAME = 'network-monitor-v16';  // v2.28.2 — تنسيق شريط أدوات الاكتشاف
const PRECACHE_URLS = [
  '/', '/index.html', '/css/style.css', '/manifest.json',
  '/js/public-dashboard.js', '/js/charts.js', '/js/public-speedtest.js',
  '/css/noc.css', '/js/noc.js',
];

// v2.27.3 — أصل ديناميكي (js/css) يُجرَّب من الشبكة أولًا ثم الكاش احتياطًا: بعد أي
// تحديث يجب ألا يعمل HTML جديد مع JS قديم متخزن (سبب «شاشات فاضية» بعد التحديث).
function respondNetworkFirst(req) {
  return fetch(req).then((res) => {
    if (res && res.status === 200) {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((c) => c.put(req, copy));
    }
    return res;
  }).catch(() => caches.match(req).then((m) => m || Response.error()));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;      // مراجع خارجية (CDN) — تمرير
  if (url.pathname.startsWith('/api/')) return;         // حيّ — بلا كاش
  const isHtml = req.headers.get('accept') === 'text/html'
    || url.pathname === '/' || url.pathname.endsWith('.html');
  const isDynamicAsset = /\.(js|css)(\?|$)/.test(url.pathname + url.search);

  if (isHtml || isDynamicAsset) {
    event.respondWith(respondNetworkFirst(req));
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const refresh = fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || refresh;
    })
  );
});

// === install: تخزين مؤقت للأصول الأساسية + تفعيل فوري ===
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// === activate: أخذ contrôle العملاء فوراً + تنظيف الكاش القديم ===
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// === push: استقبال إشعار FCM وعرضه كـ System Notification ===
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    // إذا لم يكن JSON، نتعامل معه كنص عادي
    payload = { notification: { title: 'إشعار', body: event.data ? event.data.text() : '' } };
  }

  // دعم تنسيق FCM legacy: { notification: { title, body }, data: {...} }
  const title = (payload.notification && payload.notification.title) || 'مراقبة الشبكة';
  const body = (payload.notification && payload.notification.body) || '';
  const deviceId = payload.data && payload.data.deviceId ? String(payload.data.deviceId) : '';

  const options = {
    body: body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'nm-' + deviceId,
    renotify: true,
    data: { deviceId: deviceId, url: '/' },
    vibrate: [200, 100, 200],
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// === notificationclick: فتح التطبيق أو التركيز عليه ===
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // التركيز على تبويب مفتوح إن وُجد
        for (const client of clientList) {
          if (client.url.includes(targetUrl) && 'focus' in client) {
            return client.focus();
          }
        }
        // فتح تبويب جديد إن لم يوجد
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});

// === message: استقبال رسائل من الصفحة (مثلاً طلب إرسال إشعار تجربة) ===
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
