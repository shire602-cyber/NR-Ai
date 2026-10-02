// Quote send / accept / decline / revise / expiry (Phase 8 D1).
//
// A quote is sent from the app (which mints a public link), the customer accepts or declines on a public page with
// their name and email, and the answer is a SIGNATURE RECORD (who, when, from where, a hash of exactly what they
// agreed to), kept 5 years (Decree-Law 8/2017 Art. 78). Every state change runs under the quote's document lock;
// accept/decline additionally lock the row FOR UPDATE and a unique index on the live signature backstops a race.
// Nothing here posts to the ledger.

import crypto from "crypto";
import { and, asc, eq, lt, sql } from "drizzle-orm";
import { db } from "../db";
import {
  customerContacts,
  quoteLines,
  quoteSignatures,
  quotes,
  type Company,
  type Quote,
  type QuoteLine,
  type QuoteSignature,
} from "../../shared/schema";
import { storage } from "../storage";
import { AppError } from "../errors";
import { createLogger } from "../config/logger";
import { LOCK_NS, withDocumentLock } from "./document-lock";
import { canQuoteTransition, isQuoteExpiredByDate, quoteContentHash } from "./quote-state-machine";
import { assertEmailSent, emailStatus, EMAIL_NOT_CONFIGURED_MESSAGE, escapeHtml, sendEmail } from "./email.service";
import { pdfFieldsFor } from "./custom-fields.service";
import { uaeTodayYmd } from "./late-fee.service";

const log = createLogger("quote-acceptance");
const SHARE_GRACE_DAYS = 30;
const DEFAULT_SHARE_DAYS = 90;
const SIGNATURE_RETENTION_YEARS = 5;

const refuse = (statusCode: number, code: string, message: string) => new AppError({ message, statusCode, code });
const rowsOf = (res: any): any[] => (res?.rows ?? res) as any[];
const dayOf = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString().slice(0, 10) : null);

export function publicQuoteUrl(token: string): string {
  return `/view/quote/${token}`;
}

// ─── send ───────────────────────────────────────────────────────────────────

export interface SendQuoteResult {
  quote: Quote;
  shareUrl: string;
  emailed: boolean;
  emailError?: string;
}

