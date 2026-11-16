/**
 * Engagement letters, proposals, time tracking, WIP / realisation and
 * recurring engagement billing (W5-D, R15-11).
 *
 * - Engagement letters and proposals are rendered from firm templates. The
 *   client accepts in the client file / portal by typing their name; we record
 *   the typed name, timestamp, IP and user agent. That is a click-accept
 *   record, not a qualified e-signature: the e-signature provider adapter is
 *   `requires_external` until a provider contract and keys exist.
 * - Time entries (timer or manual) roll into WIP per client; billing WIP or a
 *   recurring engagement fee produces a service invoice (fils-exact, 5% VAT).
 */
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "../../db";
import { DomainError } from "../../errors";
import { fromFils, mulRate, sumFils, toFils } from "../../../shared/money";
import {
  companies,
  companyUsers,
  engagements,
  firmEngagementLetters,
  firmEngagementTemplates,
  firmTimeEntries,
  firms,
  serviceInvoiceLines,
  serviceInvoices,
  type FirmEngagementLetter,
  type FirmTimeEntry,
  type ServiceInvoice,
} from "../../../shared/schema";
import { normalizeCompanyRole } from "../../../shared/permissions";
import type { FirmContext } from "./scope";

export const SERVICE_VAT_RATE = "0.05";

// ─── E-signature adapter boundary ────────────────────────────────────────────

export interface EsignAdapter {
  name: string;
  capability: "live" | "requires_external";
  requestSignature(letter: FirmEngagementLetter): Promise<{ status: string; providerRef?: string }>;
}

/**
 * No e-signature provider is contracted. The adapter reports
 * `requires_external` and never claims a signature was requested.
 */
export const unconfiguredEsignAdapter: EsignAdapter = {
  name: "none",
  capability: "requires_external",
  async requestSignature() {
    return { status: "requires_external" };
  },
};

export function getEsignAdapter(): EsignAdapter {
  return unconfiguredEsignAdapter;
}

// ─── Templates and letters ───────────────────────────────────────────────────

export const DEFAULT_ENGAGEMENT_BODY = `Engagement letter between {{firm_name}} and {{client_name}}

Services: {{services}}
Fee: AED {{fee}} ({{billing_cycle}})
Date: {{date}}

The client agrees that {{firm_name}} will provide the services above. Either party may end the engagement with 30 days' notice.`;

export function renderLetter(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, key: string) => vars[key] ?? "");
}

export async function createEngagementTemplate(
  ctx: FirmContext,
  input: { name: string; kind: "engagement" | "proposal"; body: string }
) {
  const [row] = await db
    .insert(firmEngagementTemplates)
    .values({ firmId: ctx.firmId, ...input, createdBy: ctx.userId })
    .returning();
  return row;
}

export async function listEngagementTemplates(ctx: FirmContext) {
  return db
    .select()
    .from(firmEngagementTemplates)
    .where(eq(firmEngagementTemplates.firmId, ctx.firmId))
    .orderBy(desc(firmEngagementTemplates.createdAt));
}

export async function createLetter(
  ctx: FirmContext,
  companyId: string,
  input: {
    templateId?: string;
    kind: "engagement" | "proposal";
    title: string;
    body?: string;
    feeAmount?: number;
    billingCycle?: "monthly" | "quarterly" | "annually";
    services?: string;
  }
) {
  let body = input.body;
  if (input.templateId) {
    const [t] = await db
      .select()
      .from(firmEngagementTemplates)
      .where(
        and(
          eq(firmEngagementTemplates.id, input.templateId),
          eq(firmEngagementTemplates.firmId, ctx.firmId)
        )
      )
      .limit(1);
    if (!t) throw new DomainError("TEMPLATE_NOT_FOUND", 404);
    body = t.body;
  }
  const [firm] = await db.select({ name: firms.name }).from(firms).where(eq(firms.id, ctx.firmId));
  const [company] = await db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, companyId));
  const rendered = renderLetter(body ?? DEFAULT_ENGAGEMENT_BODY, {
    firm_name: firm?.name ?? "",
    client_name: company?.name ?? "",
    fee: input.feeAmount != null ? fromFils(toFils(input.feeAmount)) : "",
    billing_cycle: input.billingCycle ?? "monthly",
    services: input.services ?? "",
    date: new Date().toISOString().slice(0, 10),
  });
  const [row] = await db
    .insert(firmEngagementLetters)
    .values({
      firmId: ctx.firmId,
      companyId,
      templateId: input.templateId ?? null,
      kind: input.kind,
      title: input.title,
      body: rendered,
      feeAmount: input.feeAmount ?? null,
      billingCycle: input.billingCycle ?? null,
      status: "draft",
      esignStatus: getEsignAdapter().capability,
      createdBy: ctx.userId,
    })
    .returning();
  return row;
}

