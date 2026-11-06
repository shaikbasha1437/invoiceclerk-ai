/* InvoiceClerk UI helpers: element builder, toasts with undo, sheets (modals) that close with X,
   Cancel, Esc, backdrop click and browser Back, a discard prompt for unsaved edits, and a focus trap. */
(function (root) {
  'use strict';
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    const a = attrs || {};
    for (const k of Object.keys(a)) {
      const v = a[k];
      if (v == null || v === false) continue;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'hidden' || k === 'open') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    kids.flat(Infinity).forEach((c) => { if (c == null || c === false) return; el.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return el;
  }
  function toast(text, opts) {
    const o = opts || {};
    const host = $('#toast-host');
    const t = h('div', { class: 'toast', role: 'status' }, h('span', { text }));
    let timer = null;
    const done = () => { clearTimeout(timer); t.remove(); };
    if (o.action) t.append(h('button', { type: 'button', onclick: () => { done(); o.action.fn(); } }, o.action.label));
    t.append(h('button', { type: 'button', 'aria-label': 'Dismiss', onclick: done }, '\u00d7'));
    host.append(t);
    while (host.children.length > 3) host.firstChild.remove();
    timer = setTimeout(done, o.ms || (o.action ? 9000 : 4000));
    return done;
  }
  const undoToast = (text, undo) => toast(text, { action: { label: 'Undo', fn: undo }, ms: 9000 });

  const stack = root.AgentKit.modal.createModalStack({ history: window.history, confirm: (t) => window.confirm(t) });
  window.addEventListener('popstate', () => stack.onPopState());
  let seq = 0;
  function sheet(o) {
    const id = o.id || 'sheet' + (++seq);
    if (stack.isOpen(id)) return null;
    const titleId = id + '-title';
    const body = h('div', { class: 'sheet-body' });
    const foot = h('div', { class: 'sheet-foot' });
    const box = h('div', { class: 'sheet' + (o.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1', 'data-sheet': id },
      h('div', { class: 'sheet-head' }, h('h2', { id: titleId, text: o.title }), h('button', { type: 'button', class: 'x', 'aria-label': 'Close', 'data-close': 'x', onclick: () => api.requestClose() }, '\u00d7')),
      body, foot);
    const back = h('div', { class: 'backdrop', 'data-backdrop': id });
    let downOnBack = false;
    back.addEventListener('mousedown', (e) => { downOnBack = e.target === back; });
    back.addEventListener('click', (e) => { if (e.target === back && downOnBack) api.requestClose(); downOnBack = false; });
    back.append(box);
    let prevFocus = null;
    const api = { id, el: box, body, foot, close: () => stack.close(id), requestClose: () => stack.requestClose(id), refresh: () => { body.textContent = ''; o.body && o.body(body, api); } };
    (o.actions || []).forEach((a) => foot.append(h('button', { type: 'button', class: 'btn ' + (a.cls || ''), 'data-act': a.id || null, onclick: () => a.fn(api) }, a.label)));
    foot.append(h('button', { type: 'button', class: 'btn', 'data-close': 'cancel', onclick: () => api.requestClose() }, o.cancelLabel || 'Close'));
    stack.open({
      id, isDirty: o.isDirty, confirmText: o.confirmText || 'Discard your unsaved changes?',
      show() {
        prevFocus = document.activeElement;
        $('#modal-root').append(back);
        document.body.style.overflow = 'hidden';
        o.body && o.body(body, api);
        const f = box.querySelector(o.focus || '[autofocus], .sheet-body input, .sheet-body textarea, .sheet-body select, .sheet-foot .btn.primary') || box;
        setTimeout(() => f.focus(), 0);
      },
      hide() { back.remove(); if (!stack.size) document.body.style.overflow = ''; o.onClose && o.onClose(); if (prevFocus && prevFocus.isConnected) prevFocus.focus(); }
    });
    return api;
  }
  // Yes/no in a sheet. Any close (X, Cancel, Esc, backdrop, Back) means no.
  function ask(o) {
    return new Promise((resolve) => {
      let answer = false;
      const made = sheet({
        id: 'ask', title: o.title, cancelLabel: o.cancel || 'Cancel', focus: '.sheet-foot .btn.primary',
        body: (b) => (Array.isArray(o.text) ? o.text : [o.text]).forEach((t) => b.append(h('p', { text: t }))),
        actions: [{ id: 'ok', label: o.ok || 'OK', cls: 'primary' + (o.danger ? ' danger-ok' : ''), fn: (api) => { answer = true; api.close(); } }],
        onClose: () => resolve(answer)
      });
      if (!made) resolve(false);
    });
  }
  document.addEventListener('keydown', (e) => {
    const top = stack.top();
    if (!top) return;
    if (e.key === 'Escape') { e.preventDefault(); stack.requestClose(top.id); return; }
    if (e.key === 'Tab') {
      const box = document.querySelector('[data-sheet="' + top.id + '"]');
      if (!box) return;
      const f = $$('button, [href], input, textarea, select, summary, [tabindex]:not([tabindex="-1"])', box).filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && (document.activeElement === f[0] || document.activeElement === box)) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type: type || 'application/json' }));
    const a = h('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const t = h('textarea', { style: 'position:fixed;left:-9999px' }); t.value = text; document.body.append(t); t.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { /* ignore */ }
      t.remove(); return ok;
    }
  }
  const pct = (x) => Math.round((x || 0) * 100) + '%';
  const money = (x) => (x == null ? '\u2014' : x === 0 ? '$0' : x < 0.01 ? '$' + x.toFixed(5) : '$' + x.toFixed(4));
  const ms = (x) => (x == null ? '\u2014' : x >= 1000 ? (x / 1000).toFixed(1) + ' s' : Math.round(x) + ' ms');
  const when = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  (root.IC = root.IC || {}).ui = { $, $$, h, toast, undoToast, sheet, ask, stack, download, copy, pct, money, ms, when };
})(self);
