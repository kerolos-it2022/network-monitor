// db.js: يفتح اتصال better-sqlite3 ويُفعّل مفاتيح أجنبية، ويُصدّره لباقي الوحدات.
require('dotenv').config();
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || '../database/monitoring.db';
const db = new Database(dbPath);

// تفعيل المفاتيح الأجنبية (ON DELETE CASCADE وغيرها تعتمد على هذا).
db.pragma('foreign_keys = ON');

module.exports = db;
