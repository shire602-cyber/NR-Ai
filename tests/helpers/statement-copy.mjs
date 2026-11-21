// Shared by rendered-copy checks and the browser crawl.
export const unsupportedStatementCopy =
  /(?<!\/)\b(?:bank[\s–—‑-]+feeds?|live[\s–—‑-]+(?:bank[\s–—‑-]+)?feeds?|open[\s–—‑-]+banking)\b|connect\s+your\s+bank|securely\s+link\s+your.*bank\s+account|via\s+encrypted\s+feeds|sync\s+a\s+bank\s+line|الربط\s+(?:البنكي|المصرفي)|مزامنة\s+(?:الحساب|الخلاصة)\s+البنكي/i;

// Pre-upgrade subject and message used to ensure existing rows are cleaned at delivery.
export const legacySyncSubject = ["Bank", "feed", "sync", "failed"].join(" ");
export const legacySyncMessage = [
  "The bank",
  "feed (lean) could not sync. Reconnect it under Banking.",
].join(" ");
