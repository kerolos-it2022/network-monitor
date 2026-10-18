'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnv, startServer, seedUser, makeClient } = require('./helpers/test-app');
const env = setupTestEnv();
const db = require('../src/db');
const { buildWeeklyReport } = require('../src/services/weekly-report.service');
const end = Date.parse('2026-10-17T00:00:00Z');
let device;
test.before(() => {
  const type = db.prepare('SELECT id FROM device_types LIMIT 1').get().id;
  device = db.prepare('INSERT INTO devices (name, ip, device_type_id) VALUES (?, ?, ?)').run('Review device', '127.0.0.1', type).lastInsertRowid;
});
test.beforeEach(() => db.prepare('DELETE FROM downtime_events').run());
test.after(() => { db.close(); env.cleanup(); });
function outage(start, finish, duration = null) {
  db.prepare('INSERT INTO downtime_events (device_id, started_at, ended_at, duration_seconds) VALUES (?, ?, ?, ?)').run(device, start, finish, duration);
}
test('clips events crossing either week boundary and ranks by in-window duration', () => {
  outage('2026-10-09T23:00:00Z', '2026-10-10T01:00:00Z', 7200);
  outage('2026-10-16T23:00:00Z', '2026-10-18T00:00:00Z', 90000);
  outage('2026-10-16T22:00:00Z', null);
  const r = buildWeeklyReport(0, end);
  assert.equal(r.total_minutes, 240);
  assert.equal(r.events_count, 2);
  assert.equal(r.overlapping_events_count, 3);
  assert.equal(r.per_device[0].min, 240);
  assert.equal(r.longest_events[0].minutes, 120);
});
test('excludes events ending exactly at start or starting exactly at end', () => {
  outage('2026-10-09T23:00:00Z', '2026-10-10T00:00:00Z', 3600);
  outage('2026-10-17T00:00:00Z', null);
  assert.equal(buildWeeklyReport(0, end).total_minutes, 0);
  assert.equal(buildWeeklyReport(0, end).overlapping_events_count, 0);
});
test('historical report clips still-open outages to its own window', () => {
  outage('2026-10-01T00:00:00Z', null);
  assert.equal(buildWeeklyReport(1, end).total_minutes, 7 * 24 * 60);
});
test('legacy SQLite UTC timestamps are clipped consistently with ISO timestamps', () => {
  outage('2026-10-09 23:00:00', '2026-10-10 01:00:00', 7200);
  const r = buildWeeklyReport(0, end);
  assert.equal(r.total_minutes, 60);
  assert.equal(r.events_count, 0);
});
test('empty report retains existing fields and invalid offsets are rejected', () => {
  const r = buildWeeklyReport(0, end);
  assert.equal(r.events_count, 0); assert.equal(r.uptime_percent, 100);
  for (const offset of [-1, 0.5, 'bad', Infinity, 5201]) assert.throws(() => buildWeeklyReport(offset, end), { status: 400 });
});
test('report API stays protected; private responses carry no-store', async () => {
  const srv = await startServer();
  try {
    const c = makeClient(srv.baseUrl);
    assert.equal((await c.get('/api/reports/weekly')).status, 401);
    seedUser(db, 'report_viewer', 'Password123!', 'viewer');
    await c.login('report_viewer', 'Password123!');
    assert.equal((await c.get('/api/reports/weekly?offset=invalid')).status, 400);
    for (const p of ['/api/reports/weekly', '/reports/weekly', '/labels/devices']) {
      const r = await c.get(p); assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store');
      await r.text();
    }
  } finally { await srv.close(); }
});
