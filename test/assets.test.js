'use strict';
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const { S, root } = require('./helpers.js');
test('every sample file exists and is a real PDF / PNG / JPEG', () => {
  for (const s of S.INVOICES) {
    const b = fs.readFileSync(path.join(root, 'samples', s.file));
    if (/\.pdf$/.test(s.file)) assert.strictEqual(b.subarray(0, 5).toString(), '%PDF-', s.file);
    if (/\.png$/.test(s.file)) assert.strictEqual(b.subarray(1, 4).toString(), 'PNG');
    if (/\.jpg$/.test(s.file)) assert.deepStrictEqual([...b.subarray(0, 3)], [0xff, 0xd8, 0xff]);
    if (s.kind !== 'pdf') assert.ok(fs.existsSync(path.join(root, 'samples/ocr', s.file + '.txt')), 'bundled OCR for ' + s.file);
  }
  assert.ok(S.INVOICES.filter((s) => /\.pdf$/.test(s.file)).length >= 8); assert.ok(S.INVOICES.filter((s) => /\.(png|jpg)$/.test(s.file)).length >= 1);
});
test('demo data is fictional: .example emails, no real-looking bank numbers', () => {
  S.INVOICES.forEach((s) => { assert.match(s.vendorEmail, /\.example$/); (s.payment || []).join(' ').replace(/\d+/g, (n) => { if (n.length >= 9) assert.match(n, /^00/, n); return n; }); });
});
test('service worker caches every app file, sample and vendored pdf.js', () => {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const assets = JSON.parse(sw.match(/const ASSETS = (\[[^\]]*\]);/)[1]);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  [...html.matchAll(/src="([^"]+)"/g)].map((m) => './' + m[1]).filter((s) => s.startsWith('./js')).forEach((s) => assert.ok(assets.includes(s), s));
  S.INVOICES.forEach((s) => assert.ok(assets.includes('./samples/' + s.file), s.file));
  ['./vendor/pdfjs/pdf.min.mjs', './vendor/pdfjs/pdf.worker.min.mjs', './index.html', './'].forEach((a) => assert.ok(assets.includes(a), a));
  assets.forEach((a) => assert.ok(a === './' || fs.existsSync(path.join(root, a)), 'exists ' + a));
  assert.match(sw, /const CACHE = 'invoiceclerk-ai-v\d+'/);
});
test('no absolute paths in the PWA files', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8'); assert.ok(!/(src|href)="\//.test(html));
  const man = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8')); assert.strictEqual(man.start_url, './'); man.icons.forEach((i) => assert.ok(!i.src.startsWith('/')));
});
