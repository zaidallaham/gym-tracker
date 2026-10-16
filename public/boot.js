/* Runs before first paint (loaded without defer from <head>). Kept out of index.html so the
   Content-Security-Policy can forbid inline scripts. */
// Start loading the exercise library now, while app.js is still on its way; app.js picks the
// response up (null if this attempt failed, and app.js tries again).
window.EXERCISES = fetch('data/exercises.json').catch(function () { return null; });
// Apply a forced theme before first paint so there is no flash.
try { var t = localStorage.getItem('gym-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) {}
// "Desktop site" mode on a phone ignores the viewport tag: the page is laid out ~980px wide and
// shrunk to fit. Detect that (touch screen much narrower than the layout) and zoom the UI back up.
(function () {
  var root = document.documentElement;
  function fit() {
    var w = window.innerWidth, s = screen.width, z = 1;
    if (s > 0 && s < 820 && w > s * 1.2 && matchMedia('(pointer: coarse)').matches) z = Math.round(w / s * 1000) / 1000;
    root.style.zoom = z === 1 ? '' : String(z);
    root.style.setProperty('--zoom', String(z));
    window.UI_ZOOM = z;
  }
  fit();
  addEventListener('resize', fit);
})();
