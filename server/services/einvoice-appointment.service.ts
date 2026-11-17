// E-invoicing partner appointment (reseller model).
//
// The app is not an Accredited Service Provider. It sells e-invoicing through
// one MoF-accredited partner (the active EInvoiceProvider). Under MD 243 the
// taxpayer itself must contract with its ASP and appoint it in EmaraTax, so
// before any invoice is submitted for a client company we require:
//   1. an owner/CFO accepted the partner's current terms, and
//   2. an owner/CFO confirmed they appointed that partner in EmaraTax.
// The gate below is pure so it can be tested without a database.

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { einvoiceAspAppointments, type EInvoiceAspAppointment } from "../../shared/schema";

export interface EInvoicePartner {
  /** Matches EInvoiceProvider.name. */
  provider: string;
  displayName: string;
  /** Partner's own end-user terms. Null until configured; acceptance is then blocked. */
  termsUrl: string | null;
  termsVersion: string;
  /** Mock/dev providers skip the gate; nothing real is transmitted. */
  requiresAppointment: boolean;
}

const DISPLAY_NAMES: Record<string, string> = {
  complyance: "Complyance",
  acube: "A-Cube",
  http: "Accredited service provider",
  mock: "Test provider (no real transmission)",
};

/** Describe the active partner from env. Terms URL/version are config, never hard-coded. */
export function activeEInvoicePartner(env: NodeJS.ProcessEnv = process.env): EInvoicePartner {
  const provider = (env.EINVOICE_PROVIDER || "mock").toLowerCase();
  const termsUrl = env.EINVOICE_ASP_TERMS_URL?.trim() || null;
  return {
    provider,
    displayName: env.EINVOICE_ASP_DISPLAY_NAME?.trim() || DISPLAY_NAMES[provider] || provider,
    termsUrl,
    termsVersion: env.EINVOICE_ASP_TERMS_VERSION?.trim() || "unversioned",
    requiresAppointment: provider !== "mock",
  };
}

export type AppointmentState =
  | "not_started"
  | "terms_outdated"
  | "awaiting_emaratax"
  | "active"
  | "revoked"
  | "not_required";

export function appointmentState(
  appointment:
    | Pick<
        EInvoiceAspAppointment,
        "provider" | "termsVersion" | "emarataxConfirmedAt" | "revokedAt"
      >
    | null
    | undefined,
  partner: EInvoicePartner
): AppointmentState {
  if (!partner.requiresAppointment) return "not_required";
  if (!appointment || appointment.provider !== partner.provider) return "not_started";
  if (appointment.revokedAt) return "revoked";
  if (appointment.termsVersion !== partner.termsVersion) return "terms_outdated";
  if (!appointment.emarataxConfirmedAt) return "awaiting_emaratax";
  return "active";
}

const GATE_MESSAGES: Record<Exclude<AppointmentState, "active" | "not_required">, string> = {
  not_started:
    "E-invoicing is not set up for this company yet. Accept the partner's terms and appoint it in EmaraTax first.",
  terms_outdated:
    "The e-invoicing partner's terms have changed. Review and accept the new terms first.",
  awaiting_emaratax:
    "Confirm that you have appointed the e-invoicing partner in EmaraTax before submitting invoices.",
  revoked:
    "E-invoicing was switched off for this company. Set it up again before submitting invoices.",
};

/** Null when submission may proceed; otherwise the 409 payload to return. */
export function appointmentGate(
  appointment: Parameters<typeof appointmentState>[0],
  partner: EInvoicePartner
): { code: string; message: string; state: AppointmentState } | null {
  const state = appointmentState(appointment, partner);
  if (state === "active" || state === "not_required") return null;
  return { code: "EINVOICE_APPOINTMENT_REQUIRED", message: GATE_MESSAGES[state], state };
}

/** Company roles that may bind the company to the partner's terms. */
export const APPOINTMENT_ROLES = new Set(["owner", "cfo"]);

export async function getAppointment(
  companyId: string,
  provider: string
): Promise<EInvoiceAspAppointment | null> {
  const [row] = await db
    .select()
    .from(einvoiceAspAppointments)
    .where(
      and(
        eq(einvoiceAspAppointments.companyId, companyId),
        eq(einvoiceAspAppointments.provider, provider)
      )
    )
    .limit(1);
  return row ?? null;
}

/** Record acceptance of the current terms. Accepting a newer terms version keeps
 *  the EmaraTax confirmation (same partner, still appointed). Accepting after a
 *  revocation clears it, because the client may have removed the partner. */
export async function acceptPartnerTerms(args: {
  companyId: string;
  partner: EInvoicePartner;
  userId: string;
}): Promise<EInvoiceAspAppointment> {
  const now = new Date();
  const existing = await getAppointment(args.companyId, args.partner.provider);
  const reappointing = Boolean(existing?.revokedAt);
  const [row] = await db
    .insert(einvoiceAspAppointments)
    .values({
      companyId: args.companyId,
      provider: args.partner.provider,
      termsVersion: args.partner.termsVersion,
      termsAcceptedAt: now,
      termsAcceptedBy: args.userId,
    })
    .onConflictDoUpdate({
      target: [einvoiceAspAppointments.companyId, einvoiceAspAppointments.provider],
      set: {
        termsVersion: args.partner.termsVersion,
        termsAcceptedAt: now,
        termsAcceptedBy: args.userId,
        revokedAt: null,
        revokedBy: null,
        // After a revocation the client must re-appoint in EmaraTax.
        ...(reappointing ? { emarataxConfirmedAt: null, emarataxConfirmedBy: null } : {}),
        updatedAt: now,
      },
    })
    .returning();
  return row;
}

export async function confirmEmaraTaxAppointment(args: {
  companyId: string;
  provider: string;
  userId: string;
}): Promise<EInvoiceAspAppointment | null> {
  const now = new Date();
  const [row] = await db
    .update(einvoiceAspAppointments)
    .set({ emarataxConfirmedAt: now, emarataxConfirmedBy: args.userId, updatedAt: now })
    .where(
      and(
        eq(einvoiceAspAppointments.companyId, args.companyId),
        eq(einvoiceAspAppointments.provider, args.provider)
      )
    )
    .returning();
  return row ?? null;
}

export async function revokeAppointment(args: {
  companyId: string;
  provider: string;
  userId: string;
}): Promise<EInvoiceAspAppointment | null> {
  const now = new Date();
  const [row] = await db
    .update(einvoiceAspAppointments)
    .set({ revokedAt: now, revokedBy: args.userId, updatedAt: now })
    .where(
      and(
        eq(einvoiceAspAppointments.companyId, args.companyId),
        eq(einvoiceAspAppointments.provider, args.provider)
      )
    )
    .returning();
  return row ?? null;
}