export async function listLettersForFirm(ctx: FirmContext, companyId: string) {
  return db
    .select()
    .from(firmEngagementLetters)
    .where(
      and(
        eq(firmEngagementLetters.firmId, ctx.firmId),
        eq(firmEngagementLetters.companyId, companyId)
      )
    )
    .orderBy(desc(firmEngagementLetters.createdAt));
}

async function letterForFirm(ctx: FirmContext, letterId: string) {
  const [row] = await db
    .select()
    .from(firmEngagementLetters)
    .where(
      and(eq(firmEngagementLetters.id, letterId), eq(firmEngagementLetters.firmId, ctx.firmId))
    )
    .limit(1);
  if (!row) throw new DomainError("LETTER_NOT_FOUND", 404);
  return row;
}

/** Make the letter visible to the client. No e-mail or e-signature is claimed. */
export async function sendLetter(ctx: FirmContext, letterId: string) {
  const letter = await letterForFirm(ctx, letterId);
  if (letter.status !== "draft") throw new DomainError("LETTER_NOT_DRAFT", 409);
  const esign = await getEsignAdapter().requestSignature(letter);
  const [row] = await db
    .update(firmEngagementLetters)
    .set({ status: "sent", sentAt: new Date(), esignStatus: esign.status, updatedAt: new Date() })
    .where(eq(firmEngagementLetters.id, letterId))
    .returning();
  return { letter: row, delivery: "client_portal_only" as const, esign: esign.status };
}

export async function withdrawLetter(ctx: FirmContext, letterId: string) {
  const letter = await letterForFirm(ctx, letterId);
  if (letter.status === "accepted") throw new DomainError("LETTER_ALREADY_ACCEPTED", 409);
  const [row] = await db
    .update(firmEngagementLetters)
    .set({ status: "withdrawn", updatedAt: new Date() })
    .where(eq(firmEngagementLetters.id, letterId))
    .returning();
  return row;
}

async function assertClientSigner(userId: string, companyId: string) {
  const [m] = await db
    .select({ role: companyUsers.role })
    .from(companyUsers)
    .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId)))
    .limit(1);
  const role = m ? normalizeCompanyRole(m.role) : null;
  if (role !== "owner" && role !== "admin") {
    throw new DomainError("COMPANY_OWNER_REQUIRED", 403);
  }
}

/** Letters the client sees (sent or decided; drafts stay internal). */
export async function listLettersForClient(userId: string, companyId: string) {
  const [m] = await db
    .select({ id: companyUsers.id })
    .from(companyUsers)
    .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId)))
    .limit(1);
  if (!m) throw new DomainError("COMPANY_ACCESS_DENIED", 403);
  return db
    .select({
      id: firmEngagementLetters.id,
      firmName: firms.name,
      kind: firmEngagementLetters.kind,
      title: firmEngagementLetters.title,
      body: firmEngagementLetters.body,
      feeAmount: firmEngagementLetters.feeAmount,
      billingCycle: firmEngagementLetters.billingCycle,
      status: firmEngagementLetters.status,
      sentAt: firmEngagementLetters.sentAt,
      respondedAt: firmEngagementLetters.respondedAt,
      acceptedName: firmEngagementLetters.acceptedName,
      esignStatus: firmEngagementLetters.esignStatus,
    })
    .from(firmEngagementLetters)
    .innerJoin(firms, eq(firms.id, firmEngagementLetters.firmId))
    .where(
      and(
        eq(firmEngagementLetters.companyId, companyId),
        inArray(firmEngagementLetters.status, ["sent", "accepted", "declined"])
      )
    )
    .orderBy(desc(firmEngagementLetters.createdAt));
}

/**
 * Client acceptance: typed name, timestamp, IP and user agent are recorded.
 * An accepted engagement (or proposal) with a fee creates / updates the
 * engagement that recurring billing invoices.
 */
