/**
 * WQ5: company e-invoicing identity, the accredited-partner choice, the "get your first invoice
 * tax-ready" prompt state, approver links and the firm-console e-invoicing state.
 *
 * Honesty rules (owner decisions 2026-11-18):
 * - there is NO default partner. Every accredited provider compiled into the build is offered;
 *   EINVOICE_PROVIDER (plus its credentials) decides which one this deployment can connect;
 * - nothing is transmitted and nothing is "verified" unless the chosen partner is the configured
 *   one; otherwise the state is "not connected";
 * - the approver page shows the company's display name and the EmaraTax steps only (no TRN or
 *   TIN: the owner has not decided whether those may be shown to someone without a login).
 */
import crypto from "crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, pool } from "../../db";
import { DomainError } from "../../errors";
import {
  companies,
  einvoiceApproverLinks,
  einvoiceLegalEntities,
  type Company,
  type EInvoiceApproverLink,
} from "../../../shared/schema";
import {
  APPROVER_LINK_TTL_DAYS,
  effectiveTin,
  missingSellerFields,
  sellerIdProblem,
  sellerLegalId,
  tinFromTaxNumber,
  tinProblem,
  type CompanyTaxIdentityBody,
  type TaxReadyField,
} from "../../../shared/validators/einvoice-identity";
import { activeProviderModule, providerModule, registeredProviderIds } from "./providers/registry";

type CompanyRow = Company;

// ─── Identity ────────────────────────────────────────────────────────────

export interface TaxIdentityView {
  legalName: string | null;
  legalNameAr: string | null;
  displayName: string;
  /** The stored TIN (null when not stored). */
  einvoiceTin: string | null;
  /** The TIN e-invoices use (stored, else CT TRN, else VAT TRN). */
  effectiveTin: string | null;
  /** Prefill: the first 10 digits of the CT TRN (else the VAT TRN). */
  tinSuggestion: string | null;
  tinSource: "stored" | "ct_trn" | "vat_trn" | null;
  sellerIdType: string | null;
  sellerIdNumber: string | null;
  sellerIdCountry: string | null;
  tradeLicenceAuthority: string | null;
  /** The legal identifier PINT AE writes (explicit, else the trade licence on the profile). */
  sellerLegalId: { type: string; number: string } | null;
  addressStreet: string | null;
  addressDistrict: string | null;
  addressCity: string | null;
  addressPoBox: string | null;
  addressAr: string | null;
  emirate: string | null;
  missing: TaxReadyField[];
}

export function taxIdentityView(company: CompanyRow): TaxIdentityView {
  const ct = tinFromTaxNumber(company.corporateTaxId);
  const vat = tinFromTaxNumber(company.trnVatNumber);
  const stored = company.einvoiceTin ?? null;
  return {
    legalName: company.legalName ?? null,
    legalNameAr: company.legalNameAr ?? null,
    displayName: company.name,
    einvoiceTin: stored,
    effectiveTin: effectiveTin(company),
    tinSuggestion: ct ?? vat,
    tinSource: stored ? "stored" : ct ? "ct_trn" : vat ? "vat_trn" : null,
    sellerIdType: company.sellerIdType ?? null,
    sellerIdNumber: company.sellerIdNumber ?? null,
    sellerIdCountry: company.sellerIdCountry ?? null,
    tradeLicenceAuthority: company.tradeLicenceAuthority ?? null,
    sellerLegalId: sellerLegalId(company),
    addressStreet: company.addressStreet ?? company.businessAddress ?? null,
    addressDistrict: company.addressDistrict ?? null,
    addressCity: company.addressCity ?? null,
    addressPoBox: company.addressPoBox ?? null,
    addressAr: company.addressAr ?? null,
    emirate: company.emirate ?? null,
    missing: missingSellerFields(company),
  };
}