export async function sendQuote(args: {
  companyId: string;
  quoteId: string;
  userId: string;
  email?: string | null;
  message?: string | null;
  /** Absolute origin for the link in the email, e.g. https://app.example.com. */
  origin?: string | null;
}): Promise<SendQuoteResult> {
  const { companyId, quoteId } = args;
  const updated = await withDocumentLock(quoteId, LOCK_NS.QUOTE, async (tx: typeof db) => {
    const [quote] = await tx.select().from(quotes).where(and(eq(quotes.id, quoteId), eq(quotes.companyId, companyId)));
    if (!quote) throw refuse(404, "QUOTE_NOT_FOUND", "Quote not found");
    if (!canQuoteTransition(quote.status, "send")) {
      throw refuse(409, "QUOTE_NOT_DRAFT", `Only a draft quote can be sent (this one is ${quote.status}).`);
    }
    const lines = await tx.select({ id: quoteLines.id }).from(quoteLines).where(eq(quoteLines.quoteId, quoteId)).limit(1);
    if (lines.length === 0) throw refuse(422, "QUOTE_HAS_NO_LINES", "A quote needs at least one line before it is sent.");
    if (quote.expiryDate && isQuoteExpiredByDate(dayOf(quote.expiryDate), uaeTodayYmd())) {
      throw refuse(422, "QUOTE_EXPIRY_IN_PAST", "The quote's valid-until date has already passed. Change it before sending.");
    }
    const token = crypto.randomBytes(24).toString("hex");
    const expiresAt = quote.expiryDate
      ? new Date(new Date(quote.expiryDate).getTime() + SHARE_GRACE_DAYS * 86_400_000)
      : new Date(Date.now() + DEFAULT_SHARE_DAYS * 86_400_000);
    const [row] = await tx
      .update(quotes)
      .set({ status: "sent", shareToken: token, shareTokenExpiresAt: expiresAt, sentAt: new Date(), updatedAt: new Date() } as any)
      .where(eq(quotes.id, quoteId))
      .returning();
    return row;
  });

  const shareUrl = publicQuoteUrl(updated.shareToken as string);
  const result: SendQuoteResult = { quote: updated, shareUrl, emailed: false };

  // The mail is best effort: the quote IS sent (the link works) whether or not the email goes out.
  let to = args.email?.trim() || null;
  if (!to && updated.contactId) {
    const [contact] = await db
      .select({ email: customerContacts.email })
      .from(customerContacts)
      .where(and(eq(customerContacts.id, updated.contactId), eq(customerContacts.companyId, companyId)));
    to = contact?.email?.trim() || null;
  }
  if (!to) {
    result.emailError = "No email address: share the link with the customer yourself.";
    return result;
  }
  if (!emailStatus().configured) {
    result.emailError = EMAIL_NOT_CONFIGURED_MESSAGE;
    return result;
  }
  try {
    const company = await storage.getCompany(companyId);
    if (!company) throw new Error("Company not found");
    const link = `${(args.origin || "").replace(/\/$/, "")}${shareUrl}`;
    const intro = args.message ? `${args.message}\n\n` : "";
    const body = `${intro}Please review quote ${updated.number} from ${company.name} and accept or decline it online:\n${link}`;
    const html =
      `${args.message ? `<p>${escapeHtml(args.message).replace(/\n/g, "<br>")}</p>` : ""}` +
      `<p>Please review quote <strong>${escapeHtml(updated.number)}</strong> from ${escapeHtml(company.name)} and accept or decline it online:</p>` +
      `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`;
    assertEmailSent(await sendEmail(to, `Quote ${updated.number} from ${company.name}`, body, { fromName: company.name, html }));
    result.emailed = true;
  } catch (err: any) {
    result.emailError = err?.message || "The email could not be sent.";
  }
  return result;
}

// ─── revise ─────────────────────────────────────────────────────────────────

/** sent / declined / expired -> draft: the link stops working and the earlier signature is superseded (kept). */
export async function reviseQuote(args: { companyId: string; quoteId: string }): Promise<Quote> {
  return await withDocumentLock(args.quoteId, LOCK_NS.QUOTE, async (tx: typeof db) => {
    const [quote] = await tx.select().from(quotes).where(and(eq(quotes.id, args.quoteId), eq(quotes.companyId, args.companyId)));
    if (!quote) throw refuse(404, "QUOTE_NOT_FOUND", "Quote not found");
    if (!canQuoteTransition(quote.status, "revise")) {
      throw refuse(409, "QUOTE_NOT_REVISABLE", `A ${quote.status} quote cannot be revised.`);
    }
    await tx
      .update(quoteSignatures)
      .set({ supersededAt: new Date() } as any)
      .where(and(eq(quoteSignatures.quoteId, quote.id), sql`${quoteSignatures.supersededAt} IS NULL`));
    const [row] = await tx
      .update(quotes)
      .set({ status: "draft", shareToken: null, shareTokenExpiresAt: null, sentAt: null, acceptedAt: null, declinedAt: null, updatedAt: new Date() } as any)
      .where(eq(quotes.id, quote.id))
      .returning();
    return row;
  });
}

// ─── public view ────────────────────────────────────────────────────────────

export interface PublicQuoteView {
  quote: Quote;
  lines: QuoteLine[];
  company: Company;
  customFields: Array<{ key: string; labelEn: string; labelAr: string; fieldType: string; value: string }>;
  signature: { action: string; signerName: string; signedAt: Date; reason: string | null } | null;
  /** True while the customer can still accept or decline. */
  canRespond: boolean;
}

const TOKEN_SHAPE = /^[0-9a-f]{20,64}$/i;

