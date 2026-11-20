/**
 * Customer-portal invitations (STEP5): a supplier invites one of its customers (a
 * customer_contacts row) to the authenticated portal.
 *
 * - The invitation holds a random 256-bit token; only its SHA-256 is stored. It expires after 7
 *   days and is single-use: only the accept request consumes it,
 *   inside one transaction that locks the row, so two parallel accepts produce one binding.
 * - Delivery goes through the durable email outbox directly to the invited address.
 * - Portal access is the customer_portal_accounts binding, never company membership.
 * - Every read and write is scoped by companyId (server/tenancy); another tenant's row is a 404.
 */
import crypto from "crypto";
import bcrypt from "bcryptjs";
import type { Request } from "express";
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { DomainError } from "../errors";
import { createLogger } from "../config/logger";
import { scopedGet, scopedUpdate } from "../tenancy";
import { lockPortalInviteEmail } from "../storage/portal-invite-email";
import { zEmail } from "../../shared/validators/primitives";
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
import { deliverOutboxMessage, enqueueEmail, type OutboxResult } from "../outbox";
import { renderPortalInviteEmail, normaliseInviteLanguage } from "./portal-invite-email";
import { paymentsAvailability, publicBaseUrl } from "./payments";
import { recordAudit } from "./audit.service";
import { isPlaceholderPasswordHash, passwordPolicySchema } from "../auth";
import { notificationCopy } from "../../shared/server-copy";

const log = createLogger("portal-invitations");

export type InviteDelivery = "email" | "queued";

export interface InviteResult {
  invitation: PublicInvitation;
  delivery: InviteDelivery;
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
const contactEmail = (contact: CustomerContact) => normEmail(contact.email ?? "") || null;

async function lockContact(tx: typeof db, companyId: string, contactId: string) {
  const [contact] = await tx
    .select()
    .from(customerContacts)
    .where(and(eq(customerContacts.companyId, companyId), eq(customerContacts.id, contactId)))
    .for("update");
  return contact;
}

function checkInvitedContact(invitation: CustomerPortalInvitation, contact?: CustomerContact) {
  if (!contact?.isActive || contactEmail(contact) !== invitation.contactEmailAtIssue) {
    throw inviteStateError("revoked");
  }
}
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
  return { raw, hash: inviteTokenHash(raw) };
}

function inviteTokenHash(raw: string): string {
  // Invalidate legacy links, including ones issued during a rolling deploy.
  return hashPortalToken(`customer-portal-invite:v2:${raw.toLowerCase()}`);
}

