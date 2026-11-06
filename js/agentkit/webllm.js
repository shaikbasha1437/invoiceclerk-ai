/* AgentKit in-browser model via WebLLM (WebGPU). Lazy-loaded from a CDN only when the user asks.
   Exposes the same call() shape as llm.js so the pipeline does not care where the model runs. */
(function (root) {
  'use strict';
  const CDN = 'https://esm.run/@mlc-ai/web-llm@0.2.87';
  const MODELS = [
    { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 1.5B (about 1 GB download)' },
    { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B (about 0.9 GB download)' },
    { id: 'Phi-3.5-mini-instruct-q4f16_1-MLC', label: 'Phi-3.5 mini (about 2.2 GB download)' }
  ];
  let engine = null; let engineModel = ''; let loading = null;
  async function support() {
    if (typeof navigator === 'undefined' || !navigator.gpu) return { ok: false, reason: 'This browser has no WebGPU. Try a recent Chrome or Edge on a computer, or use demo mode or your own key.' };
    try { const a = await navigator.gpu.requestAdapter(); if (!a) return { ok: false, reason: 'WebGPU is present but no GPU adapter is available here.' }; } catch (e) { return { ok: false, reason: 'WebGPU could not start: ' + e.message }; }
    return { ok: true };
  }
  function load(model, onProgress) {
    if (engine && engineModel === model) return Promise.resolve(engine);
    if (loading) return loading;
    loading = (async () => {
      const s = await support(); if (!s.ok) throw new Error(s.reason);
      const lib = await import(CDN);
      engine = await lib.CreateMLCEngine(model, { initProgressCallback: (p) => onProgress && onProgress(p) });
      engineModel = model;
      return engine;
    })();
    loading.finally(() => { loading = null; });
    return loading;
  }
  async function call(cfg, msg) {
    const e = await load(cfg.model || MODELS[0].id, cfg.onProgress);
    const t0 = performance.now();
    const r = await e.chat.completions.create({ messages: [{ role: 'system', content: msg.system }].concat(msg.messages), max_tokens: msg.maxTokens || 600, temperature: msg.temperature == null ? 0.2 : msg.temperature });
    return { text: r.choices[0].message.content || '', usage: { input: (r.usage && r.usage.prompt_tokens) || 0, output: (r.usage && r.usage.completion_tokens) || 0 }, latencyMs: Math.round(performance.now() - t0), cost: 0, model: engineModel };
  }
  (root.AgentKit = root.AgentKit || {}).webllm = { CDN, MODELS, support, load, call, get loaded() { return engineModel; } };
})(typeof self !== 'undefined' ? self : this);
