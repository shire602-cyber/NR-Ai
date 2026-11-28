/**
 * WQ5: company e-invoicing identity, the accredited-partner choice, the "get your first invoice
 * tax-ready" prompt state, approver links and the firm-console e-invoicing state.
 *
 * Honesty rules (owner decisions 2026-11-18):
 * - every compiled accredited provider is offered. The company chooses its own partner, and
 *   transmits only after configuring its credentials and linking in EmaraTax;
 * - the approver page shows the company's display name and the EmaraTax steps only (no TRN or
 *   TIN: the owner has not decided whether those may be shown to someone without a login).
 */
import crypto from "crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, pool, type AppDatabase } from "../../db";
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
  derivedTinToStore,
  tinProblem,
  type CompanyTaxIdentityBody,
  type TaxReadyField,
} from "../../../shared/validators/einvoice-identity";
import { providerModule, registeredProviderIds } from "./providers/registry";
import { companyProviderHealth } from "./providers/company-provider";
import {
  currentOnboardingEntity,
  getLegalEntity,
  lockOnboardingCompany,
  requireCompanyTin,
} from "./legal-entities";
import {
  applyCompanyApprovalScopeUpdate,
  appointmentEvidence,
  appointmentScope,
  hasAppointmentEvidence,
  recordAppointmentScope,
} from "./appointment-scope";

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

function taxIdentityPatch(company: CompanyRow, body: CompanyTaxIdentityBody) {
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
    // Same order as effectiveTin: CT TRN first, then the VAT TRN (a company with only a VAT TRN).
    const derived = derivedTinToStore(company);
    if (derived) patch.einvoiceTin = derived;
  }

  return patch;
}

/** Validate and store the taxpayer identity and withdraw approvals for a superseded taxpayer. */
export async function saveTaxIdentity(
  company: CompanyRow,
  body: CompanyTaxIdentityBody
): Promise<CompanyRow> {
  return db.transaction(async (tx) => {
    const current = await lockOnboardingCompany(company.id, tx);
    if (!current || current.deletedAt) throw new DomainError("COMPANY_NOT_FOUND", 404);
    const patch = taxIdentityPatch(current, body);
    return Object.keys(patch).length
      ? applyCompanyApprovalScopeUpdate(current, patch, tx)
      : current;
  });
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
  /** This company has the provider selected and configured. */
  live: boolean;
}

export interface PartnerView {
  partners: PartnerOption[];
  chosen: string | null;
  /** Configured provider id for this company, if any. */
  liveProvider: string | null;
  /** "Verify with partner" runs only for a current taxpayer registration. */
  verifyAvailable: boolean;
  appointment: {
    state: "not_started" | "awaiting_approval" | "approver_done" | "self_confirmed" | "verified";
    confirmedAt: string | null;
    legalEntityStatus: string | null;
  };
}

