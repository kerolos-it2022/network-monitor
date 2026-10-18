// seedAdmin.js: سكريبت يُشغَّل يدوياً مرة واحدة لإنشاء حساب المدير الافتراضي إذا لم يوجد أي مستخدم.
// ═══ SEC-03 — تأمين الإنشاء الأول ═══
//   1) كلمة مرور ضعيفة/افتراضية (ChangeMe123! أو أقل من 12 حرفًا) ⇒ **رفض في الإنتاج**
//      (NODE_ENV=production) بدل إنشاء حساب مخترَق معروف للجميع.
//   2) عند غياب كلمة مرور قوية: تُولَّد كلمة عشوائية وتُعرض **مرة واحدة فقط** هنا
//      (تُقرأ من مخرجات الأمر ثم تُغيَّر من اللوحة) — ولا تُكتب في أي سجل دائم.
//   3) كلمة المرور المُقدَّمة عبر .env لا تُطبع أبدًا.
//   سلوك الطوارئ المقصود فقط: NM_ALLOW_WEAK_ADMIN=1 يسمح بكلمة ضعيفة في الإنتاج (غير موصى به).
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');

const count = db.prepare('SELECT COUNT(*) AS cnt FROM users').get().cnt;

if (count > 0) {
  console.log('Admin already exists — لا حاجة لإنشاء مستخدم جديد.');
  process.exit(0);
}

const username = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
const provided = String(process.env.DEFAULT_ADMIN_PASSWORD || '');
const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const allowWeak = String(process.env.NM_ALLOW_WEAK_ADMIN || '') === '1';

const WEAK_PASSWORDS = new Set([
  'changeme123!', 'changeme123', 'changeme', 'admin', 'admin123', 'password',
  'password123', '123456', '12345678', '123456789', 'qwerty', 'letmein', 'welcome',
]);
const isStrong = provided.length >= 12 && !WEAK_PASSWORDS.has(provided.toLowerCase());

let password = provided;
let generated = false;

if (!isStrong) {
  if (isProd && !allowWeak) {
    console.error('========================================================');
    console.error('❌ رفض إنشاء حساب المدير: كلمة المرور غائبة أو ضعيفة/افتراضية.');
    console.error('   عيّن DEFAULT_ADMIN_PASSWORD قوية (≥ 12 حرفًا) في backend/.env ثم أعد المحاولة:');
    console.error('     DEFAULT_ADMIN_PASSWORD="<كلمة مرور قوية عشوائية>"');
    console.error('   (أو NM_ALLOW_WEAK_ADMIN=1 للسماح المؤقت — غير موصى به في الإنتاج.)');
    console.error('========================================================');
    process.exit(1);
  }
  // غير الإنتاج، أو سماح صريح: نولّد كلمة عشوائية بدل الافتراضية المعروفة.
  password = crypto.randomBytes(12).toString('base64url'); // ≈ 16 حرفًا
  generated = true;
}

const passwordHash = bcrypt.hashSync(password, 10);

db.prepare(
  'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
).run(username, passwordHash, 'admin');

console.log('========================================================');
console.log('✅ تم إنشاء حساب المدير الافتراضي بنجاح');
console.log(`   👤 اسم المستخدم: ${username}`);
if (generated) {
  console.log(`   🔑 كلمة المرور (تُعرض مرة واحدة فقط — احفظها الآن): ${password}`);
  console.log('   ⚠️  غيّرها فورًا من لوحة التحكم بعد أول تسجيل دخول.');
} else {
  console.log('   🔑 كلمة المرور: مأخوذة من DEFAULT_ADMIN_PASSWORD (لم تُطبع هنا — سياسة SEC-03).');
}
console.log('========================================================');
