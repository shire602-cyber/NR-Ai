// Applies the saved colour theme before first paint so dark-mode users never
// see a light flash. Default is light; dark is opt-in (toggle in the top bar).
// Loaded as a same-origin script (CSP: script-src 'self').
// Keep in sync with client/src/lib/theme.ts (storage key + values).
(function () {
  try {
    var pref = localStorage.getItem("muhasib-theme");
    var dark =
      pref === "dark" ||
      (pref === "system" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.classList.add("dark");
  } catch {
    /* storage blocked: stay light */
  }
})();
