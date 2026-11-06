/* AgentKit guard: treats customer-supplied text as untrusted data. Detects prompt-injection
   patterns, strips invisible characters, and wraps text in clearly fenced blocks for prompts.
   Detection only ever ADDS caution (flag + human review); nothing in the text can change rules. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.AgentKit = root.AgentKit || {}).guard = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const RULES = [
    { id: 'override', label: 'Tries to override instructions', w: 0.6, re: /\b(ignore|disregard|forget|override|bypass|skip)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|your|the|system)\b[^.\n]{0,30}\b(instructions?|rules?|prompts?|polic(y|ies)|guidelines?|directives?|guardrails?)/i },
    { id: 'role', label: 'Tries to reassign the assistant\u2019s role', w: 0.45, re: /\b(you are now|from now on,? you|act as (an? )?(admin|administrator|developer|system|manager|supervisor)|pretend (to be|you are)|new persona|developer mode|DAN mode|jailbreak)\b/i },
    { id: 'system', label: 'Mentions system or hidden prompts', w: 0.45, re: /\b(system prompt|hidden prompt|initial instructions|your instructions|internal (rules|notes|instructions)|reveal (your|the) (prompt|rules|instructions|configuration))\b|<\/?(system|assistant|instructions?)>|\[\/?(INST|SYS)\]|^\s*(system|assistant)\s*:/im },
    { id: 'action', label: 'Demands a privileged action', w: 0.4, re: /\b(approve|issue|process|grant|authori[sz]e)\b[^.\n]{0,30}\b(full |immediate |a )?(refund|credit|admin access|access|discount|override)\b[^.\n]{0,40}\b(without|no need|regardless|automatically|immediately|do not (ask|escalate|check))\b|\b(mark|set|close)\b[^.\n]{0,25}\b(as )?(resolved|approved|vip|priority)\b[^.\n]{0,30}\b(without|automatically|immediately)\b/i },
    { id: 'noescalate', label: 'Asks the agent not to involve a human', w: 0.35, re: /\b(do not|don't|never|no need to)\b[^.\n]{0,20}\b(escalate|involve|loop in|tell|notify|forward to)\b[^.\n]{0,25}\b(human|agent|manager|supervisor|anyone|staff)/i },
    { id: 'exfil', label: 'Asks for other customers\u2019 data or secrets', w: 0.5, re: /\b(list|show|send|give|print|dump|export)\b[^.\n]{0,40}\b(all|other|every)\b[^.\n]{0,20}\b(customers?|users?|accounts?|emails?|api keys?|passwords?|tokens?|credentials)\b|\b(api[_ -]?key|password|secret|token)s? (of|for) (other|all|every)/i },
    { id: 'encoded', label: 'Contains an encoded or hidden payload', w: 0.3, re: /\b(base64|rot13|decode this|hex encoded)\b|[A-Za-z0-9+/]{60,}={0,2}/i },
    { id: 'comment', label: 'Hidden HTML comment or markup', w: 0.3, re: /<!--[\s\S]*?-->|<\s*(script|iframe|img[^>]+onerror)/i }
  ];
  const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD]/g;
  function detectInjection(text) {
    const raw = String(text || '');
    const findings = [];
    const invisible = (raw.match(INVISIBLE) || []).length;
    const clean = raw.replace(INVISIBLE, '');
    // Also scan the inside of HTML comments on their own lines, so hidden 'assistant: ...' notes are caught.
    const hidden = (clean.match(/<!--([\s\S]*?)-->/g) || []).map((c) => c.slice(4, -3).trim()).join('\n');
    const scan = hidden ? clean + '\n' + hidden : clean;
    let score = 0;
    for (const r of RULES) {
      const m = scan.match(r.re);
      if (m) { findings.push({ rule: r.id, label: r.label, match: m[0].slice(0, 120) }); score += r.w; }
    }
    if (invisible >= 3) { findings.push({ rule: 'invisible', label: 'Invisible characters (' + invisible + ')', match: '' }); score += 0.25; }
    score = Math.min(1, score);
    return { flagged: score >= 0.35, score: Math.round(score * 100) / 100, findings };
  }
  function sanitize(text) { return String(text || '').replace(INVISIBLE, '').replace(/<!--[\s\S]*?-->/g, '[hidden comment removed]'); }
  // Fence untrusted text for an LLM prompt. The closing tag is neutralised inside the content.
  function fence(tag, text) {
    const safe = sanitize(text).replace(new RegExp('</?\\s*' + tag + '\\s*>', 'gi'), '[tag removed]');
    return '<' + tag + '>\n' + safe + '\n</' + tag + '>';
  }
  return { RULES, detectInjection, sanitize, fence };
});