export async function respondToLetter(
  user: { id: string },
  companyId: string,
  letterId: string,
  input: { decision: "accept" | "decline"; typedName?: string; ip?: string; userAgent?: string }
) {
  await assertClientSigner(user.id, companyId);
  const [letter] = await db
    .select()
    .from(firmEngagementLetters)
    .where(
      and(eq(firmEngagementLetters.id, letterId), eq(firmEngagementLetters.companyId, companyId))
    )
    .limit(1);
  if (!letter || letter.status === "draft" || letter.status === "withdrawn") {
    throw new DomainError("LETTER_NOT_FOUND", 404);
  }
  if (letter.status !== "sent") throw new DomainError("LETTER_ALREADY_DECIDED", 409);
  if (input.decision === "decline") {
    const [row] = await db
      .update(firmEngagementLetters)
      .set({ status: "declined", respondedAt: new Date(), updatedAt: new Date() })
      .where(eq(firmEngagementLetters.id, letterId))
      .returning();
    return row;
  }
  const typedName = (input.typedName ?? "").trim();
  if (typedName.length < 2) throw new DomainError("TYPED_NAME_REQUIRED", 400);
  return db.transaction(async (tx: typeof db) => {
    let engagementId = letter.engagementId;
    if (letter.feeAmount != null && Number(letter.feeAmount) > 0) {
      const [existing] = await tx
        .select({ id: engagements.id })
        .from(engagements)
        .where(
          and(
            eq(engagements.companyId, companyId),
            eq(engagements.firmId, letter.firmId),
            eq(engagements.status, "active")
          )
        )
        .limit(1);
      const values = {
        monthlyFee: Number(letter.feeAmount),
        billingCycle: letter.billingCycle ?? "monthly",
        nextBillingDate: new Date().toISOString().slice(0, 10),
        updatedAt: new Date(),
      };
      if (existing) {
        await tx.update(engagements).set(values).where(eq(engagements.id, existing.id));
        engagementId = existing.id;
      } else {
        const [eng] = await tx
          .insert(engagements)
          .values({
            companyId,
            firmId: letter.firmId,
            engagementType: "full_service",
            status: "active",
            startDate: new Date(),
            ...values,
          })
          .returning({ id: engagements.id });
        engagementId = eng.id;
      }
    }
    const [row] = await tx
      .update(firmEngagementLetters)
      .set({
        status: "accepted",
        respondedAt: new Date(),
        acceptedByUserId: user.id,
        acceptedName: typedName,
        acceptedIp: input.ip ?? null,
        acceptedUserAgent: input.userAgent?.slice(0, 500) ?? null,
        engagementId,
        updatedAt: new Date(),
      })
      .where(eq(firmEngagementLetters.id, letterId))
      .returning();
    return row;
  });
}

// ─── Time tracking ───────────────────────────────────────────────────────────

async function defaultRate(firmId: string, companyId: string): Promise<number> {
  const [eng] = await db
    .select({ rate: engagements.hourlyRate })
    .from(engagements)
    .where(
      and(
        eq(engagements.companyId, companyId),
        eq(engagements.firmId, firmId),
        eq(engagements.status, "active")
      )
    )
    .limit(1);
  return Number(eng?.rate ?? 0);
}

export async function logTime(
  ctx: FirmContext,
  input: {
    companyId: string;
    taskId?: string;
    entryDate: string;
    minutes: number;
    description?: string;
    billable?: boolean;
    hourlyRate?: number;
  }
) {
  const rate = input.hourlyRate ?? (await defaultRate(ctx.firmId, input.companyId));
  const [row] = await db
    .insert(firmTimeEntries)
    .values({
      firmId: ctx.firmId,
      companyId: input.companyId,
      taskId: input.taskId ?? null,
      userId: ctx.userId,
      entryDate: input.entryDate,
      minutes: input.minutes,
      description: input.description ?? null,
      billable: input.billable ?? true,
      hourlyRate: rate,
      status: "logged",
    })
    .returning();
  return row;
}

