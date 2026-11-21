/**
 * Write contracts for customer-portal invitations (STEP5). companyId and contactId come from the
 * URL (or the signed-in staff member's company), never the body. The accept password is checked on
 * the server with `passwordPolicySchema`; the client mirrors the rules from ./password-rules.
 */
import { z } from "zod";
import { zEmail, zText, zUuid } from "./primitives";

/** Invitations expire after this many days; resending extends it. */
export const PORTAL_INVITE_TTL_DAYS = 7;
/** Seconds a staff member must wait before resending the same invitation. */
export const PORTAL_INVITE_RESEND_COOLDOWN_S = 60;
export const PORTAL_INVITE_MAX_SENDS_PER_DAY = 5;
export const PORTAL_INVITE_MAX_PER_HOUR = 60;
export const PORTAL_INVITE_MAX_PER_DAY = 300;
export const PORTAL_INVITE_MESSAGE_MAX = 500;
export const PORTAL_BULK_MAX = 100;

export const PORTAL_INVITE_LANGUAGES = ["en", "ar", "bilingual"] as const;
export type PortalInviteLanguage = (typeof PORTAL_INVITE_LANGUAGES)[number];

export const portalInviteBody = z.object({
  email: zEmail.optional(),
  name: zText(100).optional(),
  language: z.enum(PORTAL_INVITE_LANGUAGES).optional(),
  message: zText(PORTAL_INVITE_MESSAGE_MAX).optional(),
  saveEmailToContact: z.boolean().optional(),
});
export type PortalInviteBody = z.output<typeof portalInviteBody>;

export const portalBulkInviteBody = z.object({
  contactIds: z.array(zUuid).min(1).max(PORTAL_BULK_MAX),
  language: z.enum(["contact", ...PORTAL_INVITE_LANGUAGES]).default("contact"),
});
export type PortalBulkInviteBody = z.output<typeof portalBulkInviteBody>;

export const portalAcceptBody = z.object({
  name: zText(100, { min: 1 }).optional(),
  password: z.string().max(256).optional(),
  acceptTerms: z.literal(true),
});
export type PortalAcceptBody = z.output<typeof portalAcceptBody>;

export const PORTAL_INVITE_TOKEN_RE = /^[0-9a-f]{64}$/i;
