/* Local double-entry ledger kept in the browser: chart of accounts, vendors, bills and journal entries.
   The agent proposes a bill + journal entry as a field-level diff; the user approves, rejects or edits
   each field; posting is atomic and undoable. Nothing here talks to a real accounting system. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./money.js'), require('./validate.js'));
  else (root.IC = root.IC || {}).ledger = factory(root.IC.money, root.IC.validate);
})(typeof self !== 'undefined' ? self : this, function (M, V) {
  'use strict';
  const CHART = [
    ['1000', 'Operating cash', 'asset'], ['1300', 'Prepaid expenses', 'asset'], ['1400', 'Input tax recoverable (VAT/GST/sales tax)', 'asset'], ['1999', 'Suspense / clearing', 'asset'],
    ['2000', 'Accounts payable', 'liability'], ['2100', 'Accrued liabilities', 'liability'], ['2200', 'Sales tax payable', 'liability'],
    ['5000', 'Cost of goods sold', 'cogs'], ['5100', 'Freight & shipping in (COGS)', 'cogs'],
    ['6000', 'Office supplies', 'expense'], ['6100', 'Software & subscriptions', 'expense'], ['6200', 'Travel', 'expense'], ['6300', 'Contractors & freelancers', 'expense'],
    ['6400', 'Utilities', 'expense'], ['6500', 'Meals & entertainment', 'expense'], ['6600', 'Rent & lease', 'expense'], ['6700', 'Professional fees', 'expense'],
    ['6800', 'Printing & marketing', 'expense'], ['6900', 'Janitorial & cleaning', 'expense'], ['6950', 'Bank fees', 'expense'], ['6990', 'Miscellaneous expense', 'expense']
  ].map(([code, name, type]) => ({ code, name, type, active: true }));
  const RULES = [
    { re: /\b(freight|shipping|drayage|container|logistics|courier|haulage|port handling)\b/i, code: '5100', why: 'freight' },
    { re: /\b(inventory|goods for resale|raw materials?|components?)\b/i, code: '5000', why: 'goods for resale' },
    { re: /\b(paper|pens?|toner|staples?|folders?|organi[sz]er|office supplies|ink|notebooks?)\b/i, code: '6000', why: 'office supplies' },
    { re: /\b(licen[cs]es?|subscriptions?|seats?|saas|software|storage|hosting|cloud|plan)\b/i, code: '6100', why: 'software' },
    { re: /\b(flights?|airfare|hotel|lodging|travel|mileage|taxi|rail|booking|nights?)\b/i, code: '6200', why: 'travel' },
    { re: /\b(design|consult(ing|ancy)?|contractor|sprint|development|freelance|icons?)\b/i, code: '6300', why: 'contractor services' },
    { re: /\b(electric(ity)?|kwh|water|gas|utilit(y|ies)|power|internet|broadband|service charge)\b/i, code: '6400', why: 'utilities' },
    { re: /\b(lunch|dinner|catering|meals?|buffet|coffee|breakfast)\b/i, code: '6500', why: 'meals' },
    { re: /\b(rent|lease)\b/i, code: '6600', why: 'rent' },
    { re: /\b(legal|accounting|audit|attorney|bookkeeping)\b/i, code: '6700', why: 'professional fees' },
    { re: /\b(print(ing)?|banners?|business cards|flyers?|marketing|advert(ising)?|signage)\b/i, code: '6800', why: 'printing & marketing' },
    { re: /\b(clean(ing)?|janitor(ial)?|carpet|shampoo|sanit(ation|izing))\b/i, code: '6900', why: 'cleaning' }
  ];
  const DEFAULT_SETTINGS = { baseCurrency: 'USD', taxTreatment: 'recoverable', fxRates: { GBP: 1.27, EUR: 1.08, CAD: 0.73, AUD: 0.66 }, requirePO: false };
  function createLedger(seed) {
    const s = seed || {};
    return { accounts: (s.accounts || CHART).map((a) => Object.assign({}, a)), vendors: (s.vendors || []).map((v) => JSON.parse(JSON.stringify(v))), bills: [], journal: [], seq: { bill: 0, je: 0, vendor: 0 } };
  }
  const acct = (L, code) => L.accounts.find((a) => a.code === code);
  const acctName = (L, code) => { const a = acct(L, code); return a ? a.name : code; };
  function mapAccount(description, vendor, L) {
    const hit = RULES.find((r) => r.re.test(description || ''));
    if (hit && (!L || acct(L, hit.code))) return { code: hit.code, reason: 'Matched \u201c' + (String(description).match(hit.re) || [''])[0] + '\u201d (' + hit.why + ')' + (vendor && vendor.defaultAccount && vendor.defaultAccount !== hit.code ? '; vendor default is ' + vendor.defaultAccount : '') };
    if (vendor && vendor.defaultAccount) return { code: vendor.defaultAccount, reason: 'Vendor default account' };
    return { code: '6990', reason: 'No rule matched; miscellaneous' };
  }
  const isVat = (label) => /\b(vat|gst|hst|pst|qst)\b/i.test(label || '');
  /* Build the field-level proposal. f = extracted fields; ai = optional { mappings: {lineIndex: {code, reason}} } */
  function propose(f, L, settings, ai) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    const vendor = V.matchVendor(L.vendors, f.vendor, f.vendorEmail);
    const rows = [];
    const row = (key, label, before, after, reason, extra) => rows.push(Object.assign({ key, label, before: before == null ? '' : before, after: after == null ? '' : after, reason: reason || '', decision: 'pending', value: null }, extra || {}));
    row('vendor', 'Vendor', vendor ? vendor.name : '', vendor ? vendor.name : f.vendor, vendor ? 'Matched vendor directory' : 'New vendor will be created', { create: !vendor });
    if (!vendor && f.vendor) {
      const firstMap = mapAccount((f.lines && f.lines[0] && f.lines[0].description) || '', null, L);
      row('vendor.defaultAccount', 'New vendor: default account', '', firstMap.code, firstMap.reason, { kind: 'account' });
      row('vendor.currency', 'New vendor: currency', '', f.currency || s.baseCurrency, 'From the invoice');
    }
    row('number', 'Bill number', '', f.invoiceNumber, 'From invoice');
    row('date', 'Bill date', '', f.issueDate, 'Issue date on invoice', { kind: 'date' });
    const vTerms = vendor && vendor.terms ? M.parseTerms(vendor.terms) : null;
    const dueByVendor = vTerms && f.issueDate ? M.addDays(f.issueDate, vTerms.days) : '';
    if (f.docType !== 'credit_note') row('due', 'Due date', dueByVendor, f.dueDate || dueByVendor, f.dueDate ? (f.dueDateComputed ? 'Computed from terms on the invoice' : 'Printed on invoice') : 'From vendor terms', { kind: 'date' });
    row('terms', 'Terms', vendor ? vendor.terms || '' : '', f.terms || (vendor && vendor.terms) || '', f.terms ? 'From invoice' : 'Vendor default');
    row('po', 'PO number', '', f.po || '', f.po ? 'From invoice' : 'Not on invoice');
    const cur = f.currency || s.baseCurrency;
    row('currency', 'Currency', vendor ? vendor.currency || s.baseCurrency : s.baseCurrency, cur, f.currency ? 'From invoice' : 'Assumed base currency');
    if (cur !== s.baseCurrency) row('fx', 'Exchange rate (1 ' + cur + ' = ? ' + s.baseCurrency + ')', '', String(s.fxRates[cur] || ''), 'Sample rate from Settings; replace with your bank or booking rate', { kind: 'number' });
    const lines = (f.lines && f.lines.length) ? f.lines : [{ description: (f.vendor || 'Bill') + ' ' + (f.invoiceNumber || ''), qty: 1, unitPrice: f.subtotal || 0, amount: f.subtotal != null ? f.subtotal : M.r2((f.total || 0) - (f.tax || 0)) }];
    lines.forEach((l, i) => {
      const def = vendor && vendor.defaultAccount ? vendor.defaultAccount : '';
      let m = mapAccount(l.description, vendor, L);
      const aiHit = ai && ai.mappings && ai.mappings[i];
      if (aiHit && acct(L, aiHit.code)) m = { code: aiHit.code, reason: 'AI: ' + (aiHit.reason || 'suggested') };
      row('line.' + i + '.account', 'Line ' + (i + 1) + ': ' + String(l.description).slice(0, 48), def, m.code, m.reason + ' \u00b7 ' + M.format(l.amount, cur), { kind: 'account', line: i });
    });
    if (f.tax) {
      const treat = isVat(f.taxLabel) ? 'recoverable' : s.taxTreatment;
      row('tax', 'Tax treatment (' + M.format(f.tax, cur) + ')', s.taxTreatment === 'recoverable' ? '1400' : 'expense', treat === 'recoverable' ? '1400' : 'expense', treat === 'recoverable' ? 'Debit Input tax recoverable 1400' : 'Add tax to the expense lines (not recoverable)', { kind: 'tax' });
    }
    const computed = M.r2(M.sum(lines.map((l) => l.amount)) + (f.tax || 0));
    if (f.total != null && !M.eq(computed, f.total)) row('total', 'Amount owed (AP)', computed.toFixed(2), Number(f.total).toFixed(2), 'Printed total differs from lines + tax by ' + M.format(M.r2(f.total - computed), cur) + '; difference goes to Suspense 1999', { kind: 'number' });
    row('memo', 'Memo', '', (f.docType === 'credit_note' ? 'Vendor credit ' : 'Bill ') + (f.invoiceNumber || '') + (f.po ? ' \u00b7 ' + f.po : '') + (f.reference ? ' \u00b7 ref ' + f.reference : ''), 'Generated');
    return { vendorId: vendor ? vendor.id : null, docType: f.docType || 'invoice', lines, tax: f.tax || 0, taxLabel: f.taxLabel || '', rows };
  }
  const effective = (r) => (r.decision === 'reject' ? r.before : r.decision === 'edit' ? r.value : r.after);
  const pending = (p) => p.rows.filter((r) => r.decision === 'pending');
  function decide(p, key, decision, value) {
    const r = p.rows.find((x) => x.key === key);
    if (!r) throw new Error('No field ' + key);
    r.decision = decision; r.value = decision === 'edit' ? value : null;
    return r;
  }
  function approveAll(p) { p.rows.forEach((r) => { if (r.decision === 'pending') r.decision = 'approve'; }); return p; }
  /* Turn an approved proposal into a bill and a balanced journal entry. Throws with a clear message. */
  function build(p, L, settings) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    if (pending(p).length) throw new Error(pending(p).length + ' field(s) still need approve, reject or edit.');
    const val = (k) => { const r = p.rows.find((x) => x.key === k); return r ? effective(r) : ''; };
    const vendorName = String(val('vendor') || '').trim();
    if (!vendorName) throw new Error('Vendor is required.');
    const number = String(val('number') || '').trim(); if (!number) throw new Error('Bill number is required.');
    const date = String(val('date') || '').trim(); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Bill date must be YYYY-MM-DD.');
    const currency = String(val('currency') || s.baseCurrency).toUpperCase();
    let fx = 1;
    if (currency !== s.baseCurrency) { fx = Number(val('fx')); if (!(fx > 0)) throw new Error('Enter an exchange rate for ' + currency + '.'); }
    const credit = p.docType === 'credit_note';
    const lines = p.lines.map((l, i) => {
      const code = String(val('line.' + i + '.account') || '').trim();
      const a = acct(L, code);
      if (!a) throw new Error('Line ' + (i + 1) + ': account ' + (code || '(blank)') + ' is not in the chart of accounts.');
      return { description: l.description, account: code, amount: M.r2(Math.abs(l.amount)) };
    });
    const tax = M.r2(Math.abs(p.tax || 0));
    const taxRow = p.rows.find((r) => r.key === 'tax');
    const taxMode = taxRow ? effective(taxRow) : '';
    const taxAccount = taxMode === 'expense' || !taxMode ? '' : String(taxMode);
    if (tax && taxAccount && !acct(L, taxAccount)) throw new Error('Tax account ' + taxAccount + ' is not in the chart.');
    const computed = M.r2(M.sum(lines.map((l) => l.amount)) + tax);
    const totalRow = p.rows.find((r) => r.key === 'total');
    const total = totalRow ? M.r2(Number(effective(totalRow))) : computed;
    if (!isFinite(total)) throw new Error('Amount owed must be a number.');
    const conv = (n) => M.r2(n * fx);
    const dr = []; // debit side for a bill (flipped for credits)
    lines.forEach((l) => dr.push({ account: l.account, amount: conv(l.amount), memo: l.description }));
    if (tax) {
      if (taxAccount) dr.push({ account: taxAccount, amount: conv(tax), memo: (p.taxLabel || 'Tax') + ' recoverable' });
      else { const big = lines.reduce((a, l) => (l.amount > a.amount ? l : a), lines[0]); dr.push({ account: big.account, amount: conv(tax), memo: (p.taxLabel || 'Tax') + ' (not recoverable)' }); }
    }
    if (!M.eq(total, computed)) dr.push({ account: '1999', amount: conv(M.r2(total - computed)), memo: 'Difference vs printed total (review)' });
    const totalBase = M.sum(dr.map((d) => d.amount));
    const jl = dr.map((d) => ({ account: d.account, name: acctName(L, d.account), debit: credit ? 0 : d.amount, credit: credit ? d.amount : 0, memo: d.memo }))
      .map((x) => (x.debit < 0 ? Object.assign(x, { credit: -x.debit, debit: 0 }) : x.credit < 0 ? Object.assign(x, { debit: -x.credit, credit: 0 }) : x));
    jl.push({ account: '2000', name: acctName(L, '2000'), debit: credit ? totalBase : 0, credit: credit ? 0 : totalBase, memo: vendorName + ' ' + number });
    const dsum = M.sum(jl.map((x) => x.debit)); const csum = M.sum(jl.map((x) => x.credit));
    if (!M.eq(dsum, csum, 0)) throw new Error('Journal entry does not balance (' + dsum + ' vs ' + csum + ').');
    const bill = { type: credit ? 'credit' : 'bill', vendorId: p.vendorId, vendorName, number, date, due: String(val('due') || ''), terms: String(val('terms') || ''), po: String(val('po') || ''), currency, fx, lines, tax, taxAccount, taxLabel: p.taxLabel, total, totalBase, memo: String(val('memo') || '') };
    const newVendor = !p.vendorId ? { name: vendorName, defaultAccount: String(val('vendor.defaultAccount') || lines[0].account), currency: String(val('vendor.currency') || currency), terms: bill.terms, aliases: [], domain: p.vendorDomain || '' } : null;
    return { bill, entry: { date, memo: (credit ? 'Vendor credit ' : 'Bill ') + vendorName + ' ' + number + (fx !== 1 ? ' @ ' + fx + ' ' + s.baseCurrency + '/' + currency : ''), lines: jl, currency: s.baseCurrency }, newVendor };
  }
  const pad = (n, w) => String(n).padStart(w || 4, '0');
  /* Post atomically. opts.allowDuplicate lets the caller override the posted-duplicate guard. */
  function post(L, built, opts) {
    const o = opts || {};
    const { bill, entry, newVendor } = built;
    let vendorId = bill.vendorId; let createdVendor = null;
    const dupe = L.bills.find((b) => V.normName(b.vendorName) === V.normName(bill.vendorName) && V.normNum(b.number) === V.normNum(bill.number) && b.type === bill.type);
    if (dupe && !o.allowDuplicate) throw Object.assign(new Error('A ' + (bill.type === 'credit' ? 'credit' : 'bill') + ' ' + bill.number + ' from ' + bill.vendorName + ' is already posted (' + dupe.id + ').'), { code: 'duplicate' });
    if (!vendorId && newVendor) {
      const existing = V.matchVendor(L.vendors, newVendor.name, '');
      if (existing) vendorId = existing.id;
      else { createdVendor = Object.assign({ id: 'v-' + pad(++L.seq.vendor, 3), requirePO: false, history: [] }, newVendor); L.vendors.push(createdVendor); vendorId = createdVendor.id; }
    }
    const b = Object.assign({}, bill, { id: 'BILL-' + pad(++L.seq.bill), vendorId, invoiceId: o.invoiceId || null, postedAt: o.now || new Date().toISOString(), jeId: 'JE-' + pad(++L.seq.je) });
    const e = Object.assign({}, entry, { id: b.jeId, billId: b.id, invoiceId: b.invoiceId, postedAt: b.postedAt });
    L.bills.push(b); L.journal.push(e);
    return { bill: b, entry: e, createdVendorId: createdVendor ? createdVendor.id : null };
  }
  function unpost(L, billId, createdVendorId) {
    const bi = L.bills.findIndex((b) => b.id === billId);
    if (bi < 0) return null;
    const [b] = L.bills.splice(bi, 1);
    const ji = L.journal.findIndex((e) => e.billId === billId);
    const e = ji >= 0 ? L.journal.splice(ji, 1)[0] : null;
    if (createdVendorId && !L.bills.some((x) => x.vendorId === createdVendorId)) L.vendors = L.vendors.filter((v) => v.id !== createdVendorId);
    return { bill: b, entry: e };
  }
  function trialBalance(L) {
    const t = {};
    L.journal.forEach((e) => e.lines.forEach((l) => { t[l.account] = t[l.account] || { account: l.account, name: acctName(L, l.account), debit: 0, credit: 0 }; t[l.account].debit = M.r2(t[l.account].debit + l.debit); t[l.account].credit = M.r2(t[l.account].credit + l.credit); }));
    return Object.values(t).sort((a, b) => a.account.localeCompare(b.account));
  }
  function apBalance(L) { const r = trialBalance(L).find((x) => x.account === '2000'); return r ? M.r2(r.credit - r.debit) : 0; }
  function addAccount(L, a) {
    if (!/^\d{3,6}$/.test(String(a.code || ''))) throw new Error('Account code must be 3\u20136 digits.');
    if (acct(L, a.code)) throw new Error('Account ' + a.code + ' already exists.');
    if (!String(a.name || '').trim()) throw new Error('Account name is required.');
    const x = { code: String(a.code), name: String(a.name).trim(), type: a.type || 'expense', active: true };
    L.accounts.push(x); L.accounts.sort((p, q) => p.code.localeCompare(q.code));
    return x;
  }
  const accountInUse = (L, code) => L.journal.some((e) => e.lines.some((l) => l.account === code)) || L.vendors.some((v) => v.defaultAccount === code);
  return { CHART, RULES, DEFAULT_SETTINGS, createLedger, acct, acctName, mapAccount, propose, decide, approveAll, effective, pending, build, post, unpost, trialBalance, apBalance, addAccount, accountInUse };
});
