/* PDF text layer -> reading-order lines, and browser helpers to read/render PDFs with pdf.js.
   groupItemsToLines() is pure (unit-tested with real pdf.js output fixtures). Cells on one line that
   are far apart are joined with three spaces, so the parser can tell columns apart. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.IC = root.IC || {}).pdftext = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const GAP = '   ';
  function groupItemsToLines(items, opts) {
    const o = opts || {};
    const pieces = (items || []).filter((it) => it && typeof it.str === 'string' && it.str.trim() !== '').map((it) => {
      const tf = it.transform || [1, 0, 0, 1, 0, 0];
      const size = Math.abs(tf[3]) || it.height || 10;
      return { s: it.str, x: tf[4], y: tf[5], w: it.width || it.str.length * size * 0.5, size };
    });
    pieces.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const p of pieces) {
      const row = rows.find((r) => Math.abs(r.y - p.y) <= Math.max(2, Math.min(r.size, p.size) * (o.tol || 0.45)));
      if (row) { row.items.push(p); row.size = Math.max(row.size, p.size); } else rows.push({ y: p.y, size: p.size, items: [p] });
    }
    rows.sort((a, b) => b.y - a.y);
    return rows.map((r) => {
      r.items.sort((a, b) => a.x - b.x);
      let out = ''; let end = null;
      for (const it of r.items) {
        if (end != null) {
          const gap = it.x - end;
          out += gap > it.size * 1.2 ? GAP : gap > it.size * 0.12 || !/\s$/.test(out) && !/^\s/.test(it.s) && gap > -0.5 && /\w$/.test(out) && /^\w/.test(it.s) && gap > 0.5 ? ' ' : '';
        }
        out += it.s; end = it.x + it.w;
      }
      return { text: out.replace(/\s+$/, ''), y: Math.round(r.y * 10) / 10, size: Math.round(r.size * 10) / 10 };
    });
  }
  function textChars(lines) { return lines.reduce((a, l) => a + l.text.replace(/\s/g, '').length, 0); }
  // ---- browser only ----
  let lib = null;
  async function pdfjs() {
    if (lib) return lib;
    const base = typeof document !== 'undefined' ? document.baseURI : self.location.href;
    lib = await import(new URL('vendor/pdfjs/pdf.min.mjs', base).href);
    lib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', base).href;
    return lib;
  }
  async function open(bytes) { const L = await pdfjs(); return L.getDocument({ data: bytes.slice ? bytes.slice(0) : bytes, isEvalSupported: false }).promise; }
  async function readText(bytes) {
    const doc = await open(bytes);
    const pages = [];
    for (let i = 1; i <= Math.min(doc.numPages, 10); i++) {
      const pg = await doc.getPage(i);
      const tc = await pg.getTextContent();
      const lines = groupItemsToLines(tc.items);
      const vp = pg.getViewport({ scale: 1 });
      pages.push({ n: i, lines, width: vp.width, height: vp.height });
    }
    const all = pages.flatMap((p) => p.lines);
    return { numPages: doc.numPages, pages, lines: all.map((l) => l.text), chars: textChars(all), scanned: textChars(all) < 40 };
  }
  async function renderPage(bytes, n, canvas, scale) {
    const doc = await open(bytes);
    const pg = await doc.getPage(n || 1);
    const vp = pg.getViewport({ scale: scale || 1.5 });
    canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
    await pg.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    return { numPages: doc.numPages, width: vp.width, height: vp.height };
  }
  return { groupItemsToLines, textChars, readText, renderPage, pdfjs, GAP };
});
