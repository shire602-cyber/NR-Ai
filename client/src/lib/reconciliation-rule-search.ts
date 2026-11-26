/** Case-insensitive match of a search term against a reconciliation rule's visible text. */
export function matchesRuleSearch(
  rule: { name: string; matchValue: string; category: string | null; memo: string | null },
  term: string,
  labels: { field: string; type: string }
): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  return [rule.name, rule.matchValue, rule.category, rule.memo, labels.field, labels.type].some(
    (v) => (v ?? "").toLowerCase().includes(q)
  );
}
