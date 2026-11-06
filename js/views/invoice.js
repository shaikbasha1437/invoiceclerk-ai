/* Invoice review: original preview beside the extracted fields, flags, line items, AI help,
   the field-level bill + journal proposal (approve / reject / edit each field), posting with undo. */
(function (root) {
  'use strict';
  const IC = root.IC; const { h, toast, undoToast, sheet } = IC.ui; const M = IC.money; const Lg = IC.ledger;
  const SEV = { error: 'stop', warn: 'warn', info: 'info' };
  const view = { page: 1, zoom: 1, reveal: false };
  function render(el, id) {
    const app = IC.app; const st = app.store; const inv = st.get(id);
    if (!inv) { el.append(h('div', { class: 'empty panel' }, h('p', { text: 'That invoice is not in this browser any more.' }), h('a', { class: 'btn', href: '#inbox' }, 'Back to inbox'))); return; }
    if (view.id !== id) { view.id = id; view.page = 1; view.reveal = false; }
    const f = inv.fields;
    const posted = inv.status === 'posted';
    el.append(h('div', { class: 'inv-head' },
      h('a', { href: '#inbox', class: 'btn sm ghost' }, '\u2190 Inbox'),
      h('div', { class: 'grow ellip' }, h('h1', { class: 'ellip', text: (f && f.invoiceNumber) || inv.name }), h('div', { class: 'small muted ellip', text: inv.name + (inv.demo ? ' \u00b7 fictional sample' : '') + (inv.story ? ' \u00b7 ' + inv.story : '') })),
      app.statusChip(inv.status)));
    el.append(h('div', { class: 'toolbar' },
      h('button', { type: 'button', class: 'btn sm', onclick: () => app.notes(id) }, '\ud83d\udcdd Notes'),
      h('button', { type: 'button', class: 'btn sm', disabled: posted, onclick: () => app.skip(id) }, inv.status === 'skipped' ? 'Unskip' : 'Skip'),
      h('button', { type: 'button', class: 'btn sm', disabled: posted || !!app.busy, onclick: async () => { const prev = JSON.stringify(inv.fields); await app.extract(id); toast('Read again.', {}); app.rerender(); void prev; } }, 'Re-read'),
      h('button', { type: 'button', class: 'btn sm', onclick: async () => { try { const u = await app.blobUrl(inv); const a = h('a', { href: u, download: inv.name }); document.body.append(a); a.click(); a.remove(); } catch (e) { toast(e.message); } } }, 'Download original'),
      h('button', { type: 'button', class: 'btn sm danger', disabled: posted, onclick: () => app.remove(id) }, 'Delete')));
    if (inv.notes) el.append(h('div', { class: 'notice', style: 'margin-bottom:12px', text: '\ud83d\udcdd ' + inv.notes }));
    const grid = h('div', { class: 'review' }); el.append(grid);
    const left = h('div', { class: 'panel preview-panel' }); const right = h('div', { class: 'review-right' });
    grid.append(left, right);
    preview(left, inv);
    if (!f) { right.append(h('div', { class: 'panel' }, h('p', { text: 'Not read yet.' }), h('button', { type: 'button', class: 'btn primary', onclick: async () => { await app.extract(id); app.rerender(); } }, 'Read now'))); return; }
    flagsPanel(right, inv);
    fieldsPanel(right, inv, posted);
    linesPanel(right, inv, posted);
    paymentPanel(right, inv);
    aiPanel(right, inv, posted);
    if (posted) postedPanel(right, inv); else proposalPanel(right, inv);
    tracePanel(right, inv);
  }
  function preview(box, inv) {
    const app = IC.app;
    const head = h('div', { class: 'row', style: 'margin-bottom:8px' }, h('h2', { class: 'grow', style: 'margin:0', text: 'Original' }));
    const stage = h('div', { class: 'stage', id: 'preview-stage' }, h('p', { class: 'muted small', text: 'Loading preview\u2026' }));
    box.append(head, stage);
    (async () => {
      try {
        if (inv.kind === 'pdf') {
          const bytes = await app.bytes(inv); const canvas = h('canvas', { class: 'page', 'aria-label': 'Page ' + view.page + ' of ' + inv.name, role: 'img' });
          const info = await IC.pdftext.renderPage(bytes, view.page, canvas, 1.6);
          stage.textContent = ''; stage.append(canvas);
          if (info.numPages > 1) head.append(h('button', { type: 'button', class: 'btn sm', disabled: view.page <= 1, onclick: () => { view.page--; app.rerender(); } }, '\u2039'), h('span', { class: 'small', text: view.page + ' / ' + info.numPages }), h('button', { type: 'button', class: 'btn sm', disabled: view.page >= info.numPages, onclick: () => { view.page++; app.rerender(); } }, '\u203a'));
        } else {
          const u = await app.blobUrl(inv); stage.textContent = ''; stage.append(h('img', { class: 'page', src: u, alt: 'Invoice image ' + inv.name }));
        }
      } catch (e) { stage.textContent = ''; stage.append(h('p', { class: 'notice warn', text: 'Preview unavailable: ' + e.message })); }
    })();
    box.append(h('p', { class: 'small muted', style: 'margin:8px 0 0', text: sourceText(inv) }));
  }
  function sourceText(inv) {
    return { pdf: 'Read from the PDF text layer with pdf.js.', ocr: 'Read with Tesseract.js OCR in this browser. Check numbers against the image.', 'demo-ocr': 'Image or scanned file: using OCR text that was pre-computed with Tesseract.js for the offline demo. Turn on OCR in Settings to run it live.', ai: 'Fields filled by your AI model from the image.', none: 'No text found. Turn on OCR, use a vision model in live mode, or type the fields.' }[inv.source] || '';
  }
  function flagsPanel(box, inv) {
    const p = h('div', { class: 'panel', id: 'flags' }, h('h2', { text: 'Checks' }));
    if (!inv.flags.length) p.append(h('p', { class: 'notice ok', text: 'All checks passed.' }));
    const order = { error: 0, warn: 1, info: 2 };
    inv.flags.slice().sort((a, b) => order[a.severity] - order[b.severity]).forEach((fl) => p.append(h('div', { class: 'flag ' + SEV[fl.severity], 'data-flag': fl.id },
      h('span', { class: 'chip ' + SEV[fl.severity], text: fl.severity === 'error' ? 'Blocking' : fl.severity === 'warn' ? 'Warning' : 'Info' }),
      h('div', {}, h('b', { text: fl.label }), fl.detail ? h('div', { class: 'small', text: fl.detail }) : null))));
    box.append(p);
  }
  function fieldsPanel(box, inv, locked) {
    const app = IC.app; const f = inv.fields;
    const p = h('div', { class: 'panel', id: 'fields' }, h('div', { class: 'row' }, h('h2', { class: 'grow', style: 'margin:0', text: 'Extracted fields' }), h('span', { class: 'small muted', text: locked ? 'Unpost to edit' : 'Edits apply when you leave a field' })));
    const grid = h('div', { class: 'fgrid' }); p.append(grid);
    IC.parse.FIELDS.forEach(([k, label, type]) => {
      const src = f.sources && f.sources[k] != null && f.rawLines ? f.rawLines[f.sources[k]] : '';
      let input;
      if (type === 'select') input = h('select', { disabled: locked }, h('option', { value: 'invoice', selected: f.docType !== 'credit_note', text: 'Invoice' }), h('option', { value: 'credit_note', selected: f.docType === 'credit_note', text: 'Credit note' }));
      else input = h('input', { type: type === 'date' ? 'date' : type === 'money' || type === 'number' ? 'text' : 'text', inputmode: type === 'money' || type === 'number' ? 'decimal' : null, value: f[k] == null ? '' : (type === 'money' ? Number(f[k]).toFixed(2) : String(f[k])), disabled: locked, 'data-field': k });
      input.addEventListener('change', () => {
        let v = input.value.trim();
        if (type === 'money' || type === 'number') { v = v === '' ? null : M.parseAmount(v); if (input.value.trim() && v == null) { toast(label + ': not a number.'); input.value = f[k] == null ? '' : f[k]; return; } }
        if (k === 'currency') v = v.toUpperCase();
        const prev = JSON.parse(JSON.stringify(inv.fields));
        IC.agent.edited(app.store, inv.id, { [k]: v });
        undoToast(label + ' updated; checks and proposal refreshed.', () => { inv.fields = prev; IC.agent.repropose(app.store, inv.id); app.rerender(); });
        app.rerender();
      });
      grid.append(h('label', { class: 'f' + (inv.flags.some((x) => x.field === k && x.severity !== 'info') ? ' flagged' : '') }, label, input, src ? h('span', { class: 'h ellip', title: src, text: 'from: \u201c' + src.trim().slice(0, 70) + '\u201d' }) : (k === 'dueDate' && f.dueDateComputed ? h('span', { class: 'h', text: 'computed from terms' }) : null)));
    });
    const extra = [f.vendorEmail ? 'Email: ' + f.vendorEmail : '', (f.phones || []).length ? 'Phone: ' + f.phones.join(', ') : ''].filter(Boolean).join(' \u00b7 ');
    if (extra) p.append(h('p', { class: 'small muted', text: extra }));
    box.append(p);
  }
  function linesPanel(box, inv, locked) {
    const app = IC.app; const f = inv.fields; const cur = f.currency || app.settings().baseCurrency;
    const p = h('div', { class: 'panel', id: 'lines' }, h('h2', { text: 'Line items' }));
    const t = h('table', { class: 't lines' }, h('thead', {}, h('tr', {}, ...['Description', 'Qty', 'Unit price', 'Amount', ''].map((x) => h('th', { text: x })))));
    const tb = h('tbody'); t.append(tb);
    const commit = (lines, msg) => { const prev = JSON.parse(JSON.stringify(inv.fields)); IC.agent.edited(app.store, inv.id, { lines }); undoToast(msg, () => { inv.fields = prev; IC.agent.repropose(app.store, inv.id); app.rerender(); }); app.rerender(); };
    (f.lines || []).forEach((l, i) => {
      const cell = (key, isNum) => { const inp = h('input', { type: 'text', inputmode: isNum ? 'decimal' : null, value: isNum ? (l[key] == null ? '' : String(l[key])) : l[key] || '', disabled: locked, 'aria-label': key + ' line ' + (i + 1) }); inp.addEventListener('change', () => { const lines = JSON.parse(JSON.stringify(f.lines)); const v = isNum ? M.parseAmount(inp.value) : inp.value; if (isNum && v == null) { toast('Not a number.'); inp.value = l[key]; return; } lines[i][key] = v; if (key !== 'amount' && key !== 'description' && lines[i].qty != null && lines[i].unitPrice != null) lines[i].amount = M.r2(lines[i].qty * lines[i].unitPrice); commit(lines, 'Line ' + (i + 1) + ' updated.'); }); return inp; };
      const bad = l.qty != null && l.unitPrice != null && !M.eq(l.qty * l.unitPrice, l.amount, 0.02);
      tb.append(h('tr', { class: bad ? 'bad' : '' }, h('td', { 'data-label': 'Description' }, cell('description')), h('td', { 'data-label': 'Qty' }, cell('qty', true)), h('td', { 'data-label': 'Unit price' }, cell('unitPrice', true)), h('td', { 'data-label': 'Amount' }, cell('amount', true)),
        h('td', {}, h('button', { type: 'button', class: 'btn sm ghost danger', disabled: locked, 'aria-label': 'Remove line ' + (i + 1), onclick: () => { const lines = f.lines.filter((_, j) => j !== i); commit(lines, 'Removed line ' + (i + 1) + '.'); } }, '\u00d7'))));
    });
    p.append(h('div', { class: 'tscroll' }, t));
    const sum = M.sum((f.lines || []).map((l) => l.amount));
    p.append(h('div', { class: 'row small', style: 'margin-top:8px' },
      h('span', { class: 'grow', text: 'Lines sum: ' + M.format(sum, cur) + (f.subtotal != null ? ' \u00b7 subtotal ' + M.format(f.subtotal, cur) : '') + (f.tax != null ? ' \u00b7 tax ' + M.format(f.tax, cur) : '') + (f.total != null ? ' \u00b7 total ' + M.format(f.total, cur) : '') }),
      h('button', { type: 'button', class: 'btn sm', disabled: locked, onclick: () => commit((f.lines || []).concat([{ description: 'New line', qty: 1, unit: '', unitPrice: 0, amount: 0 }]), 'Line added.') }, '+ Add line')));
    box.append(p);
  }
  function paymentPanel(box, inv) {
    const app = IC.app; const f = inv.fields; if (!f.hasBank) return;
    const hide = app.settings().hideBank && !view.reveal;
    const pay = hide ? IC.exports.maskBank(f.payment) : f.payment;
    const names = { iban: 'IBAN', swift: 'SWIFT/BIC', routing: 'Routing', account: 'Account', sortCode: 'Sort code' };
    box.append(h('div', { class: 'panel', id: 'payment' }, h('div', { class: 'row' }, h('h2', { class: 'grow', style: 'margin:0', text: 'Payment details' }), app.settings().hideBank ? h('button', { type: 'button', class: 'btn sm', onclick: () => { view.reveal = !view.reveal; app.rerender(); } }, view.reveal ? 'Hide' : 'Show') : null),
      h('dl', { class: 'kv', style: 'margin-top:8px' }, ...Object.keys(pay).flatMap((k) => [h('dt', { text: names[k] || k }), h('dd', { class: 'mono', text: pay[k] })])),
      h('p', { class: 'small muted', text: 'Never pay to bank details from an invoice alone; confirm changes with the vendor on a known phone number.' })));
  }
  function aiPanel(box, inv, locked) {
    const app = IC.app; const s = app.settings();
    const p = h('div', { class: 'panel', id: 'ai' }, h('h2', { text: 'AI help' }));
    if (s.mode === 'demo') { p.append(h('p', { class: 'small muted', text: 'Demo mode uses the built-in parser and rules only. Switch to live mode in Settings to let your own model (OpenAI, Anthropic, Gemini or an OpenAI-compatible server) re-read messy or scanned invoices and suggest account mappings.' }), h('a', { class: 'btn sm', href: '#settings/model' }, 'Set up live mode')); box.append(p); return; }
    const llm = app.llm();
    if (llm && llm.error) { p.append(h('p', { class: 'notice warn', text: llm.error })); box.append(p); return; }
    const imgCapable = s.mode === 'live' && (inv.kind === 'image' || inv.source === 'demo-ocr' || inv.source === 'ocr' || inv.source === 'none');
    const status = h('div', { class: 'small muted', id: 'ai-status' });
    const run = async (label, fn) => { status.textContent = label + '\u2026'; try { await fn(); } catch (e) { status.textContent = ''; toast('AI call failed: ' + e.message); return; } app.rerender(); };
    p.append(h('p', { class: 'small muted', text: 'Sends this invoice\u2019s text' + (imgCapable ? ' and page image' : '') + ' to ' + llm.label + ' (' + llm.model + ') from your browser. The reply can only fill fields and suggest accounts; it cannot post or approve anything.' }),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', id: 'ai-extract', disabled: locked, onclick: () => run('Reading with ' + llm.label, async () => { const image = imgCapable ? { mime: 'image/jpeg', data: await (async () => { const c = await app.pageImage(inv); const k = Math.min(1, 1600 / Math.max(c.width, c.height)); const d = document.createElement('canvas'); d.width = Math.round(c.width * k); d.height = Math.round(c.height * k); d.getContext('2d').drawImage(c, 0, 0, d.width, d.height); return d.toDataURL('image/jpeg', 0.85).split(',')[1]; })() } : null; const r = await IC.agent.aiExtract(app.store, inv.id, llm.call, { image }); toast('AI filled ' + (r.merged.filled.length ? r.merged.filled.join(', ') : 'nothing new') + (r.merged.suggestions.length ? '; ' + r.merged.suggestions.length + ' suggestion(s) to review' : '') + '.'); }) }, 'Improve extraction'),
        h('button', { type: 'button', class: 'btn', id: 'ai-map', disabled: locked, onclick: () => run('Asking for account mappings', async () => { const r = await IC.agent.aiMap(app.store, inv.id, llm.call); toast(Object.keys(r.mappings).length + ' account suggestion(s) added to the proposal.'); }) }, 'Suggest accounts')),
      status);
    if (inv.ai) {
      if (inv.ai.notes) p.append(h('p', { class: 'notice', text: 'Model note: ' + inv.ai.notes }));
      (inv.ai.suggestions || []).forEach((sg) => p.append(h('div', { class: 'sugg' }, h('span', { class: 'grow', text: sg.key + ': ' + sg.current + ' \u2192 ' + sg.suggested }), h('button', { type: 'button', class: 'btn sm', disabled: locked, onclick: () => { inv.ai.suggestions = inv.ai.suggestions.filter((x) => x !== sg); IC.agent.edited(app.store, inv.id, { [sg.key]: sg.suggested }); toast('Applied.'); app.rerender(); } }, 'Use'), h('button', { type: 'button', class: 'btn sm ghost', onclick: () => { inv.ai.suggestions = inv.ai.suggestions.filter((x) => x !== sg); app.store.save(); app.rerender(); } }, 'Dismiss'))));
      if (inv.aiPrev) p.append(h('button', { type: 'button', class: 'btn sm ghost', disabled: locked, onclick: () => { const cur = inv.fields; inv.fields = inv.aiPrev; inv.aiPrev = null; IC.agent.repropose(app.store, inv.id); undoToast('Reverted to the parser\u2019s fields.', () => { inv.aiPrev = inv.fields; inv.fields = cur; IC.agent.repropose(app.store, inv.id); app.rerender(); }); app.rerender(); } }, 'Revert AI changes'));
      if (inv.ai.cost != null) p.append(h('p', { class: 'small muted', text: 'Last call: ' + (inv.ai.usage ? inv.ai.usage.input + ' in / ' + inv.ai.usage.output + ' out tokens' : '') + ' \u00b7 about $' + inv.ai.cost.toFixed(4) }));
    }
    box.append(p);
  }
  function display(r, app) {
    const v = Lg.effective(r);
    if (r.kind === 'account') return v ? v + ' ' + Lg.acctName(app.store.state.ledger, v) : '\u2014';
    if (r.kind === 'tax') return v === 'expense' ? 'Add to expense (not recoverable)' : v ? v + ' ' + Lg.acctName(app.store.state.ledger, v) : '\u2014';
    return v === '' || v == null ? '\u2014' : String(v);
  }
  const show = (r, which, app) => display(Object.assign({}, r, { decision: which === 'before' ? 'reject' : 'approve' }), app);
  function proposalPanel(box, inv) {
    const app = IC.app; const st = app.store; const p = inv.proposal;
    const panel = h('div', { class: 'panel', id: 'proposal' });
    box.append(panel);
    if (!p) { panel.append(h('p', { text: 'No proposal yet.' })); return; }
    const pend = Lg.pending(p).length;
    panel.append(h('div', { class: 'row' }, h('h2', { class: 'grow', style: 'margin:0', text: 'Proposed bill + journal entry' }), h('span', { class: 'chip ' + (pend ? 'warn' : 'ok'), id: 'pending-chip', text: pend ? pend + ' to review' : 'All fields decided' })),
      h('p', { class: 'small muted', text: 'Before = vendor default or your books today; After = what the agent proposes. Approve, reject (keeps Before) or edit each field.' }));
    const list = h('div', { class: 'diff' });
    p.rows.forEach((r) => {
      const changed = String(r.before) !== String(r.after);
      list.append(h('div', { class: 'diff-row ' + r.decision, 'data-key': r.key },
        h('div', { class: 'dl' }, h('b', { text: r.label }), r.reason ? h('div', { class: 'small muted', text: r.reason }) : null),
        h('div', { class: 'dv' },
          changed && r.before !== '' ? h('div', { class: 'before', text: show(r, 'before', app) }) : null,
          h('div', { class: r.decision === 'reject' ? 'after rejected' : 'after', text: show(r, 'after', app) }),
          r.decision === 'edit' ? h('div', { class: 'edited', text: 'Edited: ' + display(r, app) }) : null,
          r.decision === 'reject' ? h('div', { class: 'small muted', text: 'Rejected: using ' + (display(r, app)) }) : null),
        h('div', { class: 'da' },
          h('button', { type: 'button', class: 'btn sm' + (r.decision === 'approve' ? ' ok' : ''), 'aria-pressed': String(r.decision === 'approve'), 'data-act': 'approve', onclick: () => { IC.agent.decide(st, inv.id, r.key, 'approve'); app.rerender(); } }, '\u2713'),
          h('button', { type: 'button', class: 'btn sm' + (r.decision === 'reject' ? ' danger-ok' : ''), 'aria-pressed': String(r.decision === 'reject'), 'data-act': 'reject', title: 'Reject (keep Before)', onclick: () => { IC.agent.decide(st, inv.id, r.key, 'reject'); app.rerender(); } }, '\u2715'),
          h('button', { type: 'button', class: 'btn sm' + (r.decision === 'edit' ? ' primary' : ''), 'data-act': 'edit', onclick: () => editRow(inv, r) }, '\u270e'))));
    });
    panel.append(list);
    // Preview the journal entry as if every pending field were approved.
    let preview = null; let err = '';
    try { const clone = JSON.parse(JSON.stringify(p)); Lg.approveAll(clone); preview = Lg.build(clone, st.state.ledger, st.state.settings); } catch (e) { err = e.message; }
    if (preview) panel.append(jeTable(preview.entry, app, 'Journal entry preview'));
    else panel.append(h('p', { class: 'notice warn', text: 'Cannot build the entry yet: ' + err }));
    const errs = inv.flags.filter((x) => x.severity === 'error').length;
    panel.append(h('div', { class: 'actions sticky-actions' },
      h('button', { type: 'button', class: 'btn', id: 'approve-all', disabled: !pend, onclick: () => { IC.agent.approveAll(st, inv.id); toast('Approved the remaining ' + pend + ' field(s).'); app.rerender(); } }, 'Approve all remaining'),
      h('button', { type: 'button', class: 'btn primary', id: 'post-btn', disabled: !!pend || inv.status === 'skipped', onclick: () => app.post(inv.id) }, errs ? 'Post (' + errs + ' blocking)\u2026' : 'Post to ledger'),
      h('button', { type: 'button', class: 'btn', onclick: () => payloads(inv, preview) , disabled: !preview }, 'API payloads')));
    if (pend) panel.append(h('p', { class: 'small muted', text: 'Decide every field to enable posting.' }));
  }
  function editRow(inv, r) {
    const app = IC.app; const L = app.store.state.ledger;
    const start = r.decision === 'edit' ? r.value : Lg.effective(r);
    let input;
    sheet({
      id: 'edit-field', title: 'Edit: ' + r.label,
      isDirty: () => input && String(input.value) !== String(start == null ? '' : start),
      body: (b) => {
        if (r.kind === 'account') input = h('select', { 'aria-label': r.label }, ...L.accounts.filter((a) => a.active !== false).map((a) => h('option', { value: a.code, selected: a.code === start, text: a.code + ' ' + a.name })));
        else if (r.kind === 'tax') input = h('select', { 'aria-label': r.label }, h('option', { value: 'expense', selected: start === 'expense', text: 'Add to expense (not recoverable)' }), ...L.accounts.filter((a) => a.type === 'asset').map((a) => h('option', { value: a.code, selected: a.code === start, text: a.code + ' ' + a.name })));
        else input = h('input', { type: r.kind === 'date' ? 'date' : 'text', value: start == null ? '' : String(start), 'aria-label': r.label, autofocus: true });
        b.append(h('label', { class: 'f' }, r.label, input), h('p', { class: 'small muted', text: 'Proposed: ' + show(r, 'after', app) + (r.before !== '' ? ' \u00b7 Before: ' + show(r, 'before', app) : '') }));
      },
      actions: [{ id: 'save', label: 'Use this value', cls: 'primary', fn: (s) => {
        const v = String(input.value).trim();
        if (r.kind === 'date' && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { toast('Use a full date.'); return; }
        if (r.kind === 'number' && v && !(Number(v) > 0)) { toast('Enter a positive number.'); return; }
        IC.agent.decide(app.store, inv.id, r.key, 'edit', v); input.value = start == null ? '' : start; s.close().then(() => app.rerender());
      } }],
      cancelLabel: 'Cancel'
    });
  }
  function jeTable(entry, app, title) {
    const t = h('table', { class: 't je' }, h('thead', {}, h('tr', {}, ...['Account', 'Debit', 'Credit', 'Memo'].map((x) => h('th', { text: x })))));
    const tb = h('tbody'); t.append(tb);
    entry.lines.forEach((l) => tb.append(h('tr', {}, h('td', { 'data-label': 'Account', text: l.account + ' ' + (l.name || '') }), h('td', { 'data-label': 'Debit', class: 'num', text: l.debit ? M.format(l.debit, entry.currency) : '' }), h('td', { 'data-label': 'Credit', class: 'num', text: l.credit ? M.format(l.credit, entry.currency) : '' }), h('td', { 'data-label': 'Memo', class: 'small', text: l.memo || '' }))));
    const d = M.sum(entry.lines.map((l) => l.debit)); const c = M.sum(entry.lines.map((l) => l.credit));
    tb.append(h('tr', { class: 'tot' }, h('td', { text: 'Total' + (M.eq(d, c, 0) ? ' \u00b7 balanced' : ' \u00b7 NOT balanced') }), h('td', { class: 'num', text: M.format(d, entry.currency) }), h('td', { class: 'num', text: M.format(c, entry.currency) }), h('td', {})));
    return h('div', { class: 'je-wrap' }, h('h3', { text: title + (entry.id ? ' ' + entry.id : '') }), h('div', { class: 'small muted', text: entry.date + ' \u00b7 ' + entry.memo }), h('div', { class: 'tscroll' }, t));
  }
  function postedPanel(box, inv) {
    const app = IC.app; const L = app.store.state.ledger;
    const bill = L.bills.find((b) => b.id === inv.postedBillId); const je = L.journal.find((e) => e.billId === inv.postedBillId);
    const p = h('div', { class: 'panel', id: 'posted' }, h('div', { class: 'row' }, h('h2', { class: 'grow', style: 'margin:0', text: 'Posted ' + (bill ? bill.id : '') }), h('span', { class: 'chip ok', text: 'In local ledger' })));
    if (bill) p.append(h('p', { class: 'small', text: (bill.type === 'credit' ? 'Vendor credit' : 'Bill') + ' ' + bill.number + ' \u00b7 ' + bill.vendorName + ' \u00b7 ' + M.format(bill.total, bill.currency) + (bill.fx !== 1 ? ' = ' + M.format(bill.totalBase, app.settings().baseCurrency) + ' at ' + bill.fx : '') + (bill.due ? ' \u00b7 due ' + bill.due : '') }));
    if (je) p.append(jeTable(je, app, 'Journal entry'));
    p.append(h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', id: 'unpost-btn', onclick: () => app.unpost(inv.id) }, 'Unpost'), bill ? h('button', { type: 'button', class: 'btn', onclick: () => payloads(inv, { bill }) }, 'API payloads') : null, h('a', { class: 'btn', href: '#ledger/journal' }, 'Open ledger')));
    box.append(p);
  }
  function payloads(inv, built) {
    const app = IC.app; const L = app.store.state.ledger; const X = IC.exports;
    const bill = Object.assign({ vendorId: '' }, built.bill);
    let tab = 'qbo';
    sheet({
      id: 'payloads', title: 'API payloads \u00b7 ' + bill.number, wide: true,
      body: (b, api) => {
        const tabs = h('div', { class: 'seg' }, ...[['qbo', 'QuickBooks Online'], ['xero', 'Xero'], ['curl', 'curl']].map(([k, l]) => h('label', {}, h('input', { type: 'radio', name: 'pl', checked: tab === k, onchange: () => { tab = k; api.refresh(); } }), l)));
        const q = X.qboPayload(bill, L.accounts); const x = X.xeroPayload(bill);
        const txt = tab === 'qbo' ? 'POST ' + X.qboUrl(q.entity) + '\n\n' + JSON.stringify(q.body, null, 2) : tab === 'xero' ? 'POST ' + X.xeroUrl(x.endpoint) + '\n\n' + JSON.stringify(x.body, null, 2) : X.curlQbo(bill, L.accounts) + '\n\n' + X.curlXero(bill);
        b.append(tabs, h('pre', { class: 'box code', id: 'payload-text', text: txt }),
          h('p', { class: 'small muted', text: 'Not sent anywhere. QuickBooks needs its own Vendor and Account Ids in VendorRef/AccountRef (local codes are shown); Xero needs account codes and tax types that exist in your organisation. Push with curl and your own token, or through the self-hosted server in /server.' }),
          h('button', { type: 'button', class: 'btn sm', onclick: async () => { toast((await IC.ui.copy(txt)) ? 'Copied.' : 'Copy failed.'); } }, 'Copy'));
      }
    });
  }
  function tracePanel(box, inv) {
    const f = inv.fields;
    box.append(h('details', { class: 'panel raw' }, h('summary', { text: 'What the agent read (' + (f.rawLines || []).length + ' lines)' }),
      h('ol', { class: 'small' }, ...(inv.steps || []).map((s) => h('li', { text: s.step + (s.detail ? ': ' + s.detail : '') }))),
      h('pre', { class: 'box', text: (f.rawLines || []).join('\n') || '(no text)' })));
  }
  IC.app.views.invoice = { render };
  IC.app.jeTable = jeTable;
})(self);
