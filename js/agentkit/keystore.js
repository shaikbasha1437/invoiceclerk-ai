/* AgentKit key store: API keys live only in this browser (localStorage, or sessionStorage when the
   user picks "this tab only"). Keys are never put in URLs, share links or exports: redact() scrubs
   any object before it leaves the app. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.AgentKit = root.AgentKit || {}).keystore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const KEY_FIELD = /^(api[_-]?key|key|apikey|token|secret|password|authorization|x-api-key|x-goog-api-key)$/i;
  const KEY_VALUE = /\b(sk-(ant-|proj-|or-)?[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,}|gsk_[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}|tvly-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._-]{16,})\b/g;
  function createKeyStore(opts) {
    const prefix = (opts && opts.prefix) || 'agentkit';
    const local = opts && 'local' in opts ? opts.local : (typeof localStorage !== 'undefined' ? localStorage : null);
    const session = opts && 'session' in opts ? opts.session : (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
    const name = (p) => prefix + '.key.' + p;
    function get(p) { try { return (session && session.getItem(name(p))) || (local && local.getItem(name(p))) || ''; } catch (e) { return ''; } }
    function where(p) { try { if (session && session.getItem(name(p))) return 'session'; if (local && local.getItem(name(p))) return 'local'; } catch (e) { /* ignore */ } return ''; }
    function set(p, key, mode) {
      clear(p);
      if (!key) return;
      const s = mode === 'session' ? session : local;
      if (s) s.setItem(name(p), String(key).trim());
    }
    function clear(p) { try { local && local.removeItem(name(p)); session && session.removeItem(name(p)); } catch (e) { /* ignore */ } }
    function clearAll(list) { (list || []).forEach(clear); }
    return { get, set, clear, clearAll, where };
  }
  function redactString(s, known) {
    let out = String(s).replace(KEY_VALUE, '[redacted]');
    (known || []).filter((k) => k && k.length >= 8).forEach((k) => { out = out.split(k).join('[redacted]'); });
    return out;
  }
  // Deep copy without secrets: drops key-like fields and masks key-looking strings.
  function redact(obj, known) {
    if (obj == null) return obj;
    if (typeof obj === 'string') return redactString(obj, known);
    if (Array.isArray(obj)) return obj.map((x) => redact(x, known));
    if (typeof obj === 'object') {
      const out = {};
      for (const k of Object.keys(obj)) { if (KEY_FIELD.test(k)) continue; out[k] = redact(obj[k], known); }
      return out;
    }
    return obj;
  }
  return { createKeyStore, redact, redactString, KEY_VALUE };
});
