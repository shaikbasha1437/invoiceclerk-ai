# InvoiceClerk AI

**Invoice PDF → accounting agent that runs in your browser.** Drop in invoices (PDF, PNG, JPG, WebP). InvoiceClerk reads them, shows the extracted fields beside the original, flags anything off, and proposes a bill plus a balanced journal entry. You approve, reject, or edit **each field** before anything is posted to the local ledger. Posting can always be undone. Export to a journal CSV, QuickBooks (CSV / IIF / QBO API JSON) or Xero (CSV / API JSON).

**Live demo:** https://shaikbasha1437.github.io/invoiceclerk-ai/ — open it and press **Load demo invoices**. No key or sign-up needed.

> The page never posts to a real accounting system. API payloads and `curl` examples are generated for you to review. Pushing for real only happens through the optional self-hosted server (below), after a confirm, and with `DRY_RUN=false`.

## What it does

| Step | How |
|---|---|
| Ingest | Drag and drop or the file picker (several at once). A batch inbox shows each file's status: new → extracted → flagged → approved → posted (or skipped). |
| Extract text | Text PDFs are read with **pdf.js** (vendored, `vendor/pdfjs`). Scans and photos are read with **Tesseract.js** OCR if you switch it on (loaded from jsDelivr only when used). In live mode a **vision model** reads the page image. |
| Parse | A deterministic parser picks out vendor, invoice number, dates, terms, PO, currency, line items, subtotal, tax, total and bank details. Each field shows the text line it came from. An LLM (live mode) can fill gaps; it never overwrites values you edited. |
| Validate | Errors: missing vendor, number, issue date or total; lines that don't sum to the subtotal; total ≠ subtotal + tax; duplicate of a posted invoice; bank details that changed from the vendor's history. Warnings: missing due date, due before issue, missing PO (when the vendor needs one), line math, unexpected tax rate, possible near-duplicate, amount far above the vendor's usual, unexpected currency, hidden "instructions" in the document (prompt injection). Info: new vendor, credit note, OCR used, and more. |
| Propose | A bill and a journal entry (Dr expense / tax receivable, Cr Accounts payable), using vendor defaults and keyword rules mapped to your chart of accounts. Foreign currency is converted at an FX rate you confirm. Credit notes reverse the entry. A total that doesn't match goes to **1999 Suspense** if you choose to post anyway. |
| Review | A field-level **diff** (before → proposed, with the reason). Approve, reject or edit each row, or approve all. Post stays disabled until every row is decided; errors need an explicit "Post anyway". |
| Post | Into a local ledger (bills, journal, trial balance, AP balance). Every post, delete, skip and edit has an **Undo** toast. |
| Export | Journal CSV · QuickBooks bill CSV · QuickBooks IIF · QBO API JSON (`Bill` / `VendorCredit`, minorversion 75) · Xero bill CSV (bill import template) · Xero API JSON (`ACCPAY` / `ACCPAYCREDIT`, status DRAFT) · generic JSON · `curl` examples. |

Also included: a vendor directory (default account, PO required, known bank account), an editable chart of accounts, light and dark themes, a mobile layout, and an installable PWA that works offline in demo mode.

## Demo invoices

All companies, people, addresses, bank numbers and amounts are **fictional** and generated in this repo (`scripts/make-samples.mjs`).

| File | What it shows | Expected flags |
|---|---|---|
| `northwind-INV-10421.pdf` | Clean office supplies bill with tax | bank details (info) |
| `cloudnest-CN-2026-0912.pdf` | Clean SaaS subscription | — |
| `pixelpine-PP-0347.pdf` | Lines add up to 4,150 but subtotal says 4,250; no PO | lines don't sum, missing PO |
| `metropower-MPL-88310.pdf` | Printed total is $10 more than subtotal + tax | total mismatch → suspense |
| `northwind-INV-10421-resend.pdf` | Same invoice sent again | duplicate |
| `northwind-CR-0042.pdf` | Credit note for returned toner | credit note (Dr AP) |
| `thamesbridge-TT-5521.pdf` | New UK vendor, GBP, VAT 20%, day-first dates, IBAN | new vendor, currency |
| `bluewater-BW-2210.pdf` | Large amount, wrong tax rate, hidden 4 pt "pay now" text | unusual amount, tax rate, injection |
| `ridgeway-scan-RJ-1187.pdf` | Scanned PDF, no text layer | OCR, missing due date |
| `lumen-print-LP-3092.png` | Phone-style image | OCR |
| `greenleaf-catering-GC-771.jpg` | Photo of a receipt-style invoice | OCR |

So the demo works offline and without downloading the OCR engine, OCR text for the bundled scans was pre-computed with Tesseract.js (`samples/ocr/*.txt`). Your own scans use live OCR.

