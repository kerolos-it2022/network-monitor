// اختبارات SEC-01 — وحدة التحقق من الأهداف وسياسة النطاقات (دوال نقية، بلا شبكة/DB).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseCidr, ipToBytes, inCidr, isPrivate, unwrapV4Mapped, parseCidrList } = require('../src/services/net/net-utils');
const { validateTarget, authorizeTarget, isAddressAllowed } = require('../src/services/net/target-guard');

test('validateTarget: أهداف صالحة', () => {
  const ok = [
    ['192.168.88.10', 'ipv4'],
    ['10.0.0.1', 'ipv4'],
    ['fe80::1', 'ipv6'],
    ['::1', 'ipv6'],
    ['2001:db8::5', 'ipv6'],
    ['synology', 'hostname'],
    ['nas.local', 'hostname'],
    ['my-pc.office.lan', 'hostname'],
    [' 192.168.1.5 ', 'ipv4'], // مسافات حول الهدف تُشذَّب
  ];
  for (const [input, kind] of ok) {
    const r = validateTarget(input);
    assert.equal(r.ok, true, `${input} يجب أن يُقبل: ${r.error || ''}`);
    assert.equal(r.kind, kind, `${input} kind`);
  }
});

test('validateTarget: محارف حقن ومسافات وأعلام مرفوضة', () => {
  const bad = [
    '',
    '   ',
    '192.168.1.1\nid',
    '192.168.1.1\r\nid',
    '192.168.1.1 -f',
    '192.168.1.1\t-f',
    '-c 5 192.168.1.1',
    '-n',
    '8.8.8.8;id',
    '8.8.8.8&&id',
    '8.8.8.8|id',
    '$(id)',
    '`id`',
    'a"b',
    "a'b",
    'host\\name',
    'host/../../etc',
    'host%00',
    'user@host',
    'عربي.مصر',
    'хост.рф',
    '192.168.1.1/24',
    '1.2.3',
    '1.2.3.4.5',
    '010.1.1.1',
    '256.1.1.1',
    '1.2.3.4.',
    'host_name',
    'host..name',
    '-host',
    'host-',
    'a'.repeat(254),
    'a'.repeat(64) + '.com',
    '1',
    '1234',
  ];
  for (const input of bad) {
    const r = validateTarget(input);
    assert.equal(r.ok, false, `يجب رفض: ${JSON.stringify(input)}`);
  }
});

test('validateTarget: رفض الأنواع غير النصية وغير المعرّفة', () => {
  assert.equal(validateTarget(undefined).ok, false);
  assert.equal(validateTarget(null).ok, false);
  assert.equal(validateTarget(123).ok, false);
  assert.equal(validateTarget({ ip: '1.2.3.4' }).ok, false);
  assert.equal(validateTarget(['1.2.3.4']).ok, false);
  assert.equal(validateTarget(undefined).error.length > 0, true);
});

test('net-utils: تحويل IPv4/CIDR والمطابقة', () => {
  assert.deepEqual(Array.from(ipToBytes('192.168.88.5').bytes), [192, 168, 88, 5]);
  assert.equal(ipToBytes('010.1.1.1'), null);
  const c = parseCidr('192.168.0.0/16');
  assert.equal(c.family, 4);
  assert.equal(inCidr(ipToBytes('192.168.88.5').bytes, c), true);
  assert.equal(inCidr(ipToBytes('192.169.0.1').bytes, c), false);
  assert.equal(inCidr(ipToBytes('10.0.0.1').bytes, c), false);
  assert.equal(parseCidr('192.168.1.1').prefix, 32, 'عنوان مفرد بدون / يُعتبر /32');
  assert.equal(parseCidr('1.2.3.4/33'), null);
  assert.equal(parseCidr('nonsense'), null);
  assert.equal(parseCidrList('10.0.0.0/8, bad, 192.168.0.0/16').length, 2);
});

