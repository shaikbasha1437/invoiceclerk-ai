/* Inbox: drop zone, sample loader, KPIs, filter/sort/search, batch list with statuses. */
(function (root) {
  'use strict';
  const IC = root.IC; const { h } = IC.ui;
  const LABEL = { new: 'New', extracted: 'Extracted', flagged: 'Flagged', approved: 'Approved', posted: 'Posted', skipped: 'Skipped' };
  const CHIP = { new: '', extracted: 'info', flagged: 'warn', approved: 'brand', posted: 'ok', skipped: '' };
  const ui = { filter: 'all', sort: 'added', q: '' };
  function statusChip(s) { return h('span', { class: 'chip ' + (CHIP[s] || ''), 'data-status': s, text: LABEL[s] || s }); }
  function flagChips(inv) {
    const e = inv.flags.filter((f) => f.severity === 'error').length; const w = inv.flags.filter((f) => f.severity === 'warn').length;
    return [e ? h('span', { class: 'chip stop', title: inv.flags.filter((f) => f.severity === 'error').map((f) => f.label).join('\n'), text: e + ' blocking' }) : null, w ? h('span', { class: 'chip warn', title: inv.flags.filter((f) => f.severity === 'warn').map((f) => f.label).join('\n'), text: w + ' warning' + (w > 1 ? 's' : '') }) : null];
  }
  function render(el) {
    const app = IC.app; const st = app.store; const c = st.counts();
    const L = st.state.ledger;
    el.append(h('div', { class: 'hero' }, h('div', { class: 'grow' }, h('h1', { text: 'Invoice inbox' }), h('p', { class: 'muted', style: 'margin:0', text: 'Drop invoices, check what the agent read, approve the bill, post it to your local ledger.' }))));
    el.append(h('div', { class: 'kpis' },
      kpi(c.all, 'Invoices'), kpi(c.flagged, 'Need a look', c.flagged ? 'warn' : ''), kpi(c.extracted + c.approved, 'Ready to approve / post'), kpi(c.posted, 'Posted'), kpi(app.fmt(IC.ledger.apBalance(L)), 'Accounts payable (local)')));
    const input = h('input', { type: 'file', id: 'file-input', accept: 'application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp', multiple: true, class: 'visually-hidden', onchange: (e) => { app.ingest(e.target.files); e.target.value = ''; } });
    const drop = h('div', { class: 'drop', id: 'drop', tabindex: '0', role: 'button', 'aria-label': 'Add invoice files', onclick: () => input.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } } },
      h('div', { class: 'big', text: '\ud83e\uddfe' }), h('b', { text: 'Drop invoice PDFs or images here' }), h('div', { class: 'small', text: 'PDF, PNG, JPG or WebP \u00b7 many at once \u00b7 files stay in this browser' }));
    ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => app.ingest(e.dataTransfer.files));
    el.append(h('div', { class: 'ingest' }, drop, input,
      h('div', { class: 'panel sample-box' },
        h('h3', { text: 'Try the demo' }),
        h('p', { class: 'small muted', text: '11 fictional invoices: 9 PDFs (one scanned) and 2 images, with clean ones plus totals that don\u2019t add up, a duplicate, a missing PO, a credit note, a GBP invoice and a hidden prompt-injection note.' }),
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn primary', id: 'load-samples', disabled: !!app.busy, onclick: () => app.loadSamples() }, 'Load sample invoices'),
          h('a', { class: 'btn', href: '#samples' }, 'Download the files')))));
    el.append(h('div', { class: 'busy notice', id: 'busy', hidden: !app.busy, text: app.busy || '' }));
    if (!c.all) { el.append(h('div', { class: 'empty panel' }, h('div', { class: 'big', text: '\ud83d\udced' }), h('p', { text: 'No invoices yet. Drop some files or load the samples.' }))); return; }
    const filters = ['all', 'new', 'extracted', 'flagged', 'approved', 'posted', 'skipped'];
    el.append(h('div', { class: 'toolbar' },
      h('div', { class: 'seg filters', role: 'group', 'aria-label': 'Filter by status' }, ...filters.map((f) => h('label', {}, h('input', { type: 'radio', name: 'flt', value: f, checked: ui.filter === f, onchange: () => { ui.filter = f; IC.app.rerender(); } }), (f === 'all' ? 'All' : LABEL[f]) + ' ' + (c[f] || 0)))),
      h('input', { type: 'search', placeholder: 'Search vendor, number, notes', 'aria-label': 'Search', value: ui.q, oninput: (e) => { ui.q = e.target.value; paintList(); } }),
      h('select', { 'aria-label': 'Sort', onchange: (e) => { ui.sort = e.target.value; paintList(); } }, ...[['added', 'Added'], ['status', 'Status'], ['flags', 'Most flags'], ['vendor', 'Vendor'], ['date', 'Invoice date'], ['total', 'Largest total']].map(([v, l]) => h('option', { value: v, selected: ui.sort === v, text: 'Sort: ' + l }))),
      c.new ? h('button', { type: 'button', class: 'btn', onclick: () => app.processNew() }, 'Read ' + c.new + ' new') : null));
    const listEl = h('div', { id: 'inv-list' });
    el.append(listEl);
    function paintList() {
      listEl.textContent = '';
      const xs = st.list(ui.filter, ui.sort, ui.q);
      if (!xs.length) { listEl.append(h('p', { class: 'empty', text: 'Nothing matches.' })); return; }
      const t = h('table', { class: 't inbox' }, h('thead', {}, h('tr', {}, ...['Invoice', 'Vendor', 'Date', 'Total', 'Status', 'Flags', ''].map((x) => h('th', { text: x })))));
      const tb = h('tbody'); t.append(tb);
      xs.forEach((inv) => {
        const f = inv.fields || {};
        tb.append(h('tr', { 'data-id': inv.id, class: inv.status === 'skipped' ? 'dim' : '' },
          h('td', { 'data-label': 'Invoice' }, h('a', { href: '#invoice/' + inv.id, class: 'inv-link' }, h('b', { text: f.invoiceNumber || inv.name })), h('div', { class: 'small muted ellip', text: inv.name + (inv.demo ? ' \u00b7 sample' : '') + (f.docType === 'credit_note' ? ' \u00b7 credit note' : '') }), inv.notes ? h('div', { class: 'small note-line', text: '\ud83d\udcdd ' + inv.notes }) : null),
          h('td', { 'data-label': 'Vendor', text: f.vendor || '\u2014' }),
          h('td', { 'data-label': 'Date', text: f.issueDate || '\u2014' }),
          h('td', { 'data-label': 'Total', class: 'num', text: f.total != null ? app.fmt(f.docType === 'credit_note' ? -f.total : f.total, f.currency || undefined) : '\u2014' }),
          h('td', { 'data-label': 'Status' }, statusChip(inv.status)),
          h('td', { 'data-label': 'Flags' }, ...flagChips(inv)),
          h('td', { class: 'row-acts' },
            h('a', { class: 'btn sm', href: '#invoice/' + inv.id }, 'Review'),
            h('button', { type: 'button', class: 'btn sm ghost', title: 'Notes', 'aria-label': 'Notes for ' + inv.name, onclick: () => app.notes(inv.id) }, '\ud83d\udcdd'),
            h('button', { type: 'button', class: 'btn sm ghost', title: inv.status === 'skipped' ? 'Unskip' : 'Skip', 'aria-label': (inv.status === 'skipped' ? 'Unskip ' : 'Skip ') + inv.name, onclick: () => app.skip(inv.id), disabled: inv.status === 'posted' }, inv.status === 'skipped' ? '\u21a9' : '\u23ed'),
            h('button', { type: 'button', class: 'btn sm ghost danger', title: 'Delete', 'aria-label': 'Delete ' + inv.name, onclick: () => app.remove(inv.id), disabled: inv.status === 'posted' }, '\ud83d\uddd1'))));
      });
      listEl.append(t);
    }
    paintList();
    el.append(h('p', { class: 'small muted', style: 'margin-top:12px', text: 'Privacy: invoices are read in this browser with pdf.js. They are not uploaded to a server we run; in live mode only the provider you pick sees the text or image you send it.' }));
  }
  function kpi(v, k, cls) { return h('div', { class: 'kpi ' + (cls || '') }, h('div', { class: 'v', text: String(v) }), h('div', { class: 'k', text: k })); }
  function renderSamples(el) {
    const S = IC.samples.INVOICES;
    el.append(h('h1', { text: 'Sample invoices' }), h('p', { class: 'muted', text: 'Real files generated with pdf-lib and headless Chromium from js/data/samples.js. All vendors, people and bank numbers are fictional.' }));
    const t = h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', { text: 'File' }), h('th', { text: 'What it tests' }), h('th', { text: '' }))));
    const tb = h('tbody'); t.append(tb);
    S.forEach((s) => tb.append(h('tr', {}, h('td', { 'data-label': 'File' }, h('b', { text: s.file })), h('td', { 'data-label': 'Tests', text: s.story }), h('td', {}, h('a', { class: 'btn sm', href: 'samples/' + s.file, download: s.file }, 'Download')))));
    el.append(h('div', { class: 'panel', style: 'overflow-x:auto' }, t), h('p', {}, h('a', { href: '#inbox' }, '\u2190 Back to the inbox')));
  }
  IC.app.views.inbox = { render };
  IC.app.views.samples = { render: renderSamples };
  IC.app.statusChip = statusChip;
})(self);
