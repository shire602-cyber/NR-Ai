/** Case-insensitive "contains" match over document fields (number, party, bill ref...). */
export function matchesDocumentSearch(
  query: string,
  ...fields: Array<string | number | null | undefined>
): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return true;
  return fields.some((f) => f != null && String(f).toLocaleLowerCase().includes(q));
}
