/* Exports: downloads for every format, per-bill API payload viewer, and the optional self-hosted push. */
(function (root) {
  'use strict';
  const IC = root.IC; const { h, toast, download, ask } = IC.ui; const X = IC.exports;
  const ui = { bill: '', kind: 'qbo' };
  function render(el) {
    const app = IC.app; const st = app.store.state; const L = st.ledger; const s = st.settings;
    el.append(h('div', { class: 'hero' }, h('div', { class: 'grow' }, h('h1', { text: 'Export' }), h('p', { class: 'muted', style: 'margin:0', text: 'Files and API payloads for your accounting system. This page never posts to QuickBooks or Xero itself.' }))));
    const n = L.bills.length; const today = new Date().toISOString().slice(0, 10);
    const dl = (label, id, fn, name, type, note) => h('div', { class: 'exp' }, h('div', { class: 'grow' }, h('b', { text: label }), h('div', { class: 'small muted', text: note })), h('button', { type: 'button', class: 'btn', 'data-export': id, disabled: !n && id !== 'json', onclick: () => { download(name, fn(), type); toast('Downloaded ' + name + '.'); } }, 'Download'));
    el.append(h('div', { class: 'panel', id: 'downloads' }, h('h2', { text: 'Downloads (' + n + ' posted bill' + (n === 1 ? '' : 's') + ')' }),
      dl('Journal (CSV)', 'journal', () => X.journalCsv(L.journal, L.accounts), 'invoiceclerk-journal-' + today + '.csv', 'text/csv', 'One row per debit/credit line, base currency.'),
      dl('QuickBooks Online bills (CSV)', 'qbo-csv', () => X.qboBillCsv(L.bills), 'invoiceclerk-qbo-bills-' + today + '.csv', 'text/csv', 'For Settings \u203a Import data \u203a Bills. Credits are not included (enter them as supplier credits).'),
      dl('QuickBooks Desktop (IIF)', 'iif', () => X.iif(L.bills, L.accounts), 'invoiceclerk-bills-' + today + '.iif', 'text/plain', 'BILL and BILL REFUND transactions. Account names must exist; try a test company file first.'),
      dl('QuickBooks Online API payloads (JSON)', 'qbo-json', () => JSON.stringify(L.bills.map((b) => Object.assign({ url: X.qboUrl(X.qboPayload(b, L.accounts).entity) }, X.qboPayload(b, L.accounts))), null, 2), 'invoiceclerk-qbo-payloads-' + today + '.json', 'application/json', 'Bill and VendorCredit bodies for the v3 Accounting API.'),
      dl('Xero bills (CSV)', 'xero-csv', () => X.xeroCsv(L.bills, { dateFormat: s.xeroDateFormat }), 'invoiceclerk-xero-bills-' + today + '.csv', 'text/csv', 'Xero\u2019s 26-column bill import template, tax exclusive with TaxAmount. Check TaxType names match your organisation.'),
      dl('Xero API payloads (JSON)', 'xero-json', () => JSON.stringify(L.bills.map((b) => X.xeroPayload(b)), null, 2), 'invoiceclerk-xero-payloads-' + today + '.json', 'application/json', 'ACCPAY Invoices and ACCPAYCREDIT CreditNotes, status DRAFT.'),
      dl('Everything (JSON)', 'json', () => X.genericJson(st, { includeBank: !s.hideBank }), 'invoiceclerk-export-' + today + '.json', 'application/json', 'Accounts, vendors, bills, journal and invoice fields. No API keys' + (s.hideBank ? '; bank details masked.' : '.'))));
    // Payload viewer
    const pv = h('div', { class: 'panel', id: 'payload-viewer' }, h('h2', { text: 'API payload + curl' }));
    if (!n) pv.append(h('p', { class: 'muted', text: 'Post a bill to see its QuickBooks Online and Xero payloads.' }));
    else {
      if (!L.bills.some((b) => b.id === ui.bill)) ui.bill = L.bills[0].id;
      const b = L.bills.find((x) => x.id === ui.bill);
      pv.append(h('div', { class: 'toolbar' },
        h('select', { 'aria-label': 'Bill', onchange: (e) => { ui.bill = e.target.value; app.rerender(); } }, ...L.bills.map((x) => h('option', { value: x.id, selected: x.id === ui.bill, text: x.id + ' \u00b7 ' + x.vendorName + ' ' + x.number }))),
        h('div', { class: 'seg' }, ...[['qbo', 'QuickBooks Online'], ['xero', 'Xero']].map(([k, l]) => h('label', {}, h('input', { type: 'radio', name: 'pk', checked: ui.kind === k, onchange: () => { ui.kind = k; app.rerender(); } }), l)))));
      const q = X.qboPayload(b, L.accounts); const x = X.xeroPayload(b);
      const body = ui.kind === 'qbo' ? q.body : x.body; const url = ui.kind === 'qbo' ? X.qboUrl(q.entity) : X.xeroUrl(x.endpoint);
      const curl = ui.kind === 'qbo' ? X.curlQbo(b, L.accounts) : X.curlXero(b);
      pv.append(h('div', { class: 'small mono', text: 'POST ' + url }), h('pre', { class: 'box code', id: 'payload-json', text: JSON.stringify(body, null, 2) }), h('h3', { text: 'curl (uses your token from environment variables)' }), h('pre', { class: 'box code', id: 'payload-curl', text: curl }),
        h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn sm', onclick: async () => toast((await IC.ui.copy(JSON.stringify(body, null, 2))) ? 'JSON copied.' : 'Copy failed.') }, 'Copy JSON'), h('button', { type: 'button', class: 'btn sm', onclick: async () => toast((await IC.ui.copy(curl)) ? 'curl copied.' : 'Copy failed.') }, 'Copy curl'),
          s.serverUrl ? h('button', { type: 'button', class: 'btn sm primary', id: 'push-btn', onclick: () => push(app, b, ui.kind) }, 'Send to my server') : null),
        h('p', { class: 'small muted', text: ui.kind === 'qbo' ? 'Replace VendorRef and AccountRef values with your QuickBooks Ids (the server can map them for you). Tax is sent as an expense line to the tax account with GlobalTaxCalculation NotApplicable.' : 'Status is DRAFT so a person approves it in Xero. CurrencyRate is foreign units per 1 ' + s.baseCurrency + '. AccountCode and TaxType must exist in your organisation.' }));
    }
    el.append(pv);
    el.append(h('div', { class: 'panel', id: 'server-info' }, h('h2', { text: 'Push for real (optional)' }),
      h('p', { text: 'A web page should not hold your QuickBooks or Xero tokens, and both APIs refuse direct browser calls. The repo includes a tiny Node server (/server, no dependencies, Dockerfile) that you run yourself with your own token. It accepts a bill from this page and forwards it.' }),
      h('pre', { class: 'box', text: 'cd server\ncp .env.example .env   # add QBO_* or XERO_* tokens, ALLOWED_ORIGIN\nnode index.js          # or: docker build -t invoiceclerk-server . && docker run -p 8787:8787 --env-file .env invoiceclerk-server' }),
      h('p', { class: 'small muted', text: 'Starts in dry-run mode (returns the payload it would send). Tested against mock QuickBooks and Xero servers only.' }),
      h('a', { class: 'btn sm', href: '#settings/server' }, s.serverUrl ? 'Server: ' + s.serverUrl : 'Set server URL')));
  }
  async function push(app, bill, kind) {
    const s = app.settings();
    const ok = await ask({ title: 'Send ' + bill.id + ' to your server?', text: ['This sends the bill to ' + s.serverUrl + ', which forwards it to ' + (kind === 'qbo' ? 'QuickBooks Online' : 'Xero') + ' if it is not in dry-run mode.', 'Only continue if that server is yours.'], ok: 'Send' });
    if (!ok) return;
    try {
      const headers = { 'content-type': 'application/json' }; const tok = app.keys.get('server'); if (tok) headers.authorization = 'Bearer ' + tok;
      const L = app.store.state.ledger;
      const payload = kind === 'qbo' ? IC.exports.qboPayload(bill, L.accounts) : IC.exports.xeroPayload(bill);
      const r = await fetch(s.serverUrl.replace(/\/+$/, '') + (kind === 'qbo' ? '/api/qbo/' + payload.entity : '/api/xero/' + payload.endpoint), { method: 'POST', headers, body: JSON.stringify(payload.body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j && j.error) || 'HTTP ' + r.status);
      toast(j.dryRun ? 'Server dry run OK: it would POST to ' + j.wouldPost : 'Server forwarded it: ' + (j.status || r.status) + (j.id ? ' id ' + j.id : ''));
    } catch (e) { toast('Server push failed: ' + e.message + ' (is it running, does ALLOWED_ORIGIN include this site, and did you allow local network access if the browser asked?)'); }
  }
  IC.app.views.export = { render };
})(self);
