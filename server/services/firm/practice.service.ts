/**
 * Request lists (documents requested from a client) and per-client FTA filing
 * packs with manual filing records (W5-D, R15-11 / R15-14).
 *
 * FTA: there is no EmaraTax filing API. A filing pack gathers the exports the
 * app already produces (VAT 201 return export, corporate tax return export,
 * trial balance), a checklist, and the TRN *format* check with a link to the
 * FTA website for the manual lookup. Staff file on EmaraTax themselves and
 * record "filed on" + the FTA reference number here. Nothing in this module
 * submits anything to the FTA.
 */
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "../../db";
import { DomainError } from "../../errors";
import {
  companies,
  companyUsers,
  corporateTaxReturns,
  documents,
  firmDocumentRequests,
  firmFilingRecords,
  firms,
  vatReturns,
} from "../../../shared/schema";
import { FTA_TRN_LOOKUP_URL } from "../firm-clients.service";
import { accessibleClientsQuery, type FirmContext } from "./scope";

// ─── Request lists ───────────────────────────────────────────────────────────

export async function createRequests(
  ctx: FirmContext,
  companyId: string,
  input: {
    listName?: string;
    items: Array<{ title: string; description?: string; dueDate?: string }>;
  }
) {
  const rows = await db
    .insert(firmDocumentRequests)
    .values(
      input.items.map((i) => ({
        firmId: ctx.firmId,
        companyId,
        listName: input.listName ?? "General",
        title: i.title,
        description: i.description ?? null,
        dueDate: i.dueDate ?? null,
        status: "requested",
        requestedBy: ctx.userId,
      }))
    )
    .returning();
  return rows;
}

export async function listRequestsForFirm(ctx: FirmContext, companyId: string) {
  return db
    .select()
    .from(firmDocumentRequests)
    .where(
      and(
        eq(firmDocumentRequests.firmId, ctx.firmId),
        eq(firmDocumentRequests.companyId, companyId)
      )
    )
    .orderBy(desc(firmDocumentRequests.createdAt));
}

export async function reviewRequest(
  ctx: FirmContext,
  requestId: string,
  input: { decision: "accept" | "reject" | "cancel"; note?: string }
) {
  const scope = and(
    eq(firmDocumentRequests.id, requestId),
    eq(firmDocumentRequests.firmId, ctx.firmId),
    inArray(firmDocumentRequests.companyId, accessibleClientsQuery(ctx))
  );
  const [row] = await db.select().from(firmDocumentRequests).where(scope).limit(1);
  if (!row) throw new DomainError("REQUEST_NOT_FOUND", 404);
  let status: string;
  if (input.decision === "cancel") {
    if (row.status === "accepted") throw new DomainError("REQUEST_ALREADY_ACCEPTED", 409);
    status = "cancelled";
  } else {
    if (row.status !== "uploaded") throw new DomainError("REQUEST_NOT_UPLOADED", 409);
    status = input.decision === "accept" ? "accepted" : "rejected";
  }
  const [updated] = await db
    .update(firmDocumentRequests)
    .set({
      status,
      reviewedBy: ctx.userId,
      reviewedAt: new Date(),
      reviewNote: input.note ?? null,
      updatedAt: new Date(),
    })
    .where(and(scope, eq(firmDocumentRequests.status, row.status)))
    .returning();
  if (!updated) throw new DomainError("REQUEST_STATE_CHANGED", 409);
  return updated;
}

async function assertMember(userId: string, companyId: string) {
  const [m] = await db
    .select({ id: companyUsers.id })
    .from(companyUsers)
    .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId)))
    .limit(1);
  if (!m) throw new DomainError("COMPANY_ACCESS_DENIED", 403);
}

/** What the client sees: open and decided requests from its firm. */
export async function listRequestsForClient(userId: string, companyId: string) {
  await assertMember(userId, companyId);
  return db
    .select({
      id: firmDocumentRequests.id,
      firmName: firms.name,
      listName: firmDocumentRequests.listName,
      title: firmDocumentRequests.title,
      description: firmDocumentRequests.description,
      dueDate: firmDocumentRequests.dueDate,
      status: firmDocumentRequests.status,
      reviewNote: firmDocumentRequests.reviewNote,
      uploadedAt: firmDocumentRequests.uploadedAt,
    })
    .from(firmDocumentRequests)
    .innerJoin(firms, eq(firms.id, firmDocumentRequests.firmId))
    .where(eq(firmDocumentRequests.companyId, companyId))
    .orderBy(desc(firmDocumentRequests.createdAt));
}

