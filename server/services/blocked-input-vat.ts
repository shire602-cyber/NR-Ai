// Blocked input VAT (Art. 53, Cabinet Decision 52/2017): client entertainment and similar costs carry VAT the
// business can never recover. ONE rule for every place that decides it, so the posting, the VAT return (box 9) and
// the VAT Audit cannot disagree:
//   - posting: the VAT is part of the expense (Dr expense net + VAT), nothing goes to Input VAT (1050);
//   - return: the document is not a box 9 expense at all (neither its amount nor its VAT);
//   - audit rows: shown, marked blocked, recoverable 0.
// The rule is the category of the document (receipt, bill, expense-claim item): "entertainment" in any spelling.

const BLOCKED_CATEGORY = /entertain|ترفيه|ضيافة/i;

/** True when a document of this category carries blocked input VAT. */
export function isBlockedInputCategory(category: string | null | undefined): boolean {
  return BLOCKED_CATEGORY.test(String(category ?? ""));
}

/** The same rule in SQL, for the VAT loaders: `categoryColumn` is a column expression such as r.category. */
export const blockedInputSql = (categoryColumn: string): string =>
  `(COALESCE(${categoryColumn}, '') ~* 'entertain|ترفيه|ضيافة')`;
