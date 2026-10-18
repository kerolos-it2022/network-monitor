// cleanup-stale-files.service.js — جسر تنظيف لمرة واحدة بعد التحديث الأول (v2.50.2).
// ─────────────────────────────────────────────────────────────────────────────
// لماذا يوجد: التحديث كان يُطبَّق بالنسخة الشغّالة القديمة (v2.50.0/v2.50.1) بنسخ
// الإصدار الجديد **فوق** الشجرة القائمة (cp -a / rsync بلا --delete)، فأي ملف وُجد
// في الإصدار القديم وغاب عن الجديد يبقى على القرص («ملفات/صفحات لا تُستبدل»).
// المُحدِّث الجديد (update-apply.service.js) يستبدل كل عنصر أعلى استبدالًا كاملًا،
// لكنه يعمل في التحديث **التالي** فقط ⇒ أول ترقية تترك بقايا خلفها. هذا الجسر يقرأ
// قائمة البقايا المرافقة للإصدار (backend/removed-files.json — يسكن backend/ لأن
// المُحدِّث القديم ينسخ backend/frontend/database فقط، فملفٌ في الجذر لا يصل أبدًا)
// ويحذف ما دُرِج فيها مرة واحدة عند أول إقلاع للنسخة الجديدة.
//
// الأمان — القائمة مدخل غير موثوق (قد تُتلاعَب): يُحذف فقط مسار نسبي داخل جذر
// المستودع، ولا يكون (ولا داخل) أي مسار محفوظ — نفس معرفة update-apply.service.js:
// node_modules · .env · database · uploads · backups · svc-backups · docs/_notes ·
// docs/private · .git · .zcode — ولا يُحذف مجلد مُدرَج في القائمة (الملفات وحدها)،
// ثم تُزال المجلدات التي أُفرغت فعلًا فقط. أي خطأ يُسجَّل ويُبتلع: الإقلاع لا يفشل
// أبدًا بسبب التنظيف، والقائمة نفسها لا تُطبَّق مرتين (علامة backend/removed-files.applied).
'use strict';
const fs = require('fs');
const path = require('path');
const { PRESERVE_INSIDE, PRESERVE_ROOT } = require('./update-apply.service');

// جذر المستودع نسبةً إلى هذا الملف: backend/src/services → ثلاث درجات أعلى.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const LIST_REL = 'backend/removed-files.json';
const APPLIED_REL = 'backend/removed-files.applied';

// أسماء محفوظة في أي عمق كانت — مُشتقّة من معرفة update-apply.service.js نفسها
// (node_modules · .env · database · uploads · backups · svc-backups · docs/_notes ·
// docs/private · .git) + .zcode (مساحة عمل محلية).
const PRESERVE_NAMES = new Set([
  ...PRESERVE_ROOT, ...Object.values(PRESERVE_INSIDE).flat(), '.zcode',
]);

// مسار نسبي بسيط داخل الجذر فقط: يرفض المطلق وUNC و«C:\» و«..» وأي حرف NUL.
function safeRelative(entry) {
  if (typeof entry !== 'string') return null;
  const s = entry.trim();
  if (!s || s.includes('\0')) return null;
  if (s.startsWith('/') || s.startsWith('\\')) return null;
  if (/^[A-Za-z]:/.test(s)) return null;
  const parts = s.replace(/\\/g, '/').split('/').filter((x) => x !== '' && x !== '.');
  if (!parts.length || parts.includes('..')) return null;
  return parts.join('/');
}

// محفوظ: المسار نفسه أو أي مجلد أعلى منه باسم محفوظ (بيانات مستخدم/تبعيات/مستودع).
function isPreserved(rel) {
  return rel.split('/').some((seg) => PRESERVE_NAMES.has(seg));
}

function readApplied(markerPath) {
  try { return fs.readFileSync(markerPath, 'utf8').trim(); } catch (e) { return null; }
}

// إزالة المجلدات التي أُفرغت بحذف ملفاتها — بالتتابع للأعلى، مع التوقف عند أول
// مجلد غير فارغ أو محفوظ. لا يُلمس الجذر أبدًا.
function removeEmptyParents(rootAbs, fromDir, report) {
  let dir = path.dirname(fromDir);
  while (true) {
    const rel = path.relative(rootAbs, dir).replace(/\\/g, '/');
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) break;   // وصلنا الجذر أو خرجنا
    if (isPreserved(rel)) break;
    try {
      if (fs.readdirSync(dir).length) break;
      fs.rmdirSync(dir);
      report.dirsRemoved.push(rel);
    } catch (e) { break; }
    dir = path.dirname(dir);
  }
}

