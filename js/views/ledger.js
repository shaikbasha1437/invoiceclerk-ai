/* Local ledger: bills, journal, vendors (default GL accounts), chart of accounts, trial balance. */
(function (root) {
  'use strict';
  const IC = root.IC; const { h, toast, undoToast, sheet, ask } = IC.ui; const M = IC.money; const Lg = IC.ledger;
  const TABS = [['bills', 'Bills'], ['journal', 'Journal'], ['vendors', 'Vendors'], ['accounts', 'Chart of accounts'], ['tb', 'Trial balance']];
  function render(el, sub) {
    const app = IC.app; const st = app.store; const L = st.state.ledger; const tab = TABS.some((t) => t[0] === sub) ? sub : 'bills';
    el.append(h('div', { class: 'hero' }, h('div', { class: 'grow' }, h('h1', { text: 'Ledger' }), h('p', { class: 'muted', style: 'margin:0', text: 'A small double-entry ledger kept in this browser. Nothing here is sent to QuickBooks, Xero or anyone else.' }))));
    el.append(h('nav', { class: 'subtabs', 'aria-label': 'Ledger sections' }, ...TABS.map(([k, l]) => h('a', { href: '#ledger/' + k, class: tab === k ? 'on' : '', text: l }))));
    const body = h('div', { class: 'panel' }); el.append(body);
    ({ bills, journal, vendors, accounts, tb })[tab](body, app, L);
  }
  function bills(box, app, L) {
    if (!L.bills.length) { box.append(h('p', { class: 'empty', text: 'No bills posted yet. Approve an invoice in the inbox and post it.' })); return; }
    const t = h('table', { class: 't' }, h('thead', {}, h('tr', {}, ...['Bill', 'Vendor', 'Date', 'Due', 'Amount', 'Base ' + app.settings().baseCurrency, 'Journal', ''].map((x) => h('th', { text: x })))));
    const tb = h('tbody'); t.append(tb);
    L.bills.slice().reverse().forEach((b) => tb.append(h('tr', { 'data-bill': b.id },
      h('td', { 'data-label': 'Bill' }, h('b', { text: b.id }), h('div', { class: 'small muted', text: (b.type === 'credit' ? 'Credit ' : '') + b.number })),
      h('td', { 'data-label': 'Vendor', text: b.vendorName }), h('td', { 'data-label': 'Date', text: b.date }), h('td', { 'data-label': 'Due', text: b.due || '\u2014' }),
      h('td', { 'data-label': 'Amount', class: 'num', text: M.format(b.type === 'credit' ? -b.total : b.total, b.currency) }), h('td', { 'data-label': 'Base', class: 'num', text: M.format(b.type === 'credit' ? -b.totalBase : b.totalBase, app.settings().baseCurrency) }),
      h('td', { 'data-label': 'Journal', text: b.jeId }),
      h('td', {}, b.invoiceId && app.store.get(b.invoiceId) ? h('a', { class: 'btn sm', href: '#invoice/' + b.invoiceId }, 'Invoice') : null, h('button', { type: 'button', class: 'btn sm danger', onclick: () => { if (b.invoiceId && app.store.get(b.invoiceId)) app.unpost(b.invoiceId); else { const snap = app.store.snapshot(); Lg.unpost(L, b.id); app.store.save(); undoToast('Removed ' + b.id + '.', () => { app.store.restoreSnapshot(snap); app.rerender(); }); app.rerender(); } } }, 'Unpost')))));
    box.append(h('div', { class: 'tscroll' }, t), h('p', { class: 'small muted', text: 'Accounts payable balance: ' + app.fmt(Lg.apBalance(L)) }));
  }
  function journal(box, app, L) {
    if (!L.journal.length) { box.append(h('p', { class: 'empty', text: 'No journal entries yet.' })); return; }
    L.journal.slice().reverse().forEach((e) => box.append(IC.app.jeTable(e, app, '')));
  }
  function vendors(box, app, L) {
    box.append(h('div', { class: 'row', style: 'margin-bottom:10px' }, h('p', { class: 'grow small muted', style: 'margin:0', text: 'Default accounts drive the proposal; history drives the unusual-amount check; the last four bank digits catch changed payment details.' }), h('button', { type: 'button', class: 'btn primary', id: 'add-vendor', onclick: () => editVendor(app, L, null) }, '+ Vendor')));
    const t = h('table', { class: 't' }, h('thead', {}, h('tr', {}, ...['Vendor', 'Default account', 'Currency', 'Terms', 'PO required', 'History', ''].map((x) => h('th', { text: x })))));
    const tb = h('tbody'); t.append(tb);
    L.vendors.forEach((v) => tb.append(h('tr', { 'data-vendor': v.id },
      h('td', { 'data-label': 'Vendor' }, h('b', { text: v.name }), h('div', { class: 'small muted', text: v.domain || '' })),
      h('td', { 'data-label': 'Account', text: v.defaultAccount + ' ' + Lg.acctName(L, v.defaultAccount) }), h('td', { 'data-label': 'Currency', text: v.currency || '' }), h('td', { 'data-label': 'Terms', text: v.terms || '' }), h('td', { 'data-label': 'PO', text: v.requirePO ? 'Yes' : 'No' }),
      h('td', { 'data-label': 'History', text: ((v.history || []).length + L.bills.filter((b) => b.vendorId === v.id).length) + ' bills' }),
      h('td', {}, h('button', { type: 'button', class: 'btn sm', onclick: () => editVendor(app, L, v) }, 'Edit'), h('button', { type: 'button', class: 'btn sm danger', 'aria-label': 'Delete vendor ' + v.name, onclick: () => {
        if (L.bills.some((b) => b.vendorId === v.id)) { toast('This vendor has posted bills. Unpost them first.'); return; }
        const i = L.vendors.indexOf(v); L.vendors.splice(i, 1); app.store.revalidateAll();
        undoToast('Deleted vendor ' + v.name + '.', () => { L.vendors.splice(i, 0, v); app.store.revalidateAll(); app.rerender(); }); app.rerender();
      } }, 'Delete')))));
    box.append(h('div', { class: 'tscroll' }, t));
  }
  function editVendor(app, L, v) {
    const init = v ? { name: v.name, domain: v.domain || '', defaultAccount: v.defaultAccount, currency: v.currency || 'USD', terms: v.terms || '', requirePO: !!v.requirePO, bankLast4: v.bankLast4 || '' } : { name: '', domain: '', defaultAccount: '6990', currency: app.settings().baseCurrency, terms: 'Net 30', requirePO: false, bankLast4: '' };
    const inp = {};
    const cur = () => ({ name: inp.name.value.trim(), domain: inp.domain.value.trim(), defaultAccount: inp.defaultAccount.value, currency: inp.currency.value.trim().toUpperCase(), terms: inp.terms.value.trim(), requirePO: inp.requirePO.checked, bankLast4: inp.bankLast4.value.trim() });
    sheet({
      id: 'vendor', title: v ? 'Edit vendor' : 'New vendor', isDirty: () => !!inp.name && JSON.stringify(cur()) !== JSON.stringify(init),
      body: (b) => {
        inp.name = h('input', { type: 'text', value: init.name, required: true, autofocus: true }); inp.domain = h('input', { type: 'text', value: init.domain, placeholder: 'vendor.example' });
        inp.defaultAccount = h('select', {}, ...L.accounts.filter((a) => a.active !== false).map((a) => h('option', { value: a.code, selected: a.code === init.defaultAccount, text: a.code + ' ' + a.name })));
        inp.currency = h('input', { type: 'text', value: init.currency, maxlength: '3' }); inp.terms = h('input', { type: 'text', value: init.terms }); inp.requirePO = h('input', { type: 'checkbox', checked: init.requirePO }); inp.bankLast4 = h('input', { type: 'text', value: init.bankLast4, maxlength: '4', inputmode: 'numeric', placeholder: 'e.g. 6789' });
        b.append(h('label', { class: 'f' }, 'Name (required)', inp.name), h('label', { class: 'f' }, 'Email domain', inp.domain), h('label', { class: 'f' }, 'Default GL account', inp.defaultAccount),
          h('div', { class: 'cols' }, h('label', { class: 'f' }, 'Currency', inp.currency), h('label', { class: 'f' }, 'Terms', inp.terms)),
          h('label', { class: 'f' }, 'Bank account last 4 (to catch changed bank details)', inp.bankLast4), h('label', { class: 'switch' }, inp.requirePO, 'Requires a PO on every bill'));
      },
      actions: [{ id: 'save', label: 'Save vendor', cls: 'primary', fn: (s) => {
        const c = cur(); if (!c.name) { toast('Name is required (or press Cancel).'); inp.name.focus(); return; }
        const snap = app.store.snapshot();
        if (v) Object.assign(v, c); else L.vendors.push(Object.assign({ id: 'v-' + String(++L.seq.vendor).padStart(3, '0'), aliases: [], history: [] }, c));
        app.store.revalidateAll(); Object.assign(init, c); s.close();
        undoToast(v ? 'Vendor updated.' : 'Vendor added.', () => { app.store.restoreSnapshot(snap); app.rerender(); }); app.rerender();
      } }],
      cancelLabel: 'Cancel'
    });
  }
  function accounts(box, app, L) {
    box.append(h('div', { class: 'row', style: 'margin-bottom:10px' }, h('p', { class: 'grow small muted', style: 'margin:0', text: 'Starter chart for a small business. Codes must match your accounting system before you import.' }), h('button', { type: 'button', class: 'btn primary', id: 'add-account', onclick: () => editAccount(app, L, null) }, '+ Account')));
    const t = h('table', { class: 't' }, h('thead', {}, h('tr', {}, ...['Code', 'Name', 'Type', ''].map((x) => h('th', { text: x })))));
    const tb = h('tbody'); t.append(tb);
    L.accounts.forEach((a) => tb.append(h('tr', { class: a.active === false ? 'dim' : '', 'data-account': a.code }, h('td', { 'data-label': 'Code', class: 'mono', text: a.code }), h('td', { 'data-label': 'Name', text: a.name + (a.active === false ? ' (inactive)' : '') }), h('td', { 'data-label': 'Type', text: a.type }),
      h('td', {}, h('button', { type: 'button', class: 'btn sm', onclick: () => editAccount(app, L, a) }, 'Edit'), h('button', { type: 'button', class: 'btn sm danger', 'aria-label': 'Delete account ' + a.code, onclick: () => {
        if (['2000', '1400', '1999'].includes(a.code) || Lg.accountInUse(L, a.code)) { toast('Account ' + a.code + ' is in use or required; deactivate it instead.'); return; }
        const i = L.accounts.indexOf(a); L.accounts.splice(i, 1); app.store.revalidateAll();
        undoToast('Deleted account ' + a.code + '.', () => { L.accounts.splice(i, 0, a); app.store.revalidateAll(); app.rerender(); }); app.rerender();
      } }, 'Delete')))));
    box.append(h('div', { class: 'tscroll' }, t));
  }
  function editAccount(app, L, a) {
    const init = a ? { code: a.code, name: a.name, type: a.type, active: a.active !== false } : { code: '', name: '', type: 'expense', active: true };
    const inp = {};
    const cur = () => ({ code: inp.code.value.trim(), name: inp.name.value.trim(), type: inp.type.value, active: inp.active.checked });
    sheet({
      id: 'account', title: a ? 'Edit account ' + a.code : 'New account', isDirty: () => !!inp.code && JSON.stringify(cur()) !== JSON.stringify(init),
      body: (b) => {
        inp.code = h('input', { type: 'text', value: init.code, inputmode: 'numeric', disabled: !!a, autofocus: !a }); inp.name = h('input', { type: 'text', value: init.name, autofocus: !!a });
        inp.type = h('select', {}, ...['expense', 'cogs', 'asset', 'liability', 'equity', 'income'].map((t) => h('option', { value: t, selected: t === init.type, text: t }))); inp.active = h('input', { type: 'checkbox', checked: init.active });
        b.append(h('label', { class: 'f' }, 'Code (3\u20136 digits, required)', inp.code), h('label', { class: 'f' }, 'Name (required)', inp.name), h('label', { class: 'f' }, 'Type', inp.type), h('label', { class: 'switch' }, inp.active, 'Active'));
      },
      actions: [{ id: 'save', label: 'Save account', cls: 'primary', fn: (s) => {
        const c = cur(); const snap = app.store.snapshot();
        try { if (a) { if (!c.name) throw new Error('Name is required.'); Object.assign(a, { name: c.name, type: c.type, active: c.active }); } else Lg.addAccount(L, c); }
        catch (e) { toast(e.message + ' (or press Cancel)'); return; }
        app.store.revalidateAll(); Object.assign(init, c); s.close();
        undoToast(a ? 'Account updated.' : 'Account ' + c.code + ' added.', () => { app.store.restoreSnapshot(snap); app.rerender(); }); app.rerender();
      } }],
      cancelLabel: 'Cancel'
    });
  }
  function tb(box, app, L) {
    const rows = Lg.trialBalance(L);
    if (!rows.length) { box.append(h('p', { class: 'empty', text: 'Nothing posted yet.' })); return; }
    const t = h('table', { class: 't' }, h('thead', {}, h('tr', {}, ...['Account', 'Debit', 'Credit', 'Balance'].map((x) => h('th', { text: x })))));
    const body = h('tbody'); t.append(body);
    rows.forEach((r) => body.append(h('tr', {}, h('td', { 'data-label': 'Account', text: r.account + ' ' + r.name }), h('td', { 'data-label': 'Debit', class: 'num', text: app.fmt(r.debit) }), h('td', { 'data-label': 'Credit', class: 'num', text: app.fmt(r.credit) }), h('td', { 'data-label': 'Balance', class: 'num', text: app.fmt(M.r2(r.debit - r.credit)) }))));
    const d = M.sum(rows.map((r) => r.debit)); const c = M.sum(rows.map((r) => r.credit));
    body.append(h('tr', { class: 'tot' }, h('td', { text: M.eq(d, c, 0) ? 'Totals \u00b7 balanced' : 'Totals \u00b7 NOT balanced' }), h('td', { class: 'num', text: app.fmt(d) }), h('td', { class: 'num', text: app.fmt(c) }), h('td', {})));
    box.append(h('div', { class: 'tscroll' }, t));
  }
  IC.app.views.ledger = { render };
})(self);
