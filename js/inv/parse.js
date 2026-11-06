/* Deterministic invoice parser: reading-order text lines (pdf.js or OCR) -> structured fields.
   No AI needed. Every value records the line it came from (sources) so the UI can point at it.
   Handles US and European number/date formats, credit notes, multi-currency and OCR noise. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./money.js'));
  else (root.IC = root.IC || {}).parse = factory(root.IC.money);
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';
  const NUM = '[-(]?(?:[A-Z]{3}\\s?)?(?:[A-Z]{0,2}\\$|[£€¥₹])?\\s?(?:\\d{1,3}(?:[,.\\u00a0 ]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d+)?)\\)?';
  const AMT_END = new RegExp('(' + NUM + ')\\s*(?:CR\\b|[£€¥₹]|[A-Z]{3}\\b)?\\s*$');
  const DATE = M.DATE_RE.source;
  const TITLE = /\s*\b(tax\s+invoice|commercial\s+invoice|invoice|credit\s+note|credit\s+memo|bill|receipt|statement)\b\s*$/i;
  const UNITS = 'hrs?|hours?|ea|each|pcs?|pc|units?|mo|months?|seats?|kwh|kg|lbs?|days?|case|box|pack|night|nights|visit|visits|pp|person|people|lot|set|m|ft|sqft|gb|tb|license|licenses|item|items|unit';
  // Fix common OCR slips in labels only (never inside amounts).
  function clean(line) {
    return String(line || '').replace(/[\u2018\u2019\u201c\u201d]/g, (c) => (c === '\u2018' || c === '\u2019' ? "'" : '"'))
      .replace(/\bl(nvoice)/gi, 'I$1').replace(/\bInvo[il1]ce\b/gi, 'Invoice').replace(/\bTota[l1I]\b/g, 'Total').replace(/\bSubtota[l1I]\b/gi, 'Subtotal')
      .replace(/\s+$/, '');
  }
  const cells = (l) => l.split(/\s{3,}|\t/).map((s) => s.trim()).filter(Boolean);
  function findLabel(lines, re, pick) {
    for (let i = 0; i < lines.length; i++) { const m = lines[i].match(re); if (m) { const v = pick ? pick(m) : m[1]; if (v) return { v: String(v).trim(), i }; } }
    return null;
  }
  function vendorFrom(lines) {
    const fromLbl = findLabel(lines, /^\s*(?:from|vendor|supplier|seller|bill\s*from)\s*[:\-]\s*(.+)$/i);
    if (fromLbl) return { v: cells(fromLbl.v)[0], i: fromLbl.i };
    for (let i = 0; i < Math.min(lines.length, 6); i++) {
      const first = cells(lines[i])[0] || '';
      const stripped = first.replace(TITLE, '').replace(/^(copy|duplicate|original)\b.*$/i, '').trim();
      if (!stripped || /^(copy|duplicate|page \d)/i.test(stripped) || /^(invoice|date|bill to)\b/i.test(stripped) || /\d{3,}/.test(stripped) && !/[a-z]{3}/i.test(stripped)) continue;
      return { v: stripped.replace(/[\s,;:]+$/, ''), i };
    }
    return null;
  }
  function lineItems(lines, sources) {
    const out = [];
    let start = lines.findIndex((l) => /\b(description|item|details|service)\b/i.test(l) && /\b(amount|total|price|line total)\b/i.test(l));
    let end = lines.findIndex((l, i) => i > start && /^\s*(sub\s*-?\s*total|total|tax|vat|gst|amount due|balance)/i.test(l));
    if (start < 0) start = -1; if (end < 0) end = lines.length;
    const re = new RegExp('^(.+?)\\s+(\\d[\\d,.]*)\\s+(?:(' + UNITS + ')\\.?\\s+)?((?:' + NUM + '))\\s+((?:' + NUM + '))$', 'i');
    const re1 = new RegExp('^(.*[A-Za-z].*?)\\s{2,}((?:' + NUM + '))$');
    for (let i = start + 1; i < end; i++) {
      const raw = lines[i].replace(/^[^\w(]+/, '').trim();
      if (!raw || /^(bill to|ship to|payment|notes?)\b/i.test(raw)) continue;
      const m = raw.replace(/\s{2,}/g, ' ').match(re);
      if (m) {
        const qty = M.parseAmount(m[2]); const unitPrice = M.parseAmount(m[4]); const amount = M.parseAmount(m[5]);
        if (qty == null || unitPrice == null || amount == null) continue;
        out.push({ description: m[1].replace(/[\s:]+$/, ''), qty, unit: m[3] || '', unitPrice, amount, src: i });
        continue;
      }
      if (start >= 0) {
        const m1 = raw.match(re1);
        if (m1 && !/\b(date|invoice|terms|po|due)\b/i.test(m1[1])) { const amount = M.parseAmount(m1[2]); if (amount != null) out.push({ description: m1[1].trim(), qty: 1, unit: '', unitPrice: amount, amount, src: i }); }
      }
    }
    if (out.length) sources.lines = out.map((l) => l.src);
    return out;
  }
  function payment(text) {
    const p = {};
    const iban = text.match(/\bIBAN\s*[:.]?\s*([A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,3})?)/i) || text.match(/\b([A-Z]{2}\d{2}(?:\s[A-Z0-9]{4}){3,7}(?:\s[A-Z0-9]{1,3})?)\b/);
    if (iban) p.iban = iban[1].replace(/\s+/g, ' ').trim();
    const sw = text.match(/\b(?:SWIFT|BIC)(?:\s*\/\s*BIC)?\s*(?:code)?\s*[:.]?\s*([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/);
    if (sw) p.swift = sw[1];
    const rt = text.match(/\b(?:routing|ABA|RTN)\s*(?:#|no\.?|number)?\s*[:.]?\s*(\d{9})\b/i);
    if (rt) p.routing = rt[1];
    const ac = text.match(/\b(?:account|acct)\s*(?:#|no\.?|number)?\s*[:.]?\s*(\d[\d\- ]{5,18}\d)\b/i);
    if (ac) p.account = ac[1].replace(/\s+/g, '');
    const sc = text.match(/\bsort\s*code\s*[:.]?\s*(\d{2}-\d{2}-\d{2})/i);
    if (sc) p.sortCode = sc[1];
    return p;
  }
  function last4(p) { const s = (p && (p.account || p.iban || '')).replace(/\s/g, ''); return s ? s.slice(-4) : ''; }
  /* lines: string[] (or {text}[]). opts: { datePref:'MDY'|'DMY', source:'pdf'|'ocr'|'ai' } */
  function parseInvoice(input, opts) {
    const o = opts || {};
    const lines = (Array.isArray(input) ? input : String(input || '').split(/\r?\n/)).map((l) => clean(typeof l === 'string' ? l : l.text));
    const text = lines.join('\n');
    const sources = {};
    const set = (k, hit, fn) => { if (hit) { sources[k] = hit.i; return fn ? fn(hit.v) : hit.v; } return ''; };
    const out = { source: o.source || 'pdf', rawLines: lines, sources };
    const credit = /\bcredit\s*(note|memo)\b/i.test(lines.slice(0, 12).join(' ')) || /\btotal\s+credit\b/i.test(text);
    out.docType = credit ? 'credit_note' : 'invoice';
    const v = vendorFrom(lines); out.vendor = set('vendor', v);
    const emails = text.match(/[A-Za-z0-9._%+-]+\s?@\s?[A-Za-z0-9-]+(?:[.\s][A-Za-z0-9-]+)*\.?(?:example|com|org|net|io|co|uk|de|fr|ai|app|dev|biz|us)\b/g) || [];
    out.emails = Array.from(new Set(emails.map((e) => e.replace(/\s/g, '').replace(/@/, '@'))));
    out.vendorEmail = out.emails[0] || '';
    out.phones = Array.from(new Set(text.match(/\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g) || []));
    const pref = o.datePref || (/\b(VAT|GBP|EUR|£|€|United Kingdom)\b/.test(text) ? 'DMY' : 'MDY');
    out.datePref = pref;
    out.invoiceNumber = set('invoiceNumber', findLabel(lines, /\b(?:invoice|inv|credit\s*note|credit\s*memo|bill|document|doc)\s*(?:#|no\.?|num(?:ber)?|n[o°º])\s*[:.#]?\s*([A-Z0-9][A-Z0-9\-\/.]{1,24}[A-Z0-9])/i));
    if (!out.invoiceNumber) out.invoiceNumber = set('invoiceNumber', findLabel(lines, /^\s*(?:#|no\.?)\s*[:.]?\s*([A-Z]{1,5}-?\d{2,}[A-Z0-9\-]*)/i));
    const dateAfter = (lbl) => new RegExp(lbl + '\\s*[:.]?\\s*(' + DATE + ')', 'i');
    out.issueDate = set('issueDate', findLabel(lines, dateAfter('(?:invoice|issue[d]?|credit(?:\\s*note)?|bill|document|tax\\s*point)\\s*date|date\\s*of\\s*issue')) || findLabel(lines, dateAfter('(?<!due\\s)\\bdate')), (s) => M.parseDate(s, pref));
    out.dueDate = set('dueDate', findLabel(lines, dateAfter('(?:due\\s*date|payment\\s*due|due\\s*by|pay\\s*by|due)')), (s) => M.parseDate(s, pref));
    out.po = set('po', findLabel(lines, /\b(?:P\.?\s?O\b\.?|purchase\s*order)\s*(?:#|no\.?|num(?:ber)?)?\s*[:.#]?\s*([A-Z0-9][A-Z0-9\-\/]{2,20})/i), (s) => (/^(number|box)$/i.test(s) ? '' : s));
    out.reference = set('reference', findLabel(lines, /\b(?:reference|ref\.?|against|applies\s*to)\s*(?:#|no\.?)?\s*[:.]?\s*([A-Z]{1,6}-?\d[A-Z0-9\-]*)/i));
    out.terms = set('terms', findLabel(lines, /\b(?:payment\s*)?terms\s*[:.]?\s*(net\s*\d+|due\s*(?:up)?on\s*receipt|\d+(?:\.\d+)?\s*\/\s*\d+\s*,?\s*net\s*\d+|due\s*in\s*\d+\s*days|\d+\s*days)/i));
    const amtLine = (re) => findLabel(lines, re, (m) => { const a = m[0].match(AMT_END); return a ? a[1] : ''; });
    const sub = amtLine(/^\s*(?:sub\s*-?\s*total|net\s*(?:amount|total)|total\s*(?:excl\.?|before)\s*(?:tax|vat))\b.*\d/i);
    out.subtotal = sub ? (sources.subtotal = sub.i, Math.abs(M.parseAmount(sub.v))) : null;
    let tax = null; let taxRate = null; let taxLabel = '';
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const m = l.match(/^\s*((?:sales\s*tax|use\s*tax|vat|gst|hst|pst|qst|tax(?:es)?))\b(?!\s*(?:id|reg|no\.?|number|exempt|point))(.*)$/i);
      if (!m) continue;
      const a = l.match(AMT_END); if (!a) continue;
      const rate = m[2].match(/(\d+(?:[.,]\d+)?)\s*%/);
      tax = Math.abs(M.parseAmount(a[1])); taxRate = rate ? Number(rate[1].replace(',', '.')) : null; taxLabel = m[1].replace(/\s+/g, ' ');
      sources.tax = i; break;
    }
    out.tax = tax; out.taxRate = taxRate; out.taxLabel = taxLabel;
    let tot = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      if (/sub\s*-?\s*total|total\s*(tax|vat|excl)/i.test(l)) continue;
      if (/^\s*(?:grand\s*total|total(?:\s*(?:due|amount|payable|credit|incl\.?\s*(?:tax|vat)))?|amount\s*(?:due|payable)|balance\s*(?:due)?|invoice\s*total)\b/i.test(l)) { const a = l.match(AMT_END); if (a) { tot = { v: a[1], i }; break; } }
    }
    out.total = tot ? (sources.total = tot.i, Math.abs(M.parseAmount(tot.v))) : null;
    const curLine = tot ? lines[tot.i] : '';
    out.currency = M.detectCurrency(curLine) || M.detectCurrency(text.replace(/\bTX\b/g, '')) || '';
    out.lines = lineItems(lines, sources);
    if (out.subtotal == null && out.lines.length) out.subtotal = M.sum(out.lines.map((l) => l.amount)), out.subtotalDerived = true;
    if (out.total == null && out.subtotal != null) { out.total = M.r2(out.subtotal + (out.tax || 0)); out.totalDerived = true; }
    if (!out.dueDate && out.issueDate && out.terms) { const t = M.parseTerms(out.terms); if (t) { out.dueDate = M.addDays(out.issueDate, t.days); out.dueDateComputed = true; } }
    out.payment = payment(text);
    out.bankLast4 = last4(out.payment);
    out.hasBank = Object.keys(out.payment).length > 0;
    return out;
  }
  // The fields the review form shows, in order.
  const FIELDS = [
    ['vendor', 'Vendor', 'text'], ['invoiceNumber', 'Invoice #', 'text'], ['docType', 'Type', 'select'], ['issueDate', 'Issue date', 'date'], ['dueDate', 'Due date', 'date'],
    ['po', 'PO number', 'text'], ['currency', 'Currency', 'text'], ['terms', 'Terms', 'text'], ['subtotal', 'Subtotal', 'money'], ['taxRate', 'Tax rate %', 'number'], ['tax', 'Tax', 'money'], ['total', 'Total', 'money'], ['reference', 'Reference', 'text']
  ];
  return { parseInvoice, payment, last4, clean, cells, FIELDS };
});
