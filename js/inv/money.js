/* Money, number, date and payment-terms helpers. Pure functions; amounts are rounded to cents. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.IC = root.IC || {}).money = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const r2 = (n) => Math.round((Number(n) + (n >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;
  const cents = (n) => Math.round(Number(n) * 100);
  const eq = (a, b, tol) => Math.abs(cents(a) - cents(b)) <= Math.round((tol == null ? 0.01 : tol) * 100);
  const sum = (arr) => r2(arr.reduce((a, x) => a + (Number(x) || 0), 0));
  const SYMBOLS = [['US$', 'USD'], ['CA$', 'CAD'], ['C$', 'CAD'], ['A$', 'AUD'], ['AU$', 'AUD'], ['NZ$', 'NZD'], ['£', 'GBP'], ['€', 'EUR'], ['¥', 'JPY'], ['₹', 'INR'], ['CHF', 'CHF'], ['$', 'USD']];
  const CODES = ['USD', 'GBP', 'EUR', 'CAD', 'AUD', 'NZD', 'JPY', 'INR', 'CHF', 'SEK', 'NOK', 'DKK', 'SGD', 'MXN'];
  /* "$1,234.56", "1.234,56 €", "(1,234.56)", "-£412.50", "1 234,56", "1,234.56-", "USD 12" -> number, or null */
  function parseAmount(input) {
    if (input == null) return null;
    if (typeof input === 'number') return isFinite(input) ? r2(input) : null;
    let s = String(input).trim();
    if (!s) return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/-\s*$/.test(s)) { neg = true; s = s.replace(/-\s*$/, ''); }
    s = s.replace(/\b[A-Z]{3}\b/g, '').replace(/[A-Z]{0,2}\$|[£€¥₹]/g, '').replace(/CR\b/i, '').trim();
    if (/^[-−–]/.test(s)) { neg = !neg; s = s.replace(/^[-−–]\s*/, ''); }
    s = s.replace(/[\s\u00a0\u202f']/g, '');
    if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
    const lastDot = s.lastIndexOf('.'); const lastComma = s.lastIndexOf(',');
    let norm;
    if (lastDot >= 0 && lastComma >= 0) norm = lastDot > lastComma ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
    else if (lastComma >= 0) norm = /,\d{1,2}$/.test(s) && (s.match(/,/g) || []).length === 1 ? s.replace(',', '.') : s.replace(/,/g, '');
    else if ((s.match(/\./g) || []).length > 1) norm = s.replace(/\.(?=\d{3}(\.|$))/g, '');
    else norm = s;
    const n = Number(norm);
    if (!isFinite(n)) return null;
    return r2(neg ? -n : n);
  }
  function detectCurrency(text) {
    const t = String(text || '');
    const code = t.match(new RegExp('\\b(' + CODES.join('|') + ')\\b'));
    if (code) return code[1];
    for (const [sym, c] of SYMBOLS) if (t.includes(sym)) return c;
    return '';
  }
  function format(n, currency) {
    if (n == null || !isFinite(n)) return '';
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(n); } catch (e) { return (currency ? currency + ' ' : '') + r2(n).toFixed(2); }
  }
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const pad = (n) => String(n).padStart(2, '0');
  function valid(y, m, d) { const dt = new Date(Date.UTC(y, m - 1, d)); return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d; }
  function iso(y, m, d) { if (y < 100) y += 2000; return valid(y, m, d) ? y + '-' + pad(m) + '-' + pad(d) : ''; }
  const DATE_RE = /(\d{4}-\d{1,2}-\d{1,2})|(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})|([A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})|(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4})/;
  /* Parse a date in many shapes into YYYY-MM-DD. pref 'MDY' (US) or 'DMY' decides 03/04/2026. */
  function parseDate(input, pref) {
    const s = String(input || '').trim();
    if (!s) return '';
    let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return iso(+m[1], +m[2], +m[3]);
    m = s.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
    if (m) {
      let a = +m[1], b = +m[2]; const y = +m[3];
      const dmy = pref === 'DMY' || s.includes('.');
      if (a > 12 && b <= 12) return iso(y, b, a);
      if (b > 12 && a <= 12) return iso(y, a, b);
      return dmy ? iso(y, b, a) : iso(y, a, b);
    }
    m = s.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
    if (m) { const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()); if (mi >= 0) return iso(+m[3], mi + 1, +m[2]); }
    m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/);
    if (m) { const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()); if (mi >= 0) return iso(+m[3], mi + 1, +m[1]); }
    return '';
  }
  function addDays(isoDate, days) {
    if (!isoDate) return '';
    const [y, m, d] = isoDate.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
  }
  function daysBetween(a, b) { if (!a || !b) return null; return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
  /* "Net 30" | "2/10 Net 30" | "Due on receipt" | "Due in 21 days" | "30 days" -> { days, discount? } */
  function parseTerms(input) {
    const s = String(input || '').toLowerCase();
    if (!s.trim()) return null;
    if (/due\s*(up)?on\s*receipt|cod\b|immediate/.test(s)) return { days: 0, label: 'Due on receipt' };
    let m = s.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+)\s*,?\s*net\s*(\d+)/);
    if (m) return { days: +m[3], discount: { pct: +m[1], days: +m[2] }, label: m[1] + '/' + m[2] + ' Net ' + m[3] };
    m = s.match(/net\s*(\d+)/) || s.match(/(?:due\s*in|within)?\s*(\d+)\s*days?/);
    if (m) return { days: +m[1], label: /net/.test(s) ? 'Net ' + m[1] : 'Due in ' + m[1] + ' days' };
    return null;
  }
  function median(arr) { const a = arr.slice().sort((x, y) => x - y); if (!a.length) return 0; const k = Math.floor(a.length / 2); return a.length % 2 ? a[k] : (a[k - 1] + a[k]) / 2; }
  function stdev(arr) { if (arr.length < 2) return 0; const mu = arr.reduce((a, b) => a + b, 0) / arr.length; return Math.sqrt(arr.reduce((a, b) => a + (b - mu) * (b - mu), 0) / (arr.length - 1)); }
  return { r2, cents, eq, sum, parseAmount, detectCurrency, format, parseDate, DATE_RE, addDays, daysBetween, parseTerms, median, stdev, CODES };
});
