/**
 * Per-company legal entity at the ASP (E1, A-Cube; provider-neutral since E2).
 *
 * One row per company / provider / environment (einvoice_legal_entities). Every accredited ASP
 * needs the taxpayer to authorise it in EmaraTax (UAE PASS); only the API steps around that differ
 * (A-Cube: reserve the TIN first; Complyance: register the company after the authorisation, see
 * providers/complyance-onboarding.ts). Status vocabulary for every provider:
 *   reserved  we hold the request; the taxpayer's EmaraTax step is not done yet
 *   pending   linked at the provider, not yet able to send (e.g. mapping/readiness pending)
 *   active    can send
 *   inactive  delinked / archived: sending is blocked (409)
 *
 * A-Cube's flow:
 * A UAE taxpayer cannot be created through the API (FTA rule). The flow is:
 *   1. we reserve the company's TIN at A-Cube (POST /legal-entities {tin}) -> status reserved;
 *   2. the taxpayer (or whoever signs in to EmaraTax for it, with UAE PASS) selects
 *      "PLATFORM ACUBE TECHNOLOGIES L.L.C" as its ASP and confirms its details on A-Cube's page
 *      within five minutes;
 *   3. A-Cube registers it on the Peppol SMP and the central registry and sends
 *      legal_entity.synchronized (action LINK) -> status active.
 * REVERIFY keeps it active; DELINK makes it inactive, which blocks sending (409).
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, type AppDatabase } from "../../db";
import { companies, einvoiceLegalEntities, type EInvoiceLegalEntity } from "../../../shared/schema";
import { DomainError } from "../../errors";
import {
  PEPPOL_SCHEME_UAE_TIN,
  isUaeTin,
  tinFromTrn,
  uaePeppolEndpointIssue,
} from "./pint-ae-codes";
import {
  effectiveTin,
  tinProblem,
  type TinSource,
} from "../../../shared/validators/einvoice-identity";

/** Provider legal-entity fields we keep (A-Cube's resource shape; other providers map onto it). */
export interface LegalEntityFields {
  legalEntityId?: string;
  tin?: string;
  status?: string;
  nameEn?: string | null;
  nameAr?: string | null;
  vatTrn?: string | null;
  enabledCapabilities?: Array<{ key: string; type?: string; domain?: string }>;
  smpSyncAt?: string | null;
  registrySyncAt?: string | null;
  reservationExpiresAt?: string | null;
}

export type LegalEntityStatus = "reserved" | "pending" | "active" | "inactive";

export function normaliseLegalEntityStatus(raw: unknown): LegalEntityStatus {
  const s = String(raw ?? "").toLowerCase();
  if (s === "active") return "active";
  if (s === "inactive") return "inactive";
  if (s === "pending") return "pending";
  return "reserved";
}

export const peppolAddressFor = (tin: string) => `${PEPPOL_SCHEME_UAE_TIN}:${tin}`;

/** Every identifier supplied by a provider must agree with the scoped legal entity. */
export function matchesProviderEntityOwner(
  entity: Pick<EInvoiceLegalEntity, "legalEntityId" | "tin">,
  owner: { legalEntityId?: unknown; tin?: unknown }
): boolean {
  return (
    (owner.legalEntityId == null || owner.legalEntityId === entity.legalEntityId) &&
    (owner.tin == null || owner.tin === entity.tin)
  );
}

type InboundTaxpayer = { endpoint: string | null; scheme: string | null; vatTrn: string | null };

function matchesTaxpayerTin(tin: string, buyer: InboundTaxpayer): boolean {
  return (
    isUaeTin(tin) &&
    Boolean(buyer.endpoint || buyer.vatTrn) &&
    (buyer.endpoint == null ||
      (buyer.scheme === PEPPOL_SCHEME_UAE_TIN &&
        uaePeppolEndpointIssue(buyer.scheme, buyer.endpoint, tin) === null)) &&
    (buyer.vatTrn == null || tinFromTrn(buyer.vatTrn) === tin)
  );
}

/** Provider receipts use the registered taxpayer even if company VAT registration is absent. */
export function matchesOnboardedTaxpayer(
  entity: Pick<EInvoiceLegalEntity, "status" | "tin" | "peppolAddress">,
  buyer: InboundTaxpayer
): boolean {
  return (
    entity.status === "active" &&
    (entity.peppolAddress === null || entity.peppolAddress === peppolAddressFor(entity.tin)) &&
    matchesTaxpayerTin(entity.tin, buyer)
  );
}

export async function getLegalEntity(
  companyId: string,
  provider: string,
  environment: string,
  conn: Pick<AppDatabase, "select"> = db,
  lock?: "share" | "update"
): Promise<EInvoiceLegalEntity | undefined> {
  const query = conn
    .select()
    .from(einvoiceLegalEntities)
    .where(
      and(
        eq(einvoiceLegalEntities.companyId, companyId),
        eq(einvoiceLegalEntities.provider, provider),
        eq(einvoiceLegalEntities.environment, environment)
      )
    )
    .limit(1);
  const rows = await (lock ? query.for(lock) : query);
  return rows[0];
}