/** Validate and store the identity fields. Throws 422 with a stable code on a bad TIN or ID. */
export async function saveTaxIdentity(
  company: CompanyRow,
  body: CompanyTaxIdentityBody
): Promise<CompanyRow> {
  const patch: Partial<typeof companies.$inferInsert> = {};
  const set = <K extends keyof CompanyTaxIdentityBody>(
    key: K,
    column: keyof typeof companies.$inferInsert = key as keyof typeof companies.$inferInsert
  ) => {
    if (body[key] !== undefined) (patch as Record<string, unknown>)[column] = body[key];
  };
  set("legalName");
  set("legalNameAr");
  set("sellerIdType");
  set("sellerIdNumber");
  set("sellerIdCountry");
  set("tradeLicenceAuthority");
  set("addressStreet");
  set("addressDistrict");
  set("addressCity");
  set("addressPoBox");
  set("addressAr");
  set("emirate");

  if (body.einvoiceTin !== undefined) {
    if (body.einvoiceTin) {
      const problem = tinProblem(body.einvoiceTin, company);
      if (problem) {
        throw new DomainError(
          problem,
          422,
          { field: "einvoiceTin" },
          problem === "TIN_FORMAT"
            ? "The TIN is 10 digits and starts with 1."
            : "The TIN must be the first 10 digits of the company's TRN."
        );
      }
    }
    patch.einvoiceTin = body.einvoiceTin;
  }

  const type = body.sellerIdType !== undefined ? body.sellerIdType : company.sellerIdType;
  const number = body.sellerIdNumber !== undefined ? body.sellerIdNumber : company.sellerIdNumber;
  const country =
    body.sellerIdCountry !== undefined ? body.sellerIdCountry : company.sellerIdCountry;
  if (
    type &&
    (body.sellerIdType !== undefined ||
      body.sellerIdNumber !== undefined ||
      body.sellerIdCountry !== undefined)
  ) {
    const problem = sellerIdProblem(type as never, number ?? "", country);
    if (problem) {
      throw new DomainError(
        problem,
        422,
        { field: problem === "SELLER_ID_PASSPORT_COUNTRY" ? "sellerIdCountry" : "sellerIdNumber" },
        "Check the ID details."
      );
    }
    // Keep the legacy trade-licence column (PDF footer, readiness) in step with a TL id.
    if (type === "TL" && number) patch.tradeLicenceNo = number;
  }

  // Store the TIN derived from the CT TRN once, so the EndpointID no longer moves with the TRN.
  if (patch.einvoiceTin === undefined && !company.einvoiceTin) {
    const derived = tinFromTaxNumber(company.corporateTaxId);
    if (derived) patch.einvoiceTin = derived;
  }

  if (Object.keys(patch).length === 0) return company;
  const [row] = await db
    .update(companies)
    .set(patch)
    .where(eq(companies.id, company.id))
    .returning();
  return row;
}

// ─── Tax-ready prompt ───────────────────────────────────────────────────

export interface TaxReadyState {
  /** Show the prompt now: fields are missing and it was never shown (Skip or Continue). */
  show: boolean;
  missing: TaxReadyField[];
  promptedAt: string | null;
  identity: TaxIdentityView;
}

export function taxReadyState(company: CompanyRow): TaxReadyState {
  const identity = taxIdentityView(company);
  const promptedAt = company.einvoiceTaxReadyPromptedAt ?? null;
  return {
    show: identity.missing.length > 0 && !promptedAt,
    missing: identity.missing,
    promptedAt: promptedAt ? new Date(promptedAt).toISOString() : null,
    identity,
  };
}

/** Record that the prompt was shown (Skip or Continue), so it never shows again. */
export async function markTaxReadyPrompted(companyId: string): Promise<void> {
  await db
    .update(companies)
    .set({ einvoiceTaxReadyPromptedAt: new Date() })
    .where(and(eq(companies.id, companyId), isNull(companies.einvoiceTaxReadyPromptedAt)));
}

// ─── Partner choice ─────────────────────────────────────────────────────

export interface PartnerOption {
  id: string;
  displayName: string;
  legalName: string;
  accreditationNumber: string;
  website: string;
  emaraTaxListing: string;
  /** This deployment has the provider selected AND configured. */
  live: boolean;
}

