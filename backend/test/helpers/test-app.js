// test-app.js — أدوات مشتركة لاختبارات API: بيئة معزولة (قاعدة بيانات مؤقتة) + سيرفر على منفذ عشوائي
// + عميل HTTP يحفظ كوكي الجلسة. تُستدعى setupTestEnv() **قبل** أي require لوحدات src.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// بيئة اختبار معزولة: قاعدة بيانات في مجلد مؤقت + سر جلسة عشوائي + تعطيل أي تكامل خارجي.
function setupTestEnv(overrides = {}) {
  // حماية من خطأ شائع: لو حُمّل src/db.js قبل التهيئة فسيفتح قاعدة المشروع الحقيقية
  // (تمّت مصادفة هذا فعلًا) — نفشل مبكرًا وبرسالة واضحة بدل تلويث قاعدة حقيقية.
  try {
    if (require.cache[require.resolve('../../src/db')]) {
      throw new Error('setupTestEnv() يجب أن تُنفَّذ قبل أي require لوحدات src (خصوصًا src/db)');
    }
  } catch (e) {
    if (String(e.message).startsWith('setupTestEnv')) throw e;
    // require.resolve فشل ⇒ الملف غير محمّل (وهذا هو الوضع الصحيح) — نكمل.
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-test-'));
  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = path.join(dir, 'test.db');
  process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  process.env.TELEGRAM_BOT_TOKEN = '';
  process.env.TELEGRAM_CHAT_ID = '';
  process.env.WHATSAPP_API_URL = '';
  Object.assign(process.env, overrides);
  return {
    dir,
    cleanup() {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* تجاهل */ }
    },
  };
}

// تشغيل التطبيق (بلا خدمات خلفية) على منفذ عشوائي محلي.
async function startServer() {
  const { createApp } = require('../../src/app');
  const db = require('../../src/db');
  const app = createApp();
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    baseUrl,
    db,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

// إنشاء مستخدم مباشرة في القاعدة (bcrypt بكلفة منخفضة لسرعة الاختبار).
function seedUser(db, username, password, role) {
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(username, bcrypt.hashSync(password, 4), role);
}

// عميل HTTP بسيط يحفظ كوكي nm.sid تلقائيًّا.
// baseUrl: نص ثابت، أو دالة تُرجع العنوان الحالي (للاختبارات التي تعيد تشغيل الخادم على منفذ جديد).
function makeClient(baseUrl) {
  const resolveBase = typeof baseUrl === 'function' ? baseUrl : () => baseUrl;
  let cookie = '';
  async function request(method, urlPath, body) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(resolveBase() + urlPath, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    if (setCookies.length) {
      cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
    }
    return res;
  }
  return {
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b),
    put: (p, b) => request('PUT', p, b),
    del: (p) => request('DELETE', p),
    login: (username, password) => request('POST', '/api/auth/login', { username, password }),
    get cookie() { return cookie; },
  };
}

// حسم استجابة نصية (JSON أو نص).
async function readText(res) {
  try { return await res.text(); } catch (_) { return ''; }
}

// قراءة بثّ SSE حتى حدث done أو انتهاء المهلة — تُرجع قائمة أحداث {event, data}.
async function collectSSE(res, { timeoutMs = 20000 } = {}) {
  const events = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const started = Date.now();
  try {
    while (Date.now() - started < timeoutMs) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const ev = { event: '', data: '' };
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) ev.event = line.slice(6).trim();
          else if (line.startsWith('data:')) ev.data += line.slice(5).trim();
        }
        if (ev.event) events.push(ev);
      }
      if (events.some((e) => e.event === 'done')) break;
    }
  } finally {
    try { await reader.cancel(); } catch (_) { /* تجاهل */ }
  }
  return events;
}

module.exports = { setupTestEnv, startServer, seedUser, makeClient, readText, collectSSE };
