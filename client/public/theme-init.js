// Applies the public site's light/dark theme before first paint so there is no
// flash of the wrong theme. The preference ("light" | "dark", else follow the
// OS) is stored by client/src/components/marketing/hooks.ts. Only public pages
// opt in here; the signed-in app owns its own theme.
(function () {
  try {
    var publicPaths =
      /^\/(|pricing|services|demo|login|register|forgot-password|reset-password|verify-email|privacy|terms|cookies|help|trust|migration-guides)\/?$/;
    if (!publicPaths.test(window.location.pathname)) return;
    var pref = window.localStorage.getItem("muhasib-theme");
    var dark =
      pref === "dark" ||
      (pref !== "light" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) {
      document.documentElement.classList.add("dark");
      document.documentElement.style.colorScheme = "dark";
    }
  } catch {
    /* storage blocked: stay light */
  }
})();
