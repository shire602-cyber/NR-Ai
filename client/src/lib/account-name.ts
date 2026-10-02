/** An account's name in the reader's language: the Arabic name when the account has one, otherwise English. */
export function accountName(
  account: { nameEn?: string | null; nameAr?: string | null; name?: string | null } | null | undefined,
  locale: string
): string {
  if (!account) return "";
  const ar = account.nameAr?.trim();
  return (locale === "ar" && ar ? ar : account.nameEn || account.name || ar || "") as string;
}
