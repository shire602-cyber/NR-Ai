export interface SearchableClaim {
  claim_number?: string | null;
  title?: string | null;
  description?: string | null;
  status?: string | null;
}

/** Case-insensitive match on claim number, title, description or status; blank query keeps all. */
export function filterClaims<T extends SearchableClaim>(claims: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return claims;
  return claims.filter((c) =>
    [c.claim_number, c.title, c.description, c.status].some((v) =>
      (v ?? "").toLowerCase().includes(q)
    )
  );
}
