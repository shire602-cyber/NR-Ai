export interface SearchableClaim {
  claim_number?: string | null;
  title?: string | null;
  description?: string | null;
  status?: string | null;
}

/**
 * Case-insensitive match on claim number, title, description or status; blank query keeps all.
 * `statusLabel` supplies the localized badge text so the visible label matches too (the raw
 * status keeps matching either way).
 */
export function filterClaims<T extends SearchableClaim>(
  claims: T[],
  query: string,
  statusLabel?: (status: string) => string | null | undefined
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return claims;
  return claims.filter((c) =>
    [
      c.claim_number,
      c.title,
      c.description,
      c.status,
      c.status && statusLabel ? statusLabel(c.status) : null,
    ].some((v) => (v ?? "").toLowerCase().includes(q))
  );
}
