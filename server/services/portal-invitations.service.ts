/**
 * Customer-portal invitations (STEP5): a supplier invites one of its customers (a
 * customer_contacts row) to the authenticated portal.
 *
 * - The invitation holds a random 256-bit token; only its SHA-256 is stored. It expires after 7
 *   days and is single-use: opening the link (GET) never consumes it, only the accept POST does,
 *   inside one transaction that locks the row, so two parallel accepts produce one binding.
 * - Delivery goes through the durable email outbox. Nothing is reported as sent without a
 *   provider: with no provider the inviter gets the link to share.
 * - Portal access is the customer_portal_accounts binding, never company membership.
 * - Every read and write is scoped by companyId (server/tenancy); another tenant's row is a 404.
 */
import crypto from "crypto";
import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { DomainError } from "../errors";
import { createLogger } from "../config/logger";
import { scopedGet, scopedUpdate } from "../tenancy";
import {
  customerContacts,
  customerPortalAccounts,
  customerPortalInvitations,
  emailOutbox,
  portalAccessLog,
  users,
  type Company,
  type CustomerContact,
  type CustomerPortalInvitation,
} from "../../shared/schema";
import {
  PORTAL_INVITE_MAX_PER_DAY,
  PORTAL_INVITE_MAX_PER_HOUR,
  PORTAL_INVITE_MAX_SENDS_PER_DAY,
  PORTAL_INVITE_RESEND_COOLDOWN_S,
  PORTAL_INVITE_TOKEN_RE,
  PORTAL_INVITE_TTL_DAYS,
  type PortalInviteBody,
  type PortalInviteLanguage,
} from "../../shared/validators/portal-invitations";
import {
  bindPortalUser,
  hashPortalToken,
  listPortalLinks,
  logPortalAccess,
} from "./portal-access.service";
import { hasEmailProvider, sendEmail } from "./email.service";
import { renderPortalInviteEmail, normaliseInviteLanguage } from "./portal-invite-email";
import { paymentsAvailability, publicBaseUrl } from "./payments";
import { recordAudit } from "./audit.service";
import { isPlaceholderPasswordHash, passwordPolicySchema } from "../auth";
import { notificationCopy } from "../../shared/server-copy";

const log = createLogger("portal-invitations");

export type InviteDelivery = "email" | "queued" | "link";

export interface InviteResult {
  invitation: PublicInvitation;
  delivery: InviteDelivery;
  /** Only when no email provider is configured: the link for the inviter to share. */
  inviteUrl?: string;
}

/** An invitation as the staff sheet sees it: never the token or its hash. */
export interface PublicInvitation {
  id: string;
  contactId: string;
  email: string;
  name: string | null;
  language: PortalInviteLanguage;
  message: string | null;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  lastSentAt: string | null;
  sendCount: number;
  acceptedAt: string | null;
  createdAt: string;
  /** Seconds until Resend is allowed again (0 = now). */
  resendIn: number;
}

const normEmail = (e: string) => e.trim().toLowerCase();
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

export function publicInvitation(inv: CustomerPortalInvitation): PublicInvitation {
  const expired = inv.status === "pending" && inv.expiresAt.getTime() <= Date.now();
  const sinceSend = inv.lastSentAt ? (Date.now() - inv.lastSentAt.getTime()) / 1000 : Infinity;
  return {
    id: inv.id,
    contactId: inv.contactId,
    email: inv.email,
    name: inv.name,
    language: normaliseInviteLanguage(inv.language) as PortalInviteLanguage,
    message: inv.message,
    status: expired ? "expired" : (inv.status as PublicInvitation["status"]),
    expiresAt: inv.expiresAt.toISOString(),
    lastSentAt: iso(inv.lastSentAt),
    sendCount: inv.sendCount,
    acceptedAt: iso(inv.acceptedAt),
    createdAt: inv.createdAt.toISOString(),
    resendIn: Math.max(0, Math.ceil(PORTAL_INVITE_RESEND_COOLDOWN_S - sinceSend)),
  };
}

function newToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("hex");
  return { raw, hash: hashPortalToken(raw) };
}

export function portalInviteUrl(rawToken: string): string {
  // The token rides in the fragment: never sent to a server, a proxy log or a Referer header.
  return `${publicBaseUrl()}/portal/join#t=${rawToken}`;
}

