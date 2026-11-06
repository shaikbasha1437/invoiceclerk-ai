'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createServer, mapQbo, checkXero } = require('../index.js');

function shut(s) { s.closeAllConnections(); s.close(); }
function listen(server) { return new Promise((r) => server.listen(0, '127.0.0.1', () => r('http://127.0.0.1:' + server.address().port))); }
function mockUpstream() {
  const calls = [];
  const s = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
      calls.push({ method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
      res.setHeader('content-type', 'application/json');
      if (req.headers.authorization === 'Bearer expired') { res.statusCode = 401; return res.end(JSON.stringify({ Fault: { Error: [{ Message: 'AuthenticationFailed' }] } })); }
      if (req.url.startsWith('/v3/company/')) return res.end(JSON.stringify({ Bill: { Id: '145', SyncToken: '0' }, time: 'now' }));
      if (req.url.startsWith('/api.xro/2.0/')) return res.end(JSON.stringify({ Invoices: [{ InvoiceID: '9f1c-uuid', Status: 'DRAFT' }] }));
      res.statusCode = 404; res.end('{}');
    });
  });
  return { s, calls };
}
const qboBody = { VendorRef: { value: 'Northwind Office Supply', name: 'Northwind Office Supply' }, TxnDate: '2026-10-14', DueDate: '2026-11-13', DocNumber: 'INV-10421', Line: [{ DetailType: 'AccountBasedExpenseLineDetail', Amount: 749.9, Description: 'Supplies', AccountBasedExpenseLineDetail: { AccountRef: { value: '6000', name: 'Office supplies' } } }] };
const xeroBody = { Invoices: [{ Type: 'ACCPAY', Contact: { Name: 'Northwind Office Supply' }, InvoiceNumber: 'INV-10421', LineItems: [{ Description: 'x', Quantity: 1, UnitAmount: 10, AccountCode: '6000' }] }] };
const ORIGIN = 'https://shaikbasha1437.github.io';
async function post(base, path, body, headers) { const r = await fetch(base + path, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json', origin: ORIGIN }, headers || {}), body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null), headers: r.headers }; }

test('health reports dry-run and configuration without secrets', async () => {
  const { server } = createServer({ QBO_ACCESS_TOKEN: 'secret-token', QBO_REALM_ID: '123' }, { log: () => {} });
  const base = await listen(server);
  const r = await fetch(base + '/health'); const j = await r.json();
  assert.deepStrictEqual(j, { ok: true, dryRun: true, qbo: true, xero: false });
  assert.ok(!JSON.stringify(j).includes('secret'));
  shut(server);
});
test('dry run returns the mapped payload and target without calling upstream', async () => {
  let called = false;
  const { server } = createServer({ QBO_REALM_ID: '123', QBO_VENDOR_MAP: '{"Northwind Office Supply":"56"}', QBO_ACCOUNT_MAP: '{"6000":"7"}' }, { fetch: () => { called = true; }, log: () => {} });
  const base = await listen(server);
  const r = await post(base, '/api/qbo/bill', qboBody);
  assert.strictEqual(r.status, 200); assert.strictEqual(r.json.dryRun, true);
  assert.match(r.json.wouldPost, /\/v3\/company\/123\/bill\?minorversion=75$/);
  assert.strictEqual(r.json.body.VendorRef.value, '56'); assert.strictEqual(r.json.body.Line[0].AccountBasedExpenseLineDetail.AccountRef.value, '7');
  assert.strictEqual(called, false);
  shut(server);
});
test('live QuickBooks push forwards with bearer token to the mock and returns the Bill Id', async () => {
  const up = mockUpstream(); const upBase = await listen(up.s);
  const { server } = createServer({ DRY_RUN: 'false', QBO_ACCESS_TOKEN: 'tok-qbo', QBO_REALM_ID: '9130', QBO_BASE_URL: upBase }, { log: () => {} });
  const base = await listen(server);
  const r = await post(base, '/api/qbo/bill', qboBody);
  assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.json, { status: 200, id: '145', syncToken: '0' });
  assert.strictEqual(up.calls.length, 1);
  assert.strictEqual(up.calls[0].url, '/v3/company/9130/bill?minorversion=75');
  assert.strictEqual(up.calls[0].headers.authorization, 'Bearer tok-qbo');
  assert.strictEqual(up.calls[0].body.DocNumber, 'INV-10421');
  assert.strictEqual(r.headers.get('access-control-allow-origin'), ORIGIN);
  shut(server); shut(up.s);
});
test('live Xero push sends xero-tenant-id and returns InvoiceID', async () => {
  const up = mockUpstream(); const upBase = await listen(up.s);
  const { server } = createServer({ DRY_RUN: 'false', XERO_ACCESS_TOKEN: 'tok-x', XERO_TENANT_ID: 'tenant-1', XERO_BASE_URL: upBase }, { log: () => {} });
  const base = await listen(server);
  const r = await post(base, '/api/xero/Invoices', xeroBody);
  assert.strictEqual(r.status, 200); assert.strictEqual(r.json.id, '9f1c-uuid');
  assert.strictEqual(up.calls[0].url, '/api.xro/2.0/Invoices');
  assert.strictEqual(up.calls[0].headers['xero-tenant-id'], 'tenant-1');
  assert.strictEqual(up.calls[0].headers.authorization, 'Bearer tok-x');
  shut(server); shut(up.s);
});
test('upstream auth failure becomes a 502 with detail', async () => {
  const up = mockUpstream(); const upBase = await listen(up.s);
  const { server } = createServer({ DRY_RUN: 'false', QBO_ACCESS_TOKEN: 'expired', QBO_REALM_ID: '1', QBO_BASE_URL: upBase }, { log: () => {} });
  const base = await listen(server);
  const r = await post(base, '/api/qbo/bill', qboBody);
  assert.strictEqual(r.status, 502); assert.match(r.json.error, /401/);
  shut(server); shut(up.s);
});
test('rejects disallowed origins, wrong token, bad payloads, unknown routes and big bodies', async () => {
  const { server } = createServer({ SERVER_TOKEN: 'shh' }, { log: () => {} });
  const base = await listen(server);
  let r = await post(base, '/api/qbo/bill', qboBody, { origin: 'https://evil.example' }); assert.strictEqual(r.status, 403);
  r = await post(base, '/api/qbo/bill', qboBody); assert.strictEqual(r.status, 401);
  r = await post(base, '/api/qbo/bill', { Line: [] }, { authorization: 'Bearer shh' }); assert.strictEqual(r.status, 422);
  r = await post(base, '/api/qbo/invoice', qboBody, { authorization: 'Bearer shh' }); assert.strictEqual(r.status, 404);
  r = await post(base, '/api/xero/Invoices', { Invoices: [{ Type: 'ACCREC', Contact: { Name: 'x' }, LineItems: [{}] }] }, { authorization: 'Bearer shh' }); assert.strictEqual(r.status, 422); assert.match(r.json.error, /ACCPAY/);
  r = await post(base, '/api/qbo/bill', { pad: 'x'.repeat(300 * 1024) }, { authorization: 'Bearer shh' }); assert.strictEqual(r.status, 413);
  shut(server);
});
test('CORS preflight allows the configured origin and private network access', async () => {
  const { server } = createServer({}, { log: () => {} });
  const base = await listen(server);
  const r = await fetch(base + '/api/qbo/bill', { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'POST' } });
  assert.strictEqual(r.status, 204); assert.strictEqual(r.headers.get('access-control-allow-origin'), ORIGIN);
  assert.strictEqual(r.headers.get('access-control-allow-private-network'), 'true');
  shut(server);
});
test('live mode without tokens is a clear 503', async () => {
  const { server } = createServer({ DRY_RUN: 'false' }, { log: () => {} });
  const base = await listen(server);
  const r = await post(base, '/api/xero/Invoices', xeroBody); assert.strictEqual(r.status, 503);
  shut(server);
});
test('helpers: mapQbo leaves unmapped values alone; checkXero needs the array', () => {
  const b = mapQbo(qboBody, { qbo: { vendors: {}, accounts: {} } }); assert.strictEqual(b.VendorRef.value, 'Northwind Office Supply');
  assert.ok(checkXero('CreditNotes', {}).length);
});
