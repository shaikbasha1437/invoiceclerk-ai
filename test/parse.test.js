'use strict';
const test = require('node:test'); const assert = require('node:assert');
const P = require('../js/inv/parse.js'); const T = require('../js/inv/pdftext.js');
const { S, fixtures, linesFor } = require('./helpers.js');
test('pdftext.groupItemsToLines reproduces the fixture lines from raw pdf.js items', () => {
  for (const [file, fx] of Object.entries(fixtures)) assert.deepStrictEqual(T.groupItemsToLines(fx.items).map((l) => l.text), fx.lines, file);
});
test('pdftext: rows by y, columns by gap, scanned detection', () => {
  const items = [{ str: 'Total', transform: [10, 0, 0, 10, 300, 100], width: 25 }, { str: 'Sub', transform: [10, 0, 0, 10, 50, 120], width: 15 }, { str: 'total', transform: [10, 0, 0, 10, 65.2, 120], width: 22 }, { str: '$5.00', transform: [10, 0, 0, 10, 500, 100.6], width: 25 }];
  assert.deepStrictEqual(T.groupItemsToLines(items).map((l) => l.text), ['Subtotal', 'Total' + T.GAP + '$5.00']);
  assert.strictEqual(T.textChars(T.groupItemsToLines(fixtures['ridgeway-scan-RJ-1187.pdf'].items)), 0);
});
for (const inv of S.INVOICES) {
  test('parse sample ' + inv.file + ' matches its source of truth', () => {
    const r = P.parseInvoice(linesFor(inv.file), { source: inv.kind === 'pdf' ? 'pdf' : 'ocr' });
    assert.strictEqual(r.vendor, inv.vendor); assert.strictEqual(r.invoiceNumber, inv.number);
    assert.strictEqual(r.issueDate, inv.issueDate); assert.strictEqual(r.currency, inv.currency);
    assert.strictEqual(r.subtotal, inv.subtotal); assert.strictEqual(r.tax, inv.tax); assert.strictEqual(r.total, inv.total);
    assert.strictEqual(r.docType, /credit/i.test(inv.title) ? 'credit_note' : 'invoice');
    assert.strictEqual(r.lines.length, inv.lines.length);
    r.lines.forEach((l, i) => { assert.strictEqual(l.amount, inv.lines[i].amount); assert.strictEqual(l.qty, inv.lines[i].qty); assert.strictEqual(l.unitPrice, inv.lines[i].unitPrice); });
    if (inv.kind !== 'scan') { assert.strictEqual(r.dueDate, inv.dueDate); assert.strictEqual(r.po, inv.po); }
    if (inv.taxRate) assert.strictEqual(r.taxRate, inv.taxRate);
  });
}
test('scanned OCR text is realistically imperfect: PO lost, due date missing', () => {
  const r = P.parseInvoice(linesFor('ridgeway-scan-RJ-1187.pdf'), { source: 'ocr' });
  assert.strictEqual(r.po, ''); assert.strictEqual(r.dueDate, ''); assert.strictEqual(r.total, 960);
});
test('payment details: ACH, IBAN/SWIFT/sort code, last4', () => {
  const nw = P.parseInvoice(linesFor('northwind-INV-10421.pdf'));
  assert.deepStrictEqual(nw.payment, { routing: '000123456', account: '000123456789' }); assert.strictEqual(nw.bankLast4, '6789'); assert.ok(nw.hasBank);
  const tt = P.parseInvoice(linesFor('thamesbridge-TT-5521.pdf'));
  assert.strictEqual(tt.payment.iban, 'GB82 WEST 1234 5698 7654 32'); assert.strictEqual(tt.payment.swift, 'EXMPGB2L'); assert.strictEqual(tt.payment.sortCode, '00-00-00'); assert.strictEqual(tt.bankLast4, '5432');
  assert.ok(!P.parseInvoice(linesFor('cloudnest-CN-2026-0912.pdf')).hasBank);
});
test('dates: DMY for UK invoices, terms compute a missing due date', () => {
  const tt = P.parseInvoice(linesFor('thamesbridge-TT-5521.pdf')); assert.strictEqual(tt.issueDate, '2026-10-09'); assert.strictEqual(tt.dueDate, '2026-11-08');
  const r = P.parseInvoice(['Acme Widgets LLC', 'Invoice No: A-77', 'Invoice date: 2026-03-01', 'Terms: Net 45', 'Total: $100.00']);
  assert.strictEqual(r.dueDate, '2026-04-15'); assert.ok(r.dueDateComputed);
});
test('European formatted invoice with VAT and a vendor label', () => {
  const lines = ['RECHNUNG', 'From: Hafenblick Bürobedarf GmbH', 'Invoice number: HB/2026/118', 'Invoice date: 03.11.2026', 'Due date: 03.12.2026', 'Description   Qty   Price   Amount', 'Ordner A4   20   2,50   50,00', 'Druckerpapier   10   4,95   49,50', 'Subtotal   99,50 €', 'VAT 19%   18,91 €', 'Total   118,41 €', 'IBAN DE89 3704 0044 0532 0130 00'];
  const r = P.parseInvoice(lines);
  assert.strictEqual(r.vendor, 'Hafenblick Bürobedarf GmbH'); assert.strictEqual(r.invoiceNumber, 'HB/2026/118'); assert.strictEqual(r.issueDate, '2026-11-03'); assert.strictEqual(r.dueDate, '2026-12-03');
  assert.strictEqual(r.currency, 'EUR'); assert.strictEqual(r.subtotal, 99.5); assert.strictEqual(r.taxRate, 19); assert.strictEqual(r.tax, 18.91); assert.strictEqual(r.total, 118.41);
  assert.strictEqual(r.lines.length, 2); assert.strictEqual(r.lines[1].amount, 49.5); assert.strictEqual(r.payment.iban, 'DE89 3704 0044 0532 0130 00');
});
test('missing fields stay empty; totals derived only when absent; credit memo detected', () => {
  const r = P.parseInvoice(['Thanks!', 'Description   Amount', 'Consulting   500.00', 'Tax   0.00']);
  assert.strictEqual(r.invoiceNumber, ''); assert.strictEqual(r.issueDate, ''); assert.strictEqual(r.subtotal, 500); assert.ok(r.subtotalDerived); assert.strictEqual(r.total, 500); assert.ok(r.totalDerived);
  const c = P.parseInvoice(['Example Parts Co', 'CREDIT MEMO', 'Credit memo no: CM-9', 'Date: 01/05/2026', 'Total credit   ($45.00)']);
  assert.strictEqual(c.docType, 'credit_note'); assert.strictEqual(c.invoiceNumber, 'CM-9'); assert.strictEqual(c.total, 45);
});
test('labels are not confused: Power is not a PO, Tax ID is not tax, Subtotal is not Total', () => {
  const r = P.parseInvoice(['Metro Power & Light', 'Tax ID: 12-3456789', 'Invoice #: X-1', 'Subtotal   10.00', 'Tax   1.00', 'Total   11.00']);
  assert.strictEqual(r.po, ''); assert.strictEqual(r.tax, 1); assert.strictEqual(r.subtotal, 10); assert.strictEqual(r.total, 11);
});
test('OCR label slips are repaired; sources point to lines', () => {
  const r = P.parseInvoice(['Foo Bar Ltd', 'lnvoice #: Q-12', 'Tota1   $9.00']);
  assert.strictEqual(r.invoiceNumber, 'Q-12'); assert.strictEqual(r.total, 9); assert.strictEqual(r.sources.invoiceNumber, 1); assert.strictEqual(r.sources.total, 2);
});