export interface PartnerView {
  partners: PartnerOption[];
  chosen: string | null;
  /** Live provider id on this deployment (null: nothing can be transmitted). */
  liveProvider: string | null;
  /** "Verify with partner" runs only when the chosen partner is the live one. */
  verifyAvailable: boolean;
  appointment: {
    state: "not_started" | "awaiting_approval" | "approver_done" | "self_confirmed" | "verified";
    confirmedAt: string | null;
    legalEntityStatus: string | null;
  };
}

export function partnerOptions(): PartnerOption[] {
  const live = activeProviderModule()?.id ?? null;
  return registeredProviderIds().map((id) => {
    const m = providerModule(id)!;
    return {
      id: m.id,
      displayName: m.displayName,
      legalName: m.legalName,
      accreditationNumber: m.accreditationNumber,
      website: m.website,
      emaraTaxListing: m.emaraTaxListing,
      live: m.id === live,
    };
  });
}

async function legalEntityStatusFor(companyId: string, provider: string | null) {
  if (!provider) return null;
  const rows = await db
    .select({ status: einvoiceLegalEntities.status })
    .from(einvoiceLegalEntities)
    .where(
      and(
        eq(einvoiceLegalEntities.companyId, companyId),
        eq(einvoiceLegalEntities.provider, provider)
      )
    )
    .limit(1);
  return rows[0]?.status ?? null;
}

export async function partnerView(company: CompanyRow): Promise<PartnerView> {
  const partners = partnerOptions();
  const live = partners.find((p) => p.live)?.id ?? null;
  const chosen = company.einvoicePartner ?? null;
  const verifyAvailable = !!chosen && chosen === live;
  const leStatus = verifyAvailable ? await legalEntityStatusFor(company.id, chosen) : null;
  const links = await listApproverLinks(company.id);
  const openLink = links.some((l) => approverLinkState(l) === "active");
  // The approver ticked "Done" in EmaraTax: the client's next step is to verify with the partner.
  const approverDone = !!chosen && links.some((l) => approverLinkState(l) === "completed");
  const confirmedAt = company.einvoiceAppointmentConfirmedAt
    ? new Date(company.einvoiceAppointmentConfirmedAt).toISOString()
    : null;
  const state: PartnerView["appointment"]["state"] =
    leStatus === "active"
      ? "verified"
      : confirmedAt
        ? "self_confirmed"
        : approverDone
          ? "approver_done"
          : openLink || leStatus === "reserved" || leStatus === "pending"
            ? "awaiting_approval"
            : "not_started";
  return {
    partners,
    chosen,
    liveProvider: live,
    verifyAvailable,
    appointment: { state, confirmedAt, legalEntityStatus: leStatus },
  };
}

export async function choosePartner(companyId: string, partner: string | null): Promise<void> {
  if (partner && !registeredProviderIds().includes(partner)) {
    throw new DomainError("EINVOICE_PARTNER_UNKNOWN", 422, { partner }, "Unknown partner.");
  }
  // A different partner is a different EmaraTax appointment: approvals given (or still open)
  // for the previous one no longer apply, so they are withdrawn.
  const [current] = await db
    .select({ partner: companies.einvoicePartner })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if ((current?.partner ?? null) !== partner) {
    await db
      .update(einvoiceApproverLinks)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(einvoiceApproverLinks.companyId, companyId), isNull(einvoiceApproverLinks.revokedAt))
      );
  }
  await db
    .update(companies)
    .set({
      einvoicePartner: partner,
      // A different partner means a different EmaraTax appointment.
      einvoiceAppointmentConfirmedAt: null,
      einvoiceAppointmentConfirmedBy: null,
    })
    .where(eq(companies.id, companyId));
}

/** "Confirmed by you, not yet verified": used when the partner offers no check. */
export async function selfConfirmAppointment(
  company: CompanyRow,
  userId: string,
  confirmed: boolean
): Promise<void> {
  if (confirmed && !company.einvoicePartner) {
    throw new DomainError("EINVOICE_PARTNER_REQUIRED", 409, undefined, "Choose a partner first.");
  }
  await db
    .update(companies)
    .set({
      einvoiceAppointmentConfirmedAt: confirmed ? new Date() : null,
      einvoiceAppointmentConfirmedBy: confirmed ? userId : null,
    })
    .where(eq(companies.id, company.id));
}

