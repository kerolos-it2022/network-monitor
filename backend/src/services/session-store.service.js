// session-store.service.js ( SEC-03) — مخزن جلسات دائم على SQLite.
// ═══════════════════════════════════════════════════════════════════════════
// بديل MemoryStore الافتراضي: الجلسات كانت تُفقَد عند كل إعادة تشغيل/تحديث للتطبيق
// (وبعد أي تحديث من الأبلاينس) ⇒ تسجيل خروج غير متوقع لكل المستخدمين.
// هذا المخزن يستعمل نفس ملف SQLite الحالي (بلا اعتماديات جديدة) + جدول sessions،
// مع تنظيف دوري للجلسات المنتهية، ويطابق واجهة express-session Store المطلوبة.
'use strict';
const { Store } = require('express-session');

function createSqliteSessionStore(db, options = {}) {
  const defaultTtlMs = options.ttlMs || 1000 * 60 * 60 * 12;      // 12 ساعة (مطابق لكوكي الجلسة)
  const pruneEveryMs = options.pruneEveryMs || 1000 * 60 * 10;

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);

  const stmtGet = db.prepare('SELECT sess, expires_at FROM sessions WHERE sid = ?');
  const stmtUpsert = db.prepare(
    `INSERT INTO sessions (sid, sess, expires_at) VALUES (?, ?, ?)
     ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires_at = excluded.expires_at`
  );
  const stmtDel = db.prepare('DELETE FROM sessions WHERE sid = ?');
  const stmtTouch = db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?');
  const stmtPrune = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
  const stmtCount = db.prepare('SELECT COUNT(*) AS c FROM sessions');
  const stmtClear = db.prepare('DELETE FROM sessions');

  function expiryOf(session) {
    const maxAge = session && session.cookie && typeof session.cookie.maxAge === 'number'
      ? session.cookie.maxAge
      : defaultTtlMs;
    return Date.now() + maxAge;
  }

  class SqliteSessionStore extends Store {
    get(sid, cb) {
      try {
        const row = stmtGet.get(sid);
        if (!row) return cb(null, null);
        if (row.expires_at <= Date.now()) {
          stmtDel.run(sid);
          return cb(null, null);
        }
        let session;
        try {
          session = JSON.parse(row.sess);
        } catch (_) {
          stmtDel.run(sid);
          return cb(null, null);
        }
        return cb(null, session);
      } catch (e) {
        return cb(e);
      }
    }

    set(sid, session, cb) {
      try {
        stmtUpsert.run(sid, JSON.stringify(session), expiryOf(session));
        if (cb) cb(null);
      } catch (e) {
        if (cb) cb(e);
      }
    }

    destroy(sid, cb) {
      try {
        stmtDel.run(sid);
        if (cb) cb(null);
      } catch (e) {
        if (cb) cb(e);
      }
    }

    touch(sid, session, cb) {
      try {
        stmtTouch.run(expiryOf(session), sid);
        if (cb) cb(null);
      } catch (e) {
        if (cb) cb(e);
      }
    }

    length(cb) {
      try {
        cb(null, stmtCount.get().c);
      } catch (e) {
        cb(e);
      }
    }

    clear(cb) {
      try {
        stmtClear.run();
        cb(null);
      } catch (e) {
        cb(e);
      }
    }

    pruneExpired() {
      try {
        return stmtPrune.run(Date.now()).changes;
      } catch (_) {
        return 0;
      }
    }
  }

  const store = new SqliteSessionStore();
  const timer = setInterval(() => store.pruneExpired(), pruneEveryMs);
  if (timer.unref) timer.unref();
  return store;
}

module.exports = { createSqliteSessionStore };
