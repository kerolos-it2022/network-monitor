// vapid.service.js — إدارة مفاتيح Web Push (VAPID) لإشعارات الموبايل (PWA).
// ─────────────────────────────────────────────────────────────────────────────
// v2.13.0 — العيب الذي يعالجه هذا الملف (مُتحقَّق منه على الأبلاينس الحيّ):
//   • مفاتيح VAPID كانت تُولَّد في `deploy.sh` فقط (تثبيت Linux يدوي)، و**لا
//     تُولَّد إطلاقًا في الأبلاينس**: الوحدة network-monitor.service تقرأ
//     `EnvironmentFile=-/var/lib/network-monitor/env` و`nm-install-to-disk` يكتب
//     فيه `SESSION_SECRET` و`DB_PATH` فقط، وبيلد الـISO يستثني `.env` أصلًا.
//   • النتيجة: `process.env.VAPID_PUBLIC_KEY` غير معرَّف ⇒
//     `GET /api/notifications/vapid-public` يردّ 503 ⇒ زر «🔔 تفعيل الإشعارات»
//     في الصفحة العامة يفشل برسالة «الإشعارات غير مُهيّأة على الخادم»،
//     و`sendMobile` يُعطَّل كاملًا بلا أي تفسير في السجل.
//
// السلوك الجديد: عند أول إقلاع بلا مفاتيح صالحة يُولَّد زوج واحد تلقائيًّا
// ويُحفظ في **ملف الإعدادات الذي تقرأه الخدمة فعلاً** ليبقى ثابتًا بعد إعادة
// التشغيل — وثبات المفاتيح شرط جوهري: تغييرها يُبطل كل تسجيلات الهواتف القائمة.
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const { APPLIANCE_ENV_FILE, ENV_FILE } = require('../config/env');

const DEFAULT_SUBJECT = 'mailto:admin@example.com';
// قيمة base64url صالحة: حروف/أرقام/شرطة/شرطة سفلية فقط (بلا padding).
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

// base64UrlBytes(value): عدد البايتات بعد فكّ قيمة base64url (0 لنص فارغ/غير صالح).
function base64UrlBytes(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s || !BASE64URL_RE.test(s)) return 0;
  try {
    return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').length;
  } catch (_) {
    return 0;
  }
}

// المفتاح العام لـ VAPID = نقطة P-256 غير مضغوطة = 65 بايت (87 حرفًا base64url).
function isValidPublicKey(value) {
  return base64UrlBytes(value) === 65;
}

// المفتاح الخاص = scalar بطول 32 بايت (43 حرفًا base64url).
function isValidPrivateKey(value) {
  return base64UrlBytes(value) === 32;
}

// envFileCandidates(): مسارات الحفظ المحتملة بالترتيب.
//   1) NM_ENV_FILE (فحوصات/تخصيص صريح)  2) ملف إعدادات خدمة الأبلاينس
//   3) backend/.env (تثبيت deploy.sh / التطوير).
function envFileCandidates() {
  const list = [];
  if (process.env.NM_ENV_FILE) list.push(process.env.NM_ENV_FILE);
  list.push(APPLIANCE_ENV_FILE);
  list.push(ENV_FILE);
  return list.filter((f, i) => f && list.indexOf(f) === i);
}

// pickWritableEnvFile(): أول ملف قابل للكتابة (موجود، أو مجلّده موجود وقابل للكتابة).
function pickWritableEnvFile() {
  for (const file of envFileCandidates()) {
    try {
      if (fs.existsSync(file)) {
        fs.accessSync(file, fs.constants.W_OK);
        return file;
      }
      fs.accessSync(path.dirname(file), fs.constants.W_OK);
      return file;
    } catch (_) {
      /* غير متاح — نجرّب التالي */
    }
  }
  return null;
}

// upsertEnvVars(file, vars): يُحدِّث الأسطر الموجودة أو يُضيف الجديدة مع الحفاظ
// على بقية محتوى الملف. الكتابة **ذرّية** (ملف مؤقّت ثم rename) فلا يبقى ملف
// إعدادات نصف مكتوب لو فشلت العملية في منتصفها.
function upsertEnvVars(file, vars) {
  let text = '';
  try {
    if (fs.existsSync(file)) text = fs.readFileSync(file, 'utf8');
  } catch (_) {
    text = '';
  }
  const lines = text.length ? text.split(/\r?\n/) : [];
  const seen = new Set();
  const out = lines.map((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && Object.prototype.hasOwnProperty.call(vars, m[1])) {
      seen.add(m[1]);
      return m[1] + '=' + vars[m[1]];
    }
    return line;
  });
  const missing = Object.keys(vars).filter((k) => !seen.has(k));
  if (missing.length) {
    while (out.length && out[out.length - 1].trim() === '') out.pop();
    if (out.length) out.push('');
    missing.forEach((k) => out.push(k + '=' + vars[k]));
  }
  const body = out.join('\n').replace(/\n+$/, '') + '\n';
  const tmp = file + '.tmp-' + process.pid;
  try {
    fs.writeFileSync(tmp, body, 'utf8');
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) { /* لا شيء */ }
    throw e;
  }
}