function partnerOptions(live: string | null): PartnerOption[] {
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

export async function partnerView(company: CompanyRow): Promise<PartnerView> {
  const health = await companyProviderHealth(company);
  const live = health.provider?.id ?? null;
  const partners = partnerOptions(live);
  const chosen = health.chosenProvider;
  const entity =
    live && health.environment
      ? currentOnboardingEntity(
          company,
          await getLegalEntity(company.id, live, health.environment),
          live,
          health.environment
        )
      : undefined;
  const verifyAvailable = Boolean(entity);
  const leStatus = entity?.status ?? null;
  const [links, approvals] = await Promise.all([
    listApproverLinks(company.id),
    appointmentEvidence([company.id]),
  ]);
  const states = links.map((link) => scopedApproverState(link, company, approvals));
  const openLink = states.includes("active");
  // The approver ticked "Done" in EmaraTax: the client's next step is to verify with the partner.
  const approverDone = states.includes("completed");
  const confirmedAt = hasAppointmentEvidence(company, approvals)
    ? (company.einvoiceAppointmentConfirmedAt?.toISOString() ?? null)
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
  // Changing partners withdraws approvals for the previous EmaraTax appointment.
  await db.transaction(async (tx) => {
    const current = await lockOnboardingCompany(companyId, tx);
    if (!current || current.deletedAt) throw new DomainError("COMPANY_NOT_FOUND", 404);
    if ((current.einvoicePartner ?? null) === partner) return;
    await applyCompanyApprovalScopeUpdate(current, { einvoicePartner: partner }, tx);
  });
}

async function lockAppointmentCompany(expected: Company, tx: Pick<AppDatabase, "select">) {
  const current = await lockOnboardingCompany(expected.id, tx);
  if (!current || current.deletedAt) throw new DomainError("COMPANY_NOT_FOUND", 404);
  if (
    current.einvoicePartner !== expected.einvoicePartner ||
    appointmentScope(current) !== appointmentScope(expected)
  )
    throw new DomainError("EINVOICE_TAXPAYER_CHANGED", 409);
  return current;
}

function requireAppointmentScope(company: Company) {
  if (!company.einvoicePartner) {
    throw new DomainError("EINVOICE_PARTNER_REQUIRED", 409, undefined, "Choose a partner first.");
  }
  requireCompanyTin(company);
  return appointmentScope(company)!;
}

/** "Confirmed by you, not yet verified": used when the partner offers no check. */
export async function selfConfirmAppointment(
  company: CompanyRow,
  userId: string,
  confirmed: boolean
): Promise<void> {
  await db.transaction(async (tx) => {
    const current = await lockAppointmentCompany(company, tx);
    const at = confirmed ? new Date() : null;
    if (at) {
      await recordAppointmentScope(tx, {
        companyId: current.id,
        userId,
        at,
        scope: requireAppointmentScope(current),
      });
    }
    await tx
      .update(companies)
      .set({
        einvoiceAppointmentConfirmedAt: at,
        einvoiceAppointmentConfirmedBy: confirmed ? userId : null,
      })
      .where(eq(companies.id, current.id));
  });
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

function scopedApproverState(
  link: EInvoiceApproverLink,
  company: Company | undefined,
  approvals: Set<string>
): ApproverLinkState {
  return company && !company.deletedAt && hasAppointmentEvidence(company, approvals, link.id)
    ? approverLinkState(link)
    : "revoked";
}

export function approverLinkView(link: EInvoiceApproverLink, state = approverLinkState(link)) {
  return {
    id: link.id,
    approverName: link.approverName,
    approverEmail: link.approverEmail,
    state,
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

export async function listApproverLinkViews(company: Company) {
  const [links, approvals] = await Promise.all([
    listApproverLinks(company.id),
    appointmentEvidence([company.id]),
  ]);
  return links.map((link) => approverLinkView(link, scopedApproverState(link, company, approvals)));
}

export async function createApproverLink(args: {
  company: CompanyRow;
  userId: string;
  approverName?: string | null;
  approverEmail?: string | null;
  now?: Date;
}): Promise<{ link: EInvoiceApproverLink; token: string }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    const current = await lockAppointmentCompany(args.company, tx);
    const scope = requireAppointmentScope(current);
    const [link] = await tx
      .insert(einvoiceApproverLinks)
      .values({
        companyId: current.id,
        tokenHash: hashApproverToken(token),
        approverName: args.approverName ?? null,
        approverEmail: args.approverEmail ?? null,
        createdBy: args.userId,
        expiresAt: new Date(now.getTime() + APPROVER_LINK_TTL_DAYS * 86_400_000),
      })
      .returning();
    await recordAppointmentScope(tx, {
      companyId: current.id,
      userId: args.userId,
      scope,
      at: now,
      linkId: link.id,
    });
    return { link, token };
  });
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
  const [company] = await db.select().from(companies).where(eq(companies.id, link.companyId));
  const approvals = await appointmentEvidence([link.companyId], db, link.id);
  const m = providerModule(company?.einvoicePartner ?? null);
  return {
    state: scopedApproverState(link, company, approvals),
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
  return db.transaction(async (tx) => {
    const company = await lockOnboardingCompany(link.companyId, tx);
    const [current] = await tx
      .select()
      .from(einvoiceApproverLinks)
      .where(
        and(
          eq(einvoiceApproverLinks.id, link.id),
          eq(einvoiceApproverLinks.companyId, link.companyId)
        )
      )
      .for("update");
    const approvals = await appointmentEvidence([link.companyId], tx, link.id);
    const state = current ? scopedApproverState(current, company, approvals) : "revoked";
    if (state !== "active") return { link: current ?? link, state, completedNow: false };
    const [done] = await tx
      .update(einvoiceApproverLinks)
      .set({ completedAt: new Date() })
      .where(eq(einvoiceApproverLinks.id, current.id))
      .returning();
    return { link: done, state: "completed" as const, completedNow: true };
  });
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
 * provider AND an active legal entity for the current taxpayer in that environment.
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
  const companyById = new Map(rows.map((company) => [company.id, company]));
  const healthByCompany = new Map(
    await Promise.all(
      rows.map(async (company) => [company.id, await companyProviderHealth(company)] as const)
    )
  );
  const active = new Set<string>();
  const pending = new Set<string>();
  const configuredIds = rows
    .filter((company) => healthByCompany.get(company.id)?.provider)
    .map((company) => company.id);
  if (configuredIds.length) {
    const les = await db
      .select()
      .from(einvoiceLegalEntities)
      .where(inArray(einvoiceLegalEntities.companyId, configuredIds));
    for (const le of les) {
      const health = healthByCompany.get(le.companyId);
      const company = companyById.get(le.companyId);
      if (
        !company ||
        health?.provider?.id !== le.provider ||
        health.environment !== le.environment ||
        !currentOnboardingEntity(company, le, le.provider, le.environment)
      )
        continue;
      if (le.status === "active") active.add(le.companyId);
      else if (le.status === "reserved" || le.status === "pending") pending.add(le.companyId);
    }
  }
  const [links, approvals] = await Promise.all([
    db
      .select()
      .from(einvoiceApproverLinks)
      .where(inArray(einvoiceApproverLinks.companyId, companyIds)),
    appointmentEvidence(companyIds),
  ]);
  const approved = new Set<string>();
  for (const l of links) {
    const st = scopedApproverState(l, companyById.get(l.companyId), approvals);
    if (st === "active") pending.add(l.companyId);
    else if (st === "completed") approved.add(l.companyId);
  }

  for (const c of rows) {
    const missing = missingSellerFields(c).length;
    const partner = c.einvoicePartner ?? null;
    const state: FirmEInvoicingState =
      partner && active.has(c.id)
        ? "connected"
        : hasAppointmentEvidence(c, approvals)
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