async function loadContact(companyId: string, contactId: string): Promise<CustomerContact> {
  const contact = await scopedGet(customerContacts, companyId, contactId);
  if (!contact) throw new DomainError("CONTACT_NOT_FOUND", 404, undefined, "Contact not found");
  return contact;
}

async function loadInvitation(
  companyId: string,
  invitationId: string
): Promise<CustomerPortalInvitation> {
  const inv = await scopedGet(customerPortalInvitations, companyId, invitationId);
  if (!inv) throw new DomainError("NOT_FOUND", 404, undefined, "Invitation not found");
  return inv;
}

async function loadCompany(companyId: string): Promise<Company> {
  const company = await storage.getCompany(companyId);
  if (!company) throw new DomainError("NOT_FOUND", 404, undefined, "Company not found");
  return company;
}

// ─── Delivery ───────────────────────────────────────────────────────────────

async function deliverInvitation(
  inv: CustomerPortalInvitation,
  rawToken: string,
  company: Company,
  contact: CustomerContact
): Promise<{ delivery: InviteDelivery; inviteUrl?: string; updated: CustomerPortalInvitation }> {
  const url = portalInviteUrl(rawToken);
  const sendNo = inv.sendCount + 1;
  const mail = renderPortalInviteEmail({
    company,
    contact,
    invitation: inv,
    url,
    onlinePayment: paymentsAvailability().available,
  });
  const result = await sendEmail(inv.email, mail.subject, mail.text, {
    html: mail.html,
    fromName: company.name,
    companyId: inv.companyId,
    category: "portal_invite",
    sensitive: true,
    relatedEntityType: "customer_portal_invitation",
    relatedEntityId: inv.id,
    idempotencyKey: `portal-invite:${inv.id}:${sendNo}`,
    replyTo: company.contactEmail ?? null,
  });
  const providerOn = hasEmailProvider();
  const delivery: InviteDelivery = result.sent ? "email" : providerOn ? "queued" : "link";
  const [updated] = await db
    .update(customerPortalInvitations)
    .set({
      lastSentAt: new Date(),
      sendCount: sendNo,
      lastOutboxId: result.id ?? null,
      updatedAt: new Date(),
    })
    .where(eq(customerPortalInvitations.id, inv.id))
    .returning();
  return {
    delivery,
    ...(delivery === "link" ? { inviteUrl: url } : {}),
    updated: updated ?? inv,
  };
}

// ─── Staff operations ───────────────────────────────────────────────────────

async function enforceInviteRate(companyId: string): Promise<void> {
  const [row] = await db
    .select({
      hour: sql<number>`count(*) FILTER (WHERE ${customerPortalInvitations.createdAt} > now() - interval '1 hour')::int`,
      day: sql<number>`count(*) FILTER (WHERE ${customerPortalInvitations.createdAt} > now() - interval '1 day')::int`,
    })
    .from(customerPortalInvitations)
    .where(eq(customerPortalInvitations.companyId, companyId));
  if ((row?.hour ?? 0) >= PORTAL_INVITE_MAX_PER_HOUR || (row?.day ?? 0) >= PORTAL_INVITE_MAX_PER_DAY) {
    throw new DomainError(
      "PORTAL_INVITE_RATE_LIMITED",
      429,
      { retryAfter: (row?.hour ?? 0) >= PORTAL_INVITE_MAX_PER_HOUR ? 3600 : 86_400 },
      "Too many invitations sent. Try again later."
    );
  }
}

