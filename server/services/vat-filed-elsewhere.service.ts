// "Filed outside Muhasib": record a historical VAT period as filed elsewhere (EmaraTax, another system, a previous accountant).
// It posts NOTHING: the period was settled outside this system, so the return carries zero figures, a legacy-style filing record
// (snapshot.legacy and snapshot.filedElsewhere, no clearing journal, net 0) and the stated filing date and reference. Autopilot and the
// VAT Filing page then show the period as filed instead of overdue.

import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { AppError } from "../errors";
import { taxFilings, vatReturns, type VatReturn } from "../../shared/schema";
import { recordAudit } from "./audit.service";
import { assertFilingPermission, type FilingActor } from "./tax-filing.service";
import { LEGACY_REFERENCE_PLACEHOLDER } from "./vat-legacy-filings.service";
import { buildVatSnapshot, snapshotHash } from "./tax-filing-core";
import { isLastMonthOfVatPeriod, normaliseVatFrequency } from "./month-end-checklist-rules";
import { vatPeriodEndOf } from "./month-end.service";
import { uaeTodayYmd } from "./vat-period-status.service";
import { invalidateVatDueNext } from "../reports/kpis";
import type { Request } from "express";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isRealDay = (v: unknown): v is string => typeof v === "string" && YMD.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

export interface FiledElsewhereResult {
  id: string;
  status: "filed_elsewhere";
  periodStart: string;
  periodEnd: string;
  filingDate: string;
  reference: string | null;
}

const addDays = (ymd: string, days: number): string => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

