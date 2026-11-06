/* InvoiceClerk AI service worker: network-first, per-file cache, versioned, offline fallback.
   Bump CACHE on each release; old caches are removed on activate. Demo mode works fully offline. */
const CACHE = 'invoiceclerk-ai-v1';
const ASSETS = ["./","./index.html","./styles.css","./manifest.webmanifest","./icons/icon-192.png","./icons/icon-512.png","./icons/icon.svg","./js/agentkit/guard.js","./js/agentkit/keystore.js","./js/agentkit/llm.js","./js/agentkit/modal.js","./js/agentkit/webllm.js","./js/app.js","./js/data/samples.js","./js/inv/agent.js","./js/inv/ai.js","./js/inv/exports.js","./js/inv/files.js","./js/inv/ledger.js","./js/inv/money.js","./js/inv/ocr.js","./js/inv/parse.js","./js/inv/pdftext.js","./js/inv/store.js","./js/inv/validate.js","./js/main.js","./js/ui.js","./js/views/export.js","./js/views/inbox.js","./js/views/invoice.js","./js/views/ledger.js","./js/views/settings.js","./samples/bluewater-BW-2210.pdf","./samples/cloudnest-CN-2026-0912.pdf","./samples/greenleaf-catering-GC-771.jpg","./samples/lumen-print-LP-3092.png","./samples/metropower-MPL-88310.pdf","./samples/northwind-CR-0042.pdf","./samples/northwind-INV-10421-resend.pdf","./samples/northwind-INV-10421.pdf","./samples/ocr/greenleaf-catering-GC-771.jpg.txt","./samples/ocr/lumen-print-LP-3092.png.txt","./samples/ocr/ridgeway-scan-RJ-1187.pdf.txt","./samples/pixelpine-PP-0347.pdf","./samples/ridgeway-scan-RJ-1187.pdf","./samples/thamesbridge-TT-5521.pdf","./vendor/pdfjs/pdf.min.mjs","./vendor/pdfjs/pdf.worker.min.mjs"];
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(ASSETS.map((a) => c.add(new Request(a, { cache: 'reload' })).catch(() => {})))));
});
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('invoiceclerk-ai-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req, { cache: 'no-cache' }).then((res) => {
    if (res && res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true })
    .then((r) => r || (req.mode === 'navigate' ? caches.match('./index.html').then((i) => i || caches.match('./')) : undefined))
    .then((r) => r || Response.error())));
});