export async function createInvitation(args: {
  companyId: string;
  contactId: string;
  body: Pick<PortalInviteBody, "email" | "name" | "language" | "message" | "saveEmailToContact">;
  invitedBy: string;
  req?: Request;
}): Promise<InviteResult> {
  const { companyId, body } = args;
  const contact = await loadContact(companyId, args.contactId);
  if (!contact.isActive) {
    throw new DomainError("CONTACT_NOT_FOUND", 404, undefined, "Contact not found");
  }
  const email = normEmail(body.email ?? contact.email ?? "");
  if (!email) {
    throw new DomainError(
      "CONTACT_EMAIL_REQUIRED",
      400,
      { field: "email" },
      "An email address is required to invite this customer"
    );
  }

  // Someone with this email already has active access to this contact.
  const [active] = await db
    .select({ id: customerPortalAccounts.id })
    .from(customerPortalAccounts)
    .innerJoin(users, eq(users.id, customerPortalAccounts.userId))
    .where(
      and(
        eq(customerPortalAccounts.companyId, companyId),
        eq(customerPortalAccounts.contactId, contact.id),
        isNull(customerPortalAccounts.revokedAt),
        sql`lower(${users.email}) = ${email}`
      )
    )
    .limit(1);
  if (active) {
    throw new DomainError("PORTAL_ALREADY_ACTIVE", 409, undefined, "This person already has access");
  }

  // A stale pending invite is retired first, so it no longer blocks a new one.
  await db
    .update(customerPortalInvitations)
    .set({ status: "expired", updatedAt: new Date() })
    .where(
      and(
        eq(customerPortalInvitations.companyId, companyId),
        eq(customerPortalInvitations.contactId, contact.id),
        eq(customerPortalInvitations.status, "pending"),
        lte(customerPortalInvitations.expiresAt, new Date())
      )
    );
  const [pending] = await db
    .select({ id: customerPortalInvitations.id })
    .from(customerPortalInvitations)
    .where(
      and(
        eq(customerPortalInvitations.companyId, companyId),
        eq(customerPortalInvitations.contactId, contact.id),
        eq(customerPortalInvitations.status, "pending"),
        sql`lower(${customerPortalInvitations.email}) = ${email}`
      )
    )
    .limit(1);
  if (pending) {
    throw new DomainError(
      "INVITATION_PENDING",
      409,
      { invitationId: pending.id },
      "An invitation is already pending for this email"
    );
  }
  await enforceInviteRate(companyId);

  const token = newToken();
  let inv: CustomerPortalInvitation;
  try {
    [inv] = await db
      .insert(customerPortalInvitations)
      .values({
        companyId,
        contactId: contact.id,
        email,
        name: body.name || contact.contactPerson || null,
        language: body.language,
        message: body.message || null,
        tokenHash: token.hash,
        expiresAt: new Date(Date.now() + PORTAL_INVITE_TTL_DAYS * 86_400_000),
        invitedBy: args.invitedBy,
      })
      .returning();
  } catch (err) {
    if ((err as { code?: string })?.code === "23505") {
      throw new DomainError("INVITATION_PENDING", 409, undefined, "An invitation is already pending");
    }
    throw err;
  }
  if (body.saveEmailToContact && !contact.email) {
    await scopedUpdate(customerContacts, companyId, contact.id, { email });
  }

  const company = await loadCompany(companyId);
  const sent = await deliverInvitation(inv, token.raw, company, contact);
  await recordAudit({
    userId: args.invitedBy,
    companyId,
    action: "portal.invite",
    entityType: "customer_portal_invitation",
    entityId: inv.id,
    before: null,
    after: { contactId: contact.id, email, language: body.language, delivery: sent.delivery },
    req: args.req,
  });
  return {
    invitation: publicInvitation(sent.updated),
    delivery: sent.delivery,
    ...(sent.inviteUrl ? { inviteUrl: sent.inviteUrl } : {}),
  };
}

