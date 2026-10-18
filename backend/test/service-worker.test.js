'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../../frontend/public/sw.js'), 'utf8');
// اسم الكاش الحالي يُقرأ من الملف نفسه: ترقيته (v25 → v26 …) لا تُسقط هذا الاختبار —
// المهم أن activate يمسح الأقدم ويُبقي الحالي وكاش أي تطبيق آخر.
const CURRENT_CACHE = /CACHE_NAME\s*=\s*'([^']+)'/.exec(source)[1];
const OLDER_CACHES = ['network-monitor-v24', 'network-monitor-v25'].filter((k) => k !== CURRENT_CACHE);

function worker({ offline = false, cacheControl = '', redirected = false } = {}) {
  const handlers = {}, writes = [], deleted = [];
  const cached = new Response('public offline shell');
  const context = {
    URL, Response,
    self: { location: { origin: 'https://monitor.test' }, addEventListener: (name, fn) => { handlers[name] = fn; }, clients: { claim: async () => {} } },
    fetch: async () => {
      if (offline) throw new Error('offline');
      const res = new Response('network', { headers: { 'cache-control': cacheControl } });
      Object.defineProperty(res, 'redirected', { value: redirected });
      return res;
    },
    caches: {
      open: async () => ({ put: async (req) => { writes.push(req.url); } }),
      match: async () => cached,
      keys: async () => [...OLDER_CACHES, CURRENT_CACHE, 'another-app'],
      delete: async (key) => { deleted.push(key); },
    },
  };
  vm.runInNewContext(source, context);
  async function request(urlPath) {
    let response;
    const pending = [];
    handlers.fetch({ request: new Request('https://monitor.test' + urlPath), respondWith: (p) => { response = p; }, waitUntil: (p) => { pending.push(p); } });
    const result = await response;
    await Promise.all(pending);
    return result;
  }
  return { handlers, writes, deleted, request };
}

test('private reports, labels, API and admin HTML bypass the cache online and offline', async () => {
  for (const offline of [false, true]) {
    const w = worker({ offline });
    for (const p of ['/reports/weekly?offset=1', '/labels/devices', '/api/devices', '/admin/dashboard.html']) {
      assert.equal(await w.request(p), undefined, p);
    }
    assert.deepEqual(w.writes, []);
  }
});
test('public shell remains available offline; static JS still refreshes online', async () => {
  assert.equal(await (await worker({ offline: true }).request('/')).text(), 'public offline shell');
  const w = worker();
  assert.equal(await (await w.request('/js/noc.js')).text(), 'network');
  assert.equal(w.writes.length, 1);
  assert.ok(w.handlers.push && w.handlers.notificationclick);
});
test('redirected and no-store responses never enter cache', async () => {
  for (const opts of [{ cacheControl: 'no-store' }, { cacheControl: 'private' }, { redirected: true }]) {
    const w = worker(opts); await w.request('/'); assert.deepEqual(w.writes, []);
  }
});
test('activation removes older application caches without deleting another application cache', async () => {
  const w = worker(); let done;
  w.handlers.activate({ waitUntil: (p) => { done = p; } });
  await done;
  assert.deepEqual([...w.deleted].sort(), [...OLDER_CACHES].sort());
  assert.ok(!w.deleted.includes(CURRENT_CACHE), 'الكاش الحالي لا يُمسح');
});
