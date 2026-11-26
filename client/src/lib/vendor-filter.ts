/** Case-insensitive supplier search on name (either language), TRN or email. */
export function filterVendors<
  V extends {
    name: string;
    nameAr: string | null;
    trn: string | null;
    email: string | null;
  },
>(vendors: V[], term: string): V[] {
  const q = term.trim().toLowerCase();
  if (!q) return vendors;
  return vendors.filter((v) =>
    [v.name, v.nameAr, v.trn, v.email].some((f) => f?.toLowerCase().includes(q))
  );
}