export async function resendInvitation(args: {
  companyId: string;
  invitationId: string;
  actorId: string;
  req?: Request;
}): Promise<InviteResult> {
  const inv = await loadInvitation(args.companyId, args.invitationId);
  if (inv.status !== "pending" && inv.status !== "expired") {
    throw new DomainError("INVITATION_NOT_RESENDABLE", 409, undefined, "This invitation is closed");
  }
  const since = inv.lastSentAt ? (Date.now() - inv.lastSentAt.getTime()) / 1000 : Infinity;
  if (since < PORTAL_INVITE_RESEND_COOLDOWN_S) {
    throw new DomainError(
      "RESEND_TOO_SOON",
      429,
      { retryAfter: Math.ceil(PORTAL_INVITE_RESEND_COOLDOWN_S - since) },
      "Please wait before resending"
    );
  }
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(emailOutbox)
    .where(
      and(
        eq(emailOutbox.relatedEntityType, "customer_portal_invitation"),
        eq(emailOutbox.relatedEntityId, inv.id),
        gte(emailOutbox.createdAt, new Date(Date.now() - 86_400_000))
      )
    );
  if (n >= PORTAL_INVITE_MAX_SENDS_PER_DAY) {
    throw new DomainError(
      "RESEND_TOO_SOON",
      429,
      { retryAfter: 86_400 },
      "This invitation was resent too many times today"
    );
  }
  const contact = await loadContact(args.companyId, inv.contactId);
  const company = await loadCompany(args.companyId);
  // Rotate the token (the old link dies) and extend the expiry.
  const token = newToken();
  const [rotated] = await db
    .update(customerPortalInvitations)
    .set({
      tokenHash: token.hash,
      status: "pending",
      expiresAt: new Date(Date.now() + PORTAL_INVITE_TTL_DAYS * 86_400_000),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(customerPortalInvitations.id, inv.id),
        eq(customerPortalInvitations.companyId, args.companyId),
        inArray(customerPortalInvitations.status, ["pending", "expired"])
      )
    )
    .returning();
  if (!rotated) {
    throw new DomainError("INVITATION_NOT_RESENDABLE", 409, undefined, "This invitation is closed");
  }
  const sent = await deliverInvitation(rotated, token.raw, company, contact);
  await recordAudit({
    userId: args.actorId,
    companyId: args.companyId,
    action: "portal.invite_resend",
    entityType: "customer_portal_invitation",
    entityId: inv.id,
    before: null,
    after: { delivery: sent.delivery, sendCount: sent.updated.sendCount },
    req: args.req,
  });
  return {
    invitation: publicInvitation(sent.updated),
    delivery: sent.delivery,
    ...(sent.inviteUrl ? { inviteUrl: sent.inviteUrl } : {}),
  };
}

export async function revokeInvitation(args: {
  companyId: string;
  invitationId: string;
  actorId: string;
  req?: Request;
}): Promise<PublicInvitation> {
  const inv = await loadInvitation(args.companyId, args.invitationId);
  if (inv.status !== "pending") {
    throw new DomainError("INVITATION_NOT_REVOCABLE", 409, undefined, "Only pending invitations can be revoked");
  }
  const [row] = await db
    .update(customerPortalInvitations)
    .set({ status: "revoked", revokedAt: new Date(), revokedBy: args.actorId, updatedAt: new Date() })
    .where(
      and(
        eq(customerPortalInvitations.id, inv.id),
        eq(customerPortalInvitations.companyId, args.companyId),
        eq(customerPortalInvitations.status, "pending")
      )
    )
    .returning();
  if (!row) {
    throw new DomainError("INVITATION_NOT_REVOCABLE", 409, undefined, "Only pending invitations can be revoked");
  }
  await recordAudit({
    userId: args.actorId,
    companyId: args.companyId,
    action: "portal.invite_revoke",
    entityType: "customer_portal_invitation",
    entityId: inv.id,
    before: { status: "pending" },
    after: { status: "revoked" },
    req: args.req,
  });
  return publicInvitation(row);
}

export async function revokePortalAccount(args: {
  companyId: string;
  accountId: string;
  actorId: string;
  req?: Request;
}): Promise<void> {
  const account = await scopedGet(customerPortalAccounts, args.companyId, args.accountId);
  if (!account || account.revokedAt) {
    throw new DomainError("NOT_FOUND", 404, undefined, "Portal access not found");
  }
  await scopedUpdate(customerPortalAccounts, args.companyId, account.id, {
    revokedAt: new Date(),
    revokedBy: args.actorId,
  });
  await recordAudit({
    userId: args.actorId,
    companyId: args.companyId,
    action: "portal.account_revoke",
    entityType: "customer_portal_account",
    entityId: account.id,
    before: { contactId: account.contactId, userId: account.userId },
    after: { revoked: true },
    req: args.req,
  });
}

