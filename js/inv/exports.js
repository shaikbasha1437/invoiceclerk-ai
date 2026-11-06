/* Exports: journal CSV, QuickBooks (Online bill JSON, bill-import CSV, Desktop IIF), Xero (bill CSV,
   Invoices JSON), generic JSON, and copy-paste curl examples. Payload shapes follow the public API docs
   (QuickBooks Online Accounting API v3, Xero Accounting API 2.0); they were checked against mock servers,
   not live company files. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./money.js'));
  else (root.IC = root.IC || {}).exports = factory(root.IC.money);
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';
  const QBO_MINOR = 75;
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  // Spreadsheet formula injection guard for CSV opened in Excel/Sheets.
  const safe = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) && !/^-?\d/.test(v) ? "'" + v : v);
  const csv = (rows) => rows.map((r) => r.map((c) => esc(safe(c))).join(',')).join('\r\n') + '\r\n';
  const mdy = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return m + '/' + d + '/' + y; };
  const dmy = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return d + '/' + m + '/' + y; };
  const n2 = (n) => (n == null || n === '' ? '' : M.r2(Number(n)).toFixed(2));
  const acctName = (accounts, code) => { const a = (accounts || []).find((x) => x.code === code); return a ? a.name : code; };
  function journalCsv(entries, accounts) {
    const rows = [['Date', 'Entry', 'Account code', 'Account name', 'Debit', 'Credit', 'Memo', 'Bill', 'Currency']];
    (entries || []).forEach((e) => e.lines.forEach((l) => rows.push([e.date, e.id, l.account, l.name || acctName(accounts, l.account), l.debit ? n2(l.debit) : '', l.credit ? n2(l.credit) : '', l.memo || '', e.billId || '', e.currency || ''])));
    return csv(rows);
  }
  /* QuickBooks Online: POST /v3/company/{realmId}/bill (or /vendorcredit for credits). AccountRef / VendorRef
     values must be the QBO Ids from your company; `map` translates local codes/names to them. */
  function qboPayload(bill, accounts, map) {
    const m = map || {};
    const ref = (code) => ({ value: (m.accounts && m.accounts[code]) || code, name: acctName(accounts, code) });
    const Line = bill.lines.map((l) => ({ DetailType: 'AccountBasedExpenseLineDetail', Amount: M.r2(l.amount), Description: l.description, AccountBasedExpenseLineDetail: { AccountRef: ref(l.account) } }));
    if (bill.tax) Line.push({ DetailType: 'AccountBasedExpenseLineDetail', Amount: M.r2(bill.tax), Description: (bill.taxLabel || 'Tax') + (bill.taxAccount ? '' : ' (not recoverable)'), AccountBasedExpenseLineDetail: { AccountRef: ref(bill.taxAccount || bill.lines[0].account) } });
    const diff = M.r2(bill.total - M.sum(bill.lines.map((l) => l.amount)) - (bill.tax || 0));
    if (diff) Line.push({ DetailType: 'AccountBasedExpenseLineDetail', Amount: diff, Description: 'Difference vs printed total (review)', AccountBasedExpenseLineDetail: { AccountRef: ref('1999') } });
    const body = { VendorRef: { value: (m.vendors && m.vendors[bill.vendorName]) || bill.vendorId || bill.vendorName, name: bill.vendorName }, TxnDate: bill.date, DocNumber: bill.number, PrivateNote: bill.memo, CurrencyRef: { value: bill.currency }, GlobalTaxCalculation: 'NotApplicable', Line };
    if (bill.type !== 'credit' && bill.due) body.DueDate = bill.due;
    if (bill.fx && bill.fx !== 1) body.ExchangeRate = bill.fx;
    return { entity: bill.type === 'credit' ? 'vendorcredit' : 'bill', body };
  }
  function qboUrl(entity, realm) { return 'https://quickbooks.api.intuit.com/v3/company/' + (realm || '{realmId}') + '/' + entity + '?minorversion=' + QBO_MINOR; }
  // QuickBooks Online "Import bills" spreadsheet (Settings > Import data > Bills).
  function qboBillCsv(bills) {
    const rows = [['Bill No.', 'Supplier', 'Bill Date', 'Due Date', 'Terms', 'Memo', 'Account', 'Line Description', 'Line Amount', 'Currency Code', 'Exchange Rate']];
    (bills || []).filter((b) => b.type !== 'credit').forEach((b) => {
      const lines = b.lines.map((l) => [l.account, l.description, l.amount]);
      if (b.tax) lines.push([b.taxAccount || b.lines[0].account, (b.taxLabel || 'Tax'), b.tax]);
      lines.forEach(([a, d, amt]) => rows.push([b.number, b.vendorName, mdy(b.date), mdy(b.due), b.terms, b.memo, a, d, n2(amt), b.currency, b.fx && b.fx !== 1 ? b.fx : '']));
    });
    return csv(rows);
  }
  /* QuickBooks Desktop IIF (tab separated). Positive = debit. Bills: TRNS credits AP; vendor credits use
     TRNSTYPE "BILL REFUND" with the signs flipped. Import into a test company file first. */
  function iif(bills, accounts) {
    const T = (a) => a.map((c) => String(c == null ? '' : c).replace(/[\t\r\n]/g, ' ')).join('\t');
    const out = [T(['!TRNS', 'TRNSID', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'AMOUNT', 'DOCNUM', 'MEMO', 'DUEDATE', 'TERMS']), T(['!SPL', 'SPLID', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'AMOUNT', 'DOCNUM', 'MEMO']), T(['!ENDTRNS'])];
    (bills || []).forEach((b) => {
      const type = b.type === 'credit' ? 'BILL REFUND' : 'BILL'; const sign = b.type === 'credit' ? -1 : 1;
      const splits = b.lines.map((l) => [l.account, l.amount, l.description]);
      if (b.tax) splits.push([b.taxAccount || b.lines[0].account, b.tax, b.taxLabel || 'Tax']);
      const diff = M.r2(b.total - M.sum(b.lines.map((l) => l.amount)) - (b.tax || 0)); if (diff) splits.push(['1999', diff, 'Difference vs printed total']);
      const total = M.sum(splits.map((x) => x[1]));
      out.push(T(['TRNS', '', type, mdy(b.date), acctName(accounts, '2000'), b.vendorName, n2(-sign * total), b.number, b.memo, b.type === 'credit' ? '' : mdy(b.due), b.terms]));
      splits.forEach(([a, amt, d]) => out.push(T(['SPL', '', type, mdy(b.date), acctName(accounts, a), b.vendorName, n2(sign * amt), b.number, d])));
      out.push(T(['ENDTRNS']));
    });
    return out.join('\r\n') + '\r\n';
  }
  const XERO_HEAD = ['*ContactName', 'EmailAddress', 'POAddressLine1', 'POAddressLine2', 'POAddressLine3', 'POAddressLine4', 'POCity', 'PORegion', 'POPostalCode', 'POCountry', '*InvoiceNumber', '*InvoiceDate', '*DueDate', 'Total', 'InventoryItemCode', 'Description', '*Quantity', '*UnitAmount', '*AccountCode', '*TaxType', 'TaxAmount', 'TrackingName1', 'TrackingOption1', 'TrackingName2', 'TrackingOption2', 'Currency'];
  /* Xero "Import bills" template (26 columns). Amounts are tax exclusive with TaxAmount filled, so the
     tax matches the paper. opts: { dateFormat:'DMY'|'MDY', taxType, noTaxType } (names must match your Xero org). */
  function xeroCsv(bills, opts) {
    const o = Object.assign({ dateFormat: 'MDY', taxType: 'Tax on Purchases', noTaxType: 'Tax Exempt' }, opts || {});
    const d = o.dateFormat === 'DMY' ? dmy : mdy;
    const rows = [XERO_HEAD];
    (bills || []).filter((b) => b.type !== 'credit').forEach((b) => {
      const base = M.sum(b.lines.map((l) => l.amount));
      b.lines.forEach((l, i) => {
        const share = b.tax && base ? (i === b.lines.length - 1 ? M.r2(b.tax - M.sum(b.lines.slice(0, -1).map((x) => M.r2(b.tax * x.amount / base)))) : M.r2(b.tax * l.amount / base)) : 0;
        const r = new Array(XERO_HEAD.length).fill('');
        r[0] = b.vendorName; r[10] = b.number; r[11] = d(b.date); r[12] = d(b.due || b.date); r[15] = l.description; r[16] = 1; r[17] = n2(l.amount); r[18] = l.account; r[19] = b.tax ? o.taxType : o.noTaxType; r[20] = b.tax ? n2(share) : ''; r[25] = b.currency;
        rows.push(r);
      });
    });
    return csv(rows);
  }
  /* Xero Accounting API: POST /api.xro/2.0/Invoices with Type ACCPAY (bills) or /CreditNotes with ACCPAYCREDIT. */
  function xeroPayload(bill, opts) {
    const o = Object.assign({ taxType: 'INPUT', noTaxType: 'NONE', status: 'DRAFT' }, opts || {});
    const base = M.sum(bill.lines.map((l) => l.amount));
    const LineItems = bill.lines.map((l, i) => ({ Description: l.description, Quantity: 1, UnitAmount: M.r2(l.amount), AccountCode: l.account, TaxType: bill.tax ? o.taxType : o.noTaxType, TaxAmount: bill.tax && base ? (i === bill.lines.length - 1 ? M.r2(bill.tax - M.sum(bill.lines.slice(0, -1).map((x) => M.r2(bill.tax * x.amount / base)))) : M.r2(bill.tax * l.amount / base)) : 0 }));
    const credit = bill.type === 'credit';
    const doc = { Type: credit ? 'ACCPAYCREDIT' : 'ACCPAY', Contact: { Name: bill.vendorName }, Date: bill.date, CurrencyCode: bill.currency, LineAmountTypes: 'Exclusive', Reference: bill.po || bill.memo || '', Status: o.status, LineItems };
    if (credit) doc.CreditNoteNumber = bill.number; else { doc.InvoiceNumber = bill.number; doc.DueDate = bill.due || bill.date; }
    if (bill.fx && bill.fx !== 1) doc.CurrencyRate = M.r2(1 / bill.fx * 1e6) / 1e6;
    return { endpoint: credit ? 'CreditNotes' : 'Invoices', body: credit ? { CreditNotes: [doc] } : { Invoices: [doc] } };
  }
  const xeroUrl = (endpoint) => 'https://api.xero.com/api.xro/2.0/' + endpoint;
  const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
  function curlQbo(bill, accounts, map) {
    const p = qboPayload(bill, accounts, map);
    return 'curl -X POST "https://quickbooks.api.intuit.com/v3/company/$QBO_REALM_ID/' + p.entity + '?minorversion=' + QBO_MINOR + '" \\\n  -H "Authorization: Bearer $QBO_ACCESS_TOKEN" \\\n  -H \'Accept: application/json\' -H \'Content-Type: application/json\' \\\n  --data ' + shq(JSON.stringify(p.body));
  }
  function curlXero(bill, opts) {
    const p = xeroPayload(bill, opts);
    return 'curl -X POST ' + shq(xeroUrl(p.endpoint)) + ' \\\n  -H "Authorization: Bearer $XERO_ACCESS_TOKEN" \\\n  -H "xero-tenant-id: $XERO_TENANT_ID" \\\n  -H \'Accept: application/json\' -H \'Content-Type: application/json\' \\\n  --data ' + shq(JSON.stringify(p.body));
  }
  function maskBank(p) {
    if (!p) return p;
    const o = {};
    Object.keys(p).forEach((k) => { const v = String(p[k] || ''); o[k] = k === 'swift' || k === 'bankName' ? v : (v.replace(/\s/g, '').length > 4 ? '\u2022\u2022\u2022\u2022 ' + v.replace(/\s/g, '').slice(-4) : '\u2022\u2022\u2022\u2022'); });
    return o;
  }
  /* Everything in one JSON (no API keys; bank details masked unless includeBank). */
  function genericJson(state, opts) {
    const o = opts || {};
    const inv = (state.invoices || []).map((i) => ({ id: i.id, name: i.name, status: i.status, notes: i.notes || '', source: i.source, fields: Object.assign({}, i.fields, { rawLines: undefined, sources: undefined, payment: o.includeBank ? i.fields && i.fields.payment : maskBank(i.fields && i.fields.payment) }), flags: (i.flags || []).map((f) => ({ id: f.id, severity: f.severity, label: f.label })) }));
    return JSON.stringify({ app: 'InvoiceClerk AI', exportedAt: o.now || new Date().toISOString(), baseCurrency: state.settings && state.settings.baseCurrency, accounts: state.ledger.accounts, vendors: state.ledger.vendors, bills: state.ledger.bills, journal: state.ledger.journal, invoices: inv }, null, 2);
  }
  return { csv, esc, safe, mdy, dmy, journalCsv, qboPayload, qboUrl, qboBillCsv, iif, XERO_HEAD, xeroCsv, xeroPayload, xeroUrl, curlQbo, curlXero, maskBank, genericJson, QBO_MINOR };
});
