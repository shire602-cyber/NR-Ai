/**
 * Per-company onboarding at Complyance (E2).
 *
 * Complyance cannot register a UAE taxpayer the taxpayer has not authorised (FTA rule), and unlike
 * A-Cube there is nothing to reserve first. The documented flow (docs.complyance.io
 * /partner-platform/isv/companies/prerequisites/, /api-reference/connect/companies/):
 *   1. the taxpayer's authorised administrator signs in to EmaraTax (UAE PASS) and authorises
 *      Complyance as its ASP, registered with an administrator email;
 *   2. we register the company through Connect: POST /v3/connect/companies with its 10-digit TIN,
 *      that same email, a branch name, and an invoice source (name + version) of our own;
 *      Complyance verifies the authorisation with EmaraTax (ASP_LINKAGE_NOT_FOUND until step 1 is
 *      done) and returns companyId, sourceId, branchId, peppolParticipantId (0235:TIN);
 *   3. the source must be ready for invoicing (readyForInvoicing, i.e. the Default GETS Mapping
 *      assigned and its test cases passed) before Unify takes invoices.
 *
 * Our row (einvoice_legal_entities, provider "complyance"):
 *   reserved  we hold the request (TIN + administrator email); waiting for the EmaraTax step
 *   pending   registered at Complyance; the source is not ready for invoicing yet
 *   active    ready for invoicing
 *   inactive  the Complyance source/company is inactive (archived): sending is blocked
 */
import type { Company, EInvoiceLegalEntity } from "../../../../shared/schema";
import { DomainError } from "../../../errors";
import { createLogger } from "../../../config/logger";
import { companyTin, getLegalEntity, upsertLegalEntity } from "../legal-entities";
import { db } from "../../../db";
import { einvoiceLegalEntities } from "../../../../shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import {
  COMPLYANCE_PROVIDER_NAME,
  ComplyanceApiError,
  ComplyanceEInvoiceProvider,
  defaultSourceFor,
  patchFromComplyance,
  type ComplyanceCompany,
} from "./complyance";

const log = createLogger("einvoice-complyance-onboarding");

type CompanyRow = Company & { peppolParticipantId?: string | null };

/** Connect error codes that mean "the EmaraTax authorisation is not there (yet)". */
const AWAITING_AUTHORISATION = new Set(["ASP_LINKAGE_NOT_FOUND", "PEPPOL_PARTICIPANT_UNAVAILABLE"]);
/** Outcomes where the company may already exist: look it up instead of creating it again. */
const RECOVER = new Set([
  "CONNECT_COMPANY_ALREADY_EXISTS",
  "ONBOARDING_TIMEOUT",
  "CONNECT_SOURCE_ALREADY_EXISTS",
]);

function details(le: EInvoiceLegalEntity | undefined | null): Record<string, unknown> {
  return ((le?.providerDetails ?? null) as Record<string, unknown> | null) ?? {};
}

/**
 * Register (or re-try registering) the company at Complyance. Safe to repeat: a company that may
 * already exist is looked up by its source name before anything is created again.
 */
export async function connectComplyanceCompany(args: {
  company: CompanyRow;
  provider: ComplyanceEInvoiceProvider;
  adminEmail?: string | null;
  contactName?: string | null;
  branchName?: string | null;
}): Promise<EInvoiceLegalEntity> {
  const { company, provider } = args;
  const tin = companyTin(company);
  if (!tin) {
    throw new DomainError(
      "EINVOICE_TIN_MISSING",
      422,
      { field: "company.trnVatNumber" },
      "Add the company's 15-digit TRN (its first 10 digits are the TIN) before connecting."
    );
  }
  const existing = await getLegalEntity(company.id, COMPLYANCE_PROVIDER_NAME, provider.environment);
  const prev = details(existing);
  const source = {
    name:
      (prev.sourceName as string | undefined) ?? defaultSourceFor(company.id, provider.cfg).name,
    version: (prev.sourceVersion as string | undefined) ?? provider.cfg.sourceVersion,
  };
  const adminEmail = args.adminEmail ?? existing?.approverEmail ?? null;
  if (!adminEmail) {
    throw new DomainError(
      "VALIDATION_ERROR",
      400,
      { fields: { adminEmail: ["Enter the administrator email the EmaraTax authorisation uses"] } },
      "Enter the administrator email the EmaraTax authorisation uses."
    );
  }
  const branchName =
    args.branchName ??
    (prev.branchName as string | undefined) ??
    company.addressCity ??
    "Head office";
  const contactName = args.contactName ?? (prev.contactName as string | undefined) ?? null;

  // Record the request first, so the card shows the EmaraTax step even if Complyance is down.
  let row = await upsertLegalEntity(
    company.id,
    COMPLYANCE_PROVIDER_NAME,
    provider.environment,
    tin,
    {
      status: existing?.status && existing.status !== "reserved" ? existing.status : "reserved",
      approver: "someone_else",
      approverEmail: adminEmail,
      providerDetails: {
        ...prev,
        sourceName: source.name,
        sourceVersion: source.version,
        branchName,
        contactName,
      },
    }
  );

  let created: ComplyanceCompany | null = null;
  try {
    created = row.legalEntityId
      ? await provider.findCompany({ companyId: row.legalEntityId })
      : await provider.createCompany({
          sourceName: source.name,
          sourceVersion: source.version,
          tin,
          contactPersonEmail: adminEmail,
          contactPersonName: contactName,
          branchName,
        });
  } catch (err) {
    if (!(err instanceof ComplyanceApiError)) throw err;
    if (AWAITING_AUTHORISATION.has(err.code)) {
      return upsertLegalEntity(company.id, COMPLYANCE_PROVIDER_NAME, provider.environment, tin, {
        status: "reserved",
        lastError: err.code,
        lastAction: "CONNECT",
        lastSyncAt: new Date(),
      });
    }
    if (RECOVER.has(err.code) || err.status >= 500) {
      created = await provider.findCompany({ sourceName: source.name }).catch(() => null);
      if (!created) {
        log.warn({ code: err.code, companyId: company.id }, "Complyance onboarding not confirmed");
        return upsertLegalEntity(company.id, COMPLYANCE_PROVIDER_NAME, provider.environment, tin, {
          lastError: err.code,
          lastAction: "CONNECT",
          lastSyncAt: new Date(),
        });
      }
    } else {
      throw new DomainError(
        err.code.startsWith("COMPLYANCE_") || err.code.startsWith("CONNECT_")
          ? err.code
          : `COMPLYANCE_${err.code}`,
        err.status >= 500 ? 502 : 422,
        undefined,
        err.message
      );
    }
  }
  if (!created) return row;
  const patch = patchFromComplyance(created, details(row));
  if (patch.status === "active" && row.status !== "active") patch.activatedAt = new Date();
  row = await upsertLegalEntity(company.id, COMPLYANCE_PROVIDER_NAME, provider.environment, tin, {
    ...patch,
    lastAction: row.legalEntityId ? "SYNC" : "CONNECT",
    lastError: null,
  });
  return row;
}

