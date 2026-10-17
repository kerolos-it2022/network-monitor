'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnv, startServer, seedUser, makeClient } = require('./helpers/test-app');
const env = setupTestEnv({ NM_TRUST_PROXY: '' });
let srv, owner;
test.before(async () => {
  srv = await startServer();
  seedUser(srv.db, 'owner', 'OwnerPass123!', 'admin');
  owner = makeClient(srv.baseUrl);
  await owner.login('owner', 'OwnerPass123!');
});
test.after(async () => { await srv.close(); srv.db.close(); env.cleanup(); });

test('deleting a user revokes existing sessions, including after username reuse', async () => {
  seedUser(srv.db, 'removed', 'Original123!', 'admin');
  const c = makeClient(srv.baseUrl);
  await c.login('removed', 'Original123!');
  assert.equal((await owner.del('/api/auth/users/removed')).status, 200);
  seedUser(srv.db, 'removed', 'NewPassword123!', 'viewer');
  assert.equal((await c.get('/api/auth/users')).status, 401);
});

test('password change revokes other sessions and preserves the initiating session', async () => {
  seedUser(srv.db, 'password_user', 'Original123!', 'admin');
  const a = makeClient(srv.baseUrl), b = makeClient(srv.baseUrl);
  await a.login('password_user', 'Original123!');
  await b.login('password_user', 'Original123!');
  assert.equal((await a.put('/api/auth/change-password', { current_password: 'Original123!', new_password: 'Changed123!' })).status, 200);
  assert.equal((await b.get('/api/auth/me')).status, 401);
  assert.equal((await a.get('/api/auth/me')).status, 200);
});

test('login rotates session ID and preserves remember-me behavior', async () => {
  const c = makeClient(srv.baseUrl);
  await c.login('owner', 'OwnerPass123!');
  const oldCookie = c.cookie;
  const r = await c.post('/api/auth/login', { username: 'owner', password: 'OwnerPass123!', remember: true });
  assert.equal(r.status, 200);
  assert.notEqual(c.cookie, oldCookie);
  assert.match(r.headers.get('set-cookie'), /Expires=/i);
  assert.equal((await fetch(srv.baseUrl + '/api/auth/me', { headers: { cookie: oldCookie } })).status, 401);
});

test('spoofed forwarded IP cannot bypass lockout or forge audit address', async () => {
  const statuses = [];
  for (let i = 0; i < 6; i++) {
    const r = await fetch(srv.baseUrl + '/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `192.0.2.${i + 1}` },
      body: JSON.stringify({ username: 'lock_test', password: 'wrong' }),
    });
    statuses.push(r.status); await r.text();
  }
  assert.deepEqual(statuses, [401, 401, 401, 401, 429, 429]);
  const row = srv.db.prepare("SELECT ip FROM audit_log WHERE actor = 'lock_test' ORDER BY id DESC LIMIT 1").get();
  assert.equal(row.ip, '127.0.0.1');
});

test('invalid login value types return 400 instead of server errors', async () => {
  assert.equal((await owner.post('/api/auth/login', { username: {}, password: [] })).status, 400);
  assert.equal((await owner.put('/api/auth/change-password', { current_password: {}, new_password: [] })).status, 400);
});

test('legacy sessions upgrade in place and remain usable', async () => {
  const c = makeClient(srv.baseUrl);
  await c.login('owner', 'OwnerPass123!');
  const rows = srv.db.prepare('SELECT sid, sess FROM sessions').all();
  for (const row of rows) {
    const session = JSON.parse(row.sess);
    delete session.accountId; delete session.credentialsVersion;
    srv.db.prepare('UPDATE sessions SET sess = ? WHERE sid = ?').run(JSON.stringify(session), row.sid);
  }
  assert.equal((await c.get('/api/auth/me')).status, 200);
  assert.ok(srv.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE json_extract(sess, '$.accountId') IS NOT NULL").get().n > 0);
});

test('untrusted HTTPS header does not change cookie security; trusted proxy does', async () => {
  const login = (url) => fetch(url + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
    body: JSON.stringify({ username: 'owner', password: 'OwnerPass123!' }),
  });
  const plain = await login(srv.baseUrl);
  assert.doesNotMatch(plain.headers.get('set-cookie'), /; Secure/i);
  assert.equal(plain.headers.get('strict-transport-security'), null);
  process.env.NM_TRUST_PROXY = 'loopback';
  let trusted;
  try {
    trusted = await startServer();
    const secure = await login(trusted.baseUrl);
    assert.match(secure.headers.get('set-cookie'), /; Secure/i);
    assert.ok(secure.headers.get('strict-transport-security'));
  } finally { process.env.NM_TRUST_PROXY = ''; if (trusted) await trusted.close(); }
});

test('database-side role and credential changes are enforced on the next request', async () => {
  seedUser(srv.db, 'changed', 'Original123!', 'admin');
  const c = makeClient(srv.baseUrl);
  await c.login('changed', 'Original123!');
  srv.db.prepare("UPDATE users SET role = 'viewer' WHERE username = 'changed'").run();
  assert.equal((await c.get('/api/auth/users')).status, 403);
  srv.db.prepare("UPDATE users SET password_hash = 'changed' WHERE username = 'changed'").run();
  assert.equal((await c.get('/api/auth/me')).status, 401);
});
