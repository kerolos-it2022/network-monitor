// sw.js: Service Worker — يدعم تثبيت PWA + استقبال إشعارات FCM Push.
const CACHE_NAME = 'network-monitor-v1';
const PRECACHE_URLS = ['/', '/index.html', '/css/style.css', '/manifest.json'];

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