function portalInviteUrl(rawToken: string): string {
  // The join page submits the fragment token in a JSON body.
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

function deliveryFailed(): DomainError {
  return new DomainError(
    "PORTAL_INVITE_DELIVERY_FAILED",
    503,
    undefined,
    "Could not deliver the invitation email"
  );
}

async function enqueueInvitation(
  tx: typeof db,
  inv: CustomerPortalInvitation,
  rawToken: string,
  company: Company,
  contact: CustomerContact
): Promise<{ invitation: CustomerPortalInvitation; outbox: OutboxResult }> {
  const mail = renderPortalInviteEmail({
    company,
    contact,
    invitation: inv,
    url: portalInviteUrl(rawToken),
    onlinePayment: paymentsAvailability().available,
  });
  try {
    const outbox = await enqueueEmail(
      {
        to: inv.email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        fromName: company.name,
        companyId: inv.companyId,
        category: "portal_invite",
        sensitive: true,
        relatedEntityType: "customer_portal_invitation",
        relatedEntityId: inv.id,
        idempotencyKey: `portal-invite:${inv.id}:${inv.sendCount}`,
        replyTo: company.contactEmail ?? null,
      },
      tx
    );
    const [invitation] = await tx
      .update(customerPortalInvitations)
      .set({ lastOutboxId: outbox.id })
      .where(eq(customerPortalInvitations.id, inv.id))
      .returning();
    return { invitation, outbox };
  } catch {
    // Roll back the email reservation with the outbox write. Driver errors can contain mail bodies.
    throw deliveryFailed();
  }
}

async function deliverInvitation(outbox: OutboxResult): Promise<InviteDelivery> {
  const result = outbox.status === "queued" ? await deliverOutboxMessage(outbox.id) : outbox;
  if (result?.status === "sent" || result?.status === "delivered") return "email";
  if (result && ["queued", "sending", "retrying", "blocked_no_provider"].includes(result.status)) {
    return "queued";
  }
  throw deliveryFailed();
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
  if (
    (row?.hour ?? 0) >= PORTAL_INVITE_MAX_PER_HOUR ||
    (row?.day ?? 0) >= PORTAL_INVITE_MAX_PER_DAY
  ) {
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
  if (!zEmail.safeParse(email).success) {
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
    throw new DomainError(
      "PORTAL_ALREADY_ACTIVE",
      409,
      undefined,
      "This person already has access"
    );
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

  const company = await loadCompany(companyId);
  const token = newToken();
  const { invitation, outbox } = await db.transaction(async (tx) => {
    await lockPortalInviteEmail(tx, email);
    const lockedContact = await lockContact(tx, companyId, contact.id);
    if (!lockedContact?.isActive || contactEmail(lockedContact) !== contactEmail(contact)) {
      throw new DomainError(
        "CONTACT_NOT_FOUND",
        404,
        undefined,
        "The contact has changed. Reload and try again."
      );
    }
    const saveEmail = body.saveEmailToContact && !lockedContact.email;
    if (saveEmail) {
      await tx
        .update(customerContacts)
        .set({ email })
        .where(eq(customerContacts.id, lockedContact.id));
    }
    const now = new Date();
    const [inv] = await tx
      .insert(customerPortalInvitations)
      .values({
        companyId,
        contactId: lockedContact.id,
        email,
        contactEmailAtIssue: saveEmail ? email : contactEmail(lockedContact),
        name: body.name || lockedContact.contactPerson || null,
        language: body.language,
        message: body.message || null,
        tokenHash: token.hash,
        expiresAt: new Date(now.getTime() + PORTAL_INVITE_TTL_DAYS * 86_400_000),
        lastSentAt: now,
        sendCount: 1,
        invitedBy: args.invitedBy,
      })
      .onConflictDoNothing()
      .returning();
    if (!inv) {
      throw new DomainError(
        "INVITATION_PENDING",
        409,
        undefined,
        "An invitation is already pending"
      );
    }
    return enqueueInvitation(tx, inv, token.raw, company, lockedContact);
  });

  const delivery = await deliverInvitation(outbox);
  await recordAudit({
    userId: args.invitedBy,
    companyId,
    action: "portal.invite",
    entityType: "customer_portal_invitation",
    entityId: invitation.id,
    before: null,
    after: { contactId: contact.id, email, language: body.language, delivery },
    req: args.req,
  });
  return {
    invitation: publicInvitation(invitation),
    delivery,
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
  const company = await loadCompany(args.companyId);
  const token = newToken();
  const { invitation, outbox } = await db.transaction(async (tx) => {
    await lockPortalInviteEmail(tx, inv.email);
    const contact = await lockContact(tx, inv.companyId, inv.contactId);
    checkInvitedContact(inv, contact);
    const now = new Date();
    const [rotated] = await tx
      .update(customerPortalInvitations)
      .set({
        tokenHash: token.hash,
        status: "pending",
        expiresAt: new Date(now.getTime() + PORTAL_INVITE_TTL_DAYS * 86_400_000),
        lastSentAt: now,
        sendCount: inv.sendCount + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(customerPortalInvitations.id, inv.id),
          eq(customerPortalInvitations.tokenHash, inv.tokenHash),
          inArray(customerPortalInvitations.status, ["pending", "expired"])
        )
      )
      .returning();
    if (!rotated) {
      throw new DomainError(
        "INVITATION_NOT_RESENDABLE",
        409,
        undefined,
        "This invitation is closed"
      );
    }
    return enqueueInvitation(tx, rotated, token.raw, company, contact);
  });
  const delivery = await deliverInvitation(outbox);
  await recordAudit({
    userId: args.actorId,
    companyId: args.companyId,
    action: "portal.invite_resend",
    entityType: "customer_portal_invitation",
    entityId: inv.id,
    before: null,
    after: { delivery, sendCount: invitation.sendCount },
    req: args.req,
  });
  return {
    invitation: publicInvitation(invitation),
    delivery,
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
    throw new DomainError(
      "INVITATION_NOT_REVOCABLE",
      409,
      undefined,
      "Only pending invitations can be revoked"
    );
  }
  const [row] = await db
    .update(customerPortalInvitations)
    .set({
      status: "revoked",
      revokedAt: new Date(),
      revokedBy: args.actorId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(customerPortalInvitations.id, inv.id),
        eq(customerPortalInvitations.companyId, args.companyId),
        eq(customerPortalInvitations.status, "pending")
      )
    )
    .returning();
  if (!row) {
    throw new DomainError(
      "INVITATION_NOT_REVOCABLE",
      409,
      undefined,
      "Only pending invitations can be revoked"
    );
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
        and(
          eq(customerPortalAccounts.companyId, companyId),
          isNull(customerPortalAccounts.revokedAt)
        )
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
    {
      active: number;
      state: "active" | "invited" | "expired" | "revoked";
      expiresAt: string | null;
    }
  > = {};
  for (const r of inviteRows) {
    const exp = new Date(r.expiresAt);
    const state =
      r.status === "pending"
        ? exp.getTime() > Date.now()
          ? "invited"
          : "expired"
        : (r.status as "expired" | "revoked");
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
    .where(eq(customerPortalInvitations.tokenHash, inviteTokenHash(rawToken)));
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
            eq(customerPortalInvitations.tokenHash, invitation.tokenHash),
            eq(customerPortalInvitations.status, "pending")
          )
        );
    }
    return { status: "expired", invitation, company };
  }
  const contact = await scopedGet(customerContacts, invitation.companyId, invitation.contactId);
  if (!company || !contact?.isActive || contactEmail(contact) !== invitation.contactEmailAtIssue) {
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
    return normEmail(signedIn.email) === normEmail(invitation.email)
      ? "signed_in"
      : "signed_in_other";
  }
  const existing = await storage.getUserByEmail(invitation.email);
  return existing ? "existing" : "new";
}

function invalidInvitation() {
  return new DomainError("PORTAL_INVITE_INVALID", 404, undefined, "This link is not valid");
}

function emailMismatch() {
  return new DomainError(
    "INVITATION_EMAIL_MISMATCH",
    403,
    undefined,
    "This invitation was sent to a different email address"
  );
}

function loginRequired() {
  return new DomainError(
    "LOGIN_REQUIRED",
    409,
    undefined,
    "An account already exists for this email. Sign in, then accept the invitation."
  );
}

export interface AcceptOutcome {
  userId: string;
  portalAccountId: string;
  createdUser: boolean;
  existingUserType: string | null;
  invitation: CustomerPortalInvitation;
}

/**
 * Accept an invitation. One transaction: the invitation row is locked, rechecked, the login is
 * created (or reused) and bound, and the invitation is closed. A second parallel accept waits on
 * the lock and then sees `accepted`.
 */
export async function acceptInvitation(args: {
  rawToken: string;
  email: string;
  signedIn: { id: string; email: string } | null;
  name?: string;
  password?: string;
  req: Request;
}): Promise<AcceptOutcome> {
  const resolved = await resolveInvitation(args.rawToken);
  if (resolved.status === "invalid") throw invalidInvitation();
  if (resolved.status !== "ok") throw inviteStateError(resolved.status);
  const inv = resolved.invitation;
  const email = normEmail(inv.email);
  if (email !== normEmail(args.email)) throw emailMismatch();
  const kind = await accountCaseFor(inv, args.signedIn);
  if (kind === "signed_in_other") throw emailMismatch();

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

  const outcome = await db.transaction(async (tx) => {
    await lockPortalInviteEmail(tx, email);
    // Contact updates revoke invitations while holding the contact row lock.
    const contact = await lockContact(tx, inv.companyId, inv.contactId);
    const [locked] = await tx
      .select()
      .from(customerPortalInvitations)
      .where(eq(customerPortalInvitations.id, inv.id))
      .for("update");
    if (
      !locked ||
      locked.tokenHash !== inviteTokenHash(args.rawToken) ||
      normEmail(locked.email) !== email
    ) {
      throw invalidInvitation();
    }
    if (
      locked.status === "accepted" ||
      locked.status === "expired" ||
      locked.status === "revoked"
    ) {
      throw inviteStateError(locked.status);
    }
    if (locked.expiresAt.getTime() <= Date.now()) throw inviteStateError("expired");
    checkInvitedContact(locked, contact);

    const [existing] = await tx
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .for("update");
    let userId: string;
    if (args.signedIn) {
      if (existing?.id !== args.signedIn.id) throw emailMismatch();
      if (!existing.emailVerified || isPlaceholderPasswordHash(existing.passwordHash)) {
        throw new DomainError(
          "PORTAL_INVITE_EMAIL_UNVERIFIED",
          403,
          undefined,
          "Verify your email before accepting this invitation"
        );
      }
      userId = existing.id;
    } else {
      if (existing || !passwordHash) throw loginRequired();
      const [created] = await tx
        .insert(users)
        .values({
          name: (args.name || locked.name || contact.name).trim(),
          email,
          userType: "client_portal",
          isAdmin: false,
          passwordHash,
          emailVerified: true,
          emailVerifiedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: users.id });
      if (!created) throw loginRequired();
      userId = created.id;
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
    return {
      userId,
      portalAccountId,
      createdUser: !existing,
      existingUserType: existing?.userType ?? null,
      invitation: closed,
    };
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
