/** A failed module fetch can stay cached by the browser, so recovery is a full page reload. */
export const yearEndRecovery = { reload: () => window.location.reload() };
