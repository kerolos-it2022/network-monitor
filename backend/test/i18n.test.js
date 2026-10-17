// اختبارات أساس الترجمة (i18n) — v2.33.0.
// الهدف: منع «التوصيل المكسور» قبل إضافة اللغة الإنجليزية: كل مفتاح مكتوب في الصفحات يجب أن يكون
// له نصّ في القاموس العربي، ولا يجوز وجود نصّ فارغ، ويجب ألّا يُلمس أي نصّ ظاهر (العربية كما هي).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', '..', 'frontend', 'public');
const PAGES = ['index.html', 'noc.html', 'admin/dashboard.html', 'admin/login.html'];
const I18N_SRC = fs.readFileSync(path.join(PUBLIC, 'js', 'nm-i18n.js'), 'utf8');

// قيم القسم العربي **وحده** (بين `ar: {` والسطر `},` الذي يغلقه) — يمنع المفاتيح المُضافة خارج القسم.
function arabicDict() {
  const start = I18N_SRC.indexOf('ar: {');
  assert.ok(start > -1, 'قسم ar موجود');
  const rest = I18N_SRC.slice(start);
  const end = rest.indexOf('\n    },');
  const block = end > -1 ? rest.slice(0, end) : rest;
  const dict = {};
  const re = /^\s*'([a-zA-Z0-9_.]+)':\s*'((?:[^'\\]|\\.)*)',\s*$/gm;
  let m;
  while ((m = re.exec(block))) dict[m[1]] = m[2].replace(/\\'/g, "'");
  return dict;
}

test('i18n: كل مفتاح مكتوب في الصفحات له نصّ في القاموس العربي', () => {
  const dict = arabicDict();
  assert.ok(Object.keys(dict).length >= 100, 'القاموس يحوي مفاتيح كافية (الآن: ' + Object.keys(dict).length + ')');
  const missing = [];
  let used = 0;
  for (const page of PAGES) {
    const html = fs.readFileSync(path.join(PUBLIC, page), 'utf8');
    const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
    used += keys.length;
    for (const k of keys) if (dict[k] === undefined) missing.push(page + ':' + k);
    // مفاتيح السمات (data-i18n-attr="attr:key") أيضًا
    for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
      m[1].split(/\s+/).forEach((pair) => {
        const k = (pair.split(':')[1] || '').trim();
        if (k && dict[k] === undefined) missing.push(page + ':attr:' + k);
      });
    }
  }
  assert.ok(used >= 90, 'عدد العناصر الموصولة في الصفحات كافٍ للبدء (الآن: ' + used + ')');
  assert.deepEqual(missing, [], 'مفاتيح بلا نصّ في القاموس: ' + missing.join(', '));
});

test('i18n: لا يوجد نصّ فارغ في القاموس، والعربية هي اللغة الافتراضية', () => {
  const dict = arabicDict();
  const empty = Object.entries(dict).filter(([, v]) => !String(v).trim()).map(([k]) => k);
  assert.deepEqual(empty, [], 'مفاتيح بنصّ فارغ: ' + empty.join(', '));
  assert.match(I18N_SRC, /let lang = 'ar'/, 'الافتراضي العربية');
  assert.match(I18N_SRC, /function t\(key, vars\)/, 'دالة t موجودة');
  assert.match(I18N_SRC, /function applyDom\(/, 'مطبّق النصوص موجود');
  // قسم الإنجليزية غير مُعبّأ الآن (يُعبّأ لاحقًا بنفس المفاتيح) — تعليق فقط
  assert.ok(!/^\s*en:\s*\{/m.test(I18N_SRC), 'قسم en غير مُفعّل بعد (كما هو مطلوب في هذه المرحلة)');
});

test('i18n: لا كلمات إنجليزية وصفية تركت في واجهات الشاشات الأربع', () => {
  // القائمة: الكلمات الوصفية التي أُزيلت بأمر المالك (المصطلحات التقنية وأسماء العلامات ليست ضمنها)
  const forbidden = [
    /\(Online\)/, /\(Offline\)/, /\(Blocked\)/,
    /\(Backbone Uplink\)/, /\(Categorized Assets\)/,
    /Network Operations Center/,
    /\(Bot Token\)/, /\(Chat ID\)/, /\(API Token\)/, /\(To Number\)/, /\(Model\)/,
    /\(Add to Home Screen\)/, /\(PWA\)/,
  ];
  const offenders = [];
  for (const page of PAGES) {
    const html = fs.readFileSync(path.join(PUBLIC, page), 'utf8');
    for (const re of forbidden) if (re.test(html)) offenders.push(page + ' → ' + re);
  }
  assert.deepEqual(offenders, [], 'كلمات إنجليزية وصفية متبقّية: ' + offenders.join(' | '));
});
