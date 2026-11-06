/* Uploaded invoice files are kept in this browser's IndexedDB (never uploaded anywhere). */
(function (root) {
  'use strict';
  const DB = 'invoiceclerk-files'; const OS = 'files';
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(OS); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return dbp;
  }
  const tx = (mode, fn) => db().then((d) => new Promise((res, rej) => { const t = d.transaction(OS, mode); const q = fn(t.objectStore(OS)); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }));
  const put = (key, blob) => tx('readwrite', (s) => s.put(blob, key));
  const get = (key) => tx('readonly', (s) => s.get(key));
  const del = (key) => tx('readwrite', (s) => s.delete(key));
  const clear = () => tx('readwrite', (s) => s.clear());
  (root.IC = root.IC || {}).files = { put, get, del, clear };
})(self);