/** Client attaches an uploaded document (documents row of the same company). */
export async function fulfilRequest(
  userId: string,
  companyId: string,
  requestId: string,
  documentId: string
) {
  await assertMember(userId, companyId);
  const [req] = await db
    .select()
    .from(firmDocumentRequests)
    .where(
      and(eq(firmDocumentRequests.id, requestId), eq(firmDocumentRequests.companyId, companyId))
    )
    .limit(1);
  if (!req) throw new DomainError("REQUEST_NOT_FOUND", 404);
  if (req.status !== "requested" && req.status !== "rejected") {
    throw new DomainError("REQUEST_NOT_OPEN", 409);
  }
  const [doc] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.companyId, companyId)))
    .limit(1);
  if (!doc) throw new DomainError("DOCUMENT_NOT_FOUND", 404);
  const [updated] = await db
    .update(firmDocumentRequests)
    .set({
      status: "uploaded",
      documentId,
      uploadedBy: userId,
      uploadedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(firmDocumentRequests.id, requestId))
    .returning();
  return updated;
}

// ─── FTA filing packs ────────────────────────────────────────────────────────

export const FILING_TYPES = ["vat201", "ct", "faf"] as const;
export type FilingType = (typeof FILING_TYPES)[number];

export const FTA_SUBMISSION_NOTE = {
  en: "Muhasib.ai does not submit to the FTA. There is no EmaraTax filing API: file on the EmaraTax portal yourself, then record the filing date and FTA reference number here.",
  ar: "لا يقدّم Muhasib.ai أي إقرار إلى الهيئة الاتحادية للضرائب. لا توجد واجهة برمجية للتقديم عبر EmaraTax: قدّم الإقرار بنفسك عبر بوابة EmaraTax ثم سجّل تاريخ التقديم والرقم المرجعي هنا.",
};

export const TRN_VERIFICATION_NOTE = {
  en: "TRN check is format-only (15 digits). Confirm the TRN on the FTA website.",
  ar: "التحقق من رقم التسجيل الضريبي شكلي فقط (15 رقمًا). تأكد من الرقم عبر موقع الهيئة الاتحادية للضرائب.",
};

function day(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return (typeof d === "string" ? new Date(d) : d).toISOString().slice(0, 10);
}

