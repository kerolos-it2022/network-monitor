// locations.routes.js: CRUD المواقع (عام للقراءة، محمي للكتابة).
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// قِيم kind المَسمُوحة لِـ هرم الشبكة المُدمَج:
//  - 'internet' : قمة الهرم (مصدر الإنترنت/الراوتر) — يَنبغي أَلّا يَملك parent_id.
//  - 'zone'     : منطقة وَسَطية (تَدعم تَداخل أَي نوع) — default لِلمواقع الجديدة.
//  - 'site' | 'building' | 'floor' | 'room' | 'rack' : أَنواع ورقية (back-compat مع v2.5.1).
const VALID_KINDS = ['internet', 'zone', 'site', 'building', 'floor', 'room', 'rack'];
const DEFAULT_KIND = 'zone';

// ---------------------------------------------------------
// التحقق من سلامة parent_id قبل INSERT/UPDATE لِـ location:
//  1) منع الإِشارة الذاتية (parent_id === id).
//  2) منع الدائرة الهرمية: نَتتبع parent_id صعودًا حتى نَصل لِـ null أَو حدّ
//     أَقصى (عمق آمن 100). لو عُدنا لنفس id قبل ذلك → دائرة.
// يَرجِع null لو صالح، أَو نص الخطأ غير الصالح.
// ---------------------------------------------------------
function validateParentId(id, parentId) {
  if (parentId == null || parentId === '') return null; // جذر، صالح.
  const pid = Number(parentId);
  if (!Number.isFinite(pid) || pid <= 0) return 'قيمة parent_id غير صالحة';
  if (id != null && pid === Number(id)) return 'لا يُمكن أَن يكون الموقع أَبًا لنفسه';

  // تأكد أَن الأَب المُشار إليه موجُود.
  const parent = db.prepare('SELECT id FROM locations WHERE id = ?').get(pid);
  if (!parent) return 'الموقع الأَب غير موجُود (parent_id=' + pid + ')';

  // تَتبع صعودي لِكشف الدائرة (بما في ذلك أَنواع غير محدودة أَو بيانات تالفة).
  let current = pid;
  const seen = new Set([pid]);
  for (let i = 0; i < 1000; i++) {
    const row = db.prepare('SELECT parent_id FROM locations WHERE id = ?').get(current);
    if (!row) break; // صف تالف (مُستحيل عبر FK لكن نَتحوط).
    if (row.parent_id == null) return null; // وَصلنا للجذر — صالح.
    if (id != null && Number(row.parent_id) === Number(id)) {
      return 'دائرة هرمية غير صالحة: الموقع الأَب يَنحدر من هذا الموقع';
    }
    if (seen.has(Number(row.parent_id))) {
      // دائرة موجُودة في البيانات (ليست بسبب هذا الطلب) — نَقطع وَنُبلّغ.
      return 'دائرة هرمية موجُودة في البيانات الأُم';
    }
    seen.add(Number(row.parent_id));
    current = row.parent_id;
  }
  return 'تعذّر التَحقق من سلامة parent_id (عمق مفرط)';
}

// GET /api/locations  (عام)
// v2.7.1: ترتيب بِـ sort_order أَوّلاً ثُمّ id (نفس ترتيب خريطة المواقع).
router.get('/', (req, res) => {
  const rows = db
    .prepare('SELECT id, name, parent_id, kind, sort_order FROM locations ORDER BY sort_order ASC, id ASC')
    .all();
  return res.json({ success: true, data: rows });
});

// POST /api/locations/reorder  🔒 (v2.7.3)
// إِعادة تَرتيب المواقع دَفعةً واحدة (لِـ تَحريكها أَعلى/أَسفل في واجهة المواقع + خريطة
// المواقع تَظهر «مَتّصلة على التَوالي» بِـ تَرتيب المُستخدم).
// body: { updates: [{ id, sort_order }, ...] }
// يُحدِّث column sort_order فقط (لا يَمسّ name/parent_id/kind) داخل معاملة واحدة
// (transaction) لِضمان اتّساق التَرتيب. يَتجاوز قيد name المُعتاد في PUT /:id.
router.post('/reorder', requireAuth, (req, res) => {
  const updates = req.body && Array.isArray(req.body.updates) ? req.body.updates : null;
  if (!updates || updates.length === 0) {
    return res.status(400).json({ success: false, error: 'updates قائمة غير صالحة' });
  }
  // تَحقق سريع من صِحة كلّ عنصر (id رقم موجب + sort_order رقم نسبي).
  for (const u of updates) {
    const idOk = u && Number.isFinite(Number(u.id)) && Number(u.id) > 0;
    const soOk = u && Number.isFinite(Number(u.sort_order));
    if (!idOk || !soOk) {
      return res.status(400).json({ success: false, error: 'عنصر غير صالح في updates (id/sort_order)' });
    }
  }
  // معاملة واحدة لِـ تَطبيق كّل التَحديثات أَو لا شيء.
  const stmt = db.prepare('UPDATE locations SET sort_order = ? WHERE id = ?');
  try {
    db.transaction(() => {
      for (const u of updates) {
        stmt.run(Number(u.sort_order), Number(u.id));
      }
    })();
    return res.json({ success: true, data: { updated: updates.length } });
  } catch (e) {
    console.error('[LOCATIONS] /reorder error:', e.message);
    return res.status(500).json({ success: false, error: 'فشل إِعادة التَرتيب', detail: e.message });
  }
});