let ensureDone = false;
let persistedPath = null;

// ensureVapidKeys(): يضمن وجود زوج مفاتيح صالح في بيئة العملية، ويحفظه عند
// التوليد. آمن للاستدعاء المتكرّر (يعمل مرة واحدة فعليًّا). يُرجع المفتاح العام.
function ensureVapidKeys() {
  if (ensureDone) return process.env.VAPID_PUBLIC_KEY || null;
  ensureDone = true;

  const subject = (process.env.VAPID_SUBJECT || '').trim() || DEFAULT_SUBJECT;
  const curPublic = process.env.VAPID_PUBLIC_KEY;
  const curPrivate = process.env.VAPID_PRIVATE_KEY;

  if (isValidPublicKey(curPublic) && isValidPrivateKey(curPrivate)) {
    console.log('[vapid] مفاتيح Web Push جاهزة من البيئة (طول صالح).');
    return curPublic;
  }

  const hadSome = !!(curPublic || curPrivate);
  let keys;
  try {
    keys = webpush.generateVAPIDKeys();
  } catch (e) {
    console.error('[vapid] تعذّر توليد مفاتيح Web Push:', e.message);
    return null;
  }

  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = subject;

  console.warn(
    hadSome
      ? '[vapid] المفاتيح الموجودة غير صالحة (الطول لا يطابق 65/32 بايت) — أُعيد توليدها.'
      : '[vapid] لا توجد مفاتيح Web Push — وُلِّدت تلقائيًّا الآن (إشعارات الموبايل صارت قابلة للتفعيل).'
  );

  const target = pickWritableEnvFile();
  if (target) {
    try {
      upsertEnvVars(target, {
        VAPID_PUBLIC_KEY: keys.publicKey,
        VAPID_PRIVATE_KEY: keys.privateKey,
        VAPID_SUBJECT: subject,
      });
      persistedPath = target;
      console.log('[vapid] حُفظت المفاتيح في: ' + target + ' (ستبقى ثابتة بعد إعادة التشغيل — لا حاجة لأي خطوة يدوية).');
    } catch (e) {
      console.warn('[vapid] تعذّر حفظ المفاتيح في ' + target + ': ' + e.message);
      console.warn('[vapid] المفاتيح صالحة الآن في هذه العملية، لكنها ستتغيّر عند إعادة التشغيل وتُبطِل تسجيلات الهواتف — أضف VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY يدويًّا إلى ملف إعدادات الخدمة.');
    }
  } else {
    console.warn('[vapid] لا يوجد ملف إعدادات قابل للكتابة (' + envFileCandidates().join(' · ') + ') — لم تُحفظ المفاتيح.');
    console.warn('[vapid] أضف VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY يدويًّا إلى ملف إعدادات الخدمة لتثبيتها.');
  }

  // جزء من المفتاح العام فقط — العام ليس سرًّا (نفس أسلوب deploy.sh في السجلّات).
  console.log('[vapid] VAPID_PUBLIC_KEY: ' + keys.publicKey.slice(0, 20) + '…');
  return keys.publicKey;
}

// getPublicKey(): المفتاح العام الحالي للعملية (null لو غير متاح).
function getPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

// isReady(): هل زوج المفاتيح صالح للإرسال؟
function isReady() {
  return isValidPublicKey(process.env.VAPID_PUBLIC_KEY) && isValidPrivateKey(process.env.VAPID_PRIVATE_KEY);
}

// getVapidDetails(): تفاصيل جاهزة لـ webpush.setVapidDetails.
function getVapidDetails() {
  return {
    subject: (process.env.VAPID_SUBJECT || '').trim() || DEFAULT_SUBJECT,
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
  };
}

// persistedPath(): مسار الحفظ الذي استُعمل (null لو لم يُحفظ شيء في هذه العملية).
function savedTo() {
  return persistedPath;
}

module.exports = {
  ensureVapidKeys,
  getPublicKey,
  isReady,
  getVapidDetails,
  isValidPublicKey,
  isValidPrivateKey,
  envFileCandidates,
  savedTo,
};
