// Runs pdf.js (pdfjs-dist legacy build, Node) over samples/*.pdf and stores the raw text items and the
// grouped lines in test/fixtures/pdf-text.json, so unit tests exercise the parser on real pdf.js output.
//   TOOLS_DIR=<dir with pdfjs-dist> node scripts/extract-fixtures.mjs
import { createRequire } from 'module';
import fs from 'fs'; import path from 'path'; import { fileURLToPath, pathToFileURL } from 'url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(path.join(process.env.TOOLS_DIR || repo, 'package.json'));
const pdfjs = await import(pathToFileURL(req.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
const { groupItemsToLines } = req(path.join(repo, 'js/inv/pdftext.js'));
const out = {};
for (const f of fs.readdirSync(path.join(repo, 'samples')).filter((f) => f.endsWith('.pdf')).sort()) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(repo, 'samples', f))), isEvalSupported: false }).promise;
  const pg = await doc.getPage(1); const tc = await pg.getTextContent();
  const items = tc.items.filter((i) => i.str !== undefined).map((i) => ({ str: i.str, transform: i.transform.map((n) => Math.round(n * 100) / 100), width: Math.round(i.width * 100) / 100, height: i.height }));
  out[f] = { items, lines: groupItemsToLines(items).map((l) => l.text) };
}
fs.writeFileSync(path.join(repo, 'test/fixtures/pdf-text.json'), JSON.stringify(out, null, 1));
console.log(Object.keys(out).length, 'pdfs');
