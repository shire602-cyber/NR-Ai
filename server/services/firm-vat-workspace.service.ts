import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "../db";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { assertPeriodNotLocked } from "./period-lock.service";
import {
  companies,
  vatReturns,
  vatWorkpaperAttachments,
  vatWorkpaperRows,
  vatWorkpapers,
  type VatWorkpaper,
  type VatWorkpaperRow,
} from "../../shared/schema";

export const VAT_WORKPAPER_CATEGORIES = [
  "standard_sale",
  "tourist_refund",
  "reverse_charge_output",
  "zero_rated_sale",
  "exempt_sale",
  "import",
  "import_adjustment",
  "standard_expense",
  "reverse_charge_input",
  "manual_adjustment",
] as const;

export type VatWorkpaperCategory = (typeof VAT_WORKPAPER_CATEGORIES)[number];
export type VatWorkpaperRowStatus = "draft" | "approved" | "excluded";
export type VatWorkpaperSourceMethod = "manual" | "ocr" | "import" | "generated";

type Vat201Totals = Record<string, number>;

export interface VatWorkpaperRowInput {
  rowCategory: VatWorkpaperCategory;
  vat201Box?: string | null;
  invoiceNumber?: string | null;
  documentDate?: Date | string | null;
  counterpartyName?: string | null;
  counterpartyTrn?: string | null;
  emirate?: string | null;
  taxableAmount?: number | string | null;
  vatAmount?: number | string | null;
  adjustmentAmount?: number | string | null;
  grossAmount?: number | string | null;
  status?: VatWorkpaperRowStatus;
  sourceMethod?: VatWorkpaperSourceMethod;
  sourceDocumentType?: string | null;
  sourceDocumentId?: string | null;
  notes?: string | null;
  auditReason?: string | null;
}

export interface VatWorkpaperAttachmentInput {
  fileName: string;
  mimeType: string;
  filePath?: string | null;
  extractedText?: string | null;
  extractionJson?: Record<string, unknown>;
}

const EMIRATE_BOX_PREFIX: Record<string, string> = {
  abu_dhabi: "box1aAbuDhabi",
  dubai: "box1bDubai",
  sharjah: "box1cSharjah",
  ajman: "box1dAjman",
  umm_al_quwain: "box1eUmmAlQuwain",
  ras_al_khaimah: "box1fRasAlKhaimah",
  fujairah: "box1gFujairah",
};

const OUTPUT_AMOUNT_BOXES = [
  "box1aAbuDhabiAmount",
  "box1bDubaiAmount",
  "box1cSharjahAmount",
  "box1dAjmanAmount",
  "box1eUmmAlQuwainAmount",
  "box1fRasAlKhaimahAmount",
  "box1gFujairahAmount",
  "box2TouristRefundAmount",
  "box3ReverseChargeAmount",
  "box4ZeroRatedAmount",
  "box5ExemptAmount",
  "box6ImportsAmount",
  "box7ImportsAdjAmount",
] as const;

const OUTPUT_VAT_BOXES = [
  "box1aAbuDhabiVat",
  "box1bDubaiVat",
  "box1cSharjahVat",
  "box1dAjmanVat",
  "box1eUmmAlQuwainVat",
  "box1fRasAlKhaimahVat",
  "box1gFujairahVat",
  "box2TouristRefundVat",
  "box3ReverseChargeVat",
  "box6ImportsVat",
  "box7ImportsAdjVat",
] as const;

const OUTPUT_ADJ_BOXES = [
  "box1aAbuDhabiAdj",
  "box1bDubaiAdj",
  "box1cSharjahAdj",
  "box1dAjmanAdj",
  "box1eUmmAlQuwainAdj",
  "box1fRasAlKhaimahAdj",
  "box1gFujairahAdj",
] as const;

const INPUT_AMOUNT_BOXES = ["box9ExpensesAmount", "box10ReverseChargeAmount"] as const;
const INPUT_VAT_BOXES = ["box9ExpensesVat", "box10ReverseChargeVat"] as const;
const INPUT_ADJ_BOXES = ["box9ExpensesAdj"] as const;

const ALL_TOTAL_KEYS = [
  ...OUTPUT_AMOUNT_BOXES,
  ...OUTPUT_VAT_BOXES,
  ...OUTPUT_ADJ_BOXES,
  ...INPUT_AMOUNT_BOXES,
  ...INPUT_VAT_BOXES,
  ...INPUT_ADJ_BOXES,
  "box8TotalAmount",
  "box8TotalVat",
  "box8TotalAdj",
  "box11TotalAmount",
  "box11TotalVat",
  "box11TotalAdj",
  "box12TotalDueTax",
  "box13RecoverableTax",
  "box14PayableTax",
] as const;

const DERIVED_TOTAL_KEYS = new Set([
  "box8TotalAmount",
  "box8TotalVat",
  "box8TotalAdj",
  "box11TotalAmount",
  "box11TotalVat",
  "box11TotalAdj",
  "box12TotalDueTax",
  "box13RecoverableTax",
  "box14PayableTax",
]);