// POST /api/locations  🔒
router.post('/', requireAuth, (req, res) => {
  const { name, parent_id, kind, sort_order } = req.body || {};
  if (!name) {
    return res.status(400).json({ success: false, error: 'الحقل name مطلوب' });
  }
  const safeKind = VALID_KINDS.includes(kind) ? kind : DEFAULT_KIND;

  // التَحقق من سلامة parent_id (منع ذاتي/دائرة + وُجود الأَب).
  const parentErr = validateParentId(null, parent_id);
  if (parentErr) {
    return res.status(400).json({ success: false, error: parentErr });
  }

  // 'internet' يَنبغي أَلّا يَملك parent (قمة الهرم) — نَتجاهل parent_id بصمت
  // لِـ المرونة (لو أَرسل الإِطار قيمةً) لأن internet هو الجذر دائمًا.
  const finalParentId = safeKind === 'internet' ? null : (parent_id ?? null);

  // v2.7.1: لو sort_order لم يُحدّد (null/undefined)، نَضبطه آليًّا = (max+1) لِضمان
  // أَنّ الموقع الجديد يَظهر في نهاية التَرتيب. لو صريح → نَستعمله (مع تَحقق عددية).
  let finalSortOrder;
  if (sort_order == null || sort_order === '') {
    const maxRow = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM locations').get();
    finalSortOrder = (maxRow.m ?? -1) + 1;
  } else {
    const n = Number(sort_order);
    finalSortOrder = Number.isFinite(n) ? n : 0;
  }

  const result = db
    .prepare('INSERT INTO locations (name, parent_id, kind, sort_order) VALUES (?, ?, ?, ?)')
    .run(name, finalParentId, safeKind, finalSortOrder);
  return res.status(201).json({ success: true, data: { id: result.lastInsertRowid } });
});

// PUT /api/locations/:id  🔒
router.put('/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT id FROM locations WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ success: false, error: 'الموقع غير موجود' });
  }
  const { name, parent_id, kind, sort_order } = req.body || {};
  if (!name) {
    return res.status(400).json({ success: false, error: 'الحقل name مطلوب' });
  }
  const safeKind = VALID_KINDS.includes(kind) ? kind : DEFAULT_KIND;

  // التَحقق من سلامة parent_id (منع ذاتي/دائرة + وُجود الأَب) — هُنا id معروف.
  const parentErr = validateParentId(id, parent_id);
  if (parentErr) {
    return res.status(400).json({ success: false, error: parentErr });
  }

  const finalParentId = safeKind === 'internet' ? null : (parent_id ?? null);

  // v2.7.1: sort_order اختياري في PUT. لو لم يُرسَل (undefined) نُبقي القيمة القَديمة
  // (لا نَكتبها). لو أُرسَل null/'' → 0. لو رقم → نَستعمله. (نَتحقّق من type على width.)
  const existingRow = db.prepare('SELECT sort_order FROM locations WHERE id = ?').get(id);
  let finalSortOrder;
  if (sort_order === undefined) {
    finalSortOrder = existingRow ? existingRow.sort_order : 0;
  } else if (sort_order == null || sort_order === '') {
    finalSortOrder = 0;
  } else {
    const n = Number(sort_order);
    finalSortOrder = Number.isFinite(n) ? n : 0;
  }

  db.prepare('UPDATE locations SET name = ?, parent_id = ?, kind = ?, sort_order = ? WHERE id = ?').run(
    name,
    finalParentId,
    safeKind,
    finalSortOrder,
    id
  );
  return res.json({ success: true, data: null });
});

// DELETE /api/locations/:id  🔒
router.delete('/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT id FROM locations WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ success: false, error: 'الموقع غير موجود' });
  }
  db.prepare('DELETE FROM locations WHERE id = ?').run(id);
  // ملاحظة: FK ON DELETE SET NULL على parent_id و location_id يُعالج الأَبناء/الأَجهزة
  // تلقائيًّا (الأَبناء يُصبحُون جذورًا، الأَجهزة تُصبح غير مُعَيَّنة). لا cascade.
  return res.json({ success: true, data: null });
});

module.exports = router;