/** 404 unknown token; 410 when the link or the quote has expired (a closed quote still shows its answer). */
export async function getPublicQuote(token: string): Promise<PublicQuoteView> {
  if (!TOKEN_SHAPE.test(token)) throw refuse(404, "QUOTE_NOT_FOUND", "Quote not found or the link is invalid.");
  const [quote] = await db.select().from(quotes).where(eq(quotes.shareToken, token));
  if (!quote) throw refuse(404, "QUOTE_NOT_FOUND", "Quote not found or the link is invalid.");
  if (quote.shareTokenExpiresAt && new Date(quote.shareTokenExpiresAt) < new Date()) {
    throw refuse(410, "QUOTE_LINK_EXPIRED", "This quote link has expired.");
  }
  const expired = quote.status === "expired" || (quote.status === "sent" && isQuoteExpiredByDate(dayOf(quote.expiryDate), uaeTodayYmd()));
  if (expired) throw refuse(410, "QUOTE_EXPIRED", "This quote has expired.");
  const company = await storage.getCompany(quote.companyId);
  if (!company) throw refuse(404, "QUOTE_NOT_FOUND", "Quote not found");
  const lines = await db.select().from(quoteLines).where(eq(quoteLines.quoteId, quote.id)).orderBy(asc(quoteLines.sortOrder), asc(quoteLines.id));
  const [sig] = await db
    .select()
    .from(quoteSignatures)
    .where(and(eq(quoteSignatures.quoteId, quote.id), sql`${quoteSignatures.supersededAt} IS NULL`));
  return {
    quote,
    lines,
    company,
    customFields: await pdfFieldsFor(quote.companyId, "quote", quote.id),
    signature: sig ? { action: sig.action, signerName: sig.signerName, signedAt: sig.signedAt, reason: sig.reason } : null,
    canRespond: quote.status === "sent",
  };
}

// ─── accept / decline ───────────────────────────────────────────────────────

