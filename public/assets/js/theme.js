/* Ustawia motyw panelu przed renderowaniem (bez migania) */
(function () {
  var t = null;
  try { t = localStorage.getItem('modulio-theme'); } catch (e) {}
  if (!t) t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
})();