/** What the contact's "Portal access" sheet shows (no token, no hash, no password hash). */
export async function portalAccessForContact(companyId: string, contactId: string) {
  const contact = await loadContact(companyId, contactId);
  const accounts = await db
    .select({
      id: customerPortalAccounts.id,
      createdAt: customerPortalAccounts.createdAt,
      lastSeenAt: customerPortalAccounts.lastSeenAt,
      invitedBy: customerPortalAccounts.createdBy,
      userName: users.name,
      userEmail: users.email,
    })
    .from(customerPortalAccounts)
    .innerJoin(users, eq(users.id, customerPortalAccounts.userId))
    .where(
      and(
        eq(customerPortalAccounts.companyId, companyId),
        eq(customerPortalAccounts.contactId, contact.id),
        isNull(customerPortalAccounts.revokedAt)
      )
    )
    .orderBy(desc(customerPortalAccounts.createdAt));
  const invitations = await db
    .select()
    .from(customerPortalInvitations)
    .where(
      and(
        eq(customerPortalInvitations.companyId, companyId),
        eq(customerPortalInvitations.contactId, contact.id),
        // Accepted invitations show as people, not as invitations.
        inArray(customerPortalInvitations.status, ["pending", "expired", "revoked"])
      )
    )
    .orderBy(desc(customerPortalInvitations.createdAt))
    .limit(20);
  const timeline = await db
    .select({
      outcome: portalAccessLog.outcome,
      createdAt: portalAccessLog.createdAt,
    })
    .from(portalAccessLog)
    .where(
      and(
        eq(portalAccessLog.companyId, companyId),
        eq(portalAccessLog.contactId, contact.id),
        sql`${portalAccessLog.outcome} LIKE 'invite_%'`
      )
    )
    .orderBy(desc(portalAccessLog.createdAt))
    .limit(20);
  return {
    contact: {
      id: contact.id,
      name: contact.name,
      email: contact.email ?? null,
      contactPerson: contact.contactPerson ?? null,
      preferredLanguage: contact.preferredLanguage ?? null,
    },
    people: accounts.map((a) => ({
      id: a.id,
      name: a.userName,
      email: a.userEmail,
      since: a.createdAt.toISOString(),
      lastSeenAt: iso(a.lastSeenAt),
    })),
    invitations: invitations.map(publicInvitation),
    links: await listPortalLinks(companyId, contact.id),
    timeline: timeline.map((t) => ({ outcome: t.outcome, at: t.createdAt.toISOString() })),
  };
}

/** One grouped query for the contact-row chips: contactId → { active, pending, expiresAt }. */
export async function portalSummary(companyId: string) {
  const [accountRows, inviteRows] = await Promise.all([
    db
      .select({
        contactId: customerPortalAccounts.contactId,
        n: sql<number>`count(*)::int`,
      })
      .from(customerPortalAccounts)
      .where(
        and(eq(customerPortalAccounts.companyId, companyId), isNull(customerPortalAccounts.revokedAt))
      )
      .groupBy(customerPortalAccounts.contactId),
    db
      .select({
        contactId: customerPortalInvitations.contactId,
        status: customerPortalInvitations.status,
        expiresAt: sql<Date>`max(${customerPortalInvitations.expiresAt})`,
      })
      .from(customerPortalInvitations)
      .where(
        and(
          eq(customerPortalInvitations.companyId, companyId),
          inArray(customerPortalInvitations.status, ["pending", "expired", "revoked"])
        )
      )
      .groupBy(customerPortalInvitations.contactId, customerPortalInvitations.status),
  ]);
  const out: Record<
    string,
    { active: number; state: "active" | "invited" | "expired" | "revoked"; expiresAt: string | null }
  > = {};
  for (const r of inviteRows) {
    const exp = new Date(r.expiresAt);
    const state =
      r.status === "pending" ? (exp.getTime() > Date.now() ? "invited" : "expired") : (r.status as "expired" | "revoked");
    const prev = out[r.contactId];
    // Pending beats expired beats revoked.
    const rank = { invited: 3, expired: 2, revoked: 1, active: 4 } as const;
    if (!prev || rank[state] > rank[prev.state]) {
      out[r.contactId] = { active: 0, state, expiresAt: exp.toISOString() };
    }
  }
  for (const r of accountRows) {
    out[r.contactId] = { active: r.n, state: "active", expiresAt: null };
  }
  return out;
}

// ─── Public: resolve and accept ─────────────────────────────────────────────

export type InviteResolution =
  | {
      status: "ok";
      invitation: CustomerPortalInvitation;
      company: Company;
      contact: CustomerContact;
    }
  | {
      status: "invalid";
    }
  | {
      status: "expired" | "revoked" | "accepted";
      invitation: CustomerPortalInvitation;
      company: Company | null;
    };

