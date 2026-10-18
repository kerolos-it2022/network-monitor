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

test('i18n: لا يوجد نصّ فارغ في القاموس، والإنجليزية هي اللغة الافتراضية', () => {
  const dict = arabicDict();
  const empty = Object.entries(dict).filter(([, v]) => !String(v).trim()).map(([k]) => k);
  assert.deepEqual(empty, [], 'مفاتيح بنصّ فارغ: ' + empty.join(', '));
  assert.match(I18N_SRC, /let lang = 'en'/, 'الافتراضي الإنجليزية');
  assert.match(I18N_SRC, /function t\(key, vars\)/, 'دالة t موجودة');
  assert.match(I18N_SRC, /function applyDom\(/, 'مطبّق النصوص موجود');
  // الاتجاه صار تابعًا للغة (كان مثبّتًا على rtl) + تسجيل اللغات من ملفات مستقلة
  assert.match(I18N_SRC, /function dirOf\(/, 'اتجاه اللغة محسوب من LANG_META');
  assert.match(I18N_SRC, /const LANG_META = \{/, 'جدول اللغات موجود');
  assert.match(I18N_SRC, /function registerLang\(/, 'تسجيل لغة جديدة متاح');
  assert.ok(!/setAttribute\('dir', 'rtl'\)/.test(I18N_SRC), 'لا يوجد تثبيت اتجاه في الكود');
});

// قسم الإنجليزية (js/nm-i18n-en.js): نفس مفاتيح العربية بالحرف — أي مفتاح ناقص يُسقط الاختبار.
function englishDict() {
  const src = fs.readFileSync(path.join(PUBLIC, 'js', 'nm-i18n-en.js'), 'utf8');
  const dict = {};
  const re = /^\s*'([a-zA-Z0-9_.]+)':\s*'((?:[^'\\]|\\.)*)',\s*$/gm;
  let m;
  while ((m = re.exec(src))) dict[m[1]] = m[2].replace(/\\'/g, "'");
  return dict;
}

test('i18n: كل مفتاح عربي له ترجمة إنجليزية بنفس المفتاح (تكافؤ كامل)', () => {
  const ar = arabicDict();
  const en = englishDict();
  assert.ok(Object.keys(en).length >= 100, 'القاموس الإنجليزي كبير بما يكفي (الآن: ' + Object.keys(en).length + ')');
  const missing = Object.keys(ar).filter((k) => en[k] === undefined || !String(en[k]).trim());
  assert.deepEqual(missing, [], 'مفاتيح بلا ترجمة إنجليزية: ' + missing.join(', '));
  // ولا مفتاح إنجليزي بلا مقابل عربي (يمنع المفاتيح اليتيمة)
  const orphans = Object.keys(en).filter((k) => ar[k] === undefined);
  assert.deepEqual(orphans, [], 'مفاتيح إنجليزية بلا أصل عربي: ' + orphans.join(', '));
});

test('i18n: قواعد الوضع الإنجليزي (LTR) موجودة وتنعكس مع العربية', () => {
  const css = fs.readFileSync(path.join(PUBLIC, 'css', 'ui.css'), 'utf8');
  for (const sel of [
    'html[dir="ltr"] table.data-table td',
    'html[dir="ltr"] table.nm-table .col-ltr',
    'html[dir="ltr"] body:not(.page-noc) input[type="time"]',
    'html[dir="ltr"] .df-value',
    'html[dir="ltr"] .sidebar.open',
  ]) {
    assert.ok(css.includes(sel), 'قاعدة LTR ناقصة: ' + sel);
  }
  // العربية تبقى كما هي: قواعد المحاذاة الأصلية (بلا dir) لم تُحذف
  assert.ok(css.includes('table.data-table .col-ltr, table.nm-table .col-ltr {'), 'قاعدة العربية الأصلية باقية');
  assert.ok(css.includes('text-align: right;'), 'محاذاة العربية اليمنى باقية');
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
