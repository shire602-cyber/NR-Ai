/** Chart-of-accounts display name: the Arabic name in Arabic mode when one exists. */
export function accountDisplayName(
  account:
    | { nameEn?: string | null; nameAr?: string | null; name?: string | null }
    | null
    | undefined,
  locale: string
): string {
  if (!account) return "";
  if (locale === "ar" && account.nameAr) return account.nameAr;
  return account.nameEn || account.name || "";
}
