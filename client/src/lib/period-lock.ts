// Period lock rules the month-end screen follows (teardown 7 #6). The server enforces every one of them; these keep the
// screen from offering what it would refuse.

export const UNLOCK_REASON_MIN_LENGTH = 10;
export const VAT_CHECKLIST_ITEM_ID = 7;

/** Only the company's owner, a firm owner or a platform admin may reopen a locked month (the server checks the same). */
export function canUnlockPeriod(
  user: { isAdmin?: boolean | null; firmRole?: string | null } | null | undefined,
  memberRole: string | null | undefined
): boolean {
  if (!user) return false;
  return user.isAdmin === true || user.firmRole === "firm_owner" || memberRole === "owner";
}

export const unlockReasonOk = (reason: string): boolean =>
  reason.trim().length >= UNLOCK_REASON_MIN_LENGTH;

interface ChecklistLike {
  id: number;
  status: "complete" | "incomplete";
}

/** Is the VAT return item of the checklist still open? Locking then needs an explicit override. */
export function vatItemOpen(checklist: ChecklistLike[] | undefined | null): boolean {
  return (checklist ?? []).some((i) => i.id === VAT_CHECKLIST_ITEM_ID && i.status === "incomplete");
}

/** Body of the lock request: the override and its written reason are sent only when the VAT item is open and the person ticked it. */
export function lockBody(
  periodEnd: string,
  vatOpen: boolean,
  override: boolean,
  overrideReason = ""
): { periodEnd: string; overrideVatCheck?: true; overrideReason?: string } {
  return vatOpen && override
    ? { periodEnd, overrideVatCheck: true, overrideReason: overrideReason.trim() }
    : { periodEnd };
}

/** Locking goes ahead when the VAT item is closed, or when it is open and the override is ticked with a written reason. */
export const lockAllowed = (vatOpen: boolean, override: boolean, overrideReason = ""): boolean =>
  !vatOpen || (override && unlockReasonOk(overrideReason));

/** The body of the unlock request (one month, YYYY-MM). */
export function unlockBody(
  companyId: string,
  period: string,
  reason: string
): { companyId: string; period: string; reason: string } {
  return { companyId, period, reason: reason.trim() };
}

/** Where the audit entry of an unlock can be read: the Audit Trail report filtered to unlocks. */
export const UNLOCK_AUDIT_HREF = "/reports/run/audit-trail?action=period.unlock";