/** Fields from a provider's legal-entity resource or synchronized event (A-Cube's shape). */
export function legalEntityPatchFrom(
  le: LegalEntityFields & { action?: string | null },
  now: Date = new Date()
): Partial<typeof einvoiceLegalEntities.$inferInsert> {
  const status = le.status !== undefined ? normaliseLegalEntityStatus(le.status) : undefined;
  const date = (v: string | null | undefined) => (v ? new Date(v) : v === null ? null : undefined);
  const patch: Partial<typeof einvoiceLegalEntities.$inferInsert> = {
    updatedAt: now,
    lastSyncAt: now,
  };
  if (le.legalEntityId) patch.legalEntityId = le.legalEntityId;
  if (status) patch.status = status;
  if (le.nameEn !== undefined) patch.nameEn = le.nameEn ?? null;
  if (le.nameAr !== undefined) patch.nameAr = le.nameAr ?? null;
  if (le.vatTrn !== undefined) patch.vatTrn = le.vatTrn ?? null;
  if (le.enabledCapabilities !== undefined) {
    patch.capabilities = (le.enabledCapabilities ?? []).map((c) => c.key);
  }
  if (le.tin && status === "active") patch.peppolAddress = peppolAddressFor(le.tin);
  if (status === "inactive") patch.peppolAddress = null;
  const smp = date(le.smpSyncAt);
  if (smp !== undefined) patch.smpSyncAt = smp;
  const reg = date(le.registrySyncAt);
  if (reg !== undefined) patch.registrySyncAt = reg;
  const exp = date(le.reservationExpiresAt);
  if (exp !== undefined) patch.reservationExpiresAt = exp;
  if (le.action) patch.lastAction = le.action;
  return patch;
}

/** E1 name, kept for the A-Cube routes. */
export const patchFromAcube = legalEntityPatchFrom;

export async function upsertLegalEntity(
  companyId: string,
  provider: string,
  environment: string,
  tin: string,
  patch: Partial<typeof einvoiceLegalEntities.$inferInsert>,
  conn: Pick<AppDatabase, "insert"> = db
): Promise<EInvoiceLegalEntity> {
  const now = new Date();
  const [row] = await conn
    .insert(einvoiceLegalEntities)
    .values({ companyId, provider, environment, tin, ...patch, updatedAt: now })
    .onConflictDoUpdate({
      target: [
        einvoiceLegalEntities.companyId,
        einvoiceLegalEntities.provider,
        einvoiceLegalEntities.environment,
      ],
      set: { tin, ...patch, updatedAt: now },
    })
    .returning();
  return row;
}

export async function updateLegalEntityRow(
  id: string,
  patch: Partial<typeof einvoiceLegalEntities.$inferInsert>
): Promise<EInvoiceLegalEntity> {
  const [row] = await db
    .update(einvoiceLegalEntities)
    .set(patch)
    .where(eq(einvoiceLegalEntities.id, id))
    .returning();
  return row;
}

/** Store a webhook's verified response only for the local identity that was re-read. */
export async function updateLegalEntityRowIfCurrent(
  entity: EInvoiceLegalEntity,
  patch: Partial<typeof einvoiceLegalEntities.$inferInsert>,
  conn: Pick<AppDatabase, "update"> = db
): Promise<boolean> {
  const [updated] = await conn
    .update(einvoiceLegalEntities)
    .set(patch)
    .where(
      and(
        eq(einvoiceLegalEntities.id, entity.id),
        eq(einvoiceLegalEntities.companyId, entity.companyId),
        eq(einvoiceLegalEntities.provider, entity.provider),
        eq(einvoiceLegalEntities.environment, entity.environment),
        eq(einvoiceLegalEntities.tin, entity.tin),
        entity.legalEntityId === null
          ? isNull(einvoiceLegalEntities.legalEntityId)
          : eq(einvoiceLegalEntities.legalEntityId, entity.legalEntityId),
        eq(einvoiceLegalEntities.status, entity.status),
        sql`date_trunc('milliseconds', ${einvoiceLegalEntities.updatedAt}) =
            ${entity.updatedAt.toISOString()}::timestamp`
      )
    )
    .returning({ id: einvoiceLegalEntities.id });
  return Boolean(updated);
}

export interface CompanyTinSource extends TinSource {
  peppolParticipantId?: string | null;
  peppolScheme?: string | null;
}

/** Prefer the statutory identity. Legacy 0235 endpoints can supply a missing TIN. */
export function companyTin(company: CompanyTinSource): string | null {
  const statutory = effectiveTin(company);
  if (statutory) return statutory;
  const scheme = company.peppolScheme?.trim() || PEPPOL_SCHEME_UAE_TIN;
  const endpoint = company.peppolParticipantId?.trim();
  return scheme === PEPPOL_SCHEME_UAE_TIN && isUaeTin(endpoint) ? endpoint! : null;
}

