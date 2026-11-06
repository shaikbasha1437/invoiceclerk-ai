/* The InvoiceClerk pipeline: read (pdf.js text / OCR / bundled OCR text / vision model) -> parse ->
   validate -> propose bill + journal entry. Side-effect free except for the store; I/O is injected. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./parse.js'), require('./ledger.js'), require('./ai.js'));
  else (root.IC = root.IC || {}).agent = factory(root.IC.parse, root.IC.ledger, root.IC.ai);
})(typeof self !== 'undefined' ? self : this, function (P, Lg, AI) {
  'use strict';
  /* deps: { readPdf(bytes)->{lines, scanned}, ocr(inv, bytes)->{text}|null, demoOcr(name)->text|null, now() } */
  async function extract(store, id, bytes, deps) {
    const inv = store.get(id); if (!inv) throw new Error('Invoice not found');
    const d = deps || {}; const steps = [];
    const t0 = Date.now();
    let lines = []; let source = 'pdf';
    if (inv.kind === 'pdf') {
      const r = await d.readPdf(bytes);
      steps.push({ step: 'Read PDF text layer', detail: r.lines.length + ' lines' + (r.scanned ? ' (no usable text: scanned)' : '') });
      lines = r.lines;
      if (r.scanned) lines = [];
    }
    if (!lines.length) {
      const bundled = d.demoOcr ? await d.demoOcr(inv) : null;
      if (bundled) { lines = bundled.split(/\r?\n/); source = 'demo-ocr'; steps.push({ step: 'Bundled OCR text', detail: 'Pre-computed with Tesseract.js for the offline demo' }); }
      else if (d.ocr) {
        const r = await d.ocr(inv, bytes);
        if (r && r.text) { lines = r.text.split(/\r?\n/); source = 'ocr'; steps.push({ step: 'OCR (Tesseract.js)', detail: 'confidence ' + Math.round(r.confidence || 0) + '%' }); }
      }
    }
    if (!lines.filter((l) => l.trim()).length) {
      store.update(id, { fields: emptyFields(), source: 'none', extractedAt: new Date().toISOString(), steps: steps.concat([{ step: 'No text found', detail: 'Turn on OCR in Settings, use live mode with a vision model, or type the fields in.' }]) });
      store.revalidate(store.get(id)); store.save();
      return store.get(id);
    }
    const pref = store.state.settings.datePref === 'auto' ? undefined : store.state.settings.datePref;
    const fields = P.parseInvoice(lines, { source, datePref: pref });
    steps.push({ step: 'Parse fields', detail: (fields.lines || []).length + ' line items, total ' + (fields.total == null ? '?' : fields.total) });
    store.update(id, { fields, source, extractedAt: new Date().toISOString(), steps, proposal: null, ms: Date.now() - t0 });
    const inv2 = store.revalidate(store.get(id));
    inv2.proposal = Lg.propose(inv2.fields, store.state.ledger, store.state.settings);
    store.revalidateAll();
    return store.get(id);
  }
  function emptyFields() { return { vendor: '', vendorEmail: '', invoiceNumber: '', docType: 'invoice', issueDate: '', dueDate: '', po: '', currency: '', terms: '', reference: '', subtotal: null, taxRate: null, tax: null, total: null, lines: [], payment: {}, hasBank: false, rawLines: [], sources: {}, emails: [], phones: [] }; }
  /* After the user edits fields: re-run validation and rebuild the proposal (decisions are reset). */
  function edited(store, id, fields) {
    const inv = store.get(id);
    inv.fields = Object.assign({}, inv.fields, fields, { subtotalDerived: false, totalDerived: false, dueDateComputed: fields.dueDate !== undefined && fields.dueDate !== inv.fields.dueDate ? false : inv.fields.dueDateComputed });
    inv.proposal = Lg.propose(inv.fields, store.state.ledger, store.state.settings, inv.aiMap ? { mappings: inv.aiMap } : null);
    if (inv.status === 'approved') inv.status = 'extracted';
    store.revalidateAll();
    return inv;
  }
  function repropose(store, id) {
    const inv = store.get(id);
    inv.proposal = Lg.propose(inv.fields, store.state.ledger, store.state.settings, inv.aiMap ? { mappings: inv.aiMap } : null);
    store.revalidateAll();
    return inv;
  }
  function decide(store, id, key, decision, value) {
    const inv = store.get(id);
    Lg.decide(inv.proposal, key, decision, value);
    store.revalidate(inv); store.save();
    return inv;
  }
  function approveAll(store, id) { const inv = store.get(id); Lg.approveAll(inv.proposal); store.revalidate(inv); store.save(); return inv; }
  /* Post: requires all fields decided and, when error flags remain, opts.override. */
  function post(store, id, opts) {
    const o = opts || {}; const inv = store.get(id); const st = store.state;
    if (inv.status === 'posted') throw new Error('Already posted.');
    const errs = inv.flags.filter((f) => f.severity === 'error');
    if (errs.length && !o.override) throw Object.assign(new Error(errs.length + ' blocking flag(s): ' + errs.map((e) => e.label).join('; ') + '. Fix them or confirm the override.'), { code: 'flags' });
    const built = Lg.build(inv.proposal, st.ledger, st.settings);
    if (built.newVendor) built.newVendor.domain = (inv.fields.vendorEmail || '').split('@')[1] || '';
    const r = Lg.post(st.ledger, built, { invoiceId: id, allowDuplicate: !!o.override, now: o.now });
    inv.status = 'posted'; inv.postedBillId = r.bill.id; inv.createdVendorId = r.createdVendorId; inv.postedAt = r.bill.postedAt;
    store.revalidateAll();
    return r;
  }
  function unpost(store, id) {
    const inv = store.get(id); const st = store.state;
    if (!inv || inv.status !== 'posted') return null;
    const r = Lg.unpost(st.ledger, inv.postedBillId, inv.createdVendorId);
    inv.status = 'approved'; inv.postedBillId = null; inv.createdVendorId = null;
    inv.proposal = inv.proposal || Lg.propose(inv.fields, st.ledger, st.settings);
    store.revalidateAll();
    return r;
  }
  /* Live mode: improve extraction with the user's model. llmCall(msg) -> { text, usage, cost }. */
  async function aiExtract(store, id, llmCall, opts) {
    const inv = store.get(id); const o = opts || {};
    const msg = AI.extractMessage({ lines: inv.fields ? inv.fields.rawLines : [], current: inv.fields, image: o.image || null });
    const r = await llmCall(msg);
    const ai = AI.normalize(AI.parseJson(r.text));
    const m = AI.merge(inv.fields || emptyFields(), ai);
    inv.aiPrev = inv.fields; inv.fields = m.fields; inv.ai = { filled: m.filled, suggestions: m.suggestions, notes: m.notes, cost: r.cost, usage: r.usage, at: new Date().toISOString() };
    if (inv.source === 'none' && m.filled.length) inv.source = 'ai';
    inv.proposal = Lg.propose(inv.fields, store.state.ledger, store.state.settings, inv.aiMap ? { mappings: inv.aiMap } : null);
    store.revalidateAll();
    return { inv, merged: m, usage: r.usage, cost: r.cost };
  }
  async function aiMap(store, id, llmCall) {
    const inv = store.get(id); const st = store.state;
    const lines = inv.proposal ? inv.proposal.lines : (inv.fields.lines || []);
    const r = await llmCall(AI.mapMessage(lines, st.ledger.accounts, inv.fields.vendor));
    const mappings = AI.parseMappings(r.text, st.ledger.accounts, lines.length);
    inv.aiMap = mappings;
    inv.proposal = Lg.propose(inv.fields, st.ledger, st.settings, { mappings });
    store.revalidateAll();
    return { inv, mappings, cost: r.cost };
  }
  return { extract, edited, repropose, decide, approveAll, post, unpost, aiExtract, aiMap, emptyFields };
});
