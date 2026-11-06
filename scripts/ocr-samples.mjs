// Pre-computes OCR text for the image samples (and the scanned PDF) with Tesseract.js, so demo mode
// can show a real OCR result offline. Output: samples/ocr/<file>.txt. The app can also run Tesseract.js
// live in the browser (Settings > OCR) on any upload.
//   TOOLS_DIR=<dir with tesseract.js> node scripts/ocr-samples.mjs
import { createRequire } from 'module';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(path.join(process.env.TOOLS_DIR || repo, 'package.json'));
const { createWorker } = req('tesseract.js');
const S = req(path.join(repo, 'js/data/samples.js'));
function jpegFromPdf(buf) { const s = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff])); const e = buf.lastIndexOf(Buffer.from([0xff, 0xd9])); return buf.subarray(s, e + 2); }
const worker = await createWorker('eng');
fs.mkdirSync(path.join(repo, 'samples/ocr'), { recursive: true });
for (const inv of S.INVOICES.filter((i) => i.kind !== 'pdf')) {
  let img = fs.readFileSync(path.join(repo, 'samples', inv.file));
  if (inv.kind === 'scan') img = jpegFromPdf(img);
  const { data } = await worker.recognize(img);
  fs.writeFileSync(path.join(repo, 'samples/ocr', inv.file + '.txt'), data.text);
  console.log('==', inv.file, Math.round(data.confidence)); console.log(data.text);
}
await worker.terminate();