export async function startTimer(
  ctx: FirmContext,
  input: { companyId: string; taskId?: string; description?: string; hourlyRate?: number }
) {
  const [running] = await db
    .select({ id: firmTimeEntries.id })
    .from(firmTimeEntries)
    .where(and(eq(firmTimeEntries.userId, ctx.userId), eq(firmTimeEntries.status, "running")))
    .limit(1);
  if (running) throw new DomainError("TIMER_ALREADY_RUNNING", 409, { entryId: running.id });
  const rate = input.hourlyRate ?? (await defaultRate(ctx.firmId, input.companyId));
  const now = new Date();
  const [row] = await db
    .insert(firmTimeEntries)
    .values({
      firmId: ctx.firmId,
      companyId: input.companyId,
      taskId: input.taskId ?? null,
      userId: ctx.userId,
      entryDate: now.toISOString().slice(0, 10),
      minutes: 0,
      description: input.description ?? null,
      billable: true,
      hourlyRate: rate,
      status: "running",
      startedAt: now,
    })
    .returning();
  return row;
}

export async function stopTimer(ctx: FirmContext, entryId: string, now: Date = new Date()) {
  const [entry] = await db
    .select()
    .from(firmTimeEntries)
    .where(
      and(
        eq(firmTimeEntries.id, entryId),
        eq(firmTimeEntries.firmId, ctx.firmId),
        eq(firmTimeEntries.userId, ctx.userId)
      )
    )
    .limit(1);
  if (!entry) throw new DomainError("TIME_ENTRY_NOT_FOUND", 404);
  if (entry.status !== "running" || !entry.startedAt)
    throw new DomainError("TIMER_NOT_RUNNING", 409);
  const minutes = Math.min(
    1440,
    Math.max(1, Math.ceil((now.getTime() - entry.startedAt.getTime()) / 60000))
  );
  const [row] = await db
    .update(firmTimeEntries)
    .set({ status: "logged", stoppedAt: now, minutes, updatedAt: now })
    .where(eq(firmTimeEntries.id, entryId))
    .returning();
  return row;
}

export async function listTimeEntries(ctx: FirmContext, companyIds: string[]) {
  if (companyIds.length === 0) return [];
  return db
    .select()
    .from(firmTimeEntries)
    .where(
      and(eq(firmTimeEntries.firmId, ctx.firmId), inArray(firmTimeEntries.companyId, companyIds))
    )
    .orderBy(desc(firmTimeEntries.entryDate));
}

/** Standard value of an entry in fils: minutes / 60 × hourly rate, half-up. */
export function entryValueFils(minutes: number, hourlyRate: number | string): number {
  const rateFils = toFils(hourlyRate);
  if (minutes <= 0 || rateFils <= 0) return 0;
  // Exact integer half-up of rateFils * minutes / 60.
  return Math.floor((2 * rateFils * minutes + 60) / 120);
}

export interface WipRow {
  companyId: string;
  companyName: string;
  unbilledMinutes: number;
  wipValue: string;
  billedMinutes: number;
  billedStandardValue: string;
  billedAmount: string;
  writtenOffValue: string;
  /** billed amount / standard value of billed + written-off time, or null with no billed time. */
  realisationRate: number | null;
}

/** WIP and realisation per client (R15-11). */
export async function wipReport(ctx: FirmContext, companyIds: string[]): Promise<WipRow[]> {
  if (companyIds.length === 0) return [];
  const entries = await db
    .select({ entry: firmTimeEntries, companyName: companies.name })
    .from(firmTimeEntries)
    .innerJoin(companies, eq(companies.id, firmTimeEntries.companyId))
    .where(
      and(
        eq(firmTimeEntries.firmId, ctx.firmId),
        inArray(firmTimeEntries.companyId, companyIds),
        eq(firmTimeEntries.billable, true)
      )
    );
  const byCompany = new Map<string, { name: string; rows: FirmTimeEntry[] }>();
  for (const e of entries as Array<{ entry: FirmTimeEntry; companyName: string }>) {
    const bucket = byCompany.get(e.entry.companyId) ?? { name: e.companyName, rows: [] };
    bucket.rows.push(e.entry);
    byCompany.set(e.entry.companyId, bucket);
  }
  const out: WipRow[] = [];
  for (const [companyId, { name, rows }] of byCompany) {
    const logged = rows.filter((r) => r.status === "logged");
    const billed = rows.filter((r) => r.status === "billed");
    const written = rows.filter((r) => r.status === "written_off");
    const wip = sumFils(logged.map((r) => entryValueFils(r.minutes, r.hourlyRate)));
    const billedStd = sumFils(billed.map((r) => entryValueFils(r.minutes, r.hourlyRate)));
    const writtenStd = sumFils(written.map((r) => entryValueFils(r.minutes, r.hourlyRate)));
    const billedAmt = sumFils(billed.map((r) => toFils(r.billedAmount ?? 0)));
    const denom = billedStd + writtenStd;
    out.push({
      companyId,
      companyName: name,
      unbilledMinutes: logged.reduce((a, r) => a + r.minutes, 0),
      wipValue: fromFils(wip),
      billedMinutes: billed.reduce((a, r) => a + r.minutes, 0),
      billedStandardValue: fromFils(billedStd),
      billedAmount: fromFils(billedAmt),
      writtenOffValue: fromFils(writtenStd),
      realisationRate: denom > 0 ? Math.round((billedAmt / denom) * 10000) / 10000 : null,
    });
  }
  return out.sort((a, b) => a.companyName.localeCompare(b.companyName));
}

