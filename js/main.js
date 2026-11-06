/* Boot: theme, offline banner, service worker, first paint. */
(function () {
  'use strict';
  const app = IC.app; const { $, toast } = IC.ui;
  const applyTheme = () => { const t = app.settings().theme; if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
  applyTheme();
  $('#theme-btn').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    app.saveSettings({ theme: dark ? 'light' : 'dark' }); applyTheme(); toast((dark ? 'Light' : 'Dark') + ' theme.');
  });
  $('#about-btn').addEventListener('click', () => app.about());
  $('#mode-chip').addEventListener('click', () => app.go('#settings/model'));
  const net = () => { $('#offline-bar').hidden = navigator.onLine; };
  window.addEventListener('online', net); window.addEventListener('offline', net); net();
  if (!location.hash) history.replaceState(history.state, '', location.pathname + location.search + '#inbox');
  app.refresh();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { /* offline support unavailable */ });
})();
