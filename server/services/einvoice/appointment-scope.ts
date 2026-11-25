import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { auditLogs, companies, einvoiceApproverLinks, type Company } from "../../../shared/schema";
import { db, type AppDatabase } from "../../db";
import { DomainError } from "../../errors";
import { companyTin, lockOnboardingCompany, matchesCompanyTin } from "./legal-entities";
import { PEPPOL_SCHEME_UAE_TIN } from "./pint-ae-codes";

const SCOPE_ACTION = "company.einvoicing_appointment_scope";
const scopeFields = [
  "einvoicePartner",
  "einvoiceTin",
  "corporateTaxId",
  "trnVatNumber",
  "peppolScheme",
  "peppolParticipantId",
] as const;

function registration(value: string | null): string | null {
  return value?.replace(/[\s-]/g, "") || null;
}

/** An appointment belongs to a provider and statutory taxpayer, including the full VAT TRN. */
export function appointmentScope(company: Company): string | null {
  const tin = companyTin(company);
  if (!company.einvoicePartner || !tin || !matchesCompanyTin(company, tin)) return null;
  const scheme = company.peppolScheme?.trim() || PEPPOL_SCHEME_UAE_TIN;
  const endpoint =
    company.peppolParticipantId?.trim() || (scheme === PEPPOL_SCHEME_UAE_TIN ? tin : null);
  return createHash("sha256")
    .update(
      JSON.stringify([
        company.id,
        company.einvoicePartner,
        tin,
        registration(company.corporateTaxId),
        registration(company.trnVatNumber),
        scheme,
        endpoint,
      ])
    )
    .digest("hex");
}

type ApprovalDb = Pick<AppDatabase, "select" | "insert" | "update">;

/** Store scope evidence in the existing company audit chain in the same transaction. */
export async function recordAppointmentScope(
  tx: Pick<ApprovalDb, "insert">,
  input: { companyId: string; userId: string; scope: string; linkId?: string; at: Date }
) {
  await tx.insert(auditLogs).values({
    action: SCOPE_ACTION,
    companyId: input.companyId,
    userId: input.userId,
    resourceId: input.linkId ?? input.companyId,
    resourceType: input.linkId ? "einvoice_approver_link" : "company",
    details: JSON.stringify({ scope: input.scope, at: input.at.toISOString() }),
  });
}

export async function appointmentEvidence(
  companyIds: string[],
  conn: Pick<ApprovalDb, "select"> = db,
  linkId?: string
) {
  const rows = await conn
    .select({
      companyId: auditLogs.companyId,
      resourceId: auditLogs.resourceId,
      resourceType: auditLogs.resourceType,
      details: auditLogs.details,
    })
    .from(auditLogs)
    .where(
      and(
        inArray(auditLogs.companyId, companyIds),
        eq(auditLogs.action, SCOPE_ACTION),
        linkId ? eq(auditLogs.resourceId, linkId) : undefined
      )
    );
  const approvals = new Set<string>();
  for (const row of rows) {
    if (!row.companyId || !row.resourceId || !row.details) continue;
    try {
      const { scope, at } = JSON.parse(row.details);
      if (typeof scope !== "string" || typeof at !== "string") continue;
      approvals.add(
        JSON.stringify([
          row.companyId,
          row.resourceId,
          scope,
          row.resourceType === "company" ? at : null,
        ])
      );
    } catch {
      // Historical audit rows without readable evidence cannot establish authority.
    }
  }
  return approvals;
}

export function hasAppointmentEvidence(
  company: Company,
  approvals: Set<string>,
  linkId?: string
): boolean {
  if (!linkId && !company.einvoiceAppointmentConfirmedAt) return false;
  const scope = appointmentScope(company);
  const confirmationTime = linkId ? null : company.einvoiceAppointmentConfirmedAt?.toISOString();
  return Boolean(
    scope &&
    approvals.has(JSON.stringify([company.id, linkId ?? company.id, scope, confirmationTime]))
  );
}

type CompanyPatch = Partial<typeof companies.$inferInsert>;

/** Apply a taxpayer edit while holding the same company lock as approvals and onboarding. */
export async function applyCompanyApprovalScopeUpdate(
  company: Company,
  patch: CompanyPatch,
  tx: Pick<ApprovalDb, "update">
): Promise<Company> {
  const next = { ...company, ...patch };
  const scopeChanged =
    next.einvoicePartner !== company.einvoicePartner ||
    appointmentScope(next) !== appointmentScope(company);
  if (scopeChanged) {
    patch = {
      ...patch,
      einvoiceAppointmentConfirmedAt: null,
      einvoiceAppointmentConfirmedBy: null,
    };
    await tx
      .update(einvoiceApproverLinks)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(einvoiceApproverLinks.companyId, company.id),
          isNull(einvoiceApproverLinks.revokedAt)
        )
      );
  }
  const [updated] = await tx
    .update(companies)
    .set(patch)
    .where(eq(companies.id, company.id))
    .returning();
  return updated;
}

/** Covers profile and provider settings edits as well as the dedicated tax identity route. */
export async function updateCompanyWithApprovalScope(
  companyId: string,
  patch: CompanyPatch
): Promise<Company> {
  if (scopeFields.some((field) => patch[field] !== undefined)) {
    return db.transaction(async (tx) => {
      const current = await lockOnboardingCompany(companyId, tx);
      if (!current || current.deletedAt) throw new DomainError("COMPANY_NOT_FOUND", 404);
      return applyCompanyApprovalScopeUpdate(current, patch, tx);
    });
  }
  const [updated] = await db
    .update(companies)
    .set(patch)
    .where(eq(companies.id, companyId))
    .returning();
  return updated;
}
