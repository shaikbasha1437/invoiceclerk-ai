/* InvoiceClerk self-hosted push server. Zero dependencies (Node 18+).
   Receives a bill payload from the InvoiceClerk page and forwards it to QuickBooks Online or Xero
   with YOUR token, held here in environment variables, never in the browser.
   Starts in DRY_RUN mode: it validates and returns what it would send, without calling anything. */
'use strict';
const http = require('http');

const QBO_MINOR = 75;
function config(env) {
  const e = env || process.env;
  const json = (s) => { try { return s ? JSON.parse(s) : {}; } catch (err) { throw new Error('Invalid JSON in env: ' + String(s).slice(0, 40)); } };
  return {
    port: Number(e.PORT || 8787),
    host: e.HOST || '127.0.0.1',
    origins: String(e.ALLOWED_ORIGIN || 'https://shaikbasha1437.github.io').split(',').map((s) => s.trim()).filter(Boolean),
    token: e.SERVER_TOKEN || '',
    dryRun: String(e.DRY_RUN || 'true').toLowerCase() !== 'false',
    qbo: { token: e.QBO_ACCESS_TOKEN || '', realm: e.QBO_REALM_ID || '', base: (e.QBO_BASE_URL || 'https://quickbooks.api.intuit.com').replace(/\/+$/, ''), vendors: json(e.QBO_VENDOR_MAP), accounts: json(e.QBO_ACCOUNT_MAP) },
    xero: { token: e.XERO_ACCESS_TOKEN || '', tenant: e.XERO_TENANT_ID || '', base: (e.XERO_BASE_URL || 'https://api.xero.com').replace(/\/+$/, '') },
    maxBody: 256 * 1024
  };
}
function send(res, status, obj, headers) { res.writeHead(status, Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, headers || {})); res.end(JSON.stringify(obj)); }
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = []; let over = false;
    req.on('data', (c) => { size += c.length; if (size > max) { over = true; chunks.length = 0; } else if (!over) chunks.push(c); });
    req.on('end', () => { if (over) return reject(Object.assign(new Error('Body too large (max ' + Math.round(max / 1024) + ' KB)'), { status: 413 })); try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(Object.assign(new Error('Body is not JSON'), { status: 400 })); } });
    req.on('error', reject);
  });
}
// Map local vendor names / account codes to QuickBooks Ids when maps are configured.
function mapQbo(body, cfg) {
  const b = JSON.parse(JSON.stringify(body));
  if (b.VendorRef && cfg.qbo.vendors[b.VendorRef.name]) b.VendorRef.value = String(cfg.qbo.vendors[b.VendorRef.name]);
  (b.Line || []).forEach((l) => { const r = l.AccountBasedExpenseLineDetail && l.AccountBasedExpenseLineDetail.AccountRef; if (r && cfg.qbo.accounts[r.value]) r.value = String(cfg.qbo.accounts[r.value]); });
  return b;
}
function checkQbo(b) {
  const errs = [];
  if (!b || typeof b !== 'object') return ['Body must be an object'];
  if (!b.VendorRef || !b.VendorRef.value) errs.push('VendorRef.value is required');
  if (!Array.isArray(b.Line) || !b.Line.length) errs.push('Line must be a non-empty array');
  (b.Line || []).forEach((l, i) => { if (typeof l.Amount !== 'number') errs.push('Line[' + i + '].Amount must be a number'); if (l.DetailType !== 'AccountBasedExpenseLineDetail') errs.push('Line[' + i + '].DetailType must be AccountBasedExpenseLineDetail'); });
  return errs;
}
function checkXero(endpoint, b) {
  const list = b && (endpoint === 'Invoices' ? b.Invoices : b.CreditNotes);
  if (!Array.isArray(list) || !list.length) return [endpoint + ' array is required'];
  const errs = [];
  list.forEach((d, i) => {
    const want = endpoint === 'Invoices' ? 'ACCPAY' : 'ACCPAYCREDIT';
    if (d.Type !== want) errs.push(endpoint + '[' + i + '].Type must be ' + want + ' (this server only creates bills and supplier credits)');
    if (!d.Contact || !d.Contact.Name) errs.push(endpoint + '[' + i + '].Contact.Name is required');
    if (!Array.isArray(d.LineItems) || !d.LineItems.length) errs.push(endpoint + '[' + i + '].LineItems is required');
  });
  return errs;
}
function createServer(env, deps) {
  const cfg = config(env); const f = (deps && deps.fetch) || globalThis.fetch;
  const log = (deps && deps.log) || ((m) => console.log(new Date().toISOString(), m));
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    const cors = cfg.origins.includes(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-max-age': '600' } : {};
    if (origin && !cors['access-control-allow-origin']) return send(res, 403, { error: 'Origin not allowed. Add it to ALLOWED_ORIGIN.' });
    if (req.method === 'OPTIONS') { res.writeHead(204, Object.assign({ 'access-control-allow-private-network': 'true' }, cors)); return res.end(); }
    const url = new URL(req.url, 'http://local');
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, dryRun: cfg.dryRun, qbo: !!(cfg.qbo.token && cfg.qbo.realm), xero: !!(cfg.xero.token && cfg.xero.tenant) }, cors);
    if (cfg.token && req.headers.authorization !== 'Bearer ' + cfg.token) return send(res, 401, { error: 'Missing or wrong SERVER_TOKEN.' }, cors);
    const m = url.pathname.match(/^\/api\/(qbo|xero)\/([A-Za-z]+)$/);
    if (req.method !== 'POST' || !m) return send(res, 404, { error: 'Not found' }, cors);
    let body;
    try { body = await readBody(req, cfg.maxBody); } catch (e) { return send(res, e.status || 400, { error: e.message }, cors); }
    try {
      if (m[1] === 'qbo') {
        const entity = m[2].toLowerCase();
        if (!['bill', 'vendorcredit'].includes(entity)) return send(res, 404, { error: 'Only bill and vendorcredit are supported.' }, cors);
        const b = mapQbo(body, cfg); const errs = checkQbo(b);
        if (errs.length) return send(res, 422, { error: errs.join('; ') }, cors);
        const target = cfg.qbo.base + '/v3/company/' + encodeURIComponent(cfg.qbo.realm || '{realmId}') + '/' + entity + '?minorversion=' + QBO_MINOR;
        if (cfg.dryRun) { log('dry-run qbo ' + entity + ' ' + (b.DocNumber || '')); return send(res, 200, { dryRun: true, wouldPost: target, body: b }, cors); }
        if (!cfg.qbo.token || !cfg.qbo.realm) return send(res, 503, { error: 'QBO_ACCESS_TOKEN and QBO_REALM_ID are not set.' }, cors);
        const r = await f(target, { method: 'POST', headers: { authorization: 'Bearer ' + cfg.qbo.token, accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(b) });
        const j = await r.json().catch(() => ({}));
        log('qbo ' + entity + ' ' + (b.DocNumber || '') + ' -> ' + r.status);
        if (!r.ok) return send(res, 502, { error: 'QuickBooks returned ' + r.status, status: r.status, detail: j.Fault || j }, cors);
        const ent = j.Bill || j.VendorCredit || {};
        return send(res, 200, { status: r.status, id: ent.Id || null, syncToken: ent.SyncToken || null }, cors);
      }
      const endpoint = m[2] === 'Invoices' || m[2] === 'CreditNotes' ? m[2] : '';
      if (!endpoint) return send(res, 404, { error: 'Only Invoices (ACCPAY) and CreditNotes (ACCPAYCREDIT) are supported.' }, cors);
      const errs = checkXero(endpoint, body);
      if (errs.length) return send(res, 422, { error: errs.join('; ') }, cors);
      const target = cfg.xero.base + '/api.xro/2.0/' + endpoint;
      if (cfg.dryRun) { log('dry-run xero ' + endpoint); return send(res, 200, { dryRun: true, wouldPost: target, body }, cors); }
      if (!cfg.xero.token || !cfg.xero.tenant) return send(res, 503, { error: 'XERO_ACCESS_TOKEN and XERO_TENANT_ID are not set.' }, cors);
      const r = await f(target, { method: 'POST', headers: { authorization: 'Bearer ' + cfg.xero.token, 'xero-tenant-id': cfg.xero.tenant, accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      log('xero ' + endpoint + ' -> ' + r.status);
      if (!r.ok) return send(res, 502, { error: 'Xero returned ' + r.status, status: r.status, detail: j }, cors);
      const doc = (j.Invoices || j.CreditNotes || [])[0] || {};
      return send(res, 200, { status: r.status, id: doc.InvoiceID || doc.CreditNoteID || null }, cors);
    } catch (e) { log('error ' + e.message); return send(res, 502, { error: 'Upstream call failed: ' + e.message }, cors); }
  });
  return { server, cfg };
}
if (require.main === module) {
  try { require('fs').readFileSync(__dirname + '/.env', 'utf8').split(/\r?\n/).forEach((l) => { const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }); } catch (e) { /* no .env */ }
  const { server, cfg } = createServer(process.env);
  server.listen(cfg.port, cfg.host, () => console.log('InvoiceClerk server on http://' + cfg.host + ':' + cfg.port + (cfg.dryRun ? ' (DRY_RUN: nothing is sent upstream)' : '') + ' allowing ' + cfg.origins.join(', ')));
}
module.exports = { createServer, config, mapQbo, checkQbo, checkXero, QBO_MINOR };