export async function buildFilingPack(
  ctx: FirmContext,
  companyId: string,
  input: { filingType: FilingType; periodStart: string; periodEnd: string }
) {
  const [company] = await db
    .select({
      id: companies.id,
      name: companies.name,
      trn: companies.trnVatNumber,
      corporateTaxId: companies.corporateTaxId,
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (!company) throw new DomainError("CLIENT_NOT_FOUND", 404);
  const start = new Date(`${input.periodStart}T00:00:00Z`);
  const end = new Date(`${input.periodEnd}T23:59:59Z`);
  const exports: Array<{
    key: string;
    label: string;
    method: "GET" | "POST";
    href: string | null;
    available: boolean;
    note?: string;
  }> = [];
  const checklist: Array<{ key: string; label: string; done: boolean }> = [];

  if (input.filingType === "vat201") {
    const [ret] = await db
      .select({ id: vatReturns.id, status: vatReturns.status })
      .from(vatReturns)
      .where(
        and(
          eq(vatReturns.companyId, companyId),
          gte(vatReturns.periodStart, start),
          lte(vatReturns.periodEnd, end)
        )
      )
      .orderBy(desc(vatReturns.periodEnd))
      .limit(1);
    exports.push({
      key: "vat201_export",
      label: "VAT 201 return export",
      method: "GET",
      href: ret ? `/api/vat-returns/${ret.id}/export` : null,
      available: !!ret,
      note: ret ? undefined : "Generate the VAT return for this period first",
    });
    checklist.push(
      { key: "return_generated", label: "VAT return generated for the period", done: !!ret },
      {
        key: "return_ready",
        label: "Return reviewed and marked ready",
        done: !!ret && ["ready", "submitted", "filed"].includes(ret.status),
      }
    );
  } else if (input.filingType === "ct") {
    const [ret] = await db
      .select({ id: corporateTaxReturns.id, status: corporateTaxReturns.status })
      .from(corporateTaxReturns)
      .where(
        and(
          eq(corporateTaxReturns.companyId, companyId),
          gte(corporateTaxReturns.taxPeriodStart, start),
          lte(corporateTaxReturns.taxPeriodEnd, end)
        )
      )
      .limit(1);
    exports.push({
      key: "ct_export",
      label: "Corporate tax return export",
      method: "GET",
      href: ret ? `/api/corporate-tax/returns/${ret.id}/export` : null,
      available: !!ret,
      note: ret ? undefined : "Prepare the corporate tax return for this period first",
    });
    checklist.push({ key: "return_prepared", label: "Corporate tax return prepared", done: !!ret });
  } else {
    exports.push({
      key: "faf_export",
      label: "FTA Audit File (FAF)",
      method: "GET",
      href: null,
      available: false,
      note: "FAF export is not built yet; use the general ledger and trial balance exports",
    });
  }
  exports.push(
    {
      key: "trial_balance",
      label: "Trial balance",
      method: "GET",
      href: `/api/companies/${companyId}/reports/trial-balance?startDate=${input.periodStart}&endDate=${input.periodEnd}`,
      available: true,
    },
    {
      key: "general_ledger",
      label: "General ledger export",
      method: "GET",
      href: `/api/companies/${companyId}/reports/general-ledger/export?startDate=${input.periodStart}&endDate=${input.periodEnd}`,
      available: true,
    }
  );
  const trnValid = !!company.trn && /^\d{15}$/.test(company.trn);
  checklist.unshift({ key: "trn_format", label: "TRN on file is 15 digits", done: trnValid });
  checklist.push({ key: "filed_on_portal", label: "Filed on the EmaraTax portal", done: false });

  const [record] = await db
    .select()
    .from(firmFilingRecords)
    .where(
      and(
        eq(firmFilingRecords.companyId, companyId),
        eq(firmFilingRecords.filingType, input.filingType),
        eq(firmFilingRecords.periodStart, input.periodStart),
        eq(firmFilingRecords.periodEnd, input.periodEnd)
      )
    )
    .limit(1);
  if (record) checklist[checklist.length - 1].done = true;

  return {
    company: { id: company.id, name: company.name },
    filingType: input.filingType,
    period: { start: input.periodStart, end: input.periodEnd },
    submission: {
      mode: "manual" as const,
      ftaApi: "not_available" as const,
      note: FTA_SUBMISSION_NOTE,
    },
    trn: {
      value: company.trn,
      formatValid: trnValid,
      verification: "format_only" as const,
      lookupUrl: FTA_TRN_LOOKUP_URL,
      note: TRN_VERIFICATION_NOTE,
    },
    exports,
    checklist,
    filed: record
      ? {
          filedOn: record.filedOn,
          referenceNumber: record.referenceNumber,
          recordedAt: day(record.createdAt),
        }
      : null,
  };
}

export async function recordFiling(
  ctx: FirmContext,
  companyId: string,
  input: {
    filingType: FilingType;
    periodStart: string;
    periodEnd: string;
    filedOn: string;
    referenceNumber: string;
    checklist?: Record<string, boolean>;
    notes?: string;
  }
) {
  if (input.periodEnd < input.periodStart) throw new DomainError("INVALID_PERIOD", 400);
  const today = new Date().toISOString().slice(0, 10);
  if (input.filedOn > today) throw new DomainError("FILED_ON_IN_FUTURE", 400);
  const [row] = await db
    .insert(firmFilingRecords)
    .values({
      firmId: ctx.firmId,
      companyId,
      filingType: input.filingType,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      filedOn: input.filedOn,
      referenceNumber: input.referenceNumber,
      checklist: input.checklist ?? {},
      notes: input.notes ?? null,
      recordedBy: ctx.userId,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new DomainError("FILING_ALREADY_RECORDED", 409);
  return row;
}

export async function listFilings(ctx: FirmContext, companyId: string) {
  return db
    .select()
    .from(firmFilingRecords)
    .where(
      and(eq(firmFilingRecords.companyId, companyId), eq(firmFilingRecords.firmId, ctx.firmId))
    )
    .orderBy(desc(firmFilingRecords.periodEnd));
}