export async function recordFiledElsewhere(args: {
  user: FilingActor;
  companyId: string;
  periodStart: unknown;
  periodEnd: unknown;
  filingDate: unknown;
  reference?: unknown;
  req?: Request;
}): Promise<FiledElsewhereResult> {
  const { user, companyId } = args;
  await assertFilingPermission(user, companyId, "write");

  if (!isRealDay(args.periodStart) || !isRealDay(args.periodEnd)) {
    throw new AppError({ message: "periodStart and periodEnd must be calendar days (YYYY-MM-DD).", statusCode: 422, code: "INVALID_PERIOD" });
  }
  const periodStart = args.periodStart;
  const periodEnd = args.periodEnd;

  // The period must be one of the company's VAT periods (its frequency and stagger), not an arbitrary range.
  const company = (await db.execute(sql`SELECT vat_filing_frequency, vat_period_start_month FROM companies WHERE id = ${companyId}`)) as any;
  const row = (company.rows ?? company)[0];
  if (!row) throw new AppError({ message: "Company not found", statusCode: 404, code: "COMPANY_NOT_FOUND" });
  const frequency = normaliseVatFrequency(row.vat_filing_frequency);
  const startMonth = Number(row.vat_period_start_month ?? 1);
  const month = Number(periodStart.slice(5, 7));
  const length = frequency === "monthly" ? 1 : frequency === "annually" ? 12 : 3;
  const offset = (((month - Math.min(12, Math.max(1, Math.trunc(startMonth) || 1))) % 12) + 12) % 12;
  const onGrid = periodStart.slice(8, 10) === "01" && offset % length === 0 && vatPeriodEndOf(periodStart, frequency, startMonth) === periodEnd && isLastMonthOfVatPeriod(frequency, startMonth, Number(periodEnd.slice(5, 7)));
  if (!onGrid) {
    throw new AppError({ message: `This is not one of the company's VAT periods (${frequency}, periods start in month ${startMonth}).`, statusCode: 422, code: "INVALID_PERIOD" });
  }
  const today = uaeTodayYmd();
  if (periodEnd >= today) {
    throw new AppError({ message: "The VAT period has not ended yet, so it cannot be recorded as filed.", statusCode: 422, code: "PERIOD_NOT_ENDED" });
  }
  if (!isRealDay(args.filingDate) || args.filingDate < periodEnd || args.filingDate > today) {
    throw new AppError({ message: "The filing date must be a real day after the period ended and not in the future.", statusCode: 422, code: "INVALID_FILING_DATE" });
  }
  const filingDate = args.filingDate;
  const reference = typeof args.reference === "string" && args.reference.trim() ? args.reference.trim().slice(0, 120) : null;

  const existing = (await db
    .select()
    .from(vatReturns)
    .where(and(eq(vatReturns.companyId, companyId), eq(vatReturns.isAmendment, false)))) as VatReturn[];
  // JS Date columns come back as instants: compare by the UTC day, which is how the period is stored.
  const dayOf = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
  const matching = existing.filter((r) => dayOf(r.periodStart) === periodStart && dayOf(r.periodEnd) === periodEnd);
  if (matching.some((r) => ["filed", "submitted", "accepted"].includes(r.status))) {
    throw new AppError({ message: "This VAT period is already recorded as filed.", statusCode: 409, code: "PERIOD_ALREADY_FILED" });
  }

  const submittedAt = new Date(`${filingDate}T00:00:00Z`);
  const result = await db.transaction(async (tx: any) => {
    // an unfiled draft of the period is turned into the filed record; otherwise a zero-figure return is created
    const draft = matching.find((r) => r.status === "draft");
    let ret: VatReturn;
    if (draft) {
      [ret] = (await tx
        .update(vatReturns)
        .set({ status: "filed", ftaReferenceNumber: reference, submittedAt, submittedBy: user.id, notes: "Filed outside Muhasib", updatedAt: new Date() })
        .where(eq(vatReturns.id, draft.id))
        .returning()) as VatReturn[];
    } else {
      [ret] = (await tx
        .insert(vatReturns)
        .values({
          companyId,
          periodStart: new Date(`${periodStart}T00:00:00Z`),
          periodEnd: new Date(`${periodEnd}T23:59:59.999Z`),
          dueDate: new Date(`${addDays(periodEnd, 28)}T00:00:00Z`),
          status: "filed",
          ftaReferenceNumber: reference,
          submittedAt,
          submittedBy: user.id,
          createdBy: user.id,
          notes: "Filed outside Muhasib",
        } as any)
        .returning()) as VatReturn[];
    }
    const snapshot = { ...buildVatSnapshot(ret as unknown as Record<string, unknown>), legacy: true, filedElsewhere: true };
    await tx
      .insert(taxFilings)
      .values({
        companyId,
        kind: "vat",
        returnId: ret.id,
        referenceNumber: reference ?? LEGACY_REFERENCE_PLACEHOLDER,
        filedAt: filingDate,
        notes: "Filed outside Muhasib: recorded for the record, nothing was posted.",
        snapshot,
        snapshotHash: snapshotHash(snapshot),
        baseFilingId: null,
        settlementOutput: 0,
        settlementInput: 0,
        settlementNet: 0,
        clearingEntryId: null,
        filedBy: user.id,
      })
      .onConflictDoNothing();
    // Autopilot's period row: shown as accepted, never overdue
    await tx.execute(sql`
      INSERT INTO vat_return_periods (company_id, period_start, period_end, due_date, frequency, status, vat_return_id, submitted_at, submitted_by, fta_reference_number, notes)
      VALUES (${companyId}, ${`${periodStart}T00:00:00.000`}::timestamp, ${`${periodEnd}T23:59:59.999`}::timestamp, ${`${addDays(periodEnd, 28)}T00:00:00.000`}::timestamp, ${frequency}, 'accepted', ${ret.id}, ${submittedAt}, ${user.id}, ${reference}, 'Filed outside Muhasib')
      ON CONFLICT (company_id, period_start, period_end)
      DO UPDATE SET status = 'accepted', vat_return_id = EXCLUDED.vat_return_id, submitted_at = EXCLUDED.submitted_at, submitted_by = EXCLUDED.submitted_by,
                    fta_reference_number = EXCLUDED.fta_reference_number, notes = EXCLUDED.notes, updated_at = now()`);
    return ret;
  });

  await recordAudit({
    userId: user.id,
    companyId,
    action: "vat_return.filed_elsewhere",
    entityType: "vat_return",
    entityId: result.id,
    before: null,
    after: { periodStart, periodEnd, filingDate, reference },
    req: args.req,
  });
  invalidateVatDueNext(companyId);
  return { id: result.id, status: "filed_elsewhere", periodStart, periodEnd, filingDate, reference };
}