// ─── Approver links ─────────────────────────────────────────────────────

export function hashApproverToken(raw: string): string {
  return crypto.createHash("sha256").update(`einvoice-approver:${raw}`, "utf8").digest("hex");
}

export type ApproverLinkState = "active" | "completed" | "expired" | "revoked";

export function approverLinkState(link: EInvoiceApproverLink, now = new Date()): ApproverLinkState {
  if (link.revokedAt) return "revoked";
  if (link.completedAt) return "completed";
  if (new Date(link.expiresAt).getTime() <= now.getTime()) return "expired";
  return "active";
}

export function approverLinkView(link: EInvoiceApproverLink) {
  return {
    id: link.id,
    approverName: link.approverName,
    approverEmail: link.approverEmail,
    state: approverLinkState(link),
    expiresAt: new Date(link.expiresAt).toISOString(),
    completedAt: link.completedAt ? new Date(link.completedAt).toISOString() : null,
    revokedAt: link.revokedAt ? new Date(link.revokedAt).toISOString() : null,
    lastViewedAt: link.lastViewedAt ? new Date(link.lastViewedAt).toISOString() : null,
    createdAt: new Date(link.createdAt).toISOString(),
  };
}

export async function listApproverLinks(companyId: string): Promise<EInvoiceApproverLink[]> {
  return db
    .select()
    .from(einvoiceApproverLinks)
    .where(eq(einvoiceApproverLinks.companyId, companyId))
    .orderBy(desc(einvoiceApproverLinks.createdAt));
}

export async function createApproverLink(args: {
  company: CompanyRow;
  userId: string;
  approverName?: string | null;
  approverEmail?: string | null;
  now?: Date;
}): Promise<{ link: EInvoiceApproverLink; token: string }> {
  if (!args.company.einvoicePartner) {
    throw new DomainError(
      "EINVOICE_PARTNER_REQUIRED",
      409,
      undefined,
      "Choose your e-invoicing partner before you ask someone to approve it."
    );
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const now = args.now ?? new Date();
  const [link] = await db
    .insert(einvoiceApproverLinks)
    .values({
      companyId: args.company.id,
      tokenHash: hashApproverToken(token),
      approverName: args.approverName ?? null,
      approverEmail: args.approverEmail ?? null,
      createdBy: args.userId,
      expiresAt: new Date(now.getTime() + APPROVER_LINK_TTL_DAYS * 86_400_000),
    })
    .returning();
  return { link, token };
}

/** Revoke one of the company's links; another company's link id is a 404. */
export async function revokeApproverLink(companyId: string, linkId: string) {
  const [row] = await db
    .update(einvoiceApproverLinks)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(einvoiceApproverLinks.id, linkId),
        eq(einvoiceApproverLinks.companyId, companyId),
        isNull(einvoiceApproverLinks.revokedAt)
      )
    )
    .returning();
  if (row) return row;
  const [existing] = await db
    .select()
    .from(einvoiceApproverLinks)
    .where(
      and(eq(einvoiceApproverLinks.id, linkId), eq(einvoiceApproverLinks.companyId, companyId))
    );
  if (!existing) throw new DomainError("NOT_FOUND", 404, undefined, "Link not found");
  return existing;
}

export async function findApproverLinkByToken(raw: string) {
  if (!raw || raw.length < 20 || raw.length > 100) return undefined;
  const [row] = await db
    .select()
    .from(einvoiceApproverLinks)
    .where(eq(einvoiceApproverLinks.tokenHash, hashApproverToken(raw)));
  return row;
}