export function emptyVat201Totals(): Vat201Totals {
  return Object.fromEntries(ALL_TOTAL_KEYS.map((key) => [key, 0]));
}

function toMoney(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function parseDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function add(totals: Vat201Totals, key: string, value: unknown): void {
  totals[key] = toMoney((totals[key] ?? 0) + toMoney(value));
}

function requireAuditReasonForOverride(input: VatWorkpaperRowInput): void {
  if (input.rowCategory === "manual_adjustment" && !input.auditReason?.trim()) {
    throw new ValidationError("Manual VAT adjustments require an audit reason");
  }
}

function normalizeEmirate(emirate: string | null | undefined): string {
  const normalized = (emirate || "dubai").toLowerCase().replace(/\s+/g, "_");
  return EMIRATE_BOX_PREFIX[normalized] ? normalized : "dubai";
}

export function mapVatWorkpaperRowToBox(input: {
  rowCategory: VatWorkpaperCategory | string;
  emirate?: string | null;
  vat201Box?: string | null;
}): string {
  if (input.rowCategory === "manual_adjustment") {
    if (!input.vat201Box) throw new ValidationError("Manual adjustment rows require a VAT 201 box");
    if (
      !ALL_TOTAL_KEYS.includes(input.vat201Box as any) ||
      DERIVED_TOTAL_KEYS.has(input.vat201Box)
    ) {
      throw new ValidationError("Manual adjustment VAT 201 box is not supported");
    }
    return input.vat201Box;
  }

  switch (input.rowCategory) {
    case "standard_sale":
      return `${EMIRATE_BOX_PREFIX[normalizeEmirate(input.emirate)]}Amount`;
    case "tourist_refund":
      return "box2TouristRefundAmount";
    case "reverse_charge_output":
      return "box3ReverseChargeAmount";
    case "zero_rated_sale":
      return "box4ZeroRatedAmount";
    case "exempt_sale":
      return "box5ExemptAmount";
    case "import":
      return "box6ImportsAmount";
    case "import_adjustment":
      return "box7ImportsAdjAmount";
    case "standard_expense":
      return "box9ExpensesAmount";
    case "reverse_charge_input":
      return "box10ReverseChargeAmount";
    default:
      throw new ValidationError("Unsupported VAT workpaper row category");
  }
}

export function calculateVatWorkpaperTotals(
  rows: Array<
    Pick<
      VatWorkpaperRow,
      | "rowCategory"
      | "vat201Box"
      | "emirate"
      | "taxableAmount"
      | "vatAmount"
      | "adjustmentAmount"
      | "status"
    >
  >
): Vat201Totals {
  const totals = emptyVat201Totals();

  for (const row of rows) {
    if (row.status !== "approved") continue;
    const category = row.rowCategory as VatWorkpaperCategory;
    const taxableAmount = toMoney(row.taxableAmount);
    const vatAmount = toMoney(row.vatAmount);
    const adjustmentAmount = toMoney(row.adjustmentAmount);

    if (category === "manual_adjustment") {
      add(totals, row.vat201Box, adjustmentAmount || vatAmount || taxableAmount);
      continue;
    }

    const amountBox = mapVatWorkpaperRowToBox({
      rowCategory: category,
      emirate: row.emirate,
      vat201Box: row.vat201Box,
    });
    add(totals, amountBox, taxableAmount);

    if (amountBox.endsWith("Amount")) {
      const vatBox = amountBox.replace(/Amount$/, "Vat");
      if (ALL_TOTAL_KEYS.includes(vatBox as any)) add(totals, vatBox, vatAmount);
    }

    if (category === "standard_sale") {
      const adjBox = amountBox.replace(/Amount$/, "Adj");
      add(totals, adjBox, adjustmentAmount);
    } else if (category === "standard_expense") {
      add(totals, "box9ExpensesAdj", adjustmentAmount);
    }
  }

  totals.box8TotalAmount = toMoney(
    OUTPUT_AMOUNT_BOXES.reduce((sum, key) => sum + (totals[key] ?? 0), 0)
  );
  totals.box8TotalVat = toMoney(OUTPUT_VAT_BOXES.reduce((sum, key) => sum + (totals[key] ?? 0), 0));
  totals.box8TotalAdj = toMoney(OUTPUT_ADJ_BOXES.reduce((sum, key) => sum + (totals[key] ?? 0), 0));
  totals.box11TotalAmount = toMoney(
    INPUT_AMOUNT_BOXES.reduce((sum, key) => sum + (totals[key] ?? 0), 0)
  );
  totals.box11TotalVat = toMoney(INPUT_VAT_BOXES.reduce((sum, key) => sum + (totals[key] ?? 0), 0));
  totals.box11TotalAdj = toMoney(INPUT_ADJ_BOXES.reduce((sum, key) => sum + (totals[key] ?? 0), 0));
  totals.box12TotalDueTax = totals.box8TotalVat;
  totals.box13RecoverableTax = totals.box11TotalVat;
  totals.box14PayableTax = toMoney(totals.box12TotalDueTax - totals.box13RecoverableTax);

  return totals;
}

export function defaultVatDueDate(periodEnd: Date | string): Date {
  const dueDate = new Date(periodEnd);
  dueDate.setDate(dueDate.getDate() + 28);
  return dueDate;
}

async function getWorkpaperOrThrow(workpaperId: string): Promise<VatWorkpaper> {
  const [workpaper] = await db
    .select()
    .from(vatWorkpapers)
    .where(eq(vatWorkpapers.id, workpaperId))
    .limit(1);
  if (!workpaper) throw new NotFoundError("VAT workpaper");
  return workpaper;
}

async function assertWorkpaperEditable(workpaper: VatWorkpaper): Promise<void> {
  if (workpaper.status === "locked" || workpaper.status === "filed") {
    throw new ConflictError(
      "VAT workpaper is locked and cannot be changed",
      "VAT_WORKPAPER_LOCKED"
    );
  }
  await assertPeriodNotLocked(workpaper.companyId, workpaper.periodEnd);
}

export async function listVatWorkpapers(companyIds: string[], companyId?: string) {
  if (companyIds.length === 0) return [];
  if (companyId && !companyIds.includes(companyId)) {
    throw new NotFoundError("VAT workpaper");
  }

  const scopedCompanyIds = companyId ? [companyId] : companyIds;
  const rows = await db
    .select({
      id: vatWorkpapers.id,
      companyId: vatWorkpapers.companyId,
      companyName: companies.name,
      periodStart: vatWorkpapers.periodStart,
      periodEnd: vatWorkpapers.periodEnd,
      dueDate: vatWorkpapers.dueDate,
      status: vatWorkpapers.status,
      reviewerUserId: vatWorkpapers.reviewerUserId,
      generatedVatReturnId: vatWorkpapers.generatedVatReturnId,
      totalsSnapshot: vatWorkpapers.totalsSnapshot,
      notes: vatWorkpapers.notes,
      createdBy: vatWorkpapers.createdBy,
      createdAt: vatWorkpapers.createdAt,
      updatedAt: vatWorkpapers.updatedAt,
    })
    .from(vatWorkpapers)
    .innerJoin(companies, eq(companies.id, vatWorkpapers.companyId))
    .where(eq(companies.companyType, "client"))
    .orderBy(desc(vatWorkpapers.periodEnd), desc(vatWorkpapers.updatedAt));

  return (rows as Array<{ companyId: string }>).filter((row: { companyId: string }) =>
    scopedCompanyIds.includes(row.companyId)
  );
}

export async function getVatWorkpaperDetail(workpaperId: string) {
  const workpaper = await getWorkpaperOrThrow(workpaperId);
  const [company] = await db
    .select({ id: companies.id, name: companies.name, trnVatNumber: companies.trnVatNumber })
    .from(companies)
    .where(eq(companies.id, workpaper.companyId))
    .limit(1);

  const [rows, attachments] = await Promise.all([
    db
      .select()
      .from(vatWorkpaperRows)
      .where(eq(vatWorkpaperRows.workpaperId, workpaperId))
      .orderBy(desc(vatWorkpaperRows.createdAt)),
    db
      .select()
      .from(vatWorkpaperAttachments)
      .where(eq(vatWorkpaperAttachments.workpaperId, workpaperId))
      .orderBy(desc(vatWorkpaperAttachments.createdAt)),
  ]);

  return {
    workpaper,
    company: company ?? null,
    rows,
    attachments,
    totals: calculateVatWorkpaperTotals(rows),
  };
}

export async function createVatWorkpaper(input: {
  companyId: string;
  periodStart: Date | string;
  periodEnd: Date | string;
  dueDate?: Date | string | null;
  reviewerUserId?: string | null;
  notes?: string | null;
  createdBy: string;
}) {
  const periodStart = parseDate(input.periodStart);
  const periodEnd = parseDate(input.periodEnd);
  if (!periodStart || !periodEnd) throw new ValidationError("Valid VAT period dates are required");
  if (periodEnd < periodStart)
    throw new ValidationError("VAT period end must be after period start");
  await assertPeriodNotLocked(input.companyId, periodEnd);

  const dueDate = parseDate(input.dueDate) ?? defaultVatDueDate(periodEnd);
  const [existing] = await db
    .select()
    .from(vatWorkpapers)
    .where(
      and(
        eq(vatWorkpapers.companyId, input.companyId),
        eq(vatWorkpapers.periodStart, periodStart),
        eq(vatWorkpapers.periodEnd, periodEnd)
      )
    )
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(vatWorkpapers)
    .values({
      companyId: input.companyId,
      periodStart,
      periodEnd,
      dueDate,
      reviewerUserId: input.reviewerUserId ?? null,
      notes: input.notes ?? null,
      createdBy: input.createdBy,
      totalsSnapshot: emptyVat201Totals(),
    } as any)
    .returning();
  return created;
}

function normalizeRowInput(
  input: VatWorkpaperRowInput,
  defaults?: Partial<VatWorkpaperRowInput>
): VatWorkpaperRowInput {
  const merged = { ...defaults, ...input };
  if (!VAT_WORKPAPER_CATEGORIES.includes(merged.rowCategory as VatWorkpaperCategory)) {
    throw new ValidationError("Unsupported VAT workpaper row category");
  }
  requireAuditReasonForOverride(merged as VatWorkpaperRowInput);
  return merged as VatWorkpaperRowInput;
}

export async function addVatWorkpaperRow(
  workpaperId: string,
  actorUserId: string,
  input: VatWorkpaperRowInput
) {
  const workpaper = await getWorkpaperOrThrow(workpaperId);
  await assertWorkpaperEditable(workpaper);
  const row = normalizeRowInput(input);
  const status = row.status ?? (row.sourceMethod === "ocr" ? "draft" : "approved");
  const vat201Box = mapVatWorkpaperRowToBox({
    rowCategory: row.rowCategory,
    emirate: row.emirate,
    vat201Box: row.vat201Box,
  });
  const taxableAmount = toMoney(row.taxableAmount);
  const vatAmount = toMoney(row.vatAmount);
  const adjustmentAmount = toMoney(row.adjustmentAmount);
  const grossAmount = toMoney(row.grossAmount ?? taxableAmount + vatAmount + adjustmentAmount);

  const [created] = await db
    .insert(vatWorkpaperRows)
    .values({
      workpaperId,
      companyId: workpaper.companyId,
      rowCategory: row.rowCategory,
      vat201Box,
      invoiceNumber: row.invoiceNumber ?? null,
      documentDate: parseDate(row.documentDate),
      counterpartyName: row.counterpartyName ?? null,
      counterpartyTrn: row.counterpartyTrn ?? null,
      emirate: row.emirate ?? null,
      taxableAmount,
      vatAmount,
      adjustmentAmount,
      grossAmount,
      status,
      sourceMethod: row.sourceMethod ?? "manual",
      sourceDocumentType: row.sourceDocumentType ?? null,
      sourceDocumentId: row.sourceDocumentId ?? null,
      notes: row.notes ?? null,
      auditReason: row.auditReason ?? null,
      reviewedBy: status === "approved" || status === "excluded" ? actorUserId : null,
      reviewedAt: status === "approved" || status === "excluded" ? new Date() : null,
      createdBy: actorUserId,
    } as any)
    .returning();

  await recalculateVatWorkpaper(workpaperId);
  return created;
}

export async function updateVatWorkpaperRow(
  workpaperId: string,
  rowId: string,
  actorUserId: string,
  input: Partial<VatWorkpaperRowInput>
) {
  const workpaper = await getWorkpaperOrThrow(workpaperId);
  await assertWorkpaperEditable(workpaper);
  const [existing] = await db
    .select()
    .from(vatWorkpaperRows)
    .where(and(eq(vatWorkpaperRows.id, rowId), eq(vatWorkpaperRows.workpaperId, workpaperId)))
    .limit(1);
  if (!existing) throw new NotFoundError("VAT workpaper row");

  const merged = normalizeRowInput(
    {
      rowCategory: (input.rowCategory ?? existing.rowCategory) as VatWorkpaperCategory,
      vat201Box: input.vat201Box ?? existing.vat201Box,
      emirate: input.emirate ?? existing.emirate,
      auditReason: input.auditReason ?? existing.auditReason,
    },
    existing as unknown as VatWorkpaperRowInput
  );

  const status = input.status ?? (existing.status as VatWorkpaperRowStatus);
  const vat201Box = mapVatWorkpaperRowToBox({
    rowCategory: merged.rowCategory,
    emirate: input.emirate ?? existing.emirate,
    vat201Box: input.vat201Box ?? existing.vat201Box,
  });

  const update: Record<string, unknown> = {
    updatedAt: new Date(),
    vat201Box,
  };
  for (const key of [
    "rowCategory",
    "invoiceNumber",
    "counterpartyName",
    "counterpartyTrn",
    "emirate",
    "sourceMethod",
    "sourceDocumentType",
    "sourceDocumentId",
    "notes",
    "auditReason",
  ] as const) {
    if (key in input) update[key] = input[key] ?? null;
  }
  if ("documentDate" in input) update.documentDate = parseDate(input.documentDate);
  if ("taxableAmount" in input) update.taxableAmount = toMoney(input.taxableAmount);
  if ("vatAmount" in input) update.vatAmount = toMoney(input.vatAmount);
  if ("adjustmentAmount" in input) update.adjustmentAmount = toMoney(input.adjustmentAmount);
  if ("grossAmount" in input) update.grossAmount = toMoney(input.grossAmount);
  if ("status" in input) {
    update.status = status;
    update.reviewedBy = status === "approved" || status === "excluded" ? actorUserId : null;
    update.reviewedAt = status === "approved" || status === "excluded" ? new Date() : null;
  }

  const [updated] = await db
    .update(vatWorkpaperRows)
    .set(update as any)
    .where(and(eq(vatWorkpaperRows.id, rowId), eq(vatWorkpaperRows.workpaperId, workpaperId)))
    .returning();

  await recalculateVatWorkpaper(workpaperId);
  return updated;
}

export async function scanVatWorkpaperEvidence(
  workpaperId: string,
  actorUserId: string,
  attachment: VatWorkpaperAttachmentInput,
  draftRow: VatWorkpaperRowInput
) {
  const row = await addVatWorkpaperRow(workpaperId, actorUserId, {
    ...draftRow,
    status: "draft",
    sourceMethod: "ocr",
  });

  const [createdAttachment] = await db
    .insert(vatWorkpaperAttachments)
    .values({
      workpaperId,
      rowId: row.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      filePath: attachment.filePath ?? null,
      extractedText: attachment.extractedText ?? null,
      extractionJson: attachment.extractionJson ?? {},
      uploadedBy: actorUserId,
    } as any)
    .returning();

  return { row, attachment: createdAttachment };
}

export async function recalculateVatWorkpaper(workpaperId: string) {
  await getWorkpaperOrThrow(workpaperId);
  const rows = await db
    .select()
    .from(vatWorkpaperRows)
    .where(eq(vatWorkpaperRows.workpaperId, workpaperId));
  const totals = calculateVatWorkpaperTotals(rows);
  const [updated] = await db
    .update(vatWorkpapers)
    .set({ totalsSnapshot: totals, updatedAt: new Date() } as any)
    .where(eq(vatWorkpapers.id, workpaperId))
    .returning();
  return { workpaper: updated, totals };
}

/**
 * Bulk variant of addVatWorkpaperRow: one insert, one recalculation. Used by
 * the books-pull and .xlsx import paths where dozens of rows land at once.
 */
export async function addVatWorkpaperRowsBulk(
  workpaperId: string,
  actorUserId: string,
  inputs: VatWorkpaperRowInput[]
) {
  const workpaper = await getWorkpaperOrThrow(workpaperId);
  await assertWorkpaperEditable(workpaper);
  if (inputs.length === 0) return [];

  const values = inputs.map((input) => {
    const row = normalizeRowInput(input);
    const status = row.status ?? (row.sourceMethod === "ocr" ? "draft" : "approved");
    const vat201Box = mapVatWorkpaperRowToBox({
      rowCategory: row.rowCategory,
      emirate: row.emirate,
      vat201Box: row.vat201Box,
    });
    const taxableAmount = toMoney(row.taxableAmount);
    const vatAmount = toMoney(row.vatAmount);
    const adjustmentAmount = toMoney(row.adjustmentAmount);
    const grossAmount = toMoney(row.grossAmount ?? taxableAmount + vatAmount + adjustmentAmount);
    return {
      workpaperId,
      companyId: workpaper.companyId,
      rowCategory: row.rowCategory,
      vat201Box,
      invoiceNumber: row.invoiceNumber ?? null,
      documentDate: parseDate(row.documentDate),
      counterpartyName: row.counterpartyName ?? null,
      counterpartyTrn: row.counterpartyTrn ?? null,
      emirate: row.emirate ?? null,
      taxableAmount,
      vatAmount,
      adjustmentAmount,
      grossAmount,
      status,
      sourceMethod: row.sourceMethod ?? "manual",
      sourceDocumentType: row.sourceDocumentType ?? null,
      sourceDocumentId: row.sourceDocumentId ?? null,
      notes: row.notes ?? null,
      auditReason: row.auditReason ?? null,
      reviewedBy: status === "approved" || status === "excluded" ? actorUserId : null,
      reviewedAt: status === "approved" || status === "excluded" ? new Date() : null,
      createdBy: actorUserId,
    };
  });

  const created = await db
    .insert(vatWorkpaperRows)
    .values(values as any)
    .returning();
  await recalculateVatWorkpaper(workpaperId);
  return created;
}

// ─── Pull-from-books ─────────────────────────────────────────────────────────

export interface BookInvoice {
  id: string;
  number?: string | null;
  date: Date | string;
  status: string;
  customerName?: string | null;
  customerTrn?: string | null;
}

export interface BookInvoiceLine {
  invoiceId: string;
  quantity: number;
  unitPrice: number;
  vatRate?: number | null;
  vatSupplyType?: string | null;
}

export interface BookReceipt {
  id: string;
  date?: Date | string | null;
  createdAt?: Date | string | null;
  posted?: boolean | null;
  merchant?: string | null;
  amount?: number | string | null;
  vatAmount?: number | string | null;
  reverseCharge?: boolean | null;
}

const PULL_AUDIT_NOTE = "Pulled from books";

function withinPeriod(value: Date | string | null | undefined, start: Date, end: Date): boolean {
  const date = parseDate(value ?? null);
  return !!date && date >= start && date <= end;
}

/**
 * Maps a period's issued invoices and posted receipts onto workpaper rows.
 * Mirrors the categorization in the VAT 201 generator (vat.routes.ts):
 * zero-rated when the line says so or carries a 0% rate, exempt when marked,
 * standard otherwise; reverse-charge receipts go to Box 10's category.
 * Rows land as drafts so the accountant reviews instead of re-typing.
 */
export function mapBooksToVatWorkpaperRows(input: {
  invoices: BookInvoice[];
  invoiceLines: BookInvoiceLine[];
  receipts: BookReceipt[];
  companyEmirate: string;
  periodStart: Date;
  periodEnd: Date;
  existingSourceIds: Set<string>;
  defaultVatRate?: number;
}): VatWorkpaperRowInput[] {
  const {
    invoices,
    invoiceLines,
    receipts,
    companyEmirate,
    periodStart,
    periodEnd,
    existingSourceIds,
  } = input;
  const vatRateFallback = input.defaultVatRate ?? 0.05;
  const rows: VatWorkpaperRowInput[] = [];

  const linesByInvoice = new Map<string, BookInvoiceLine[]>();
  for (const line of invoiceLines) {
    const list = linesByInvoice.get(line.invoiceId) ?? [];
    list.push(line);
    linesByInvoice.set(line.invoiceId, list);
  }

  for (const invoice of invoices) {
    if (existingSourceIds.has(invoice.id)) continue;
    if (invoice.status === "void" || invoice.status === "draft" || invoice.status === "cancelled")
      continue;
    if (!withinPeriod(invoice.date, periodStart, periodEnd)) continue;

    let standardAmount = 0;
    let standardVat = 0;
    let zeroRatedAmount = 0;
    let exemptAmount = 0;
    for (const line of linesByInvoice.get(invoice.id) ?? []) {
      const lineAmount = toMoney(line.quantity * line.unitPrice);
      const supplyType = line.vatSupplyType || "standard_rated";
      // Explicit supply type wins; the 0%-rate fallback only catches lines
      // that weren't tagged (an exempt line also carries a 0% rate).
      if (supplyType === "exempt") {
        exemptAmount += lineAmount;
      } else if (supplyType === "zero_rated" || line.vatRate === 0) {
        zeroRatedAmount += lineAmount;
      } else {
        standardAmount += lineAmount;
        standardVat += toMoney(lineAmount * (line.vatRate ?? vatRateFallback));
      }
    }

    const base = {
      invoiceNumber: invoice.number ?? null,
      documentDate: invoice.date,
      counterpartyName: invoice.customerName ?? null,
      counterpartyTrn: invoice.customerTrn ?? null,
      emirate: companyEmirate,
      status: "draft" as const,
      sourceMethod: "generated" as const,
      sourceDocumentType: "invoice",
      sourceDocumentId: invoice.id,
      notes: PULL_AUDIT_NOTE,
    };
    if (standardAmount > 0 || standardVat > 0) {
      rows.push({
        ...base,
        rowCategory: "standard_sale",
        taxableAmount: toMoney(standardAmount),
        vatAmount: toMoney(standardVat),
      });
    }
    if (zeroRatedAmount > 0) {
      rows.push({
        ...base,
        rowCategory: "zero_rated_sale",
        taxableAmount: toMoney(zeroRatedAmount),
        vatAmount: 0,
      });
    }
    if (exemptAmount > 0) {
      rows.push({
        ...base,
        rowCategory: "exempt_sale",
        taxableAmount: toMoney(exemptAmount),
        vatAmount: 0,
      });
    }
  }

  for (const receipt of receipts) {
    if (existingSourceIds.has(receipt.id)) continue;
    if (!receipt.posted) continue;
    if (!withinPeriod(receipt.date ?? receipt.createdAt, periodStart, periodEnd)) continue;

    rows.push({
      rowCategory: receipt.reverseCharge ? "reverse_charge_input" : "standard_expense",
      invoiceNumber: null,
      documentDate: receipt.date ?? receipt.createdAt ?? null,
      counterpartyName: receipt.merchant ?? null,
      counterpartyTrn: null,
      emirate: companyEmirate,
      taxableAmount: toMoney(receipt.amount),
      vatAmount: toMoney(receipt.vatAmount),
      status: "draft",
      sourceMethod: "generated",
      sourceDocumentType: "receipt",
      sourceDocumentId: receipt.id,
      notes: PULL_AUDIT_NOTE,
    });
  }

  return rows;
}

/**
 * Populates a workpaper from the client's actual books for its period —
 * issued invoices (split standard / zero-rated / exempt) and posted receipts.
 * Documents already pulled into this workpaper are skipped, so the action is
 * safe to repeat as new documents arrive during the period.
 */
export async function pullVatWorkpaperRowsFromBooks(workpaperId: string, actorUserId: string) {
  const workpaper = await getWorkpaperOrThrow(workpaperId);
  await assertWorkpaperEditable(workpaper);

  const periodStart = parseDate(workpaper.periodStart);
  const periodEnd = parseDate(workpaper.periodEnd);
  if (!periodStart || !periodEnd) {
    throw new ValidationError("VAT workpaper has no period to pull documents for");
  }

  const [company] = await db
    .select({ emirate: companies.emirate })
    .from(companies)
    .where(eq(companies.id, workpaper.companyId))
    .limit(1);

  const existing = await db
    .select({ sourceDocumentId: vatWorkpaperRows.sourceDocumentId })
    .from(vatWorkpaperRows)
    .where(eq(vatWorkpaperRows.workpaperId, workpaperId));
  const existingSourceIds = new Set<string>(
    existing
      .map((row: { sourceDocumentId: string | null }) => row.sourceDocumentId)
      .filter((id: string | null): id is string => !!id)
  );

  const { storage } = await import("../storage");
  const [invoices, receipts] = await Promise.all([
    storage.getInvoicesByCompanyId(workpaper.companyId),
    storage.getReceiptsByCompanyId(workpaper.companyId),
  ]);
  const invoiceLines = await storage.getInvoiceLinesByInvoiceIds(
    invoices.map((invoice: BookInvoice) => invoice.id)
  );

  const rows = mapBooksToVatWorkpaperRows({
    invoices,
    invoiceLines,
    receipts,
    companyEmirate: normalizeEmirate(company?.emirate),
    periodStart,
    periodEnd,
    existingSourceIds,
  });

  const created = await addVatWorkpaperRowsBulk(workpaperId, actorUserId, rows);
  return { created: created.length, skippedExisting: existingSourceIds.size };
}

/**
 * Bulk status transition for workpaper rows — the review queue's
 * "approve all drafts" action. One UPDATE, one recalculation.
 */
export async function bulkUpdateVatWorkpaperRowStatus(
  workpaperId: string,
  actorUserId: string,
  input: { to: "approved" | "excluded"; rowIds?: string[] }
): Promise<{ updated: number }> {
  const workpaper = await getWorkpaperOrThrow(workpaperId);
  await assertWorkpaperEditable(workpaper);

  const conditions = [
    eq(vatWorkpaperRows.workpaperId, workpaperId),
    eq(vatWorkpaperRows.status, "draft"),
  ];
  if (input.rowIds && input.rowIds.length > 0) {
    conditions.push(inArray(vatWorkpaperRows.id, input.rowIds));
  }

  const updated = await db
    .update(vatWorkpaperRows)
    .set({
      status: input.to,
      reviewedBy: actorUserId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    } as any)
    .where(and(...conditions))
    .returning({ id: vatWorkpaperRows.id });

  if (updated.length > 0) await recalculateVatWorkpaper(workpaperId);
  return { updated: updated.length };
}

export async function updateVatWorkpaperStatus(
  workpaperId: string,
  status: "draft" | "in_review" | "ready" | "generated" | "filed" | "locked",
  data?: { reviewerUserId?: string | null; notes?: string | null }
) {
  const workpaper = await getWorkpaperOrThrow(workpaperId);
  if (workpaper.status === "locked" && status !== "locked") {
    throw new ConflictError(
      "VAT workpaper is locked and cannot be reopened",
      "VAT_WORKPAPER_LOCKED"
    );
  }
  if (status !== "locked" && status !== "filed") await assertWorkpaperEditable(workpaper);

  const update: Record<string, unknown> = { status, updatedAt: new Date() };
  if (data && "reviewerUserId" in data) update.reviewerUserId = data.reviewerUserId ?? null;
  if (data && "notes" in data) update.notes = data.notes ?? null;

  const [updated] = await db
    .update(vatWorkpapers)
    .set(update as any)
    .where(eq(vatWorkpapers.id, workpaperId))
    .returning();
  return updated;
}

export async function generateVatReturnFromWorkpaper(workpaperId: string, actorUserId: string) {
  const detail = await getVatWorkpaperDetail(workpaperId);
  const { workpaper, totals } = detail;
  await assertWorkpaperEditable(workpaper);

  const vatReturnPayload = {
    companyId: workpaper.companyId,
    periodStart: workpaper.periodStart,
    periodEnd: workpaper.periodEnd,
    dueDate: workpaper.dueDate,
    status: "pending_review",
    vatStagger: "quarterly",
    box1aAbuDhabiAmount: totals.box1aAbuDhabiAmount,
    box1aAbuDhabiVat: totals.box1aAbuDhabiVat,
    box1aAbuDhabiAdj: totals.box1aAbuDhabiAdj,
    box1bDubaiAmount: totals.box1bDubaiAmount,
    box1bDubaiVat: totals.box1bDubaiVat,
    box1bDubaiAdj: totals.box1bDubaiAdj,
    box1cSharjahAmount: totals.box1cSharjahAmount,
    box1cSharjahVat: totals.box1cSharjahVat,
    box1cSharjahAdj: totals.box1cSharjahAdj,
    box1dAjmanAmount: totals.box1dAjmanAmount,
    box1dAjmanVat: totals.box1dAjmanVat,
    box1dAjmanAdj: totals.box1dAjmanAdj,
    box1eUmmAlQuwainAmount: totals.box1eUmmAlQuwainAmount,
    box1eUmmAlQuwainVat: totals.box1eUmmAlQuwainVat,
    box1eUmmAlQuwainAdj: totals.box1eUmmAlQuwainAdj,
    box1fRasAlKhaimahAmount: totals.box1fRasAlKhaimahAmount,
    box1fRasAlKhaimahVat: totals.box1fRasAlKhaimahVat,
    box1fRasAlKhaimahAdj: totals.box1fRasAlKhaimahAdj,
    box1gFujairahAmount: totals.box1gFujairahAmount,
    box1gFujairahVat: totals.box1gFujairahVat,
    box1gFujairahAdj: totals.box1gFujairahAdj,
    box2TouristRefundAmount: totals.box2TouristRefundAmount,
    box2TouristRefundVat: totals.box2TouristRefundVat,
    box3ReverseChargeAmount: totals.box3ReverseChargeAmount,
    box3ReverseChargeVat: totals.box3ReverseChargeVat,
    box4ZeroRatedAmount: totals.box4ZeroRatedAmount,
    box5ExemptAmount: totals.box5ExemptAmount,
    box6ImportsAmount: totals.box6ImportsAmount,
    box6ImportsVat: totals.box6ImportsVat,
    box7ImportsAdjAmount: totals.box7ImportsAdjAmount,
    box7ImportsAdjVat: totals.box7ImportsAdjVat,
    box8TotalAmount: totals.box8TotalAmount,
    box8TotalVat: totals.box8TotalVat,
    box8TotalAdj: totals.box8TotalAdj,
    box9ExpensesAmount: totals.box9ExpensesAmount,
    box9ExpensesVat: totals.box9ExpensesVat,
    box9ExpensesAdj: totals.box9ExpensesAdj,
    box10ReverseChargeAmount: totals.box10ReverseChargeAmount,
    box10ReverseChargeVat: totals.box10ReverseChargeVat,
    box11TotalAmount: totals.box11TotalAmount,
    box11TotalVat: totals.box11TotalVat,
    box11TotalAdj: totals.box11TotalAdj,
    box12TotalDueTax: totals.box12TotalDueTax,
    box13RecoverableTax: totals.box13RecoverableTax,
    box14PayableTax: totals.box14PayableTax,
    box1SalesStandard:
      totals.box1aAbuDhabiAmount +
      totals.box1bDubaiAmount +
      totals.box1cSharjahAmount +
      totals.box1dAjmanAmount +
      totals.box1eUmmAlQuwainAmount +
      totals.box1fRasAlKhaimahAmount +
      totals.box1gFujairahAmount,
    box2SalesOtherEmirates: 0,
    box3SalesTaxExempt: totals.box4ZeroRatedAmount,
    box4SalesExempt: totals.box5ExemptAmount,
    box5TotalOutputTax: totals.box8TotalVat,
    box6ExpensesStandard: totals.box9ExpensesAmount,
    box7ExpensesTouristRefund: totals.box2TouristRefundVat,
    box8TotalInputTax: totals.box11TotalVat,
    box9NetTax: totals.box14PayableTax,
    notes: "Generated from NRA VAT Submission Workspace. No FTA submission was performed.",
    createdBy: actorUserId,
    updatedAt: new Date(),
  };

  let vatReturnId = workpaper.generatedVatReturnId;
  let vatReturn;
  if (vatReturnId) {
    [vatReturn] = await db
      .update(vatReturns)
      .set(vatReturnPayload as any)
      .where(eq(vatReturns.id, vatReturnId))
      .returning();
  } else {
    [vatReturn] = await db
      .insert(vatReturns)
      .values(vatReturnPayload as any)
      .returning();
    vatReturnId = vatReturn.id;
  }

  const [updatedWorkpaper] = await db
    .update(vatWorkpapers)
    .set({
      status: "generated",
      generatedVatReturnId: vatReturnId,
      totalsSnapshot: totals,
      updatedAt: new Date(),
    } as any)
    .where(eq(vatWorkpapers.id, workpaperId))
    .returning();

  return { workpaper: updatedWorkpaper, vatReturn, totals };
}