/** Signed XML uses the same statutory company identity as the provider onboarding workflow. */
export function matchesCompanyTaxpayer(company: CompanyTinSource, buyer: InboundTaxpayer): boolean {
  const tin = companyTin(company);
  return tin !== null && !companyTinConflict(tin, company) && matchesTaxpayerTin(tin, buyer);
}

function companyTinConflict(tin: string, company: CompanyTinSource): boolean {
  const scheme = company.peppolScheme?.trim() || PEPPOL_SCHEME_UAE_TIN;
  const endpoint = company.peppolParticipantId?.trim();
  return Boolean(
    tinProblem(tin, company) ||
    (company.einvoiceTin && company.einvoiceTin !== tin) ||
    (scheme === PEPPOL_SCHEME_UAE_TIN && endpoint && endpoint !== tin)
  );
}

/** Resolve the taxpayer to register and send as, refusing conflicting company identity fields. */
export function requireCompanyTin(company: CompanyTinSource): string {
  const tin = companyTin(company);
  if (!tin) {
    throw new DomainError(
      "EINVOICE_TIN_MISSING",
      422,
      { field: "company.trnVatNumber" },
      "Enter the company's 10-digit TIN or 15-digit TRN before connecting."
    );
  }
  if (companyTinConflict(tin, company)) {
    throw new DomainError(
      "EINVOICE_SUPPLIER_ENDPOINT_MISMATCH",
      422,
      undefined,
      "The company's tax registration and e-invoicing address must use the same TIN."
    );
  }
  return tin;
}

export function matchesOnboardingCompany(
  company: (CompanyTinSource & { einvoicePartner: string | null }) | undefined,
  provider: string,
  tin: string
): boolean {
  return (
    !!company &&
    company.einvoicePartner === provider &&
    companyTin(company) === tin &&
    !companyTinConflict(tin, company)
  );
}

/** Settings project only the entity for the currently selected taxpayer and environment. */
export function currentOnboardingEntity(
  company: CompanyTinSource & { id: string; einvoicePartner: string | null },
  entity: EInvoiceLegalEntity | undefined,
  provider: string,
  environment: string
): EInvoiceLegalEntity | undefined {
  return entity &&
    entity.companyId === company.id &&
    entity.provider === provider &&
    entity.environment === environment &&
    (entity.status !== "active" || !!entity.legalEntityId?.trim()) &&
    matchesOnboardingCompany(company, provider, entity.tin) &&
    (!company.peppolScheme?.trim() || company.peppolScheme.trim() === PEPPOL_SCHEME_UAE_TIN) &&
    (entity.peppolAddress === null ||
      entity.peppolAddress === entity.tin ||
      entity.peppolAddress === peppolAddressFor(entity.tin))
    ? entity
    : undefined;
}

/** Clear identity-specific state before onboarding a different taxpayer in the same local slot. */
export const newOnboardingEntity: Partial<typeof einvoiceLegalEntities.$inferInsert> = {
  legalEntityId: null,
  status: "reserved",
  nameEn: null,
  nameAr: null,
  vatTrn: null,
  peppolAddress: null,
  capabilities: null,
  smpSyncAt: null,
  registrySyncAt: null,
  activatedAt: null,
  lastSyncAt: null,
  reservationExpiresAt: null,
};

/** Serialize onboarding state writes with company identity and provider selection changes. */
export async function lockOnboardingCompany(companyId: string, conn: Pick<AppDatabase, "select">) {
  const [company] = await conn
    .select()
    .from(companies)
    .where(eq(companies.id, companyId))
    .for("update");
  return company;
}

/** Require identity evidence from the provider before saving a reservation or connection. */
export function assertProviderTin(expected: string, actual: string | null | undefined): void {
  if (actual !== expected) {
    throw new DomainError(
      "EINVOICE_PROVIDER_TIN_MISMATCH",
      502,
      undefined,
      "The e-invoicing provider did not confirm this company's TIN."
    );
  }
}

/**
 * Sending gate: an accredited ASP only transmits for an active legal entity. Reserved / pending
 * means the EmaraTax (or provider readiness) step is not done; inactive means the taxpayer delinked
 * the provider. `providerName` is the provider's display name for the message.
 */
export function assertLegalEntityCanSend(
  le: EInvoiceLegalEntity | undefined,
  providerName = "the e-invoicing provider"
): void {
  if (le?.status === "active") return;
  if (le?.status === "inactive") {
    throw new DomainError(
      "EINVOICE_LEGAL_ENTITY_DELINKED",
      409,
      { legalEntityStatus: "inactive" },
      `${providerName} is no longer linked to this company in EmaraTax. Link it again before sending.`
    );
  }
  throw new DomainError(
    "EINVOICE_LEGAL_ENTITY_NOT_ACTIVE",
    409,
    { legalEntityStatus: le?.status ?? "not_connected" },
    `Connect this company to ${providerName} in EmaraTax before sending e-invoices.`
  );
}