test('net-utils: IPv6 والمطابقة وعناوين IPv4 المدمجة', () => {
  const fe80 = parseCidr('fe80::/10');
  assert.equal(inCidr(ipToBytes('fe80::abcd').bytes, fe80), true);
  assert.equal(inCidr(ipToBytes('2001:db8::1').bytes, fe80), false);
  const ula = parseCidr('fc00::/7');
  assert.equal(inCidr(ipToBytes('fd12:3456::1').bytes, ula), true);
  assert.equal(inCidr(ipToBytes('::1').bytes, parseCidr('::1/128')), true);
  // ::ffff:192.168.1.1 يجب أن تُعامَل كـ IPv4 خاص
  const mapped = ipToBytes('::ffff:192.168.1.1').bytes;
  assert.deepEqual(Array.from(unwrapV4Mapped(mapped)), [192, 168, 1, 1]);
  assert.equal(isPrivate('::ffff:192.168.1.1'), true);
  assert.equal(isPrivate('8.8.8.8'), false);
  assert.equal(isPrivate('192.168.1.5'), true);
  assert.equal(isPrivate('100.100.1.1'), true);
  assert.equal(ipToBytes('fe80::1%eth0'), null);
});

test('authorizeTarget: العنوان العام مرفوض افتراضيًّا والخاص مقبول', async () => {
  const denied = await authorizeTarget('8.8.8.8');
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'TARGET_NOT_ALLOWED');

  const allowed = await authorizeTarget('192.168.88.10');
  assert.equal(allowed.ok, true);
  assert.equal(allowed.address, '192.168.88.10');

  const loop = await authorizeTarget('127.0.0.1');
  assert.equal(loop.ok, true);

  const allowedPublic = await authorizeTarget('8.8.8.8', { allowPublic: true });
  assert.equal(allowedPublic.ok, true);
});

test('authorizeTarget: حلّ الاسم ثم اعتماد الـ IP — ورفض كل العناوين خارج النطاق', async () => {
  const resolvePrivate = async () => [{ address: '192.168.1.50' }];
  const okHost = await authorizeTarget('nas.local', { resolve: resolvePrivate });
  assert.equal(okHost.ok, true);
  assert.equal(okHost.address, '192.168.1.50');

  const resolvePublic = async () => [{ address: '93.184.216.34' }];
  const badHost = await authorizeTarget('example.com', { resolve: resolvePublic });
  assert.equal(badHost.ok, false);
  assert.equal(badHost.code, 'TARGET_NOT_ALLOWED');

  // سجل مختلط (خاص + عام) ⇒ يُرفض كاملًا (منع DNS rebinding)
  const mixed = async () => [{ address: '192.168.1.50' }, { address: '8.8.8.8' }];
  const mixedRes = await authorizeTarget('dual.example.com', { resolve: mixed });
  assert.equal(mixedRes.ok, false);

  const failing = async () => { throw new Error('ENOTFOUND'); };
  const dnsFail = await authorizeTarget('nowhere.invalid', { resolve: failing });
  assert.equal(dnsFail.ok, false);
  assert.equal(dnsFail.code, 'DNS_FAILED');
});

test('authorizeTarget: قائمة CIDR مخصصة تستبدل الافتراضية', async () => {
  const cidrs = parseCidrList('172.20.0.0/16');
  const outOfList = await authorizeTarget('192.168.1.10', { cidrs });
  assert.equal(outOfList.ok, false, 'خارج القائمة المخصصة يجب رفضه');
  const inList = await authorizeTarget('172.20.5.6', { cidrs });
  assert.equal(inList.ok, true);
});

test('isAddressAllowed: IPv4-mapped IPv6 يُقارَن كـ IPv4', () => {
  const cidrs = parseCidrList('10.0.0.0/8');
  assert.equal(isAddressAllowed(ipToBytes('::ffff:10.1.2.3').bytes, cidrs), true);
  assert.equal(isAddressAllowed(ipToBytes('::ffff:8.8.8.8').bytes, cidrs), false);
});
