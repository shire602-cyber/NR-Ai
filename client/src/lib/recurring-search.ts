/** Case-insensitive match of a search term against a schedule's customer, frequency and status. */
export function matchesRecurringSearch(
  item: { customerName: string; isActive: boolean },
  term: string,
  labels: { frequency: string; status: string }
): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  return [item.customerName, labels.frequency, labels.status].some((v) =>
    (v ?? "").toLowerCase().includes(q)
  );
}