/** Re-read the company's state (or retry registration while the EmaraTax step is pending). */
export async function syncComplyanceCompany(args: {
  company: CompanyRow;
  provider: ComplyanceEInvoiceProvider;
}): Promise<EInvoiceLegalEntity> {
  const le = await getLegalEntity(
    args.company.id,
    COMPLYANCE_PROVIDER_NAME,
    args.provider.environment
  );
  if (!le) {
    throw new DomainError(
      "EINVOICE_LEGAL_ENTITY_NOT_RESERVED",
      409,
      undefined,
      "Connect the company first."
    );
  }
  return connectComplyanceCompany({ company: args.company, provider: args.provider });
}

/** Poll job: retry companies still waiting for EmaraTax or for mapping readiness. */
export async function syncPendingComplyanceCompanies(
  provider: ComplyanceEInvoiceProvider,
  loadCompany: (id: string) => Promise<CompanyRow | undefined>
): Promise<{ checked: number; activated: number }> {
  const rows = await db
    .select()
    .from(einvoiceLegalEntities)
    .where(
      and(
        eq(einvoiceLegalEntities.provider, COMPLYANCE_PROVIDER_NAME),
        eq(einvoiceLegalEntities.environment, provider.environment),
        inArray(einvoiceLegalEntities.status, ["reserved", "pending"])
      )
    )
    .limit(50);
  let activated = 0;
  for (const row of rows) {
    const company = await loadCompany(row.companyId);
    if (!company) continue;
    try {
      const out = await connectComplyanceCompany({ company, provider });
      if (out.status === "active") activated++;
    } catch (err) {
      log.warn({ companyId: row.companyId, err: (err as Error).message }, "Complyance sync failed");
    }
  }
  return { checked: rows.length, activated };
}

type StepState = "done" | "current" | "todo" | "failed";

/** The three steps the settings card shows for Complyance. */
export function complyanceSteps(
  configured: boolean,
  le: EInvoiceLegalEntity | undefined | null
): Array<{ key: "request" | "authorize" | "ready"; state: StepState }> {
  const status = le?.status ?? null;
  return [
    { key: "request", state: le ? "done" : configured ? "current" : "todo" },
    {
      key: "authorize",
      state:
        status === "inactive"
          ? "failed"
          : status === "pending" || status === "active"
            ? "done"
            : status === "reserved"
              ? "current"
              : "todo",
    },
    {
      key: "ready",
      state: status === "active" ? "done" : status === "pending" ? "current" : "todo",
    },
  ];
}

export function complyanceLegalEntityView(le: EInvoiceLegalEntity | undefined | null) {
  if (!le) return null;
  const d = details(le);
  const readiness = (d.mappingReadiness ?? null) as { status?: string; code?: string } | null;
  return {
    status: le.status,
    legalEntityId: le.legalEntityId,
    tin: le.tin,
    nameEn: le.nameEn,
    nameAr: le.nameAr,
    vatTrn: le.vatTrn,
    peppolAddress: le.peppolAddress,
    adminEmail: le.approverEmail,
    sourceName: (d.sourceName as string | undefined) ?? null,
    sourceVersion: (d.sourceVersion as string | undefined) ?? null,
    branchName: (d.branchName as string | undefined) ?? null,
    mappingReadinessCode: readiness?.code ?? null,
    readyForInvoicing: d.readyForInvoicing === true,
    lastAction: le.lastAction,
    lastError: le.lastError,
    lastSyncAt: le.lastSyncAt,
    activatedAt: le.activatedAt,
  };
}
