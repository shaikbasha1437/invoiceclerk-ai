'use strict';
const test = require('node:test'); const assert = require('node:assert');
const X = require('../js/inv/exports.js'); const Lg = require('../js/inv/ledger.js'); const P = require('../js/inv/parse.js'); const M = require('../js/inv/money.js');
const { S, linesFor } = require('./helpers.js');
function ledgerWith(files) { const L = Lg.createLedger({ vendors: S.VENDORS }); files.forEach((f) => { const p = Lg.propose(P.parseInvoice(linesFor(f)), L, {}); Lg.approveAll(p); Lg.post(L, Lg.build(p, L, {}), { invoiceId: f }); }); return L; }
const L = ledgerWith(['northwind-INV-10421.pdf', 'northwind-CR-0042.pdf', 'thamesbridge-TT-5521.pdf', 'metropower-MPL-88310.pdf']);
const bill = (n) => L.bills.find((b) => b.number === n);
const parseCsv = (s) => s.trim().split(/\r\n/).map((r) => r.match(/("([^"]|"")*"|[^,]*)(,|$)/g).slice(0, -1).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')));
test('CSV escaping and spreadsheet formula guard', () => {
  assert.strictEqual(X.csv([['a,b', 'say "hi"', 'x\ny', '=1+1', '-5.00', '@cmd']]), '"a,b","say ""hi""","x\ny",\'=1+1,-5.00,\'@cmd\r\n');
});
test('journal CSV: one row per JE line, debits equal credits', () => {
  const rows = parseCsv(X.journalCsv(L.journal, L.accounts));
  assert.deepStrictEqual(rows[0], ['Date', 'Entry', 'Account code', 'Account name', 'Debit', 'Credit', 'Memo', 'Bill', 'Currency']);
  assert.strictEqual(rows.length - 1, L.journal.reduce((a, e) => a + e.lines.length, 0));
  const d = M.sum(rows.slice(1).map((r) => Number(r[4] || 0))); const c = M.sum(rows.slice(1).map((r) => Number(r[5] || 0))); assert.ok(M.eq(d, c, 0));
});
test('QuickBooks Online bill payload', () => {
  const q = X.qboPayload(bill('INV-10421'), L.accounts, { vendors: { 'Northwind Office Supply': '56' }, accounts: { 6000: '7' } });
  assert.strictEqual(q.entity, 'bill'); assert.strictEqual(q.body.VendorRef.value, '56'); assert.strictEqual(q.body.DocNumber, 'INV-10421'); assert.strictEqual(q.body.DueDate, '2026-11-13');
  assert.strictEqual(q.body.Line.length, 5); assert.strictEqual(q.body.Line[0].AccountBasedExpenseLineDetail.AccountRef.value, '7'); assert.strictEqual(q.body.Line[4].AccountBasedExpenseLineDetail.AccountRef.value, '1400');
  assert.ok(M.eq(M.sum(q.body.Line.map((l) => l.Amount)), 811.77, 0)); assert.strictEqual(q.body.GlobalTaxCalculation, 'NotApplicable');
  assert.strictEqual(X.qboUrl('bill', '123'), 'https://quickbooks.api.intuit.com/v3/company/123/bill?minorversion=75');
});
test('QuickBooks: vendor credit, FX rate and suspense line', () => {
  const c = X.qboPayload(bill('CR-0042'), L.accounts); assert.strictEqual(c.entity, 'vendorcredit'); assert.ok(!('DueDate' in c.body));
  const g = X.qboPayload(bill('TT-5521'), L.accounts); assert.strictEqual(g.body.ExchangeRate, 1.27); assert.strictEqual(g.body.CurrencyRef.value, 'GBP');
  const m = X.qboPayload(bill('MPL-88310'), L.accounts); const s = m.body.Line.find((l) => l.AccountBasedExpenseLineDetail.AccountRef.value === '1999'); assert.strictEqual(s.Amount, 10); assert.ok(M.eq(M.sum(m.body.Line.map((l) => l.Amount)), 660.68, 0));
});
test('QuickBooks bill-import CSV skips credits and includes tax rows', () => {
  const rows = parseCsv(X.qboBillCsv(L.bills));
  assert.strictEqual(rows[0][0], 'Bill No.'); assert.ok(!rows.some((r) => r[0] === 'CR-0042'));
  assert.strictEqual(rows.filter((r) => r[0] === 'INV-10421').length, 5); assert.strictEqual(rows.find((r) => r[0] === 'INV-10421')[2], '10/14/2026');
});
test('IIF: header blocks, BILL negative AP, BILL REFUND for credits, each transaction sums to zero', () => {
  const out = X.iif(L.bills, L.accounts); const lines = out.trim().split('\r\n');
  assert.ok(lines[0].startsWith('!TRNS\t')); assert.strictEqual(lines[2], '!ENDTRNS');
  const txns = []; let cur = null; lines.slice(3).forEach((l) => { const c = l.split('\t'); if (c[0] === 'TRNS') { cur = [c]; } else if (c[0] === 'SPL') cur.push(c); else if (c[0] === 'ENDTRNS') txns.push(cur); });
  assert.strictEqual(txns.length, L.bills.length);
  txns.forEach((t) => assert.ok(M.eq(M.sum(t.map((c) => Number(c[6]))), 0, 0)));
  const nw = txns.find((t) => t[0][7] === 'INV-10421'); assert.strictEqual(nw[0][2], 'BILL'); assert.strictEqual(nw[0][6], '-811.77'); assert.strictEqual(nw[0][4], 'Accounts payable');
  const cr = txns.find((t) => t[0][7] === 'CR-0042'); assert.strictEqual(cr[0][2], 'BILL REFUND'); assert.strictEqual(cr[0][6], '187.49');
});
test('Xero bill CSV: 26 template columns, tax split adds up exactly', () => {
  const rows = parseCsv(X.xeroCsv(L.bills, { dateFormat: 'DMY' }));
  assert.strictEqual(rows[0].length, 26); assert.strictEqual(rows[0][0], '*ContactName'); assert.strictEqual(rows[0][25], 'Currency');
  const nw = rows.filter((r) => r[10] === 'INV-10421'); assert.strictEqual(nw.length, 4); assert.strictEqual(nw[0][11], '14/10/2026');
  assert.ok(M.eq(M.sum(nw.map((r) => Number(r[20]))), 61.87, 0)); assert.strictEqual(nw[0][19], 'Tax on Purchases');
  assert.ok(!rows.some((r) => r[10] === 'CR-0042'));
});
test('Xero API payloads: ACCPAY with tax amounts, ACCPAYCREDIT credit notes, currency rate', () => {
  const x = X.xeroPayload(bill('INV-10421')); assert.strictEqual(x.endpoint, 'Invoices'); const d = x.body.Invoices[0];
  assert.strictEqual(d.Type, 'ACCPAY'); assert.strictEqual(d.Status, 'DRAFT'); assert.strictEqual(d.LineAmountTypes, 'Exclusive'); assert.ok(M.eq(M.sum(d.LineItems.map((l) => l.TaxAmount)), 61.87, 0));
  const c = X.xeroPayload(bill('CR-0042')); assert.strictEqual(c.endpoint, 'CreditNotes'); assert.strictEqual(c.body.CreditNotes[0].Type, 'ACCPAYCREDIT'); assert.strictEqual(c.body.CreditNotes[0].CreditNoteNumber, 'CR-0042');
  const g = X.xeroPayload(bill('TT-5521')).body.Invoices[0]; assert.strictEqual(g.CurrencyCode, 'GBP'); assert.ok(Math.abs(g.CurrencyRate - 1 / 1.27) < 1e-6);
});
test('curl examples quote safely and keep tokens in env vars', () => {
  const b = Object.assign({}, bill('INV-10421'), { vendorName: "O'Brien & Sons" });
  const q = X.curlQbo(b, L.accounts); assert.match(q, /"https:\/\/quickbooks\.api\.intuit\.com\/v3\/company\/\$QBO_REALM_ID\/bill\?minorversion=75"/); assert.match(q, /Bearer \$QBO_ACCESS_TOKEN/); assert.ok(q.includes("O'\\''Brien"));
  const x = X.curlXero(b); assert.match(x, /xero-tenant-id: \$XERO_TENANT_ID/); assert.match(x, /api\.xro\/2\.0\/Invoices/);
});
test('generic JSON masks bank details by default and never includes keys', () => {
  const state = { settings: { baseCurrency: 'USD', apiKey: 'sk-should-not-appear' }, ledger: L, invoices: [{ id: 'i1', name: 'a.pdf', status: 'posted', fields: { vendor: 'x', payment: { account: '000123456789', iban: 'GB82 WEST 1234 5698 7654 32', swift: 'EXMPGB2L' }, rawLines: ['secret raw'] }, flags: [] }] };
  const j = JSON.parse(X.genericJson(state, { now: 'now' }));
  assert.strictEqual(j.invoices[0].fields.payment.account, '\u2022\u2022\u2022\u2022 6789'); assert.strictEqual(j.invoices[0].fields.payment.iban, '\u2022\u2022\u2022\u2022 5432'); assert.strictEqual(j.invoices[0].fields.payment.swift, 'EXMPGB2L');
  assert.ok(!JSON.stringify(j).includes('sk-should')); assert.ok(!('rawLines' in j.invoices[0].fields));
  const open = JSON.parse(X.genericJson(state, { includeBank: true })); assert.strictEqual(open.invoices[0].fields.payment.account, '000123456789');
});