export async function resolveInvitation(rawToken: string): Promise<InviteResolution> {
  if (typeof rawToken !== "string" || !PORTAL_INVITE_TOKEN_RE.test(rawToken)) {
    return { status: "invalid" };
  }
  const [invitation] = await db
    .select()
    .from(customerPortalInvitations)
    .where(eq(customerPortalInvitations.tokenHash, hashPortalToken(rawToken.toLowerCase())));
  if (!invitation) return { status: "invalid" };
  const company = (await storage.getCompany(invitation.companyId)) ?? null;
  if (invitation.status === "accepted") return { status: "accepted", invitation, company };
  if (invitation.status === "revoked") return { status: "revoked", invitation, company };
  if (invitation.status === "expired" || invitation.expiresAt.getTime() <= Date.now()) {
    if (invitation.status === "pending") {
      await db
        .update(customerPortalInvitations)
        .set({ status: "expired", updatedAt: new Date() })
        .where(
          and(
            eq(customerPortalInvitations.id, invitation.id),
            eq(customerPortalInvitations.status, "pending")
          )
        );
    }
    return { status: "expired", invitation, company };
  }
  const contact = await scopedGet(customerContacts, invitation.companyId, invitation.contactId);
  if (!company || !contact || !contact.isActive) {
    // The supplier or the customer went away: indistinguishable from a revoked invitation.
    return { status: "revoked", invitation, company };
  }
  return { status: "ok", invitation, company, contact };
}

export type AccountCase = "new" | "existing" | "signed_in" | "signed_in_other";

export async function accountCaseFor(
  invitation: CustomerPortalInvitation,
  signedIn: { id: string; email: string } | null
): Promise<AccountCase> {
  if (signedIn) {
    return normEmail(signedIn.email) === normEmail(invitation.email) ? "signed_in" : "signed_in_other";
  }
  const existing = await storage.getUserByEmail(invitation.email);
  return existing && !isPlaceholderPasswordHash(existing.passwordHash) ? "existing" : "new";
}

export interface AcceptOutcome {
  userId: string;
  portalAccountId: string;
  createdUser: boolean;
  existingUserType: string | null;
  invitation: CustomerPortalInvitation;
}

/**
 * Accept an invitation. One transaction: the invitation row is locked, re-checked, the login is
 * created (or reused) and bound, and the invitation is closed. A second parallel accept waits on
 * the lock and then sees `accepted`.
 */
