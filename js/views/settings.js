/* Settings: AI mode + provider keys, OCR, books (currency, tax, FX), privacy, server, data. */
(function (root) {
  'use strict';
  const IC = root.IC; const { h, toast, undoToast, ask, download } = IC.ui;
  const SECTIONS = [['model', 'AI model'], ['ocr', 'OCR'], ['books', 'Books & tax'], ['privacy', 'Privacy'], ['server', 'Server'], ['data', 'Data']];
  function render(el, sub) {
    const app = IC.app; const AK = app.AK; const s = app.settings(); const sec = SECTIONS.some((x) => x[0] === sub) ? sub : 'model';
    el.append(h('h1', { text: 'Settings' }));
    const wrap = h('div', { class: 'settings' }); el.append(wrap);
    wrap.append(h('nav', { class: 'snav', 'aria-label': 'Settings sections' }, ...SECTIONS.map(([k, l]) => h('a', { href: '#settings/' + k, class: sec === k ? 'on' : '', text: l }))));
    const body = h('div'); wrap.append(body);
    const panel = (title, ...kids) => h('div', { class: 'ssec panel' }, h('h2', { text: title }), ...kids);
    if (sec === 'model') {
      body.append(panel('How invoices are read',
        h('div', { class: 'seg', role: 'radiogroup' }, ...[['demo', 'Demo (no key)'], ['live', 'Live (your key)'], ['webllm', 'In-browser model']].map(([id, l]) => h('label', {}, h('input', { type: 'radio', name: 'mode', value: id, checked: s.mode === id, onchange: () => { app.saveSettings({ mode: id }); app.rerender(); } }), l))),
        h('p', { class: 'small muted', style: 'margin-top:10px', text: 'Demo: pdf.js text + rule-based parser and bundled OCR text for the image samples; works offline. Live: your own provider improves extraction on messy or scanned invoices (vision for images) and suggests account mappings. In-browser: WebLLM on WebGPU, text only, untested end-to-end.' })));
      if (s.mode === 'live') {
        const P = AK.llm.PROVIDERS; const p = s.provider in P ? s.provider : 'gemini'; const cfg = P[p]; const model = s.model || cfg.defaultModel;
        const keyIn = h('input', { type: 'password', id: 'key-input', placeholder: cfg.keyHint, value: app.keys.get(p) || '', autocomplete: 'off', 'aria-label': cfg.label + ' API key' });
        const baseIn = h('input', { type: 'url', value: s.baseUrl || cfg.baseUrl, 'aria-label': 'Base URL' });
        const modelIn = h('input', { type: 'text', value: model, list: 'models', 'aria-label': 'Model' });
        const save = () => { const patch = { model: modelIn.value.trim() }; if (p === 'compatible') patch.baseUrl = baseIn.value.trim(); app.saveSettings(patch); app.keys.set(p, keyIn.value, s.keyMode === 'session' ? 'session' : 'local'); };
        body.append(panel('Provider',
          h('label', { class: 'f' }, 'Provider', h('select', { id: 'provider', onchange: (e) => { app.saveSettings({ provider: e.target.value, model: '', baseUrl: '' }); app.rerender(); } }, ...Object.keys(P).map((k) => h('option', { value: k, selected: k === p, text: P[k].label })))),
          p === 'compatible' ? h('div', { class: 'row', style: 'margin-bottom:10px' }, ...AK.llm.PRESETS.map((pr) => h('button', { type: 'button', class: 'btn sm', onclick: () => { app.saveSettings({ baseUrl: pr.baseUrl, model: pr.model }); app.rerender(); } }, pr.label))) : null,
          p === 'compatible' ? h('label', { class: 'f' }, 'Base URL', baseIn) : null,
          h('label', { class: 'f' }, 'Model (vision-capable for scanned/image invoices)', modelIn, h('datalist', { id: 'models' }, ...cfg.models.map((m) => h('option', { value: m })))),
          h('label', { class: 'f' }, 'API key \u00b7 stored only in this browser, never in exports or links' + (cfg.keyUrl ? '' : ' (optional)'), keyIn),
          h('div', { class: 'seg', style: 'margin-bottom:10px' }, h('label', {}, h('input', { type: 'radio', name: 'km', checked: s.keyMode !== 'session', onchange: () => app.saveSettings({ keyMode: 'local' }) }), 'Remember on this device'), h('label', {}, h('input', { type: 'radio', name: 'km', checked: s.keyMode === 'session', onchange: () => app.saveSettings({ keyMode: 'session' }) }), 'This tab only')),
          h('div', { class: 'actions' },
            h('button', { type: 'button', class: 'btn primary', id: 'save-key', onclick: () => { save(); toast('Saved in this browser only.'); app.paintMode(); } }, 'Save'),
            h('button', { type: 'button', class: 'btn', id: 'test-call', onclick: async () => { save(); const out = document.getElementById('test-out'); out.textContent = 'Calling\u2026'; try { const r = await AK.llm.call(app.modelCfg(), { system: 'Reply with exactly: OK', messages: [{ role: 'user', content: 'ping' }], maxTokens: 16, temperature: 0 }, { timeoutMs: 20000 }); out.textContent = 'Provider replied: ' + String(r.text).slice(0, 60) + ' (' + r.latencyMs + ' ms)'; } catch (e) { out.textContent = e.message; } } }, 'Test call'),
            h('button', { type: 'button', class: 'btn danger', onclick: () => { app.keys.clear(p); keyIn.value = ''; toast('Key removed from this browser.'); } }, 'Remove key')),
          h('p', { class: 'small', id: 'test-out', 'aria-live': 'polite' }),
          h('p', { class: 'small muted', text: { openai: 'OpenAI: calls go from your browser to api.openai.com. Note: OpenAI\u2019s error for an invalid key has no CORS header, so a bad key shows up as a network error.', anthropic: 'Anthropic: sent with the anthropic-dangerous-direct-browser-access header, which Anthropic requires for browser calls.', gemini: 'Gemini: key sent in the x-goog-api-key header, never in the URL.', compatible: 'Ollama: start it with OLLAMA_ORIGINS set to include this site. LM Studio: turn on CORS. OpenRouter works directly.' }[p] })));
      }
      if (s.mode === 'webllm') body.append(panel('In-browser model', h('p', { class: 'small', text: 'Downloads about 1 GB on first use and runs on your GPU with WebGPU. Text only (no images), so it helps with account suggestions and text PDFs. Not tested end-to-end in this release.' }), h('button', { type: 'button', class: 'btn', onclick: async () => { const r = await AK.webllm.support(); toast(r.ok ? 'WebGPU is available.' : r.reason); } }, 'Check WebGPU')));
    }
    if (sec === 'ocr') {
      body.append(panel('OCR for scanned PDFs and images',
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', id: 'ocr-toggle', checked: s.ocr, onchange: (e) => { app.saveSettings({ ocr: e.target.checked }); toast(e.target.checked ? 'OCR on: Tesseract.js loads from jsDelivr the first time (about 15 MB).' : 'OCR off.'); } }), 'Run Tesseract.js OCR in this browser'),
        h('p', { class: 'small muted', text: 'Off by default. When off, sample images use OCR text that was pre-computed with Tesseract.js, and your own scans need live mode with a vision model or manual entry. When on, OCR runs locally; the image is not uploaded.' }),
        h('button', { type: 'button', class: 'btn', id: 'ocr-test', onclick: async () => { toast('Loading Tesseract.js\u2026'); try { await IC.ocr.load(); toast('Tesseract.js loaded.'); } catch (e) { toast(e.message); } } }, 'Test load')));
    }
    if (sec === 'books') {
      const fx = h('textarea', { id: 'fx', rows: '4', 'aria-label': 'Exchange rates' }); fx.value = Object.keys(s.fxRates).map((k) => k + ' ' + s.fxRates[k]).join('\n');
      body.append(panel('Books',
        h('label', { class: 'f' }, 'Base (books) currency', h('input', { type: 'text', maxlength: '3', value: s.baseCurrency, onchange: (e) => { const v = e.target.value.trim().toUpperCase(); if (!/^[A-Z]{3}$/.test(v)) { toast('Use a 3-letter code.'); e.target.value = s.baseCurrency; return; } app.saveSettings({ baseCurrency: v }); app.store.revalidateAll(); toast('Base currency ' + v + '.'); } })),
        h('label', { class: 'f' }, 'Tax on bills', h('select', { onchange: (e) => { app.saveSettings({ taxTreatment: e.target.value }); toast('Saved. New proposals use this.'); } }, h('option', { value: 'recoverable', selected: s.taxTreatment === 'recoverable', text: 'Recoverable: debit Input tax 1400 (VAT/GST, resale)' }), h('option', { value: 'expense', selected: s.taxTreatment === 'expense', text: 'Not recoverable: add to the expense (typical US sales tax)' })), h('span', { class: 'h', text: 'VAT/GST invoices always propose recoverable; you can change it per bill.' })),
        h('label', { class: 'f' }, 'Exchange rates to base (one per line, e.g. GBP 1.27). Sample values; replace with your rates.', fx),
        h('button', { type: 'button', class: 'btn', onclick: () => { const r = {}; let bad = ''; fx.value.split(/\n/).map((l) => l.trim()).filter(Boolean).forEach((l) => { const m = l.match(/^([A-Za-z]{3})\s*[=:,]?\s*([\d.]+)$/); if (m && Number(m[2]) > 0) r[m[1].toUpperCase()] = Number(m[2]); else bad = l; }); if (bad) { toast('Could not read: ' + bad); return; } app.saveSettings({ fxRates: r }); toast('Rates saved.'); } }, 'Save rates'),
        h('label', { class: 'switch', style: 'margin-top:12px' }, h('input', { type: 'checkbox', checked: s.requirePO, onchange: (e) => { app.saveSettings({ requirePO: e.target.checked }); app.store.revalidateAll(); } }), 'Require a PO number on every bill'),
        h('label', { class: 'f', style: 'margin-top:12px' }, 'Ambiguous dates like 03/04/2026', h('select', { onchange: (e) => app.saveSettings({ datePref: e.target.value }) }, ...[['auto', 'Auto (DMY for VAT/GBP/EUR invoices, else MDY)'], ['MDY', 'Month first (US)'], ['DMY', 'Day first']].map(([v, l]) => h('option', { value: v, selected: s.datePref === v, text: l })))),
        h('label', { class: 'f' }, 'Xero CSV date format', h('select', { onchange: (e) => app.saveSettings({ xeroDateFormat: e.target.value }) }, h('option', { value: 'MDY', selected: s.xeroDateFormat === 'MDY', text: 'MM/DD/YYYY (US org)' }), h('option', { value: 'DMY', selected: s.xeroDateFormat === 'DMY', text: 'DD/MM/YYYY (UK/AU/NZ org)' })))));
    }
    if (sec === 'privacy') {
      body.append(panel('Privacy',
        h('ul', { class: 'small' }, h('li', { text: 'Invoices are read in this browser. They are not uploaded to any server we run (there isn\u2019t one; this is a static GitHub Pages site).' }), h('li', { text: 'Uploaded files stay in IndexedDB; fields and the ledger in localStorage. Clear them under Data.' }), h('li', { text: 'Live mode sends the invoice text, and for scanned files a page image, only to the AI provider you picked, with your key.' }), h('li', { text: 'API keys are never written into exports, payloads or share links.' })),
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', id: 'hide-bank', checked: s.hideBank, onchange: (e) => { app.saveSettings({ hideBank: e.target.checked }); toast(e.target.checked ? 'Bank details hidden on screen and masked in JSON export.' : 'Bank details shown.'); } }), 'Hide bank details (show last 4 only)')));
    }
    if (sec === 'server') {
      const url = h('input', { type: 'url', id: 'server-url', value: s.serverUrl, placeholder: 'http://localhost:8787' }); const tok = h('input', { type: 'password', value: app.keys.get('server') || '', placeholder: 'SERVER_TOKEN from your .env (optional)', autocomplete: 'off' });
      body.append(panel('Self-hosted server (optional)',
        h('p', { class: 'small muted', text: 'Only needed to push bills to QuickBooks Online or Xero. Run /server from the repo yourself; it holds your accounting tokens, not this page.' }),
        h('label', { class: 'f' }, 'Server URL', url), h('label', { class: 'f' }, 'Shared token', tok),
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn primary', id: 'save-server', onclick: () => { app.saveSettings({ serverUrl: url.value.trim() }); app.keys.set('server', tok.value, 'local'); toast('Saved.'); } }, 'Save'),
          h('button', { type: 'button', class: 'btn', id: 'check-server', onclick: async () => { try { const r = await fetch(url.value.trim().replace(/\/+$/, '') + '/health'); const j = await r.json(); toast('Server OK: ' + (j.dryRun ? 'dry-run' : 'live') + ' \u00b7 QuickBooks ' + (j.qbo ? 'configured' : 'not set') + ' \u00b7 Xero ' + (j.xero ? 'configured' : 'not set')); } catch (e) { toast('Could not reach the server: ' + e.message + '. Is it running, does ALLOWED_ORIGIN include this site, and did you allow local network access if the browser asked?'); } } }, 'Check'))));
    }
    if (sec === 'data') {
      body.append(panel('Data',
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn', onclick: () => download('invoiceclerk-backup.json', IC.exports.genericJson(app.store.state, { includeBank: !s.hideBank }), 'application/json') }, 'Download backup (JSON)'),
          h('button', { type: 'button', class: 'btn danger', id: 'reset-all', onclick: async () => {
            const ok = await ask({ title: 'Clear all invoices and the ledger?', text: 'Removes every invoice, bill, journal entry and vendor change in this browser, and restores the starter chart and demo vendors. Settings and keys stay. You can undo right after.', ok: 'Clear', danger: true });
            if (!ok) return; const snap = app.store.snapshot(); app.store.reset(true);
            undoToast('Cleared. Starter data restored.', () => { app.store.restoreSnapshot(snap); app.rerender(); }); app.rerender();
          } }, 'Clear everything')),
        h('p', { class: 'small muted', text: 'Uploaded files are removed from IndexedDB when you delete their invoice.' })));
    }
  }
  IC.app.views.settings = { render };
})(self);
