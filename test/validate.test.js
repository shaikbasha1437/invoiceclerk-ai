'use strict';
const test = require('node:test'); const assert = require('node:assert');
const V = require('../js/inv/validate.js'); const P = require('../js/inv/parse.js');
const { S, linesFor } = require('./helpers.js');
const vendors = JSON.parse(JSON.stringify(S.VENDORS));
const base = () => ({ vendor: 'Cloudnest Software Inc.', vendorEmail: 'invoices@cloudnest.example', invoiceNumber: 'CN-1', docType: 'invoice', issueDate: '2026-10-01', dueDate: '2026-10-16', po: 'PO-1', currency: 'USD', subtotal: 100, taxRate: 10, tax: 10, total: 110, lines: [{ description: 'Seat', qty: 2, unitPrice: 50, amount: 100 }], hasBank: false });
const ids = (f, ctx) => V.validate(f, Object.assign({ vendors, settings: { baseCurrency: 'USD' } }, ctx || {})).map((x) => x.id);
test('a clean invoice has no flags', () => assert.deepStrictEqual(ids(base()), []));
test('missing vendor / number / dates / total', () => {
  const f = Object.assign(base(), { vendor: '', vendorEmail: '', invoiceNumber: '', issueDate: '', dueDate: '', total: null });
  const got = ids(f); ['missing_vendor', 'missing_number', 'missing_issue_date', 'missing_due_date', 'missing_total'].forEach((k) => assert.ok(got.includes(k), k));
  assert.ok(V.blocking(V.validate(f, { vendors })).length >= 4);
});
test('line sum, line math, tax rate and total mismatches', () => {
  assert.ok(ids(Object.assign(base(), { subtotal: 120, total: 130, tax: 12 })).includes('lines_sum'));
  assert.ok(ids(Object.assign(base(), { lines: [{ description: 'Seat', qty: 3, unitPrice: 50, amount: 100 }] })).includes('line_math'));
  assert.ok(ids(Object.assign(base(), { tax: 12, total: 112 })).includes('tax_rate'));
  const t = V.validate(Object.assign(base(), { total: 120 }), { vendors }); const fl = t.find((x) => x.id === 'total_mismatch');
  assert.strictEqual(fl.severity, 'error'); assert.match(fl.detail, /\$10\.00/);
  assert.ok(!ids(Object.assign(base(), { tax: 10.01, total: 110.01 })).includes('tax_rate'), '1 cent rounding tolerated');
});
test('vendor matching by name variants and email domain', () => {
  assert.strictEqual(V.matchVendor(vendors, 'Northwind Office Supply, Inc.', '').id, 'v-northwind');
  assert.strictEqual(V.matchVendor(vendors, 'Pixel and Pine Design Studio', '').id, 'v-pixelpine');
  assert.strictEqual(V.matchVendor(vendors, 'Lumen Printing', 'orders@lumenprint example').id, 'v-lumen');
  assert.strictEqual(V.matchVendor(vendors, 'Totally New LLC', 'a@new.example'), null);
  assert.ok(ids(Object.assign(base(), { vendor: 'Totally New LLC', vendorEmail: '' })).includes('new_vendor'));
});
test('missing PO only when the vendor or settings require it', () => {
  assert.ok(!ids(Object.assign(base(), { po: '' })).includes('missing_po'));
  assert.ok(ids(Object.assign(base(), { po: '' }), { settings: { requirePO: true } }).includes('missing_po'));
  assert.ok(ids(Object.assign(base(), { vendor: 'Northwind Office Supply', vendorEmail: '', po: '' })).includes('missing_po'));
  assert.ok(!ids(Object.assign(base(), { vendor: 'Northwind Office Supply', vendorEmail: '', po: '', docType: 'credit_note' })).includes('missing_po'));
});
test('exact duplicate (same vendor + number, normalised) against inbox and posted bills', () => {
  const other = { id: 'a', order: 1, status: 'extracted', fields: Object.assign(base(), { invoiceNumber: 'cn 1' }) };
  assert.ok(ids(base(), { selfId: 'b', others: [other] }).includes('duplicate'));
  assert.ok(!ids(base(), { selfId: 'b', others: [Object.assign({}, other, { status: 'skipped' })] }).includes('duplicate'));
  const bills = [{ invoiceId: 'z', vendorName: 'Cloudnest Software', number: 'CN-1', total: 110, date: '2026-10-01', type: 'bill' }];
  const fl = V.validate(base(), { vendors, bills, selfId: 'b' }).find((x) => x.id === 'duplicate'); assert.match(fl.detail, /already posted/);
  assert.ok(!ids(Object.assign(base(), { docType: 'credit_note' }), { bills }).includes('duplicate'), 'credit note with same number is not a dup of the bill');
});
test('near duplicate: same vendor, same total, close date, different number', () => {
  const other = { id: 'a', status: 'extracted', fields: Object.assign(base(), { invoiceNumber: 'CN-0', issueDate: '2026-09-28' }) };
  assert.ok(ids(base(), { selfId: 'b', others: [other] }).includes('duplicate_near'));
  other.fields.issueDate = '2026-09-01'; assert.ok(!ids(base(), { selfId: 'b', others: [other] }).includes('duplicate_near'));
});
test('unusual amount vs vendor history (high and low), needs 3+ bills', () => {
  const big = Object.assign(base(), { vendor: 'Bluewater Freight Co.', vendorEmail: '', total: 9706.2, subtotal: 9240, tax: 466.2, taxRate: null, lines: [{ description: 'x', qty: 1, unitPrice: 9240, amount: 9240 }] });
  const fl = V.validate(big, { vendors }).find((x) => x.id === 'unusual_amount'); assert.ok(fl); assert.match(fl.detail, /median of 4/);
  assert.strictEqual(V.unusual(10, [{ total: 400 }, { total: 420 }, { total: 390 }]).low, true);
  assert.strictEqual(V.unusual(5000, [{ total: 400 }, { total: 420 }]), null);
  assert.strictEqual(V.unusual(450, [{ total: 400 }, { total: 420 }, { total: 390 }]), null);
});
test('currency: foreign vs base, and vs vendor usual', () => {
  const f = Object.assign(base(), { vendor: 'Someone Abroad', vendorEmail: '', currency: 'GBP' });
  assert.match(V.validate(f, { vendors, settings: { baseCurrency: 'USD' } }).find((x) => x.id === 'currency_mismatch').label, /Foreign/);
  const g = Object.assign(base(), { currency: 'EUR' });
  assert.match(V.validate(g, { vendors }).find((x) => x.id === 'currency_mismatch').label, /usual/);
  assert.ok(ids(Object.assign(base(), { currency: '' })).includes('missing_currency'));
});
test('bank details present vs changed from vendor record', () => {
  const f = Object.assign(base(), { vendor: 'Northwind Office Supply', vendorEmail: '', hasBank: true, bankLast4: '6789', payment: { account: '000123456789' } });
  assert.strictEqual(V.validate(f, { vendors }).find((x) => x.id === 'bank_details').severity, 'info');
  f.bankLast4 = '1111'; const ch = V.validate(f, { vendors }).find((x) => x.id === 'bank_changed'); assert.strictEqual(ch.severity, 'error'); assert.match(ch.detail, /1111/);
});
test('credit note, OCR source and hidden prompt-injection text', () => {
  assert.ok(ids(Object.assign(base(), { docType: 'credit_note' })).includes('credit_note'));
  assert.ok(ids(base(), { source: 'demo-ocr' }).includes('ocr'));
  const bw = linesFor('bluewater-BW-2210.pdf').join('\n');
  assert.ok(ids(base(), { text: bw }).includes('injection'));
  assert.ok(!ids(base(), { text: linesFor('northwind-INV-10421.pdf').join('\n') }).includes('injection'));
});
test('due date sanity', () => {
  assert.ok(ids(Object.assign(base(), { dueDate: '2026-09-01' })).includes('due_before_issue'));
  assert.ok(ids(Object.assign(base(), { dueDateComputed: true, terms: 'Net 15' })).includes('due_computed'));
  const f = P.parseInvoice(linesFor('ridgeway-scan-RJ-1187.pdf')); assert.ok(ids(f).includes('missing_due_date'));
});
