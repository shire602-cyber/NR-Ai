// Shared by rendered-copy checks and the browser crawl.
export const unsupportedStatementCopy =
  /(?<!\/)\b(?:bank[\s–—‑-]+feeds?|live[\s–—‑-]+(?:bank[\s–—‑-]+)?feeds?|open[\s–—‑-]+banking)\b|\b(?:re)?connect(?:s|ing)?\s+(?:a|their|your|the)\s+bank\b|\blink(?:s|ing)?\s+(?:a|their|your)\s+bank\b|\bfeeds?\s+(?:sync|connection)\b|\bbank\s+sync\b|\bsync(?:s|ing)?\s+(?:a|the)\s+feed\b|\bbanking\s+embedded\b|securely\s+link\s+your.*bank\s+account|via\s+encrypted\s+feeds|sync\s+a\s+bank\s+line|الربط\s+(?:البنكي|المصرفي)|مزامنة\s+(?:الحساب|الخلاصة)\s+البنكي/i;
