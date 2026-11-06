/* Optional OCR with Tesseract.js, loaded from jsDelivr only when the user turns it on (about 15 MB
   with the English model, cached by the browser afterwards). Runs entirely in this browser. */
(function (root) {
  'use strict';
  const CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/tesseract.min.js';
  let loading = null; let worker = null;
  function load() {
    if (root.Tesseract) return Promise.resolve(root.Tesseract);
    if (loading) return loading;
    loading = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = CDN; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = () => (root.Tesseract ? res(root.Tesseract) : rej(new Error('Tesseract.js did not load.')));
      s.onerror = () => { loading = null; rej(new Error('Could not download Tesseract.js (offline or blocked).')); };
      document.head.append(s);
    });
    return loading;
  }
  async function recognize(image, onProgress) {
    const T = await load();
    if (!worker) worker = await T.createWorker('eng', 1, { logger: (m) => onProgress && onProgress(m) });
    const { data } = await worker.recognize(image);
    return { text: data.text, confidence: data.confidence };
  }
  (root.IC = root.IC || {}).ocr = { CDN, load, recognize, get ready() { return !!worker; } };
})(self);