// التنظيف نفسه: يُرجع تقريرًا ({ ran, skipped, deleted, refused, dirsRemoved, markerWritten })
// ولا يرمي أبدًا — يقرأ القائمة إن وُجدت ويحذف ما دُرِج فيها بأمان.
function cleanupStaleFiles({ root = REPO_ROOT } = {}) {
  const report = { ran: false, skipped: false, deleted: [], refused: [], dirsRemoved: [], markerWritten: false };
  try {
    const rootAbs = path.resolve(root);
    const listPath = path.join(rootAbs, ...LIST_REL.split('/'));
    const markerPath = path.join(rootAbs, ...APPLIED_REL.split('/'));
    if (!fs.existsSync(listPath)) return report;                       // لا قائمة ⇒ لا شيء (تثبيت جديد/نسخة أقدم)

    let list;
    try {
      list = JSON.parse(fs.readFileSync(listPath, 'utf8'));
    } catch (e) {
      console.error('[CLEANUP] تعذّر قراءة ' + LIST_REL + ': ' + e.message);
      return report;
    }
    const forVersion = list && typeof list.for === 'string' ? list.for.trim() : '';
    if (!forVersion) { console.error('[CLEANUP] قائمة بلا حقل «for» صالح — تخطٍ.'); return report; }

    // مرة واحدة لكل قائمة: العلامة تسجّل إصدار القائمة التي طُبِّقت، فقائمة إصدار
    // لاحق (ملف جديد بـfor مختلف) تُطبَّق بدورها.
    if (readApplied(markerPath) === forVersion) { report.skipped = true; return report; }

    report.ran = true;
    const removed = Array.isArray(list.removed) ? list.removed : [];
    for (const entry of removed) {
      const rel = safeRelative(entry);
      if (!rel || rel === LIST_REL || rel === APPLIED_REL) { report.refused.push(String(entry)); continue; }
      if (isPreserved(rel)) { report.refused.push(rel); continue; }
      const abs = path.resolve(rootAbs, rel);
      const within = path.relative(rootAbs, abs);
      if (!within || within.startsWith('..') || path.isAbsolute(within)) { report.refused.push(rel); continue; }
      let st;
      try { st = fs.lstatSync(abs); } catch (e) { continue; }          // غير موجود = سبق حذفه/لم يُنسخ أصلًا
      if (!st.isFile() && !st.isSymbolicLink()) { report.refused.push(rel); continue; }  // مجلد؟ مرفوض (قد يحوي محفوظات)
      try {
        fs.unlinkSync(abs);
        report.deleted.push(rel);
        removeEmptyParents(rootAbs, abs, report);
      } catch (e) {
        report.refused.push(rel);
        console.error('[CLEANUP] فشل حذف ' + rel + ': ' + e.message);
      }
    }

    if (report.deleted.length) {
      console.log('[CLEANUP] حُذف ' + report.deleted.length + ' ملفًا متبقّيًا من إصدار سابق'
        + (report.dirsRemoved.length ? ' و' + report.dirsRemoved.length + ' مجلدًا فارغًا' : ''));
    }
    if (report.refused.length) {
      console.error('[CLEANUP] رُفض ' + report.refused.length + ' مسارًا غير آمن في قائمة البقايا');
    }
    // العلامة تُكتب بعد تنفيذ نظيف (ولو لم يُحذف شيء — لا بقايا على القرص أصلًا):
    // قائمةٌ سليمة لا يُعاد فحصها كل إقلاع، وقائمة فيها مسارات مرفوضة لا تُوسم
    // «طُبِّقت» فيبقى التحذير ظاهرًا في كل إقلاع حتى تُصحَّح.
    if (!report.refused.length) {
      try { fs.writeFileSync(markerPath, forVersion + '\n'); report.markerWritten = true; }
      catch (e) { console.error('[CLEANUP] تعذّر كتابة علامة التنفيذ: ' + e.message); }
    }
  } catch (e) {
    console.error('[CLEANUP] فشل التنظيف:', e.message);
  }
  return report;
}

module.exports = { cleanupStaleFiles, safeRelative, isPreserved, LIST_REL, APPLIED_REL };
