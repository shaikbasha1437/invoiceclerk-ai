'use strict';
const test = require('node:test'); const assert = require('node:assert');
const M = require('../js/inv/money.js');
test('parseAmount: US, EU, negatives, symbols and junk', () => {
  const cases = [['$1,234.56', 1234.56], ['1.234,56 €', 1234.56], ['(1,234.56)', -1234.56], ['-£412.50', -412.5], ['1 234,56', 1234.56], ['1,234.56-', -1234.56], ['USD 12', 12], ['12,5', 12.5], ['1,234', 1234], ['£1,406.40', 1406.4], ['CA$ 99.99', 99.99], ['1.234.567,89', 1234567.89], ['0.13', 0.13], ['240,00', 240], [12.345, 12.35]];
  cases.forEach(([s, n]) => assert.strictEqual(M.parseAmount(s), n, String(s)));
  ['abc', '', null, '..', '$'].forEach((s) => assert.strictEqual(M.parseAmount(s), null, String(s)));
});
test('rounding helpers avoid float drift', () => {
  assert.strictEqual(M.r2(0.1 + 0.2), 0.3); assert.strictEqual(M.r2(1.005), 1.01); assert.strictEqual(M.r2(-1.005), -1.01);
  assert.strictEqual(M.sum([0.1, 0.2, 0.3]), 0.6); assert.ok(M.eq(10, 10.01)); assert.ok(!M.eq(10, 10.02)); assert.ok(M.eq(10, 10.02, 0.02));
});
test('parseDate: ISO, named months, slashes, dots, preference, invalid', () => {
  assert.strictEqual(M.parseDate('2026-10-14'), '2026-10-14');
  assert.strictEqual(M.parseDate('Oct 14, 2026'), '2026-10-14'); assert.strictEqual(M.parseDate('14 October 2026'), '2026-10-14'); assert.strictEqual(M.parseDate('October 5th, 2026'), '2026-10-05');
  assert.strictEqual(M.parseDate('10/14/2026'), '2026-10-14'); assert.strictEqual(M.parseDate('14/10/2026'), '2026-10-14');
  assert.strictEqual(M.parseDate('09/10/2026'), '2026-09-10'); assert.strictEqual(M.parseDate('09/10/2026', 'DMY'), '2026-10-09');
  assert.strictEqual(M.parseDate('14.10.2026'), '2026-10-14'); assert.strictEqual(M.parseDate('1/2/26'), '2026-01-02');
  assert.strictEqual(M.parseDate('31/02/2026'), ''); assert.strictEqual(M.parseDate('soon'), '');
});
test('terms, day math and currency detection', () => {
  assert.deepStrictEqual(M.parseTerms('Net 30'), { days: 30, label: 'Net 30' });
  assert.deepStrictEqual(M.parseTerms('2/10 Net 30').discount, { pct: 2, days: 10 });
  assert.strictEqual(M.parseTerms('Due on receipt').days, 0); assert.strictEqual(M.parseTerms('Due in 21 days').days, 21); assert.strictEqual(M.parseTerms(''), null);
  assert.strictEqual(M.addDays('2026-10-31', 30), '2026-11-30'); assert.strictEqual(M.addDays('2026-12-15', 30), '2027-01-14'); assert.strictEqual(M.daysBetween('2026-10-01', '2026-10-16'), 15);
  assert.strictEqual(M.detectCurrency('Total due (GBP) £1,406.40'), 'GBP'); assert.strictEqual(M.detectCurrency('€ 50'), 'EUR'); assert.strictEqual(M.detectCurrency('$5'), 'USD'); assert.strictEqual(M.detectCurrency('CA$5'), 'CAD'); assert.strictEqual(M.detectCurrency('5'), '');
  assert.strictEqual(M.format(1234.5, 'USD'), '$1,234.50'); assert.strictEqual(M.median([5, 1, 3]), 3); assert.strictEqual(M.median([1, 2, 3, 4]), 2.5);
});
