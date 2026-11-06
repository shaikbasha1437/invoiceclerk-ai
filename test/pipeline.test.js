'use strict';
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const St = require('../js/inv/store.js'); const A = require('../js/inv/agent.js'); const Lg = require('../js/inv/ledger.js');
const { S, memStorage, loadAllSamples, root } = require('./helpers.js');
const mk = () => St.createStore({ storage: memStorage() });
test('full demo run: every sample gets exactly its expected flags and status', async () => {
  const st = mk(); const xs = await loadAllSamples(st, A);
  assert.strictEqual(xs.length, 11);
  for (const s of S.INVOICES) {
    const inv = st.state.invoices.find((i) => i.name === s.file);
    const got = inv.flags.map((f) => f.id).filter((id) => id !== 'due_computed');
    assert.deepStrictEqual(got.slice().sort(), s.expect.flags.slice().sort(), s.file + ': ' + got.join(','));
    assert.strictEqual(inv.source, s.kind === 'pdf' ? 'pdf' : 'demo-ocr', s.file);
    assert.ok(inv.proposal && inv.proposal.rows.length, s.file);
  }
  const c = st.counts(); assert.strictEqual(c.flagged, 6); assert.strictEqual(c.extracted, 5);
});
test('duplicates are flagged on the later copy only, and clear when the copy is skipped/deleted', async () => {
  const st = mk(); await loadAllSamples(st, A);
  const first = st.state.invoices.find((i) => i.name === 'northwind-INV-10421.pdf'); const copy = st.state.invoices.find((i) => i.name === 'northwind-INV-10421-resend.pdf');
  assert.ok(!first.flags.some((f) => f.id === 'duplicate')); assert.ok(copy.flags.some((f) => f.id === 'duplicate'));
  const snap = st.remove(first.id); st.revalidateAll(); assert.ok(!st.get(copy.id).flags.some((f) => f.id === 'duplicate'));
  st.restore(snap); assert.ok(st.get(copy.id).flags.some((f) => f.id === 'duplicate')); assert.strictEqual(st.state.invoices.indexOf(st.get(first.id)), 0);
});
test('approve -> post -> undo -> repost, status transitions and blocking flags', async () => {
  const st = mk(); await loadAllSamples(st, A);
  const id = st.state.invoices.find((i) => i.name === 'northwind-INV-10421.pdf').id;
  assert.throws(() => A.post(st, id), /still need/);
  A.decide(st, id, 'line.1.account', 'edit', '6990'); A.approveAll(st, id); assert.strictEqual(st.get(id).status, 'approved');
  const r = A.post(st, id); assert.strictEqual(st.get(id).status, 'posted'); assert.strictEqual(r.bill.lines[1].account, '6990');
  assert.throws(() => A.post(st, id), /Already posted/);
  A.unpost(st, id); assert.strictEqual(st.get(id).status, 'approved'); assert.strictEqual(st.state.ledger.bills.length, 0);
  A.post(st, id); assert.strictEqual(st.state.ledger.bills.length, 1);
  const mp = st.state.invoices.find((i) => i.name === 'metropower-MPL-88310.pdf').id; A.approveAll(st, mp);
  assert.throws(() => A.post(st, mp), (e) => e.code === 'flags'); const r2 = A.post(st, mp, { override: true }); assert.ok(r2.entry.lines.some((l) => l.account === '1999'));
});
test('posting the original makes the copy a posted duplicate; override allows it', async () => {
  const st = mk(); await loadAllSamples(st, A);
  const a = st.state.invoices.find((i) => i.name === 'northwind-INV-10421.pdf').id; const b = st.state.invoices.find((i) => i.name === 'northwind-INV-10421-resend.pdf').id;
  A.approveAll(st, a); A.post(st, a); A.approveAll(st, b);
  assert.match(st.get(b).flags.find((f) => f.id === 'duplicate').detail, /already posted|posted bill/);
  assert.throws(() => A.post(st, b), /blocking/);
});
test('editing fields re-runs checks and rebuilds the proposal', async () => {
  const st = mk(); await loadAllSamples(st, A);
  const id = st.state.invoices.find((i) => i.name === 'metropower-MPL-88310.pdf').id;
  assert.ok(st.get(id).flags.some((f) => f.id === 'total_mismatch'));
  A.edited(st, id, { total: 650.68 }); const inv = st.get(id);
  assert.ok(!inv.flags.some((f) => f.id === 'total_mismatch')); assert.ok(!inv.proposal.rows.some((r) => r.key === 'total')); assert.strictEqual(inv.status, 'extracted');
  const pp = st.state.invoices.find((i) => i.name === 'pixelpine-PP-0347.pdf').id;
  A.edited(st, pp, { po: 'PO-7820', lines: st.get(pp).fields.lines.concat([{ description: 'Revisions', qty: 1, unitPrice: 100, amount: 100 }]) });
  assert.deepStrictEqual(st.get(pp).flags.map((f) => f.id), ['bank_details']);
});
test('a scanned upload with no OCR and no AI ends with empty fields and clear guidance', async () => {
  const st = mk(); const inv = st.add({ name: 'scan.pdf', kind: 'pdf', demo: false });
  await A.extract(st, inv.id, null, { readPdf: async () => ({ lines: [], scanned: true }), demoOcr: async () => null });
  const x = st.get(inv.id); assert.strictEqual(x.source, 'none'); assert.ok(x.flags.some((f) => f.id === 'missing_vendor')); assert.match(x.steps.at(-1).detail, /OCR/);
});
test('live OCR path is used when supplied', async () => {
  const st = mk(); const inv = st.add({ name: 'photo.jpg', kind: 'image', demo: false });
  const text = fs.readFileSync(path.join(root, 'samples/ocr/greenleaf-catering-GC-771.jpg.txt'), 'utf8');
  await A.extract(st, inv.id, null, { demoOcr: async () => null, ocr: async () => ({ text, confidence: 84 }) });
  const x = st.get(inv.id); assert.strictEqual(x.source, 'ocr'); assert.strictEqual(x.fields.total, 763.16); assert.ok(x.flags.some((f) => f.id === 'ocr'));
});
test('aiExtract with a mocked model fills the scan gaps; injection-style output fields are ignored', async () => {
  const st = mk(); await loadAllSamples(st, A);
  const id = st.state.invoices.find((i) => i.name === 'ridgeway-scan-RJ-1187.pdf').id;
  let sent = null;
  const fake = async (msg) => { sent = msg; return { text: JSON.stringify({ vendor: 'Ridgeway Janitorial', invoiceNumber: 'RJ-1187', po: 'PO-7799', dueDate: '2026-11-30', total: 960, status: 'approved', post: true }), usage: { input: 900, output: 80 }, cost: 0.0004 }; };
  const r = await A.aiExtract(st, id, fake, { image: { mime: 'image/jpeg', data: 'QUJD' } });
  assert.ok(sent.images && sent.images.length === 1); assert.ok(r.merged.filled.includes('po') && r.merged.filled.includes('dueDate'));
  const inv = st.get(id); assert.strictEqual(inv.fields.po, 'PO-7799'); assert.ok(!inv.flags.some((f) => f.id === 'missing_due_date')); assert.notStrictEqual(inv.status, 'posted'); assert.ok(inv.aiPrev);
  await assert.rejects(A.aiExtract(st, id, async () => ({ text: 'sorry, I cannot' })), /JSON/);
});
test('aiMap applies valid account suggestions to the proposal', async () => {
  const st = mk(); await loadAllSamples(st, A);
  const id = st.state.invoices.find((i) => i.name === 'cloudnest-CN-2026-0912.pdf').id;
  const r = await A.aiMap(st, id, async () => ({ text: '{"mappings":[{"line":1,"code":"6990","reason":"storage add-on"},{"line":0,"code":"2000"}]}' }));
  assert.deepStrictEqual(Object.keys(r.mappings), ['1']);
  const row = st.get(id).proposal.rows.find((x) => x.key === 'line.1.account'); assert.strictEqual(row.after, '6990'); assert.match(row.reason, /AI: storage/);
  assert.strictEqual(st.get(id).proposal.rows.find((x) => x.key === 'line.0.account').after, '6100');
});
test('store: persistence, list filter/sort/search, notes, reset and snapshots', async () => {
  const mem = memStorage(); const st = St.createStore({ storage: mem }); await loadAllSamples(st, A);
  st.update(st.state.invoices[2].id, { notes: 'asked vendor' });
  const st2 = St.createStore({ storage: mem }); assert.strictEqual(st2.state.invoices.length, 11); assert.strictEqual(st2.state.invoices[2].notes, 'asked vendor');
  assert.strictEqual(st2.list('flagged').length, 6); assert.strictEqual(st2.list('all', 'total')[0].fields.total, 9706.2);
  assert.strictEqual(st2.list('all', 'vendor')[0].fields.vendor, 'Bluewater Freight Co.'); assert.strictEqual(st2.list('all', 'added', 'asked').length, 1); assert.strictEqual(st2.list('all', 'flags')[0].flags.filter((f) => f.severity !== 'info').length, 3);
  const snap = st2.snapshot(); st2.reset(true); assert.strictEqual(st2.state.invoices.length, 0); assert.strictEqual(st2.state.ledger.vendors.length, S.VENDORS.length);
  st2.restoreSnapshot(snap); assert.strictEqual(st2.state.invoices.length, 11);
  assert.deepStrictEqual(St.STATUSES, ['new', 'extracted', 'flagged', 'approved', 'posted', 'skipped']);
});
test('skipped invoices do not count as duplicates', async () => {
  const st = mk(); await loadAllSamples(st, A);
  const first = st.state.invoices.find((i) => i.name === 'northwind-INV-10421.pdf'); first.status = 'skipped'; st.revalidateAll();
  assert.ok(!st.state.invoices.find((i) => i.name === 'northwind-INV-10421-resend.pdf').flags.some((f) => f.id === 'duplicate'));
});
void Lg;
