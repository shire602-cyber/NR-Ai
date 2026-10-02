// Is a Connect checkout event trustworthy enough to post money? Pure module (unit-tested).
//
// Metadata on a Stripe object is NOT proof: anyone with a Stripe account can create a checkout session whose metadata
// names another company's invoice. So money is posted only when OUR OWN records agree with the signed event: we created
// the session (a payment_links row has this session id), the event's connected account is the one connected to the
// company that owns the link, the invoice named in the metadata (if any) is the link's invoice, and the amount and
// currency are what we asked for. Anything else posts nothing.

export interface SessionLike {
  id?: string | null;
  payment_status?: string | null;
  payment_intent?: string | { id?: string } | null;
  amount_total?: number | null;
  currency?: string | null;
  metadata?: Record<string, string> | null;
}

export interface LinkLike {
  companyId: string;
  invoiceId: string;
  amount: number | string;
  currency: string;
}

export interface ConnectionLike {
  companyId: string;
  externalAccountId: string | null;
  status: string;
}

export type SessionVerdict =
  | { ok: true; paymentId: string; amount: number; currency: string }
  | {
      ok: false;
      reason:
        | "no_account"
        | "unknown_session"
        | "foreign_account"
        | "invoice_mismatch"
        | "amount_mismatch"
        | "currency_mismatch"
        | "not_paid"
        | "no_payment_id";
    };

export function verifyCheckoutCompleted(args: {
  eventAccount: string | null | undefined;
  session: SessionLike;
  link: LinkLike | null;
  /** The ACTIVE connection whose external account is `eventAccount`. */
  connection: ConnectionLike | null;
}): SessionVerdict {
  const { eventAccount, session, link, connection } = args;
  if (!eventAccount) return { ok: false, reason: "no_account" };
  if (!link) return { ok: false, reason: "unknown_session" };
  if (!connection || connection.status !== "active" || connection.externalAccountId !== eventAccount || connection.companyId !== link.companyId) {
    return { ok: false, reason: "foreign_account" };
  }
  const claimedInvoice = session.metadata?.invoiceId;
  if (claimedInvoice && claimedInvoice !== link.invoiceId) return { ok: false, reason: "invoice_mismatch" };
  if (String(session.currency ?? "").toUpperCase() !== link.currency.toUpperCase()) return { ok: false, reason: "currency_mismatch" };
  const paid = Number(session.amount_total) / 100;
  if (!Number.isFinite(paid) || Math.abs(paid - Number(link.amount)) > 0.005) return { ok: false, reason: "amount_mismatch" };
  if (session.payment_status !== "paid") return { ok: false, reason: "not_paid" };
  const paymentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!paymentId) return { ok: false, reason: "no_payment_id" };
  return { ok: true, paymentId, amount: paid, currency: String(session.currency).toUpperCase() };
}
