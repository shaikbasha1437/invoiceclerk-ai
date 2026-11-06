'use strict';
const test = require('node:test'); const assert = require('node:assert');
const Lg = require('../js/inv/ledger.js'); const P = require('../js/inv/parse.js'); const M = require('../js/inv/money.js');
const { S, linesFor } = require('./helpers.js');
const fresh = () => Lg.createLedger({ vendors: S.VENDORS });
const parsed = (file) => P.parseInvoice(linesFor(file));
const balanced = (e) => M.eq(M.sum(e.lines.map((l) => l.debit)), M.sum(e.lines.map((l) => l.credit)), 0);
function postFile(L, file, settings, tweak) { const p = Lg.propose(parsed(file), L, settings || {}); if (tweak) tweak(p); Lg.approveAll(p); const b = Lg.build(p, L, settings || {}); return Lg.post(L, b, { invoiceId: file, now: '2026-11-06T16:00:00Z' }); }
test('starter chart has the key accounts', () => {
  const codes = Lg.CHART.map((a) => a.code);
  ['2000', '1400', '1999', '5000', '5100', '6000', '6100', '6200', '6300', '6400'].forEach((c) => assert.ok(codes.includes(c), c));
});
test('account mapping: keyword rules beat vendor default; fallback misc', () => {
  const L = fresh();
  assert.strictEqual(Lg.mapAccount('Hotel, 3 nights', null, L).code, '6200');
  assert.strictEqual(Lg.mapAccount('Ocean freight, 40ft container', null, L).code, '5100');
  assert.strictEqual(Lg.mapAccount('Something odd', { defaultAccount: '6300' }, L).code, '6300');
  assert.strictEqual(Lg.mapAccount('Something odd', null, L).code, '6990');
  assert.match(Lg.mapAccount('Hotel', { defaultAccount: '6000' }, L).reason, /vendor default is 6000/);
});
test('proposal rows for a known vendor', () => {
  const p = Lg.propose(parsed('northwind-INV-10421.pdf'), fresh(), {});
  assert.strictEqual(p.vendorId, 'v-northwind');
  const keys = p.rows.map((r) => r.key);
  ['vendor', 'number', 'date', 'due', 'terms', 'po', 'currency', 'line.0.account', 'line.3.account', 'tax', 'memo'].forEach((k) => assert.ok(keys.includes(k), k));
  assert.ok(!keys.includes('total') && !keys.includes('fx') && !keys.includes('vendor.defaultAccount'));
  assert.strictEqual(p.rows.find((r) => r.key === 'tax').after, '1400');
  assert.ok(p.rows.every((r) => r.decision === 'pending'));
});
test('build refuses while fields are pending; post creates balanced bill + JE', () => {
  const L = fresh(); const p = Lg.propose(parsed('northwind-INV-10421.pdf'), L, {});
  assert.throws(() => Lg.build(p, L, {}), /still need/);
  Lg.approveAll(p); const r = Lg.post(L, Lg.build(p, L, {}), { invoiceId: 'x' });
  assert.strictEqual(r.bill.id, 'BILL-0001'); assert.strictEqual(r.entry.id, 'JE-0001'); assert.ok(balanced(r.entry));
  assert.deepStrictEqual(r.entry.lines.map((l) => [l.account, l.debit, l.credit]), [['6000', 291, 0], ['6000', 112.5, 0], ['6000', 86.6, 0], ['6000', 259.8, 0], ['1400', 61.87, 0], ['2000', 0, 811.77]]);
  assert.strictEqual(Lg.apBalance(L), 811.77);
});
test('reject keeps Before, edit uses the typed value', () => {
  const L = fresh(); const p = Lg.propose(parsed('thamesbridge-TT-5521.pdf'), L, {});
  Lg.decide(p, 'line.2.account', 'edit', '6700'); Lg.decide(p, 'tax', 'edit', 'expense'); Lg.decide(p, 'fx', 'edit', '1.25');
  Lg.approveAll(p); const b = Lg.build(p, L, {});
  assert.strictEqual(b.bill.lines[2].account, '6700'); assert.strictEqual(b.bill.taxAccount, ''); assert.strictEqual(b.bill.fx, 1.25);
  const p2 = Lg.propose(parsed('northwind-INV-10421.pdf'), L, {}); Lg.decide(p2, 'number', 'reject'); Lg.approveAll(p2);
  assert.throws(() => Lg.build(p2, L, {}), /Bill number is required/);
  assert.throws(() => Lg.decide(p2, 'nope', 'approve'), /No field/);
});
test('foreign currency converts every line at the rate and stays balanced; new vendor created', () => {
  const L = fresh(); const r = postFile(L, 'thamesbridge-TT-5521.pdf');
  assert.strictEqual(r.bill.fx, 1.27); assert.strictEqual(r.bill.currency, 'GBP'); assert.strictEqual(r.bill.total, 1406.4);
  assert.strictEqual(r.bill.totalBase, M.sum([M.r2(642 * 1.27), M.r2(495 * 1.27), M.r2(35 * 1.27), M.r2(234.4 * 1.27)]));
  assert.ok(balanced(r.entry)); assert.match(r.entry.memo, /@ 1\.27/);
  assert.ok(r.createdVendorId); const v = L.vendors.find((x) => x.id === r.createdVendorId); assert.strictEqual(v.currency, 'GBP'); assert.strictEqual(v.defaultAccount, '6200');
  const p = Lg.propose(parsed('thamesbridge-TT-5521.pdf'), fresh(), { fxRates: {} }); Lg.approveAll(p); assert.throws(() => Lg.build(p, fresh(), { fxRates: {} }), /exchange rate/);
});
test('credit note debits AP and credits expense + tax', () => {
  const L = fresh(); const r = postFile(L, 'northwind-CR-0042.pdf');
  assert.strictEqual(r.bill.type, 'credit');
  assert.deepStrictEqual(r.entry.lines.map((l) => [l.account, l.debit, l.credit]), [['6000', 0, 173.2], ['1400', 0, 14.29], ['2000', 187.49, 0]]);
  assert.strictEqual(Lg.apBalance(L), -187.49);
});
test('printed total that disagrees goes to suspense when approved, or uses computed when rejected', () => {
  const L = fresh(); const r = postFile(L, 'metropower-MPL-88310.pdf');
  const s = r.entry.lines.find((l) => l.account === '1999'); assert.strictEqual(s.debit, 10); assert.strictEqual(r.bill.total, 660.68); assert.ok(balanced(r.entry));
  const L2 = fresh(); const r2 = postFile(L2, 'metropower-MPL-88310.pdf', {}, (p) => Lg.decide(p, 'total', 'reject'));
  assert.ok(!r2.entry.lines.some((l) => l.account === '1999')); assert.strictEqual(r2.bill.total, 650.68);
  const L3 = fresh(); const r3 = postFile(L3, 'pixelpine-PP-0347.pdf');
  assert.strictEqual(r3.entry.lines.find((l) => l.account === '1999').debit, 100);
});
test('non-recoverable tax is added to the largest line account', () => {
  const L = fresh(); const r = postFile(L, 'bluewater-BW-2210.pdf', { taxTreatment: 'expense' });
  const taxLine = r.entry.lines.find((l) => /not recoverable/.test(l.memo)); assert.strictEqual(taxLine.account, '5100'); assert.strictEqual(taxLine.debit, 466.2);
  assert.ok(!r.entry.lines.some((l) => l.account === '1400'));
});
test('posted-duplicate guard, override, unpost and vendor cleanup', () => {
  const L = fresh(); postFile(L, 'northwind-INV-10421.pdf');
  assert.throws(() => postFile(L, 'northwind-INV-10421-resend.pdf'), (e) => e.code === 'duplicate');
  const p = Lg.propose(parsed('northwind-INV-10421-resend.pdf'), L, {}); Lg.approveAll(p);
  const r = Lg.post(L, Lg.build(p, L, {}), { allowDuplicate: true }); assert.strictEqual(r.bill.id, 'BILL-0002');
  assert.ok(Lg.unpost(L, 'BILL-0002')); assert.strictEqual(L.bills.length, 1); assert.strictEqual(L.journal.length, 1); assert.strictEqual(Lg.unpost(L, 'nope'), null);
  const t = postFile(L, 'thamesbridge-TT-5521.pdf'); const n = L.vendors.length; Lg.unpost(L, t.bill.id, t.createdVendorId); assert.strictEqual(L.vendors.length, n - 1);
});
test('unknown accounts and bad dates are refused', () => {
  const L = fresh(); const p = Lg.propose(parsed('cloudnest-CN-2026-0912.pdf'), L, {});
  Lg.decide(p, 'line.0.account', 'edit', '9999'); Lg.approveAll(p); assert.throws(() => Lg.build(p, L, {}), /not in the chart/);
  const p2 = Lg.propose(parsed('cloudnest-CN-2026-0912.pdf'), L, {}); Lg.decide(p2, 'date', 'edit', '10/01/2026'); Lg.approveAll(p2); assert.throws(() => Lg.build(p2, L, {}), /YYYY-MM-DD/);
});
test('no line items: posts the subtotal as one line', () => {
  const L = fresh(); const f = { vendor: 'Cloudnest Software Inc.', invoiceNumber: 'X1', issueDate: '2026-10-01', currency: 'USD', subtotal: 80, tax: 0, total: 80, lines: [] };
  const p = Lg.propose(f, L, {}); assert.strictEqual(p.lines.length, 1); Lg.approveAll(p); const b = Lg.build(p, L, {}); assert.strictEqual(b.bill.lines[0].amount, 80); assert.strictEqual(b.bill.lines[0].account, '6100');
});
test('trial balance across a full demo posting run balances', () => {
  const L = fresh();
  ['northwind-INV-10421.pdf', 'cloudnest-CN-2026-0912.pdf', 'northwind-CR-0042.pdf', 'thamesbridge-TT-5521.pdf', 'metropower-MPL-88310.pdf', 'lumen-print-LP-3092.png'].forEach((f) => postFile(L, f));
  const tb = Lg.trialBalance(L); assert.ok(M.eq(M.sum(tb.map((r) => r.debit)), M.sum(tb.map((r) => r.credit)), 0));
  assert.strictEqual(L.bills.length, 6); assert.ok(L.journal.every(balanced));
});
test('chart editing rules', () => {
  const L = fresh();
  assert.throws(() => Lg.addAccount(L, { code: '12', name: 'x' }), /3/); assert.throws(() => Lg.addAccount(L, { code: '6000', name: 'x' }), /exists/); assert.throws(() => Lg.addAccount(L, { code: '6123', name: ' ' }), /name/);
  const a = Lg.addAccount(L, { code: '6123', name: 'Training', type: 'expense' }); assert.strictEqual(a.code, '6123');
  assert.ok(L.accounts.findIndex((x) => x.code === '6123') > L.accounts.findIndex((x) => x.code === '6100'));
  assert.ok(Lg.accountInUse(L, '6000')); assert.ok(!Lg.accountInUse(L, '6123'));
});
