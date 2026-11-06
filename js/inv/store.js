/* Persistent state in localStorage (invoice metadata, extracted fields, ledger, settings). Uploaded
   files themselves live in IndexedDB (files.js). Nothing is sent anywhere. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ledger.js'), require('./validate.js'), require('../data/samples.js'));
  else (root.IC = root.IC || {}).store = factory(root.IC.ledger, root.IC.validate, root.IC.samples);
})(typeof self !== 'undefined' ? self : this, function (Lg, V, S) {
  'use strict';
  const KEY = 'invoiceclerk.v1';
  const STATUSES = ['new', 'extracted', 'flagged', 'approved', 'posted', 'skipped'];
  const DEFAULTS = { mode: 'demo', provider: 'gemini', model: '', baseUrl: '', keyMode: 'local', theme: '', ocr: false, hideBank: true, baseCurrency: 'USD', taxTreatment: 'recoverable', requirePO: false, fxRates: { GBP: 1.27, EUR: 1.08, CAD: 0.73, AUD: 0.66 }, datePref: 'auto', serverUrl: '', xeroDateFormat: 'MDY' };
  function fresh() { return { v: 1, settings: JSON.parse(JSON.stringify(DEFAULTS)), invoices: [], ledger: Lg.createLedger({ vendors: S.VENDORS }), seq: 0 }; }
  function createStore(opts) {
    const o = opts || {};
    const storage = 'storage' in o ? o.storage : (typeof localStorage !== 'undefined' ? localStorage : null);
    let state = null;
    function load() {
      if (state) return state;
      try { const raw = storage && storage.getItem(KEY); state = raw ? JSON.parse(raw) : fresh(); } catch (e) { state = fresh(); }
      state.settings = Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), state.settings || {});
      state.ledger = state.ledger || Lg.createLedger({ vendors: S.VENDORS });
      state.invoices = state.invoices || []; state.seq = state.seq || state.invoices.length;
      return state;
    }
    function save() { try { storage && storage.setItem(KEY, JSON.stringify(state)); } catch (e) { if (o.onQuota) o.onQuota(e); } }
    const get = (id) => load().invoices.find((i) => i.id === id) || null;
    function add(rec) {
      const st = load();
      const inv = Object.assign({ id: 'inv-' + (++st.seq) + '-' + Math.random().toString(36).slice(2, 6), order: st.seq, status: 'new', notes: '', flags: [], fields: null, proposal: null, addedAt: o.now ? o.now() : new Date().toISOString() }, rec);
      st.invoices.push(inv); save(); return inv;
    }
    function update(id, patch) { const inv = get(id); if (!inv) return null; Object.assign(inv, patch); save(); return inv; }
    function remove(id) {
      const st = load(); const i = st.invoices.findIndex((x) => x.id === id);
      if (i < 0) return null;
      const [inv] = st.invoices.splice(i, 1); save();
      return { inv, index: i };
    }
    function restore(snap) { const st = load(); st.invoices.splice(Math.min(snap.index, st.invoices.length), 0, snap.inv); save(); revalidateAll(); return snap.inv; }
    function context(inv) {
      const st = load();
      return { selfId: inv.id, others: st.invoices.filter((x) => x.id !== inv.id && (x.order < inv.order || x.status === 'posted')), vendors: st.ledger.vendors, bills: st.ledger.bills, settings: st.settings, source: inv.source, text: inv.fields ? (inv.fields.rawLines || []).join('\n') : '' };
    }
    function statusFor(inv) {
      if (inv.status === 'posted' || inv.status === 'skipped') return inv.status;
      if (!inv.fields) return 'new';
      if (inv.proposal && inv.proposal.rows.length && !Lg.pending(inv.proposal).length) return 'approved';
      return inv.flags.some((f) => f.severity !== 'info') ? 'flagged' : 'extracted';
    }
    function revalidate(inv) {
      if (!inv.fields) return inv;
      inv.flags = V.validate(inv.fields, context(inv));
      inv.status = statusFor(inv);
      return inv;
    }
    function revalidateAll() { load().invoices.forEach(revalidate); save(); }
    function setSettings(patch) { Object.assign(load().settings, patch); save(); }
    function counts() { const c = { all: 0 }; STATUSES.forEach((s) => { c[s] = 0; }); load().invoices.forEach((i) => { c.all++; c[i.status] = (c[i.status] || 0) + 1; }); return c; }
    function list(filter, sort, q) {
      let xs = load().invoices.slice();
      if (filter && filter !== 'all') xs = xs.filter((i) => i.status === filter);
      if (q) { const n = q.toLowerCase(); xs = xs.filter((i) => [i.name, i.notes, i.fields && i.fields.vendor, i.fields && i.fields.invoiceNumber].join(' ').toLowerCase().includes(n)); }
      const f = (i, k) => (i.fields ? i.fields[k] : null);
      const sorters = {
        added: (a, b) => a.order - b.order,
        vendor: (a, b) => String(f(a, 'vendor') || a.name).localeCompare(String(f(b, 'vendor') || b.name)),
        date: (a, b) => String(f(a, 'issueDate') || '').localeCompare(String(f(b, 'issueDate') || '')),
        total: (a, b) => (f(b, 'total') || 0) - (f(a, 'total') || 0),
        flags: (a, b) => b.flags.filter((x) => x.severity !== 'info').length - a.flags.filter((x) => x.severity !== 'info').length || a.order - b.order,
        status: (a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || a.order - b.order
      };
      return xs.sort(sorters[sort] || sorters.added);
    }
    function reset(keepSettings) { const s = load().settings; state = fresh(); if (keepSettings) state.settings = s; save(); return state; }
    function snapshot() { return JSON.stringify(load()); }
    function restoreSnapshot(json) { state = JSON.parse(json); save(); return state; }
    return { load, save, get, add, update, remove, restore, revalidate, revalidateAll, context, statusFor, setSettings, counts, list, reset, snapshot, restoreSnapshot, get state() { return load(); } };
  }
  return { createStore, STATUSES, DEFAULTS, KEY };
});
