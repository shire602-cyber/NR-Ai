/**
 * Quote state machine (S1, W4-D follow-up). Every quote status change outside conversion goes
 * through here, as ONE conditional UPDATE ... WHERE status IN (<allowed sources>) RETURNING, so
 * two writers racing on the same quote cannot both win and nothing writes quotes.status directly.
 *
 *   draft     -> sent | accepted | declined | expired
 *   sent      -> draft | accepted | declined | expired
 *   accepted  -> sent | declined
 *   declined  -> draft | sent
 *   expired   -> draft | sent
 *   converted -> (terminal; only convertQuoteAtomically enters it)
 *
 * `quotes.respond` (registered in the service registry) is the customer's answer from the portal:
 * only a SENT, unexpired quote of that contact can be accepted or declined, once, and the signed
 * response row is written in the same transaction.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { DomainError } from "../errors";
import { has, provide } from "../platform/service-registry";
import { portalQuoteResponses, quotes, type Quote } from "../../shared/schema";

export const QUOTE_STATUSES = [
  "draft",
  "sent",
  "accepted",
  "declined",
  "expired",
  "converted",
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
  draft: ["sent", "accepted", "declined", "expired"],
  sent: ["draft", "accepted", "declined", "expired"],
  accepted: ["sent", "declined"],
  declined: ["draft", "sent"],
  expired: ["draft", "sent"],
  converted: [],
};

export function canTransitionQuote(from: string, to: string): boolean {
  return (QUOTE_TRANSITIONS[from as QuoteStatus] ?? []).includes(to as QuoteStatus);
}

/** Statuses a quote may move to `to` from. */
export function quoteSourcesFor(to: QuoteStatus): QuoteStatus[] {
  return QUOTE_STATUSES.filter((s) => QUOTE_TRANSITIONS[s].includes(to));
}

type Tx = typeof db;

/**
 * Move a quote to `to`. 409 QUOTE_ALREADY_CONVERTED for a converted quote, 409
 * QUOTE_INVALID_TRANSITION otherwise when the current status cannot move there.
 * `from` narrows the accepted sources (the portal only answers a `sent` quote).
 */
export async function transitionQuote(args: {
  companyId: string;
  quoteId: string;
  to: QuoteStatus;
  from?: readonly QuoteStatus[];
  tx?: Tx;
}): Promise<Quote> {
  const exec = args.tx ?? db;
  const sources = quoteSourcesFor(args.to).filter((s) => !args.from || args.from.includes(s));
  const [row] = sources.length
    ? await exec
        .update(quotes)
        .set({ status: args.to, updatedAt: new Date() })
        .where(
          and(
            eq(quotes.id, args.quoteId),
            eq(quotes.companyId, args.companyId),
            inArray(quotes.status, sources)
          )
        )
        .returning()
    : [];
  if (row) return row;
  const [current] = await exec
    .select({ status: quotes.status })
    .from(quotes)
    .where(and(eq(quotes.id, args.quoteId), eq(quotes.companyId, args.companyId)));
  if (!current) throw new DomainError("QUOTE_NOT_FOUND", 404, undefined, "Quote not found");
  if (current.status === "converted") {
    throw new DomainError("QUOTE_ALREADY_CONVERTED", 409, undefined, "Quote already converted");
  }
  throw new DomainError(
    "QUOTE_INVALID_TRANSITION",
    409,
    { from: current.status, to: args.to },
    `A ${current.status} quote cannot be marked ${args.to}.`
  );
}

export interface QuoteResponseInput {
  companyId: string;
  quoteId: string;
  contactId: string;
  decision: "accepted" | "declined";
  signerName: string;
  comment?: string | null;
  ip?: string | null;
  now?: Date;
}

const DAY_MS = 86_400_000;

/** The customer's portal answer (see header). Returns the updated quote. */
export async function respondToQuote(input: QuoteResponseInput): Promise<Quote> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx: Tx) => {
    const [q] = await tx
      .select()
      .from(quotes)
      .where(
        and(
          eq(quotes.id, input.quoteId),
          eq(quotes.companyId, input.companyId),
          eq(quotes.contactId, input.contactId)
        )
      );
    // Another contact's (or tenant's) quote is a 404, never a 403.
    if (!q) throw new DomainError("QUOTE_NOT_FOUND", 404);
    if (q.status !== "sent") {
      throw new DomainError("QUOTE_NOT_OPEN", 409, undefined, "This quote cannot be answered");
    }
    if (q.expiryDate && new Date(q.expiryDate).getTime() < now.getTime() - DAY_MS) {
      throw new DomainError("QUOTE_EXPIRED", 409, undefined, "This quote has expired");
    }
    let updated: Quote;
    try {
      updated = await transitionQuote({
        companyId: input.companyId,
        quoteId: q.id,
        to: input.decision,
        from: ["sent"],
        tx,
      });
    } catch (err) {
      // Lost a race with another answer (or an internal status change).
      if (err instanceof DomainError && err.statusCode === 409) {
        throw new DomainError("QUOTE_NOT_OPEN", 409, undefined, "This quote cannot be answered");
      }
      throw err;
    }
    await tx.insert(portalQuoteResponses).values({
      companyId: input.companyId,
      quoteId: q.id,
      contactId: input.contactId,
      decision: input.decision,
      signerName: input.signerName,
      comment: input.comment ?? null,
      ip: input.ip ?? null,
    });
    return updated;
  });
}

export type QuotesRespond = typeof respondToQuote;

/** Idempotent: safe on every route registration (tests rebuild the app). */
export function registerQuoteServices(): void {
  if (!has("quotes.respond")) provide("quotes.respond", respondToQuote);
}
