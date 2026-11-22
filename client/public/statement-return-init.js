// Capture the provider return before the app or any lazy chunks load.
(() => {
  const { pathname, search } = window.location;
  if (!/^\/(?:bank-feeds|banking)\/callback\/?$/i.test(pathname) || !search) return;

  const reference = {
    returnId: crypto.randomUUID(),
    tabKey: crypto.randomUUID(),
  };
  const startedAt = Date.now();
  window.__statementReturn = { reference, search };
  try {
    sessionStorage.setItem(
      "muhasib:statement-authorization",
      JSON.stringify({ reference, startedAt })
    );
  } catch {
    // The current tab can still use the in-memory return if storage is unavailable.
  }
  history.replaceState(history.state, "", "/bank-feeds/callback");
})();