/** What the no-login page may show: display name, partner, steps. No TRN, TIN or address. */
export async function publicApproverView(link: EInvoiceApproverLink) {
  const [company] = await db
    .select({ name: companies.name, partner: companies.einvoicePartner, locale: companies.locale })
    .from(companies)
    .where(eq(companies.id, link.companyId));
  const m = providerModule(company?.partner ?? null);
  return {
    state: approverLinkState(link),
    companyName: company?.name ?? "",
    locale: company?.locale ?? "en",
    approverName: link.approverName,
    expiresAt: new Date(link.expiresAt).toISOString(),
    completedAt: link.completedAt ? new Date(link.completedAt).toISOString() : null,
    partner: m
      ? {
          displayName: m.displayName,
          legalName: m.legalName,
          accreditationNumber: m.accreditationNumber,
          emaraTaxListing: m.emaraTaxListing,
        }
      : null,
  };
}

export async function completeApproverLink(link: EInvoiceApproverLink) {
  const [row] = await db
    .update(einvoiceApproverLinks)
    .set({ completedAt: new Date() })
    .where(and(eq(einvoiceApproverLinks.id, link.id), isNull(einvoiceApproverLinks.completedAt)))
    .returning();
  return row ?? link;
}

export async function touchApproverLink(linkId: string) {
  await db
    .update(einvoiceApproverLinks)
    .set({ lastViewedAt: new Date() })
    .where(eq(einvoiceApproverLinks.id, linkId));
}

/** Who to tell that the approver pressed Done: the link's creator and the company owners. */
export async function approverNotifyRecipients(link: EInvoiceApproverLink): Promise<string[]> {
  const r = await pool.query(
    `SELECT DISTINCT u.email FROM users u
       LEFT JOIN company_users cu ON cu.user_id = u.id AND cu.company_id = $1
      WHERE u.email IS NOT NULL AND (u.id = $2 OR cu.role = 'owner')`,
    [link.companyId, link.createdBy]
  );
  return r.rows.map((x: { email: string }) => x.email).filter(Boolean);
}

// ─── Firm console ───────────────────────────────────────────────────────

export type FirmEInvoicingState =
  | "connected"
  | "self_confirmed"
  | "approver_done"
  | "awaiting_approval"
  | "appoint_partner"
  | "partner_not_chosen"
  | "identity_missing";

/**
 * One state per client for the NR firm console. "connected" needs the live, configured
 * provider AND an active legal entity there, so with no provider it never appears.
 */
export async function firmEInvoicingStates(
  companyIds: string[]
): Promise<Map<string, { state: FirmEInvoicingState; missing: number; partner: string | null }>> {
  const out = new Map<
    string,
    { state: FirmEInvoicingState; missing: number; partner: string | null }
  >();
  if (companyIds.length === 0) return out;
  const rows = await db.select().from(companies).where(inArray(companies.id, companyIds));
  const live = activeProviderModule()?.id ?? null;
  const active = new Set<string>();
  const pending = new Set<string>();
  if (live) {
    const les = await db
      .select({ companyId: einvoiceLegalEntities.companyId, status: einvoiceLegalEntities.status })
      .from(einvoiceLegalEntities)
      .where(
        and(
          inArray(einvoiceLegalEntities.companyId, companyIds),
          eq(einvoiceLegalEntities.provider, live)
        )
      );
    for (const le of les) {
      if (le.status === "active") active.add(le.companyId);
      else if (le.status === "reserved" || le.status === "pending") pending.add(le.companyId);
    }
  }
  const links = await db
    .select()
    .from(einvoiceApproverLinks)
    .where(inArray(einvoiceApproverLinks.companyId, companyIds));
  const approved = new Set<string>();
  for (const l of links) {
    const st = approverLinkState(l);
    if (st === "active") pending.add(l.companyId);
    else if (st === "completed") approved.add(l.companyId);
  }

  for (const c of rows) {
    const missing = missingSellerFields(c).length;
    const partner = c.einvoicePartner ?? null;
    const state: FirmEInvoicingState =
      partner && partner === live && active.has(c.id)
        ? "connected"
        : c.einvoiceAppointmentConfirmedAt && partner
          ? "self_confirmed"
          : partner && approved.has(c.id)
            ? "approver_done"
            : partner && pending.has(c.id)
              ? "awaiting_approval"
              : missing > 0
                ? "identity_missing"
                : partner
                  ? "appoint_partner"
                  : "partner_not_chosen";
    out.set(c.id, { state, missing, partner });
  }
  return out;
}
