/* Validation flags for an extracted invoice. Pure: (fields, context) -> flags[].
   severity: 'error' blocks posting until fixed or explicitly overridden; 'warn' needs a look; 'info' is FYI. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./money.js'), require('../agentkit/guard.js'));
  else (root.IC = root.IC || {}).validate = factory(root.IC.money, root.AgentKit.guard);
})(typeof self !== 'undefined' ? self : this, function (M, guard) {
  'use strict';
  const normName = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\b(inc|llc|ltd|limited|co|corp|corporation|company|plc|gmbh|the)\b\.?/g, '').replace(/[^a-z0-9]+/g, '');
  const normNum = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(INV|INVOICE|NO)(?=\d)/, '');
  const domainOf = (email) => { const m = String(email || '').toLowerCase().match(/@\s*([a-z0-9.\- ]+)/); return m ? m[1].replace(/[^a-z0-9]/g, '') : ''; };
  function matchVendor(vendors, name, email) {
    const n = normName(name); const d = domainOf(email);
    let best = null;
    for (const v of vendors || []) {
      const names = [v.name].concat(v.aliases || []).map(normName).filter(Boolean);
      if (n && names.includes(n)) return v;
      if (d && v.domain && v.domain.replace(/[^a-z0-9]/g, '') === d) best = best || v;
      if (n && names.some((x) => x.length >= 6 && (n.startsWith(x) || x.startsWith(n)))) best = best || v;
    }
    return best;
  }
  /* history: [{ total, date }] for this vendor (seed history + posted bills). */
  function unusual(total, history) {
    const vals = (history || []).map((h) => Math.abs(h.total)).filter((x) => x > 0);
    if (vals.length < 3 || !(total > 0)) return null;
    const med = M.median(vals); const sd = M.stdev(vals);
    const hi = Math.max(med * 3, med + 4 * sd);
    if (total > hi) return { median: M.r2(med), ratio: Math.round((total / med) * 10) / 10, n: vals.length };
    if (total < med / 10) return { median: M.r2(med), ratio: Math.round((total / med) * 100) / 100, n: vals.length, low: true };
    return null;
  }
  function flag(id, severity, label, detail, field) { return { id, severity, label, detail: detail || '', field: field || '' }; }
  /* f: extracted fields; ctx: { selfId, others:[{id, status, fields}], vendors, bills, settings:{ baseCurrency, requirePO }, source, text } */
  function validate(f, ctx) {
    const c = ctx || {}; const s = c.settings || {}; const flags = [];
    const fmt = (n) => M.format(n, f.currency || s.baseCurrency || 'USD');
    const vendor = matchVendor(c.vendors, f.vendor, f.vendorEmail);
    if (!f.vendor) flags.push(flag('missing_vendor', 'error', 'Vendor is missing', 'No vendor name was found. Type it in or pick one from the vendor list.', 'vendor'));
    else if (!vendor) flags.push(flag('new_vendor', 'info', 'New vendor', '\u201c' + f.vendor + '\u201d is not in your vendor directory yet. Posting will create it.', 'vendor'));
    if (!f.invoiceNumber) flags.push(flag('missing_number', 'error', 'Invoice number is missing', 'Needed to catch duplicates and to reference the bill.', 'invoiceNumber'));
    if (!f.issueDate) flags.push(flag('missing_issue_date', 'error', 'Issue date is missing', 'The bill date drives the journal entry date.', 'issueDate'));
    if (!f.dueDate && f.docType !== 'credit_note') flags.push(flag('missing_due_date', 'warn', 'Due date is missing', vendor && vendor.terms ? 'Vendor default terms (' + vendor.terms + ') will be used to compute it.' : 'Add a due date or payment terms.', 'dueDate'));
    else if (f.dueDateComputed) flags.push(flag('due_computed', 'info', 'Due date computed from terms', f.terms + ' from ' + f.issueDate + '.', 'dueDate'));
    if (f.issueDate && f.dueDate && f.dueDate < f.issueDate) flags.push(flag('due_before_issue', 'warn', 'Due date is before the issue date', f.dueDate + ' < ' + f.issueDate, 'dueDate'));
    if (!f.po && f.docType !== 'credit_note' && (s.requirePO || (vendor && vendor.requirePO))) flags.push(flag('missing_po', 'warn', 'PO number is missing', (vendor && vendor.requirePO ? vendor.name + ' requires a PO on every bill.' : 'Your settings require a PO.') + ' Check it was approved before posting.', 'po'));
    if (f.total == null) flags.push(flag('missing_total', 'error', 'Total is missing', 'No total was found.', 'total'));
    const lines = f.lines || [];
    if (!lines.length) flags.push(flag('no_lines', 'warn', 'No line items found', 'The bill will post as one line for the subtotal unless you add lines.', 'lines'));
    lines.forEach((l, i) => {
      if (l.qty != null && l.unitPrice != null && l.amount != null && !M.eq(l.qty * l.unitPrice, l.amount, 0.02)) flags.push(flag('line_math', 'warn', 'Line ' + (i + 1) + ': qty \u00d7 price \u2260 amount', l.qty + ' \u00d7 ' + fmt(l.unitPrice) + ' = ' + fmt(M.r2(l.qty * l.unitPrice)) + ', but the line says ' + fmt(l.amount) + '.', 'lines'));
    });
    const lineSum = M.sum(lines.map((l) => l.amount));
    if (lines.length && f.subtotal != null && !f.subtotalDerived && !M.eq(lineSum, f.subtotal)) flags.push(flag('lines_sum', 'error', 'Line items don\u2019t add up to the subtotal', 'Lines sum to ' + fmt(lineSum) + ' but the subtotal says ' + fmt(f.subtotal) + ' (difference ' + fmt(M.r2(f.subtotal - lineSum)) + ').', 'subtotal'));
    if (f.taxRate != null && f.subtotal != null && f.tax != null) {
      const exp = M.r2(f.subtotal * f.taxRate / 100);
      if (!M.eq(exp, f.tax, 0.02)) flags.push(flag('tax_rate', 'warn', 'Tax doesn\u2019t match the rate', f.taxRate + '% of ' + fmt(f.subtotal) + ' is ' + fmt(exp) + ', but the invoice says ' + fmt(f.tax) + '.', 'tax'));
    }
    if (f.subtotal != null && f.total != null && !f.totalDerived) {
      const exp = M.r2(f.subtotal + (f.tax || 0) + (f.shipping || 0) - (f.discount || 0));
      if (!M.eq(exp, f.total)) flags.push(flag('total_mismatch', 'error', 'Total doesn\u2019t match subtotal + tax', fmt(f.subtotal) + ' + ' + fmt(f.tax || 0) + ' = ' + fmt(exp) + ', but the total says ' + fmt(f.total) + ' (difference ' + fmt(M.r2(f.total - exp)) + ').', 'total'));
    }
    // Duplicates against other invoices in the inbox and bills already posted.
    const vKey = vendor ? 'id:' + vendor.id : 'n:' + normName(f.vendor);
    const keyOf = (x) => { const v = matchVendor(c.vendors, x.vendor, x.vendorEmail); return v ? 'id:' + v.id : 'n:' + normName(x.vendor); };
    const pool = (c.others || []).filter((o) => o.id !== c.selfId && o.status !== 'skipped' && o.fields).map((o) => ({ ref: o.name || o.id, id: o.id, f: o.fields, posted: o.status === 'posted' }))
      .concat((c.bills || []).filter((b) => b.invoiceId !== c.selfId).map((b) => ({ ref: 'posted bill ' + b.number, id: b.invoiceId, f: { vendor: b.vendorName, invoiceNumber: b.number, total: b.total, issueDate: b.date, docType: b.type === 'credit' ? 'credit_note' : 'invoice' }, posted: true })));
    let dup = null; let near = null;
    for (const o of pool) {
      if (keyOf(o.f) !== vKey || (o.f.docType || 'invoice') !== (f.docType || 'invoice')) continue;
      if (f.invoiceNumber && normNum(o.f.invoiceNumber) === normNum(f.invoiceNumber)) { dup = dup || o; continue; }
      const days = M.daysBetween(o.f.issueDate, f.issueDate);
      if (f.total != null && o.f.total != null && Math.abs(o.f.total - f.total) <= Math.max(0.01, Math.abs(f.total) * 0.005) && days != null && Math.abs(days) <= 7) near = near || o;
    }
    if (dup) flags.push(flag('duplicate', 'error', 'Possible duplicate invoice', 'Same vendor and invoice number as ' + dup.ref + (dup.posted ? ' (already posted)' : '') + '. Skip this one unless it is genuinely new.', 'invoiceNumber'));
    else if (near) flags.push(flag('duplicate_near', 'warn', 'Looks like a near-duplicate', 'Same vendor, same total and a date within a week of ' + near.ref + ', with a different number.', 'total'));
    if (vendor && f.docType !== 'credit_note') {
      const hist = (vendor.history || []).concat((c.bills || []).filter((b) => b.vendorId === vendor.id && b.type !== 'credit' && b.invoiceId !== c.selfId).map((b) => ({ total: b.totalBase != null ? b.totalBase : b.total, date: b.date })));
      const u = unusual(f.total, hist);
      if (u) flags.push(flag('unusual_amount', 'warn', u.low ? 'Unusually small amount for this vendor' : 'Unusually large amount for this vendor', fmt(f.total) + ' is ' + u.ratio + '\u00d7 the usual ' + fmt(u.median) + ' (median of ' + u.n + ' earlier bills). Confirm before posting.', 'total'));
    }
    const base = s.baseCurrency || 'USD';
    if (f.currency && vendor && vendor.currency && f.currency !== vendor.currency) flags.push(flag('currency_mismatch', 'warn', 'Currency differs from the vendor\u2019s usual', vendor.name + ' usually bills in ' + vendor.currency + '; this one is ' + f.currency + '.', 'currency'));
    else if (f.currency && f.currency !== base) flags.push(flag('currency_mismatch', 'warn', 'Foreign-currency invoice', 'Billed in ' + f.currency + '; your books are in ' + base + '. Check the exchange rate in the proposal before posting.', 'currency'));
    if (!f.currency) flags.push(flag('missing_currency', 'info', 'Currency not stated', 'Assuming ' + base + '.', 'currency'));
    if (f.docType === 'credit_note') flags.push(flag('credit_note', 'info', 'Credit note, not an invoice', 'This will post as a vendor credit (debit Accounts Payable)' + (f.reference ? ' against ' + f.reference : '') + '.', 'docType'));
    if (f.hasBank) {
      const changed = vendor && vendor.bankLast4 && f.bankLast4 && vendor.bankLast4 !== f.bankLast4;
      flags.push(changed
        ? flag('bank_changed', 'error', 'Bank details differ from the vendor record', 'Account ending ' + f.bankLast4 + ' on the invoice; your record ends ' + vendor.bankLast4 + '. Confirm with the vendor by phone before paying (a common fraud pattern).', 'payment')
        : flag('bank_details', 'info', 'Bank / payment details present', 'Account ending ' + (f.bankLast4 || '????') + '. These are sensitive; they are hidden in exports unless you turn that off.', 'payment'));
    }
    if (c.source === 'ocr' || c.source === 'demo-ocr') flags.push(flag('ocr', 'info', 'Read with OCR', 'Text came from an image, so check numbers against the preview.', ''));
    if (c.text && guard) {
      const inj = guard.detectInjection(c.text);
      if (inj.flagged) flags.push(flag('injection', 'warn', 'Hidden instructions found in the document', 'The file contains text aimed at AI tools (\u201c' + (inj.findings[0] ? inj.findings[0].match : '') + '\u201d). It was ignored. Treat the invoice with extra care.', ''));
    }
    return flags;
  }
  const blocking = (flags) => flags.filter((x) => x.severity === 'error');
  return { validate, matchVendor, normName, normNum, unusual, blocking };
});
