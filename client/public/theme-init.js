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

// Same for the language: the stored locale sets <html lang dir> before first paint, so an Arabic
// visitor never sees a left-to-right shell flip after the app mounts. Keep in sync with
// client/src/lib/i18n.ts (storage key "i18n-storage", applyDocumentLocale).
(function () {
  var routeLocale = window.location.pathname.match(/^\/(ar|en)(?:\/|$)/);
  if (routeLocale) {
    document.documentElement.lang = routeLocale[1];
    document.documentElement.dir = routeLocale[1] === "ar" ? "rtl" : "ltr";
    document.documentElement.classList.add(document.documentElement.dir);
    return;
  }
  try {
    var raw = localStorage.getItem("i18n-storage");
    var state = raw && JSON.parse(raw).state;
    if (state && state.locale === "ar") {
      var html = document.documentElement;
      html.lang = "ar";
      html.dir = "rtl";
      html.classList.add("rtl");
    }
  } catch {
    /* storage blocked or unparsable: stay English */
  }
})();
