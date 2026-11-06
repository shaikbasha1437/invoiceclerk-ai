/* InvoiceClerk AI app core: state, routing, the ingest/extract pipeline, posting with undo, shared widgets. */
(function (root) {
  'use strict';
  const IC = root.IC; const { $, $$, h, toast, undoToast, sheet, ask } = IC.ui;
  const AK = root.AgentKit;
  const keys = AK.keystore.createKeyStore({ prefix: 'invoiceclerk' });
  const store = IC.store.createStore({ onQuota: () => toast('Browser storage is full. Export your data, then delete some invoices.') });
  const app = { views: {}, keys, store, busy: null, route: { tab: 'inbox', param: '' }, urls: {} };
  IC.app = app;
  const PROVIDER_IDS = Object.keys(AK.llm.PROVIDERS);
  app.knownKeys = () => PROVIDER_IDS.concat(['server']).map((p) => keys.get(p)).filter(Boolean);
  app.settings = () => store.state.settings;
  app.saveSettings = (patch) => { store.setSettings(patch); app.paintMode(); };
  app.fmt = (n, c) => IC.money.format(n, c || app.settings().baseCurrency);
  app.modelCfg = () => {
    const s = app.settings(); const p = s.provider in AK.llm.PROVIDERS ? s.provider : 'gemini'; const P = AK.llm.PROVIDERS[p];
    return { provider: p, model: s.model || P.defaultModel, baseUrl: p === 'compatible' ? (s.baseUrl || P.baseUrl) : '', key: keys.get(p), referer: location.origin + location.pathname, title: 'InvoiceClerk AI' };
  };
  app.llm = () => {
    const s = app.settings();
    if (s.mode === 'live') {
      const c = app.modelCfg(); const P = AK.llm.PROVIDERS[c.provider];
      if (P.needsKey && !c.key) return { error: 'Live mode needs your ' + P.label + ' API key. Add it in Settings, or switch back to demo mode.' };
      return { label: P.label, model: c.model, vision: true, call: (msg) => AK.llm.call(c, msg, { timeoutMs: 120000 }) };
    }
    if (s.mode === 'webllm') { const model = s.model && /MLC/.test(s.model) ? s.model : AK.webllm.MODELS[0].id; return { label: 'In-browser (WebLLM)', model, vision: false, call: (msg) => AK.webllm.call({ model, onProgress: (p) => { app.webllmText = p.text || ''; } }, Object.assign({}, msg, { images: undefined })) }; }
    return null;
  };
  app.modeLabel = () => { const s = app.settings(); if (s.mode === 'live') { const c = app.modelCfg(); return 'Live \u00b7 ' + AK.llm.PROVIDERS[c.provider].label + ' \u00b7 ' + c.model; } if (s.mode === 'webllm') return 'In-browser model'; return 'Demo mode \u00b7 no key'; };
  app.paintMode = () => { const c = $('#mode-chip'); if (!c) return; c.textContent = app.modeLabel(); c.className = 'mode-chip ' + (app.settings().mode === 'demo' ? 'demo' : 'live'); };
  app.go = (hash) => { if (location.hash === hash) app.refresh(); else location.hash = hash; };
  app.parseRoute = () => { const raw = (location.hash || '#inbox').replace(/^#/, ''); const [tab, param] = raw.split('/'); app.route = { tab: tab || 'inbox', param: decodeURIComponent(param || '') }; };
  app.paintBadges = () => { const c = store.counts(); $$('[data-badge=flagged]').forEach((b) => { b.textContent = c.flagged; b.hidden = !c.flagged; }); };
  app.refresh = () => {
    app.parseRoute(); app.paintMode(); app.paintBadges();
    const tab = app.route.tab === 'invoice' ? 'inbox' : app.route.tab;
    $$('.tabs a, .bottom-tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
    const view = $('#view'); const y = app.keepScroll ? window.scrollY : 0;
    view.textContent = '';
    const v = app.views[app.route.tab] || app.views.inbox;
    v.render(view, app.route.param);
    if (app.keepScroll) { window.scrollTo(0, y); app.keepScroll = false; }
  };
  app.rerender = () => { app.keepScroll = true; app.refresh(); };
  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); app.refresh(); });

  // ---------- files ----------
  const kindOf = (file) => { const t = (file.type || '').toLowerCase(); const n = (file.name || '').toLowerCase(); if (t === 'application/pdf' || n.endsWith('.pdf')) return 'pdf'; if (/^image\/(png|jpe?g|webp)$/.test(t) || /\.(png|jpe?g|webp)$/.test(n)) return 'image'; return ''; };
  const mimeOf = (name) => (/\.pdf$/i.test(name) ? 'application/pdf' : /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg');
  app.bytes = async (inv) => {
    if (inv.demo) { const r = await fetch('samples/' + encodeURIComponent(inv.sample)); if (!r.ok) throw new Error('Could not load sample ' + inv.sample + ' (' + r.status + ')'); return new Uint8Array(await r.arrayBuffer()); }
    const blob = await IC.files.get(inv.blobKey); if (!blob) throw new Error('The original file is no longer in this browser.');
    return new Uint8Array(await blob.arrayBuffer());
  };
  app.blobUrl = async (inv) => { if (app.urls[inv.id]) return app.urls[inv.id]; const b = await app.bytes(inv); app.urls[inv.id] = URL.createObjectURL(new Blob([b], { type: inv.mime })); return app.urls[inv.id]; };
  async function canvasToB64(canvas, max) {
    let c = canvas; const m = max || 1600;
    if (Math.max(c.width, c.height) > m) { const k = m / Math.max(c.width, c.height); const d = document.createElement('canvas'); d.width = Math.round(c.width * k); d.height = Math.round(c.height * k); d.getContext('2d').drawImage(c, 0, 0, d.width, d.height); c = d; }
    return c.toDataURL('image/jpeg', 0.85).split(',')[1];
  }
  app.pageImage = async (inv) => {
    const bytes = await app.bytes(inv); const canvas = document.createElement('canvas');
    if (inv.kind === 'pdf') await IC.pdftext.renderPage(bytes, 1, canvas, 2);
    else { const img = new Image(); img.src = URL.createObjectURL(new Blob([bytes], { type: inv.mime })); await img.decode(); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight; canvas.getContext('2d').drawImage(img, 0, 0); URL.revokeObjectURL(img.src); }
    return canvas;
  };
  app.deps = () => ({
    readPdf: (bytes) => IC.pdftext.readText(bytes),
    demoOcr: async (inv) => { if (!inv.demo || app.settings().ocr) return null; try { const r = await fetch('samples/ocr/' + encodeURIComponent(inv.sample) + '.txt'); return r.ok ? r.text() : null; } catch (e) { return null; } },
    ocr: app.settings().ocr ? async (inv) => { app.setBusy('OCR: loading Tesseract.js\u2026'); const canvas = await app.pageImage(inv); return IC.ocr.recognize(canvas, (m) => { if (m && m.status) app.setBusy('OCR: ' + m.status + (m.progress ? ' ' + Math.round(m.progress * 100) + '%' : '')); }); } : null
  });
  app.setBusy = (text) => { app.busy = text; const b = $('#busy'); if (b) { b.textContent = text || ''; b.hidden = !text; } };
  app.extract = async (id) => {
    const inv = store.get(id);
    try { const bytes = inv.kind === 'pdf' ? await app.bytes(inv) : null; await IC.agent.extract(store, id, bytes, app.deps()); }
    catch (e) { store.update(id, { error: e.message }); toast('Could not read ' + inv.name + ': ' + e.message); }
  };
  app.ingest = async (fileList) => {
    const files = Array.from(fileList || []); const added = [];
    for (const f of files) {
      const kind = kindOf(f);
      if (!kind) { toast(f.name + ': only PDF, PNG, JPG or WebP files.'); continue; }
      if (f.size > 25 * 1024 * 1024) { toast(f.name + ' is over 25 MB.'); continue; }
      const key = 'f-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      await IC.files.put(key, f);
      added.push(store.add({ name: f.name, kind, mime: f.type || mimeOf(f.name), size: f.size, blobKey: key, demo: false }));
    }
    for (let i = 0; i < added.length; i++) { app.setBusy('Reading ' + (i + 1) + ' of ' + added.length + ': ' + added[i].name); await app.extract(added[i].id); }
    app.setBusy(''); if (added.length) toast(added.length + ' invoice' + (added.length === 1 ? '' : 's') + ' added. Files stay in this browser.');
    app.rerender(); return added;
  };
  app.loadSamples = async () => {
    const S = IC.samples.INVOICES; const added = [];
    S.forEach((s) => added.push(store.add({ name: s.file, kind: s.kind === 'pdf' || s.kind === 'scan' ? 'pdf' : 'image', mime: mimeOf(s.file), demo: true, sample: s.file, story: s.story })));
    app.rerender();
    for (let i = 0; i < added.length; i++) { app.setBusy('Reading sample ' + (i + 1) + ' of ' + added.length + '\u2026'); await app.extract(added[i].id); }
    app.setBusy(''); app.rerender();
    const c = store.counts(); toast('Loaded ' + added.length + ' fictional invoices: ' + c.flagged + ' flagged, ' + (c.extracted + c.approved) + ' clean.');
    return added;
  };
  app.processNew = async () => { const xs = store.state.invoices.filter((i) => i.status === 'new'); for (const x of xs) { app.setBusy('Reading ' + x.name); await app.extract(x.id); } app.setBusy(''); app.rerender(); };

  // ---------- actions with undo ----------
  app.post = async (id) => {
    const inv = store.get(id); if (!inv) return;
    const errs = inv.flags.filter((f) => f.severity === 'error'); const warns = inv.flags.filter((f) => f.severity === 'warn');
    let override = false;
    if (errs.length || warns.length) {
      const ok = await ask({ title: errs.length ? 'Post despite blocking flags?' : 'Post with warnings?', text: [(errs.length ? errs.length + ' blocking: ' + errs.map((e) => e.label).join('; ') + '. ' : '') + (warns.length ? warns.length + ' warning(s): ' + warns.map((e) => e.label).join('; ') + '.' : ''), 'Posting only changes the local ledger in this browser. You can undo it.'], ok: errs.length ? 'Post anyway' : 'Post', danger: !!errs.length });
      if (!ok) return null;
      override = true;
    }
    try {
      const r = IC.agent.post(store, id, { override });
      undoToast('Posted ' + r.bill.id + ' and ' + r.entry.id + ' (' + app.fmt(r.bill.totalBase) + ').', () => { IC.agent.unpost(store, id); toast('Unposted ' + r.bill.id + '.'); app.rerender(); });
      app.rerender(); return r;
    } catch (e) { toast(e.message); return null; }
  };
  app.unpost = (id) => {
    const inv = store.get(id); const snap = store.snapshot();
    const r = IC.agent.unpost(store, id); if (!r) return;
    undoToast('Unposted ' + r.bill.id + ' (journal ' + (r.entry ? r.entry.id : '') + ' removed).', () => { store.restoreSnapshot(snap); app.rerender(); });
    app.rerender(); return inv;
  };
  app.remove = async (id) => {
    const inv = store.get(id); if (!inv) return;
    if (inv.status === 'posted') { toast('Unpost this invoice before deleting it.'); return; }
    const snap = store.remove(id); store.revalidateAll();
    undoToast('Deleted ' + inv.name + '.', () => { store.restore(snap); app.rerender(); });
    if (!inv.demo) setTimeout(() => { if (!store.get(id)) IC.files.del(inv.blobKey).catch(() => {}); }, 10000);
    if (app.route.tab === 'invoice') app.go('#inbox'); else app.rerender();
  };
  app.skip = (id) => {
    const inv = store.get(id); const prev = inv.status;
    if (prev === 'skipped') { inv.status = 'new'; store.revalidate(inv); store.revalidateAll(); toast('Back in the inbox.'); app.rerender(); return; }
    if (prev === 'posted') { toast('Unpost it first.'); return; }
    inv.status = 'skipped'; store.revalidateAll();
    undoToast('Skipped ' + inv.name + '.', () => { inv.status = prev; store.revalidate(inv); store.revalidateAll(); app.rerender(); });
    app.rerender();
  };
  app.notes = (id) => {
    const inv = store.get(id); let ta;
    sheet({
      id: 'notes', title: 'Notes \u00b7 ' + inv.name, isDirty: () => ta && ta.value !== (inv.notes || ''),
      body: (b) => { ta = h('textarea', { 'aria-label': 'Notes', placeholder: 'e.g. Asked vendor for corrected total', autofocus: true }); ta.value = inv.notes || ''; b.append(ta, h('p', { class: 'small muted', text: 'Notes stay in this browser and are included in the JSON export.' })); },
      actions: [{ id: 'save', label: 'Save notes', cls: 'primary', fn: (s) => { store.update(id, { notes: ta.value.trim() }); ta.value = inv.notes; s.close(); toast('Notes saved.'); app.rerender(); } }],
      cancelLabel: 'Cancel'
    });
  };
  app.about = () => sheet({
    id: 'about', title: 'About InvoiceClerk AI',
    body: (b) => b.append(
      h('p', { text: 'InvoiceClerk reads invoice PDFs and images in your browser, checks them, and proposes a bill and journal entry for a small local ledger. You approve, reject or edit every field before anything posts.' }),
      h('p', { text: 'Your files are not uploaded to any server we run. In live mode, the invoice text (and an image for scanned files) goes only to the AI provider you choose, with your own key.' }),
      h('p', { text: 'The page never posts to QuickBooks or Xero. Exports and API payloads are for you to import, or to push through the optional self-hosted server with your own token.' }),
      h('p', { text: 'Demo invoices are fictional: made-up vendors on .example domains and documentation-style bank numbers.' }),
      h('p', { class: 'small muted', text: 'MIT licensed. pdf.js (Apache-2.0) is bundled; Tesseract.js is loaded from jsDelivr only if you turn OCR on.' }))
  });
  app.h = h; app.toast = toast; app.undoToast = undoToast; app.sheet = sheet; app.ask = ask; app.AK = AK;
})(self);