export async function acceptInvitation(args: {
  rawToken: string;
  signedIn: { id: string; email: string } | null;
  name?: string;
  password?: string;
  req: Request;
  res: Response;
}): Promise<AcceptOutcome> {
  const resolved = await resolveInvitation(args.rawToken);
  if (resolved.status === "invalid") {
    throw new DomainError("PORTAL_INVITE_INVALID", 404, undefined, "This link is not valid");
  }
  if (resolved.status !== "ok") throw inviteStateError(resolved.status);
  const inv = resolved.invitation;
  const kind = await accountCaseFor(inv, args.signedIn);

  if (kind === "signed_in_other") {
    throw new DomainError(
      "INVITATION_EMAIL_MISMATCH",
      403,
      undefined,
      "This invitation was sent to a different email address"
    );
  }
  if (kind === "existing") {
    throw new DomainError(
      "LOGIN_REQUIRED",
      409,
      undefined,
      "An account already exists for this email. Sign in, then accept the invitation."
    );
  }
  let passwordHash: string | null = null;
  if (kind === "new") {
    const parsed = passwordPolicySchema.safeParse(args.password ?? "");
    if (!parsed.success) {
      throw new DomainError(
        "VALIDATION_ERROR",
        400,
        { fields: { password: parsed.error.issues.map((i) => i.message) } },
        parsed.error.issues[0]?.message ?? "Choose a stronger password"
      );
    }
    passwordHash = await bcrypt.hash(parsed.data, 10);
  }

  const outcome = await db.transaction(async (tx: typeof db) => {
    await tx.execute(
      sql`SELECT id FROM customer_portal_invitations WHERE id = ${inv.id} FOR UPDATE`
    );
    const [locked] = await tx
      .select()
      .from(customerPortalInvitations)
      .where(eq(customerPortalInvitations.id, inv.id));
    if (!locked || locked.status !== "pending") {
      throw inviteStateError(locked?.status === "revoked" ? "revoked" : "accepted");
    }
    if (locked.expiresAt.getTime() <= Date.now()) throw inviteStateError("expired");

    let userId: string;
    let createdUser = false;
    let existingUserType: string | null = null;
    if (kind === "signed_in") {
      userId = args.signedIn!.id;
      const [u] = await tx.select({ userType: users.userType }).from(users).where(eq(users.id, userId));
      existingUserType = u?.userType ?? null;
    } else {
      const displayName = (args.name || locked.name || resolved.contact.name).trim();
      const existing = await storage.getUserByEmail(locked.email);
      if (existing && isPlaceholderPasswordHash(existing.passwordHash)) {
        // A placeholder account (no credential) is claimed by the real owner of the address.
        await tx
          .update(users)
          .set({ passwordHash: passwordHash!, name: displayName, emailVerified: true, emailVerifiedAt: new Date() })
          .where(eq(users.id, existing.id));
        userId = existing.id;
        existingUserType = existing.userType;
      } else {
        const [created] = await tx
          .insert(users)
          .values({
            name: displayName,
            email: locked.email,
            userType: "client_portal",
            isAdmin: false,
            passwordHash: passwordHash!,
            // The link reached the inbox: the address is proven.
            emailVerified: true,
            emailVerifiedAt: new Date(),
          })
          .returning({ id: users.id });
        userId = created.id;
      }
      createdUser = true;
    }
    const portalAccountId = await bindPortalUser(
      {
        companyId: locked.companyId,
        contactId: locked.contactId,
        userId,
        createdBy: locked.invitedBy,
        invitationId: locked.id,
      },
      tx
    );
    const now = new Date();
    const [closed] = await tx
      .update(customerPortalInvitations)
      .set({
        status: "accepted",
        acceptedAt: now,
        acceptedUserId: userId,
        termsAcceptedAt: now,
        updatedAt: now,
      })
      .where(eq(customerPortalInvitations.id, locked.id))
      .returning();
    return { userId, portalAccountId, createdUser, existingUserType, invitation: closed };
  });

  await recordAudit({
    userId: outcome.userId,
    companyId: inv.companyId,
    action: "portal.invite_accept",
    entityType: "customer_portal_invitation",
    entityId: inv.id,
    before: { status: "pending" },
    after: { createdUser: outcome.createdUser, existingUserType: outcome.existingUserType },
    req: args.req,
  });
  void notifyInviter(inv, resolved.contact, outcome.createdUser);
  return outcome;
}

async function notifyInviter(
  inv: CustomerPortalInvitation,
  contact: CustomerContact,
  _createdUser: boolean
): Promise<void> {
  if (!inv.invitedBy) return;
  try {
    await storage.createNotification({
      userId: inv.invitedBy,
      companyId: inv.companyId,
      type: "system",
      ...notificationCopy("notification.portalJoined.title", "notification.portalJoined.message", {
        customer: contact.name,
        email: inv.email,
      }),
      priority: "normal",
      actionUrl: "/contacts",
    } as Parameters<typeof storage.createNotification>[0]);
  } catch (err) {
    log.warn({ err: (err as Error)?.message }, "portal-joined notification failed");
  }
}

export function inviteStateError(status: "expired" | "revoked" | "accepted"): DomainError {
  const map = {
    expired: ["PORTAL_INVITE_EXPIRED", "This invitation has expired"],
    revoked: ["PORTAL_INVITE_REVOKED", "This invitation was cancelled"],
    accepted: ["PORTAL_INVITE_ACCEPTED", "This invitation was already used"],
  } as const;
  return new DomainError(map[status][0], 410, undefined, map[status][1]);
}

/** Log one invitation event for the contact's timeline (never the token). */
export async function logInviteEvent(
  req: Request,
  outcome: string,
  inv?: Pick<CustomerPortalInvitation, "companyId" | "contactId"> | null
): Promise<void> {
  await logPortalAccess({
    req,
    outcome,
    companyId: inv?.companyId ?? null,
    contactId: inv?.contactId ?? null,
  });
}
