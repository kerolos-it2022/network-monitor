// seedAdmin.js: سكريبت يُشغَّل يدوياً مرة واحدة لإنشاء حساب المدير الافتراضي إذا لم يوجد أي مستخدم.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

const count = db.prepare('SELECT COUNT(*) AS cnt FROM users').get().cnt;

if (count > 0) {
  console.log('Admin already exists — لا حاجة لإنشاء مستخدم جديد.');
  process.exit(0);
}

const username = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
const password = process.env.DEFAULT_ADMIN_PASSWORD || 'ChangeMe123!';
const passwordHash = bcrypt.hashSync(password, 10);

db.prepare(
  'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
).run(username, passwordHash, 'admin');

console.log('========================================================');
console.log('✅ تم إنشاء حساب المدير الافتراضي بنجاح');
console.log(`   👤 اسم المستخدم: ${username}`);
console.log(`   🔑 كلمة المرور:  ${password}`);
console.log('   ⚠️  غيّر كلمة المرور فورًا من لوحة التحكم بعد أول تسجيل دخول.');
console.log('   🔒 أو عدّل DEFAULT_ADMIN_PASSWORD في backend/.env وأعد التشغيل.');
console.log('========================================================');
