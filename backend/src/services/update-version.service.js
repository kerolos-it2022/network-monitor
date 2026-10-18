// update-version.service.js — منطق الإصدارات للمُحدِّث (مقارنة semver + تحديد الاتجاه).
// ملاحظة مهمة عن النطاق: نسخة المستودع المحلي قد تكون **أحدث** من آخر تاج منشور على GitHub
// عندما نعمل على إصدار لم يُرفع بعد (وهذا الوضع الطبيعي أثناء التطوير). لذلك نفرّق بين:
//   • differenceFromGithub — يوجد فرق بين ما عندنا وما على GitHub (يُعرَض للمالك كما هو).
//   • remoteNewer          — GitHub أحدث فعلًا ⇒ يوجد ما يُثبَّت.
//   • localNewer           — نسختنا المحلية أحدث من المنشور ⇒ لا يوجد ما يُثبَّت (ولا تنزيل نازل).
// هذه الدوال نقية بلا شبكة/ملفات ⇒ قابلة للاختبار مباشرة.
// ملاحظة: note يُعرَض في اللوحة ⇒ بلغة الواجهة (ar التوأم الإنجليزي موجود دائمًا).
const { uiText } = require('./ui-text.service');

function semverParts(v) {
  const m = String(v == null ? '' : v).replace(/^v/i, '').trim().match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return [0, 0, 0];
  return [+m[1], +(m[2] || 0), +(m[3] || 0)];
}

/** هل a أحدث من b؟ */
function isNewerVersion(a, b) {
  const pa = semverParts(a), pb = semverParts(b);
  for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pa[i] > pb[i]; }
  return false;
}

/** هل الإصداران متساويان (بعد تطبيع شكل v)؟ */
function isSameVersion(a, b) {
  const pa = semverParts(a), pb = semverParts(b);
  return pa[0] === pb[0] && pa[1] === pb[1] && pa[2] === pb[2];
}

/**
 * تصنيف العلاقة بين نسخة التطبيق الحالية وآخر إصدار منشور على GitHub.
 * @returns {{same:boolean, remoteNewer:boolean, localNewer:boolean,
 *            differenceFromGithub:boolean, note:string}}
 */
function compareVersions(currentVersion, latestVersion) {
  const same = isSameVersion(currentVersion, latestVersion);
  const remoteNewer = !same && isNewerVersion(latestVersion, currentVersion);
  const localNewer = !same && isNewerVersion(currentVersion, latestVersion);
  const cur = String(currentVersion || '').replace(/^v/i, '');
  const lat = String(latestVersion || '').replace(/^v/i, '');
  let note;
  if (same) {
    note = uiText(`أنت على نفس آخر إصدار منشور على GitHub (v${lat})`,
      `You are on the same latest version published on GitHub (v${lat})`);
  } else if (remoteNewer) {
    note = uiText(`يتوفّر تحديث جديد على GitHub: v${lat} (نسختك الحالية v${cur})`,
      `A new update is available on GitHub: v${lat} (your current version v${cur})`);
  } else if (localNewer) {
    note = uiText(`آخر إصدار منشور على GitHub هو v${lat}، ونسختك المحلية (v${cur}) أحدث منه — `
      + 'هذا طبيعي أثناء العمل على إصدار لم يُرفع بعد؛ لا يوجد تحديث للتنزيل الآن.',
      `The latest version published on GitHub is v${lat}, and your local version (v${cur}) is newer — `
      + 'this is normal while working on a version that has not been published yet; there is no update to download right now.');
  } else {
    note = uiText(`فرق إصدارات: الحالي v${cur} · المتاح v${lat}`,
      `Version difference: current v${cur} · available v${lat}`);
  }
  return { same, remoteNewer, localNewer, differenceFromGithub: !same, note };
}

module.exports = { semverParts, isNewerVersion, isSameVersion, compareVersions };