export interface RespondInput {
  token: string;
  action: "accept" | "decline";
  name: string;
  email: string;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export async function respondToQuote(input: RespondInput): Promise<{ quote: Quote; signature: QuoteSignature }> {
  if (!TOKEN_SHAPE.test(input.token)) throw refuse(404, "QUOTE_NOT_FOUND", "Quote not found or the link is invalid.");
  const [peek] = await db.select({ id: quotes.id }).from(quotes).where(eq(quotes.shareToken, input.token));
  if (!peek) throw refuse(404, "QUOTE_NOT_FOUND", "Quote not found or the link is invalid.");

  const outcome = await withDocumentLock(peek.id, LOCK_NS.QUOTE, async (tx: typeof db) => {
    // Row lock as well: the document lock serialises this process, FOR UPDATE protects any other writer.
    const locked = rowsOf(await tx.execute(sql`SELECT id FROM quotes WHERE id = ${peek.id} AND share_token = ${input.token} FOR UPDATE`));
    if (locked.length === 0) throw refuse(404, "QUOTE_NOT_FOUND", "Quote not found or the link is invalid.");
    const [quote] = await tx.select().from(quotes).where(eq(quotes.id, peek.id));
    if (quote.shareTokenExpiresAt && new Date(quote.shareTokenExpiresAt) < new Date()) {
      throw refuse(410, "QUOTE_LINK_EXPIRED", "This quote link has expired.");
    }
    if (quote.status === "expired" || (quote.status === "sent" && isQuoteExpiredByDate(dayOf(quote.expiryDate), uaeTodayYmd()))) {
      throw refuse(410, "QUOTE_EXPIRED", "This quote has expired.");
    }
    if (!canQuoteTransition(quote.status, input.action)) {
      throw refuse(409, "QUOTE_NOT_OPEN", "This quote has already been answered or is no longer open.");
    }
    const lines = await tx.select().from(quoteLines).where(eq(quoteLines.quoteId, quote.id)).orderBy(asc(quoteLines.sortOrder), asc(quoteLines.id));
    const hash = quoteContentHash({
      subtotal: Number(quote.subtotal),
      vatAmount: Number(quote.vatAmount),
      total: Number(quote.total),
      lines: lines.map((l: QuoteLine) => ({
        description: l.description,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        vatRate: Number(l.vatRate),
        lineKind: l.lineKind,
        discountType: l.discountType,
        discountValue: l.discountValue === null ? null : Number(l.discountValue),
      })),
    });
    const retention = new Date();
    retention.setFullYear(retention.getFullYear() + SIGNATURE_RETENTION_YEARS);
    let signature: QuoteSignature;
    try {
      [signature] = await tx
        .insert(quoteSignatures)
        .values({
          companyId: quote.companyId,
          quoteId: quote.id,
          quoteNumber: quote.number,
          customerName: quote.customerName,
          currency: quote.currency,
          total: Number(quote.total),
          action: input.action === "accept" ? "accepted" : "declined",
          signerName: input.name,
          signerEmail: input.email,
          ip: input.ip ?? null,
          userAgent: input.userAgent?.slice(0, 400) ?? null,
          reason: input.action === "decline" ? (input.reason ?? null) : null,
          quoteHash: hash,
          retentionExpiresAt: retention,
        } as any)
        .returning();
    } catch (err: any) {
      // The unique index on the live signature: another answer won the race.
      if (err?.code === "23505" || err?.cause?.code === "23505") {
        throw refuse(409, "QUOTE_NOT_OPEN", "This quote has already been answered.");
      }
      throw err;
    }
    const now = new Date();
    const [updated] = await tx
      .update(quotes)
      .set(
        (input.action === "accept"
          ? { status: "accepted", acceptedAt: now, updatedAt: now }
          : { status: "declined", declinedAt: now, updatedAt: now }) as any
      )
      .where(eq(quotes.id, quote.id))
      .returning();
    return { quote: updated, signature };
  });

  // Tell the company (after the lock is released: it uses the pool).
  try {
    const users = await storage.getCompanyUsersByCompanyId(outcome.quote.companyId);
    for (const cu of users) {
      await storage.createNotification({
        userId: cu.userId,
        companyId: outcome.quote.companyId,
        type: input.action === "accept" ? "quote_accepted" : "quote_declined",
        title: `Quote ${outcome.quote.number} ${input.action === "accept" ? "accepted" : "declined"}`,
        message: `${input.name} (${input.email}) ${input.action === "accept" ? "accepted" : "declined"} the quote for ${outcome.quote.customerName}.`,
        priority: "normal",
        relatedEntityType: "quote",
        relatedEntityId: outcome.quote.id,
        actionUrl: "/quotes",
      } as any);
    }
  } catch (err) {
    log.warn({ err }, "Could not notify the company of the quote answer");
  }
  return outcome;
}

export async function getSignature(companyId: string, quoteId: string) {
  const rows = await db
    .select()
    .from(quoteSignatures)
    .where(and(eq(quoteSignatures.companyId, companyId), eq(quoteSignatures.quoteId, quoteId)))
    .orderBy(asc(quoteSignatures.signedAt));
  return { current: rows.find((r: QuoteSignature) => !r.supersededAt) ?? null, history: rows };
}

// ─── expiry job ─────────────────────────────────────────────────────────────

/** Daily: a `sent` quote whose valid-until day has passed becomes `expired` (its link then answers 410). */
export async function expireDueQuotes(opts: { companyId?: string } = {}): Promise<number> {
  const today = uaeTodayYmd();
  const conds = [eq(quotes.status, "sent"), lt(quotes.expiryDate, new Date(`${today}T00:00:00.000Z`))];
  if (opts.companyId) conds.push(eq(quotes.companyId, opts.companyId));
  // A company in its deletion window is left alone (D5).
  conds.push(sql`NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = ${quotes.companyId} AND c.deleted_at IS NOT NULL)`);
  const rows = await db
    .update(quotes)
    .set({ status: "expired", updatedAt: new Date() } as any)
    .where(and(...conds))
    .returning({ id: quotes.id });
  if (rows.length > 0) log.info({ expired: rows.length }, "Quotes past their valid-until date marked expired");
  return rows.length;
}
