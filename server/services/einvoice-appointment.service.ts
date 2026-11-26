// E-invoicing partner appointment (reseller model).
//
// The app is not an Accredited Service Provider. It sells e-invoicing through
// one MoF-accredited partner (the active EInvoiceProvider). Under MD 243 the
// taxpayer itself must contract with its ASP and appoint it in EmaraTax, so
// before any invoice is submitted for a client company we require:
//   1. an owner/CFO accepted the partner's current terms, and
//   2. an owner/CFO confirmed they appointed that partner in EmaraTax.
// The gate below is pure so it can be tested without a database.

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { einvoiceAspAppointments, type EInvoiceAspAppointment } from "../../shared/schema";

export interface EInvoicePartner {
  /** Matches EInvoiceProvider.name. */
  provider: string;
  displayName: string;
  /** Partner's own end-user terms. Null until configured; acceptance is then blocked. */
  termsUrl: string | null;
  termsVersion: string;
  /** The mock provider skips the gate; nothing real is transmitted. */
  requiresAppointment: boolean;
}

const DISPLAY_NAMES: Record<string, string> = {
  http: "Accredited service provider",
  mock: "Test provider (no real transmission)",
};

/** Describe the tenant's selected or resolved provider using its configured terms. */
export function eInvoicePartner(
  provider = "mock",
  env: NodeJS.ProcessEnv = process.env
): EInvoicePartner {
  const prefix = `EINVOICE_ASP_${provider.toUpperCase()}_`;
  const legacy = env.EINVOICE_PROVIDER?.toLowerCase() === provider;
  const setting = (key: string) =>
    env[prefix + key]?.trim() || (legacy ? env[`EINVOICE_ASP_${key}`]?.trim() : undefined);
  return {
    provider,
    displayName: setting("DISPLAY_NAME") || DISPLAY_NAMES[provider] || provider,
    termsUrl: setting("TERMS_URL") || null,
    termsVersion: setting("TERMS_VERSION") || "unversioned",
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

export async function getAppointment(
  companyId: string,
  provider: string,
  conn: Pick<typeof db, "select"> = db,
  lock?: "share"
): Promise<EInvoiceAspAppointment | null> {
  const query = conn
    .select()
    .from(einvoiceAspAppointments)
    .where(
      and(
        eq(einvoiceAspAppointments.companyId, companyId),
        eq(einvoiceAspAppointments.provider, provider)
      )
    )
    .limit(1);
  const [row] = await (lock ? query.for(lock) : query);
  return row ?? null;
}

export async function submissionAppointmentGate(
  companyId: string,
  provider: string,
  conn: Pick<typeof db, "select">
) {
  const partner = eInvoicePartner(provider);
  if (!partner.requiresAppointment) return null;
  return appointmentGate(await getAppointment(companyId, provider, conn, "share"), partner);
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
  // The EmaraTax confirmation is cleared atomically when the row's current
  // revokedAt is non-null at write time (not at the earlier read time),
  // closing the TOCTOU window where a concurrent revocation could be lost.
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
        // Keep acceptance distinct even if revocation and reacceptance share a clock tick.
        termsAcceptedAt: sql`GREATEST(${now.toISOString()}::timestamp, ${einvoiceAspAppointments.termsAcceptedAt} + interval '1 millisecond')`,
        termsAcceptedBy: args.userId,
        revokedAt: null,
        revokedBy: null,
        // After a revocation the client must re-appoint in EmaraTax. Evaluate
        // revokedAt at write time so a concurrent revocation is not silently cleared.
        emarataxConfirmedAt: sql`CASE WHEN ${einvoiceAspAppointments.revokedAt} IS NOT NULL THEN NULL ELSE ${einvoiceAspAppointments.emarataxConfirmedAt} END`,
        emarataxConfirmedBy: sql`CASE WHEN ${einvoiceAspAppointments.revokedAt} IS NOT NULL THEN NULL ELSE ${einvoiceAspAppointments.emarataxConfirmedBy} END`,
        updatedAt: now,
      },
    })
    .returning();
  return row;
}

export async function confirmEmaraTaxAppointment(args: {
  accepted: Pick<
    EInvoiceAspAppointment,
    "id" | "companyId" | "provider" | "termsVersion" | "termsAcceptedAt"
  >;
  userId: string;
}): Promise<EInvoiceAspAppointment | null> {
  const now = new Date();
  const { accepted } = args;
  const [row] = await db
    .update(einvoiceAspAppointments)
    .set({ emarataxConfirmedAt: now, emarataxConfirmedBy: args.userId, updatedAt: now })
    .where(
      and(
        eq(einvoiceAspAppointments.id, accepted.id),
        eq(einvoiceAspAppointments.companyId, accepted.companyId),
        eq(einvoiceAspAppointments.provider, accepted.provider),
        eq(einvoiceAspAppointments.termsVersion, accepted.termsVersion),
        eq(einvoiceAspAppointments.termsAcceptedAt, accepted.termsAcceptedAt),
        isNull(einvoiceAspAppointments.revokedAt)
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
