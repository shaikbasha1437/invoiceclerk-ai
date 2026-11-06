'use strict';
const fs = require('fs'); const path = require('path');
const root = path.resolve(__dirname, '..');
const S = require('../js/data/samples.js');
const fixtures = require('./fixtures/pdf-text.json');
function linesFor(file) {
  if (fixtures[file] && fixtures[file].lines.join('').trim()) return fixtures[file].lines;
  const p = path.join(root, 'samples/ocr', file + '.txt');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split(/\r?\n/) : [];
}
function memStorage() { return { d: {}, getItem(k) { return k in this.d ? this.d[k] : null; }, setItem(k, v) { this.d[k] = String(v); }, removeItem(k) { delete this.d[k]; } }; }
const deps = {
  readPdf: async (bytes, inv) => ({ lines: [], scanned: true }),
};
function depsFor() {
  return {
    readPdf: async function () { return { lines: this._lines || [], scanned: !(this._lines || []).join('').trim() }; },
  };
}
// Pipeline deps that read the committed pdf.js fixtures and bundled OCR texts.
function fixtureDeps() {
  return {
    current: null,
    readPdf: async () => { throw new Error('set per call'); },
    demoOcr: async (inv) => { const p = path.join(root, 'samples/ocr', inv.sample + '.txt'); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; }
  };
}
async function loadAllSamples(store, agent) {
  const added = [];
  for (const s of S.INVOICES) {
    const inv = store.add({ name: s.file, kind: s.kind === 'pdf' || s.kind === 'scan' ? 'pdf' : 'image', demo: true, sample: s.file });
    const lines = fixtures[s.file] ? fixtures[s.file].lines : [];
    await agent.extract(store, inv.id, null, { readPdf: async () => ({ lines, scanned: !lines.join('').trim() }), demoOcr: fixtureDeps().demoOcr });
    added.push(store.get(inv.id));
  }
  return added;
}
module.exports = { root, S, fixtures, linesFor, memStorage, deps, depsFor, loadAllSamples };