// ─── Service invoices ────────────────────────────────────────────────────────

async function nextServiceInvoiceNumber(tx: typeof db, firmId: string): Promise<string> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('service_invoice_no'), hashtext(${firmId}))`
  );
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(serviceInvoices)
    .where(eq(serviceInvoices.firmId, firmId));
  return `SI-${String(Number(row?.n ?? 0) + 1).padStart(6, "0")}`;
}

async function ensureEngagement(tx: typeof db, firmId: string, companyId: string): Promise<string> {
  const [eng] = await tx
    .select({ id: engagements.id })
    .from(engagements)
    .where(and(eq(engagements.companyId, companyId), eq(engagements.firmId, firmId)))
    .orderBy(desc(engagements.createdAt))
    .limit(1);
  if (eng) return eng.id;
  const [created] = await tx
    .insert(engagements)
    .values({
      companyId,
      firmId,
      engagementType: "advisory",
      status: "active",
      startDate: new Date(),
    })
    .returning({ id: engagements.id });
  return created.id;
}

async function insertServiceInvoice(
  tx: typeof db,
  input: {
    firmId: string;
    companyId: string;
    engagementId: string;
    actorId: string | null;
    source: string;
    sourceKey: string | null;
    description: string;
    periodStart?: Date | null;
    periodEnd?: Date | null;
    lines: Array<{
      description: string;
      quantity: number;
      unitPriceFils: number;
      amountFils: number;
    }>;
    invoiceDate: Date;
    paymentTermsDays: number;
  }
): Promise<ServiceInvoice> {
  const subtotal = sumFils(input.lines.map((l) => l.amountFils));
  const vat = mulRate(subtotal, SERVICE_VAT_RATE);
  const due = new Date(input.invoiceDate);
  due.setUTCDate(due.getUTCDate() + input.paymentTermsDays);
  const [invoice] = await tx
    .insert(serviceInvoices)
    .values({
      firmId: input.firmId,
      companyId: input.companyId,
      engagementId: input.engagementId,
      invoiceNumber: await nextServiceInvoiceNumber(tx, input.firmId),
      invoiceDate: input.invoiceDate,
      dueDate: due,
      subtotal: Number(fromFils(subtotal)),
      vatAmount: Number(fromFils(vat)),
      total: Number(fromFils(subtotal + vat)),
      status: "draft",
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      description: input.description,
      source: input.source,
      sourceKey: input.sourceKey,
      createdBy: input.actorId,
    })
    .returning();
  for (const l of input.lines) {
    await tx.insert(serviceInvoiceLines).values({
      serviceInvoiceId: invoice.id,
      description: l.description,
      quantity: l.quantity,
      unitPrice: Number(fromFils(l.unitPriceFils)),
      vatRate: 0.05,
      amount: Number(fromFils(l.amountFils)),
    });
  }
  return invoice;
}

/** Bill every unbilled billable logged entry of a client into one service invoice. */
export async function billWip(ctx: FirmContext, companyId: string, invoiceDate: Date = new Date()) {
  return db.transaction(async (tx: typeof db) => {
    const entries = await tx
      .select()
      .from(firmTimeEntries)
      .where(
        and(
          eq(firmTimeEntries.firmId, ctx.firmId),
          eq(firmTimeEntries.companyId, companyId),
          eq(firmTimeEntries.status, "logged"),
          eq(firmTimeEntries.billable, true)
        )
      )
      .for("update");
    if (entries.length === 0) throw new DomainError("NO_UNBILLED_TIME", 409);
    const lines = (entries as FirmTimeEntry[]).map((e) => {
      const amountFils = entryValueFils(e.minutes, e.hourlyRate);
      return {
        description: `${e.entryDate} ${e.description ?? "Professional services"} (${e.minutes} min)`,
        quantity: Math.round((e.minutes / 60) * 100) / 100,
        unitPriceFils: toFils(e.hourlyRate),
        amountFils,
        entryId: e.id,
      };
    });
    const engagementId = await ensureEngagement(tx, ctx.firmId, companyId);
    const invoice = await insertServiceInvoice(tx, {
      firmId: ctx.firmId,
      companyId,
      engagementId,
      actorId: ctx.userId,
      source: "time",
      sourceKey: null,
      description: "Time-based professional services",
      lines,
      invoiceDate,
      paymentTermsDays: 30,
    });
    for (const l of lines) {
      await tx
        .update(firmTimeEntries)
        .set({
          status: "billed",
          serviceInvoiceId: invoice.id,
          billedAmount: Number(fromFils(l.amountFils)),
          updatedAt: new Date(),
        })
        .where(eq(firmTimeEntries.id, l.entryId));
    }
    return { invoice, entriesBilled: lines.length };
  });
}

function advance(dateIso: string, cycle: string | null): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const months = cycle === "quarterly" ? 3 : cycle === "annually" ? 12 : 1;
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Invoice every active engagement of the firm whose next billing date is due. */
export async function runRecurringBilling(
  ctx: Pick<FirmContext, "firmId"> & { userId?: string | null },
  asOf: Date = new Date()
) {
  const today = asOf.toISOString().slice(0, 10);
  const due = await db
    .select()
    .from(engagements)
    .where(
      and(
        eq(engagements.firmId, ctx.firmId),
        eq(engagements.status, "active"),
        lte(engagements.nextBillingDate, today)
      )
    );
  const created: ServiceInvoice[] = [];
  for (const eng of due) {
    const fee = Number(eng.monthlyFee ?? 0);
    if (!(fee > 0) || !eng.nextBillingDate) continue;
    const sourceKey = `recurring:${eng.id}:${eng.nextBillingDate}`;
    const invoice = await db.transaction(async (tx: typeof db) => {
      const [dup] = await tx
        .select({ id: serviceInvoices.id })
        .from(serviceInvoices)
        .where(
          and(eq(serviceInvoices.firmId, ctx.firmId), eq(serviceInvoices.sourceKey, sourceKey))
        )
        .limit(1);
      if (dup) return null;
      const periodStart = new Date(`${eng.nextBillingDate}T00:00:00Z`);
      const next = advance(eng.nextBillingDate!, eng.billingCycle);
      const periodEnd = new Date(`${next}T00:00:00Z`);
      periodEnd.setUTCDate(periodEnd.getUTCDate() - 1);
      const feeFils = toFils(fee);
      const inv = await insertServiceInvoice(tx, {
        firmId: ctx.firmId,
        companyId: eng.companyId,
        engagementId: eng.id,
        actorId: ctx.userId ?? null,
        source: "recurring",
        sourceKey,
        description: `Recurring ${eng.billingCycle ?? "monthly"} engagement fee`,
        periodStart,
        periodEnd,
        lines: [
          {
            description: `Engagement fee ${eng.nextBillingDate} to ${periodEnd.toISOString().slice(0, 10)}`,
            quantity: 1,
            unitPriceFils: feeFils,
            amountFils: feeFils,
          },
        ],
        invoiceDate: asOf,
        paymentTermsDays: eng.paymentTerms ?? 30,
      });
      await tx
        .update(engagements)
        .set({ nextBillingDate: next, updatedAt: new Date() })
        .where(eq(engagements.id, eng.id));
      return inv;
    });
    if (invoice) created.push(invoice);
  }
  return { created: created.length, invoices: created };
}

export async function listServiceInvoices(ctx: FirmContext, companyIds: string[]) {
  if (companyIds.length === 0) return [];
  return db
    .select()
    .from(serviceInvoices)
    .where(
      and(eq(serviceInvoices.firmId, ctx.firmId), inArray(serviceInvoices.companyId, companyIds))
    )
    .orderBy(desc(serviceInvoices.invoiceDate));
}
