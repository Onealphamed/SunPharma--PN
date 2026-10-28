// Applies the colour theme before the page paints (no flash of the wrong theme).
// A saved choice wins; otherwise the device's light/dark setting is followed.
(function () {
  var saved = null;
  try {
    saved = localStorage.getItem('sunpm.theme');
  } catch (e) {
    /* storage unavailable */
  }
  var dark = saved ? saved === 'dark' : !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