## Live mode (your own key)

Settings → Model. Pick a provider and paste **your own** API key. The key is kept only in this browser (localStorage, or session-only if you prefer) and is sent only to that provider.

| Provider | Notes |
|---|---|
| Anthropic | Called directly from the browser with the `anthropic-dangerous-direct-browser-access` header. Vision supported. |
| Google Gemini | Direct browser call. Vision supported. |
| OpenAI | Direct browser call. OpenAI's "invalid key" response has no CORS header, so a bad key shows as a network error. |
| OpenAI-compatible | OpenRouter, LM Studio, Ollama (`OLLAMA_ORIGINS=https://shaikbasha1437.github.io ollama serve`), or any `/v1/chat/completions` endpoint. |
| WebLLM (optional) | Runs a small model fully in the browser with WebGPU. Large download; text only. |

**Privacy:** invoices stay in your browser (IndexedDB for files, localStorage for the ledger). In live mode, the extracted text and/or page image of the invoice you are working on goes to the provider you chose. **Hide bank details** (Settings → Privacy, on by default) shows only the last 4 digits on screen, with a Show button per invoice, and masks them in the JSON export and backup. Settings → Data lets you download a backup or clear everything (with undo). Uploaded files are removed from IndexedDB when you delete their invoice.

## Self-hosted server (optional)

Browsers can't call QuickBooks or Xero directly (CORS, OAuth secrets), so `/server` is a tiny Node proxy (no dependencies) that you run yourself.

```bash
cd server
cp .env.example .env      # fill in tokens; keep DRY_RUN=true first
node index.js             # reads server/.env; listens on 127.0.0.1:8787
# or with Docker
docker build -t invoiceclerk-server .
docker run --rm -p 8787:8787 --env-file .env -e HOST=0.0.0.0 invoiceclerk-server
```

Then in the app: Settings → Server → URL `http://127.0.0.1:8787` (and the token if you set `SERVER_TOKEN`) → **Check**. Export → **Push** shows the payload and asks you to confirm.

| Route | Forwards to |
|---|---|
| `GET /health` | status, dry-run flag, which systems are configured |
| `POST /api/qbo/bill`, `/api/qbo/vendorcredit` | `{QBO_BASE_URL}/v3/company/{realm}/bill|vendorcredit?minorversion=75` |
| `POST /api/xero/Invoices`, `/api/xero/CreditNotes` | `https://api.xero.com/api.xro/2.0/...` |

- `DRY_RUN=true` (default) validates and echoes the payload without forwarding.
- Only origins listed in `ALLOWED_ORIGIN` are allowed (CORS). Bodies are capped at 256 KB.
- `QBO_VENDOR_MAP` and `QBO_ACCOUNT_MAP` map InvoiceClerk vendor names and account codes to QuickBooks Ids.
- Tokens are plain OAuth access tokens you paste in: QuickBooks tokens last about 1 hour, Xero about 30 minutes. The server does not refresh them.
- When the page is served over HTTPS and the server is on `localhost`, Chrome and Firefox ask you to allow **local network access** the first time; allow it, or the request fails with "Failed to fetch".

## Exports: caveats

- QuickBooks API JSON uses `VendorRef` and `AccountRef` **Ids**; the defaults are placeholders unless you map them (server env) or edit them. Tax is sent as its own expense line (`GlobalTaxCalculation: NotApplicable`).
- Xero tax types depend on your organisation's tax settings. The defaults are `Tax on Purchases` / `Tax Exempt` in the CSV and `INPUT` / `NONE` in the API JSON (tax-exclusive, with an explicit tax amount).
- IIF and the CSV templates follow the published QuickBooks Desktop and Xero bill import formats. Check them with a test company first.

## Develop

```bash
npm install        # dev tools only: pdf-lib, pdfjs-dist, tesseract.js, playwright
npm test           # 93 tests: parser, validation, ledger, exports, AI parsing, full pipeline, assets, server (mocked)
python3 -m http.server 8080   # then open http://localhost:8080/
npm run samples    # regenerate demo PDFs/images, OCR text, fixtures and the service worker asset list
```

No build step: plain ES modules (UMD) that run in the browser and in Node tests. All provider and accounting calls in tests are mocked; no real keys are used.

## Limits

- The parser is rule-based and tuned for common invoice layouts. Unusual layouts may need a few manual edits, or live mode.
- OCR quality depends on the scan; the bundled scan intentionally loses its PO number.
- Live OCR needs internet the first time (the Tesseract engine and language data load from jsDelivr).
- WebLLM support is untested on real hardware.
- The Docker image has not been built in CI. Server pushes have been tested only against mock QuickBooks and Xero endpoints.
- This is a bookkeeping helper, not accounting advice. Review entries before using them in real books.

## License

MIT
