// Generates the fictional demo invoices in samples/ from js/data/samples.js.
//   npm i -D pdf-lib playwright   (playwright only for the PNG/JPG/scanned samples)
//   node scripts/make-samples.mjs
// Text PDFs are drawn with pdf-lib. Image samples are rendered from HTML with headless Chromium;
// the "scanned" PDF embeds such a JPG with no text layer.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const req = createRequire(path.join(process.env.TOOLS_DIR || repo, 'package.json'));
const { PDFDocument, StandardFonts, rgb } = req('pdf-lib');
const S = req(path.join(repo, 'js/data/samples.js'));
const out = path.join(repo, 'samples');
fs.mkdirSync(out, { recursive: true });

const DATE_FMT = { 'Northwind Office Supply': 'long', 'Cloudnest Software Inc.': 'iso', 'Metro Power & Light': 'full', 'Thamesbridge Travel Ltd': 'dmy' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function fmtDate(iso, vendor) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const f = DATE_FMT[vendor] || 'mdy';
  if (f === 'iso') return iso;
  if (f === 'long') return MON[m - 1] + ' ' + d + ', ' + y;
  if (f === 'full') return MONTH[m - 1] + ' ' + d + ', ' + y;
  if (f === 'dmy') return String(d).padStart(2, '0') + '/' + String(m).padStart(2, '0') + '/' + y;
  return String(m).padStart(2, '0') + '/' + String(d).padStart(2, '0') + '/' + y;
}
const sym = (c) => ({ USD: '$', GBP: '£', EUR: '€' }[c] || c + ' ');
const num = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyStr = (q) => (Number.isInteger(q) ? String(q) : String(q));
export function model(inv) {
  const credit = /credit/i.test(inv.title);
  const meta = [[credit ? 'Credit note #' : 'Invoice #', inv.number], [credit ? 'Credit date' : 'Invoice date', fmtDate(inv.issueDate, inv.vendor)]];
  if (inv.dueDate) meta.push(['Due date', fmtDate(inv.dueDate, inv.vendor)]);
  if (inv.reference) meta.push(['Reference', inv.reference]);
  if (inv.po) meta.push(['PO number', inv.po]);
  if (inv.terms) meta.push(['Terms', inv.terms]);
  const taxLine = inv.taxRate ? inv.taxLabel + ' (' + inv.taxRate + '%)' : inv.taxLabel;
  const totals = [['Subtotal', num(inv.subtotal)], [taxLine, num(inv.tax)], [(credit ? 'Total credit (' : 'Total due (') + inv.currency + ')', sym(inv.currency) + num(inv.total)]];
  return { credit, meta, totals };
}
async function makePdf(inv) {
  const doc = await PDFDocument.create();
  doc.setTitle(inv.title + ' ' + inv.number + ' (fictional demo)'); doc.setAuthor(inv.vendor + ' (fictional)'); doc.setCreator('InvoiceClerk AI sample generator'); doc.setProducer('pdf-lib');
  doc.setCreationDate(new Date(inv.issueDate + 'T12:00:00Z')); doc.setModificationDate(new Date(inv.issueDate + 'T12:00:00Z'));
  const page = doc.addPage([612, 792]);
  const F = await doc.embedFont(StandardFonts.Helvetica); const B = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.12, 0.2), mute = rgb(0.4, 0.43, 0.5), brand = rgb(0.13, 0.4, 0.33);
  const t = (s, x, y, o = {}) => page.drawText(String(s), { x, y, size: o.size || 10, font: o.bold ? B : F, color: o.color || ink });
  const tr = (s, xr, y, o = {}) => { const f = o.bold ? B : F; const w = f.widthOfTextAtSize(String(s), o.size || 10); t(s, xr - w, y, o); };
  const { credit, meta, totals } = model(inv);
  if (inv.stamp) { tr(inv.stamp, 562, 770, { bold: true, size: 11, color: rgb(0.75, 0.1, 0.1) }); }
  tr(inv.title, 562, 742, { bold: true, size: 24, color: brand });
  t(inv.vendor, 50, 742, { bold: true, size: 17 });
  const left = inv.vendorAddress.concat([inv.vendorEmail, inv.vendorPhone || '', inv.vatNumber ? 'VAT reg. no. ' + inv.vatNumber : '']).filter(Boolean);
  let y = 716;
  for (let i = 0; i < Math.max(left.length, meta.length); i++) {
    if (left[i]) t(left[i], 50, y, { color: mute });
    if (meta[i]) { tr(meta[i][0] + ':', 470, y, { color: mute }); t(meta[i][1], 478, y, { bold: true }); }
    y -= 15;
  }
  y -= 14; t('Bill to', 50, y, { bold: true, color: brand }); y -= 15;
  inv.billTo.forEach((l) => { t(l, 50, y); y -= 14; });
  y -= 16;
  page.drawRectangle({ x: 44, y: y - 6, width: 524, height: 22, color: rgb(0.93, 0.96, 0.95) });
  t('Description', 50, y, { bold: true }); tr('Qty', 352, y, { bold: true }); t('Unit', 362, y, { bold: true }); tr('Unit price', 482, y, { bold: true }); tr('Amount', 562, y, { bold: true });
  y -= 24;
  inv.lines.forEach((l) => {
    t(l.description, 50, y); tr(qtyStr(l.qty), 352, y); t(l.unit, 362, y); tr(num(l.unitPrice), 482, y); tr(num(l.amount), 562, y);
    page.drawLine({ start: { x: 44, y: y - 7 }, end: { x: 568, y: y - 7 }, thickness: 0.5, color: rgb(0.86, 0.88, 0.9) });
    y -= 22;
  });
  y -= 10;
  totals.forEach(([k, v], i) => { const last = i === totals.length - 1; tr(k, 470, y, { bold: last, size: last ? 12 : 10 }); tr(v, 562, y, { bold: last, size: last ? 12 : 10 }); y -= last ? 20 : 16; });
  y -= 18;
  if (inv.payment) { t(credit ? 'Notes' : 'Payment details', 50, y, { bold: true, color: brand }); y -= 15; inv.payment.forEach((l) => { t(l, 50, y); y -= 14; }); }
  if (credit) { t('This credit will be applied to your account balance against ' + inv.reference + '.', 50, y); y -= 14; }
  t('Thank you for your business.', 50, 70, { color: mute });
  t('Fictional sample generated for the InvoiceClerk AI demo. Not a real company or invoice.', 50, 54, { size: 8, color: mute });
  if (inv.hiddenNote) page.drawText(inv.hiddenNote, { x: 50, y: 30, size: 4, font: F, color: rgb(0.985, 0.985, 0.985) });
  return doc.save({ useObjectStreams: false });
}
export function html(inv, opts = {}) {
  const { credit, meta, totals } = model(inv);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const left = inv.vendorAddress.concat([inv.vendorEmail, inv.vendorPhone || '']).filter(Boolean);
  return `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;background:${opts.bg || '#fff'};font:15px/1.35 Arial,Helvetica,sans-serif;color:#1a1f33}
  .p{width:816px;padding:44px 52px;box-sizing:border-box;background:${opts.paper || '#fff'};${opts.css || ''}}
  .top{display:flex;justify-content:space-between;align-items:flex-start}.v{font-weight:700;font-size:24px}.ti{font-weight:700;font-size:30px;color:#216654}
  .m{display:grid;grid-template-columns:auto auto;gap:3px 10px;justify-content:end;margin-top:-6px}.m b{font-weight:700}
  .mu{color:#555}table{width:100%;border-collapse:collapse;margin-top:22px}th{background:#edf5f2;text-align:left;padding:7px}td{padding:7px;border-bottom:1px solid #ddd}
  .r{text-align:right}.tot{margin-left:auto;width:330px;margin-top:12px}.tot div{display:flex;justify-content:space-between;padding:3px 0}.tot .g{font-weight:700;font-size:17px}
  .f{margin-top:34px;font-size:12px;color:#777}</style>
  <div class="p"><div class="top"><div><div class="v">${esc(inv.vendor)}</div>${left.map((l) => `<div class="mu">${esc(l)}</div>`).join('')}</div>
  <div><div class="ti" style="text-align:right">${esc(inv.title)}</div><div class="m">${meta.map(([k, v]) => `<span class="mu">${esc(k)}:</span><b>${esc(v)}</b>`).join('')}</div></div></div>
  <div style="margin-top:22px"><b style="color:#216654">Bill to</b>${inv.billTo.map((l) => `<div>${esc(l)}</div>`).join('')}</div>
  <table><tr><th>Description</th><th class="r">Qty</th><th>Unit</th><th class="r">Unit price</th><th class="r">Amount</th></tr>
  ${inv.lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="r">${qtyStr(l.qty)}</td><td>${esc(l.unit)}</td><td class="r">${num(l.unitPrice)}</td><td class="r">${num(l.amount)}</td></tr>`).join('')}</table>
  <div class="tot">${totals.map(([k, v], i) => `<div class="${i === totals.length - 1 ? 'g' : ''}"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}</div>
  ${inv.payment ? `<div style="margin-top:18px"><b style="color:#216654">Payment details</b>${inv.payment.map((l) => `<div>${esc(l)}</div>`).join('')}</div>` : ''}
  <div class="f">Fictional sample generated for the InvoiceClerk AI demo. Not a real company or invoice.</div></div>`;
}
async function renderImages(list) {
  const pw = req('playwright');
  const b = await pw.chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME, args: ['--no-sandbox'] } : {});
  const p = await b.newPage({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 1 });
  for (const inv of list) {
    const style = inv.kind === 'png' ? {} : inv.kind === 'jpg'
      ? { bg: '#8a8f86', paper: '#fbf8ef', css: 'transform:rotate(-1.4deg);margin:30px 40px;box-shadow:0 6px 18px rgba(0,0,0,.35);filter:blur(.35px) contrast(.95)' }
      : { bg: '#fff', paper: '#f4f4f1', css: 'transform:rotate(0.6deg);margin:10px;filter:grayscale(1) contrast(1.15) blur(.45px)' };
    await p.setContent(html(inv, style));
    const el = inv.kind === 'png' ? await p.$('.p') : null;
    const shotOpts = inv.kind === 'png' ? { type: 'png' } : { type: 'jpeg', quality: inv.kind === 'jpg' ? 72 : 60, fullPage: true };
    const buf = el ? await el.screenshot(shotOpts) : await p.screenshot(shotOpts);
    if (inv.kind === 'scan') {
      const doc = await PDFDocument.create();
      doc.setTitle('Scanned invoice ' + inv.number + ' (fictional demo)'); doc.setProducer('pdf-lib'); doc.setCreator('InvoiceClerk AI sample generator');
      doc.setCreationDate(new Date(inv.issueDate + 'T12:00:00Z')); doc.setModificationDate(new Date(inv.issueDate + 'T12:00:00Z'));
      const img = await doc.embedJpg(buf); const page = doc.addPage([612, 792]);
      const sc = Math.min(612 / img.width, 792 / img.height); page.drawImage(img, { x: (612 - img.width * sc) / 2, y: 792 - img.height * sc, width: img.width * sc, height: img.height * sc });
      fs.writeFileSync(path.join(out, inv.file), await doc.save({ useObjectStreams: false }));
    } else fs.writeFileSync(path.join(out, inv.file), buf);
    console.log('wrote', inv.file, buf.length);
  }
  await b.close();
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const inv of S.INVOICES.filter((i) => i.kind === 'pdf')) { const bytes = await makePdf(inv); fs.writeFileSync(path.join(out, inv.file), bytes); console.log('wrote', inv.file, bytes.length); }
  if (!process.argv.includes('--pdf-only')) await renderImages(S.INVOICES.filter((i) => i.kind !== 'pdf'));
}
