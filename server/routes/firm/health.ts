// Firm portfolio health handlers: client health, upcoming deadlines and the practice overview.
// Handlers moved from firm.routes.ts (R20-09); the route registrations (paths and
// middleware order) stay in firm.routes.ts.
import type { Request, Response } from "express";
import { and, count, eq, inArray, lt, lte, max, sql } from "drizzle-orm";
import {
  bankTransactions,
  companies,
  invoices,
  receipts,
  vatReturns,
} from "../../../shared/schema";
import { firmReceivablesAed, sumReceivables } from "../../services/firm/receivables.service";
import { buildBookkeeperDashboard } from "./bookkeeper-dashboard";
import {
  activeVatReturnFilter,
  vatFilingOutstandingFilter,
  vatFilingRecordedFilter,
} from "../../tax/vat-filing-filter";
import { db } from "../../db";
import { aed, ledgerBalanceCheckByCompany } from "../../reporting";
import { getAccessibleCompanyIds } from "../../middleware/rbac";
import {
  type DeadlineStatus,
  type HealthStatus,
  daysSince,
  daysUntil,
  deadlineStatus,
  emptyHealthPayload,
  maxHealthStatus,
  mostRecentDate,
  vatHealthFromReturn,
  vatStatusToHealth,
} from "./shared";

/** GET /firm/health */
export const handleGetFirmHealth = async (req: Request, res: Response) => {
  const { id: userId, firmRole } = req.user!;
  const accessibleIds = await getAccessibleCompanyIds(
    userId,
    firmRole ?? "",
    req.user?.isAdmin === true
  );

  let clientList: {
    id: string;
    name: string;
    trnVatNumber: string | null;
    createdAt: Date;
  }[];
  if (accessibleIds === null) {
    clientList = await db
      .select({
        id: companies.id,
        name: companies.name,
        trnVatNumber: companies.trnVatNumber,
        createdAt: companies.createdAt,
      })
      .from(companies)
      .where(and(eq(companies.companyType, "client"), sql`${companies.deletedAt} IS NULL`));
  } else if (accessibleIds.length === 0) {
    return res.json(emptyHealthPayload());
  } else {
    clientList = await db
      .select({
        id: companies.id,
        name: companies.name,
        trnVatNumber: companies.trnVatNumber,
        createdAt: companies.createdAt,
      })
      .from(companies)
      .where(and(inArray(companies.id, accessibleIds), sql`${companies.deletedAt} IS NULL`));
  }

  const clientIds = clientList.map((c: { id: string }) => c.id);
  if (clientIds.length === 0) return res.json(emptyHealthPayload());

  const now = new Date();

  // Latest VAT return per company (subquery join)
  const latestVatSub = db
    .select({
      companyId: vatReturns.companyId,
      maxPeriodEnd: max(vatReturns.periodEnd).as("max_period_end"),
    })
    .from(vatReturns)
    .where(and(inArray(vatReturns.companyId, clientIds), activeVatReturnFilter))
    .groupBy(vatReturns.companyId)
    .as("latest_vat");

  const vatRows = await db
    .select({
      companyId: vatReturns.companyId,
      status: vatReturns.status,
      ftaReferenceNumber: vatReturns.ftaReferenceNumber,
      dueDate: vatReturns.dueDate,
      periodEnd: vatReturns.periodEnd,
      submittedAt: vatReturns.submittedAt,
      updatedAt: vatReturns.updatedAt,
    })
    .from(vatReturns)
    .innerJoin(
      latestVatSub,
      and(
        eq(vatReturns.companyId, latestVatSub.companyId),
        eq(vatReturns.periodEnd, latestVatSub.maxPeriodEnd),
        activeVatReturnFilter
      )
    );

  type LastFiledVatRow = { companyId: string; lastFiledDate: Date | null };
  const lastFiledVatRows: LastFiledVatRow[] = (await db
    .select({
      companyId: vatReturns.companyId,
      lastFiledDate: sql<Date | null>`max(coalesce(${vatReturns.submittedAt}, ${vatReturns.updatedAt}))`,
    })
    .from(vatReturns)
    .where(and(inArray(vatReturns.companyId, clientIds), vatFilingRecordedFilter))
    .groupBy(vatReturns.companyId)) as LastFiledVatRow[];

  // AR health per company: total open AR plus overdue count/value.
  type ArBucketRow = {
    companyId: string;
    totalOutstanding: string | null;
    overdueAmount: string | null;
    overdueCount: string | null;
  };
  const arRows: ArBucketRow[] = (await db
    .select({
      companyId: invoices.companyId,
      totalOutstanding: sql<string>`sum(case when ${invoices.status} in ('sent', 'partial') then ${invoices.total} else 0 end)`,
      overdueAmount: sql<string>`sum(case when ${invoices.status} in ('sent', 'partial') and ${invoices.dueDate} < ${now} then ${invoices.total} else 0 end)`,
      overdueCount: sql<string>`count(*) filter (where ${invoices.status} in ('sent', 'partial') and ${invoices.dueDate} < ${now})`,
    })
    .from(invoices)
    .where(inArray(invoices.companyId, clientIds))
    .groupBy(invoices.companyId)) as ArBucketRow[];

  // Bank reconciliation health per company.
  type BankRow = {
    companyId: string;
    total: number;
    unreconciled: string | null;
    lastBankDate: Date | null;
    lastReconciledDate: Date | null;
  };
  const bankRows: BankRow[] = (await db
    .select({
      companyId: bankTransactions.companyId,
      total: count(),
      unreconciled: sql<string>`sum(case when ${bankTransactions.isReconciled} then 0 else 1 end)`,
      lastBankDate: max(bankTransactions.transactionDate),
      lastReconciledDate: sql<Date | null>`max(case when ${bankTransactions.isReconciled} then ${bankTransactions.transactionDate} else null end)`,
    })
    .from(bankTransactions)
    .where(inArray(bankTransactions.companyId, clientIds))
    .groupBy(bankTransactions.companyId)) as BankRow[];

  const trialBalanceMap = await ledgerBalanceCheckByCompany(clientIds);

  type InvoiceActivityRow = { companyId: string; lastInvoiceActivity: Date | null };
  const invoiceActivityRows: InvoiceActivityRow[] = (await db
    .select({ companyId: invoices.companyId, lastInvoiceActivity: max(invoices.createdAt) })
    .from(invoices)
    .where(inArray(invoices.companyId, clientIds))
    .groupBy(invoices.companyId)) as InvoiceActivityRow[];

  type ReceiptActivityRow = { companyId: string; lastReceiptActivity: Date | null };
  const receiptActivityRows: ReceiptActivityRow[] = (await db
    .select({ companyId: receipts.companyId, lastReceiptActivity: max(receipts.createdAt) })
    .from(receipts)
    .where(inArray(receipts.companyId, clientIds))
    .groupBy(receipts.companyId)) as ReceiptActivityRow[];

  // Build lookup maps
  type VatRow = {
    companyId: string;
    status: string;
    ftaReferenceNumber: string | null;
    dueDate: Date;
    periodEnd: Date;
    submittedAt: Date | null;
    updatedAt: Date | null;
  };
  const vatMap = new Map<string, VatRow>(vatRows.map((r: VatRow) => [r.companyId, r]));
  const lastFiledVatMap = new Map<string, LastFiledVatRow>(
    lastFiledVatRows.map((r: LastFiledVatRow) => [r.companyId, r])
  );
  const arMap = new Map<string, ArBucketRow>(arRows.map((r: ArBucketRow) => [r.companyId, r]));
  const bankMap = new Map<string, BankRow>(bankRows.map((r: BankRow) => [r.companyId, r]));
  const invoiceActivityMap = new Map<string, InvoiceActivityRow>(
    invoiceActivityRows.map((r: InvoiceActivityRow) => [r.companyId, r])
  );
  const receiptActivityMap = new Map<string, ReceiptActivityRow>(
    receiptActivityRows.map((r: ReceiptActivityRow) => [r.companyId, r])
  );

  const clients = clientList.map((company) => {
    const vat = vatMap.get(company.id) ?? null;
    const lastFiledVat = lastFiledVatMap.get(company.id)?.lastFiledDate ?? null;
    const vatStatus = vatHealthFromReturn(vat, now);
    const vatHealth = vatStatusToHealth(vatStatus);

    const ar = arMap.get(company.id);
    const totalOutstanding = Number(ar?.totalOutstanding ?? 0);
    const overdueAmount = Number(ar?.overdueAmount ?? 0);
    const overdueCount = Number(ar?.overdueCount ?? 0);
    const arStatus: HealthStatus =
      overdueAmount > 0 ? "critical" : totalOutstanding > 0 ? "attention" : "healthy";

    const bank = bankMap.get(company.id);
    const unreconciledCount = Number(bank?.unreconciled ?? 0);
    const bankRecStatus: HealthStatus =
      unreconciledCount > 10 ? "critical" : unreconciledCount > 0 ? "attention" : "healthy";

    const trialBalance = trialBalanceMap.get(company.id);
    const discrepancy = aed(trialBalance?.differenceFils ?? 0);
    const trialBalanceStatus: HealthStatus = discrepancy > 0.01 ? "critical" : "healthy";

    const lastActivity = mostRecentDate(
      bank?.lastBankDate,
      trialBalance?.lastJournalAt,
      invoiceActivityMap.get(company.id)?.lastInvoiceActivity,
      receiptActivityMap.get(company.id)?.lastReceiptActivity,
      vat?.updatedAt,
      company.createdAt
    );

    return {
      companyId: company.id,
      companyName: company.name,
      trn: company.trnVatNumber,
      vatStatus: {
        nextDueDate: vat?.dueDate ?? null,
        daysTilDue: daysUntil(vat?.dueDate, now),
        lastFiledDate: lastFiledVat,
        status: vatStatus,
      },
      arHealth: {
        totalOutstanding,
        overdueAmount,
        overdueCount,
        status: arStatus,
      },
      bankRecStatus: {
        lastRecDate: bank?.lastReconciledDate ?? null,
        daysSinceRec: daysSince(bank?.lastReconciledDate, now),
        unreconciledCount,
        status: bankRecStatus,
      },
      trialBalanceStatus: {
        balanced: discrepancy <= 0.01,
        discrepancy,
        status: trialBalanceStatus,
      },
      lastActivity,
      overallHealth: maxHealthStatus(vatHealth, arStatus, bankRecStatus, trialBalanceStatus),
    };
  });

  const summary = clients.reduce(
    (acc, client) => {
      acc.totalClients += 1;
      acc[client.overallHealth] += 1;
      return acc;
    },
    { totalClients: 0, healthy: 0, attention: 0, critical: 0 }
  );

  res.json({ clients, summary });
};

/** GET /firm/health/deadlines */
export const handleGetFirmHealthDeadlines = async (req: Request, res: Response) => {
  const { id: userId, firmRole } = req.user!;
  const accessibleIds = await getAccessibleCompanyIds(
    userId,
    firmRole ?? "",
    req.user?.isAdmin === true
  );

  if (accessibleIds !== null && accessibleIds.length === 0) {
    return res.json({ deadlines: [] });
  }

  const now = new Date();
  const ninetyDaysOut = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const whereClause = and(
    vatFilingOutstandingFilter,
    lte(vatReturns.dueDate, ninetyDaysOut),
    ...(accessibleIds !== null ? [inArray(vatReturns.companyId, accessibleIds)] : [])
  );

  type DeadlineRow = {
    companyId: string;
    companyName: string;
    vatReturnId: string;
    type: "vat";
    status: DeadlineStatus;
    dueDate: Date;
    periodEnd: Date;
    daysTilDue: number;
  };

  const rows = await db
    .select({
      companyId: vatReturns.companyId,
      companyName: companies.name,
      vatReturnId: vatReturns.id,
      dueDate: vatReturns.dueDate,
      periodEnd: vatReturns.periodEnd,
    })
    .from(vatReturns)
    .innerJoin(companies, eq(companies.id, vatReturns.companyId))
    .where(
      and(
        whereClause,
        accessibleIds === null ? eq(companies.companyType, "client") : undefined,
        sql`${companies.deletedAt} IS NULL`
      )
    )
    .orderBy(vatReturns.dueDate);

  const deadlines: DeadlineRow[] = rows.map(
    (r: {
      companyId: string;
      companyName: string;
      vatReturnId: string;
      dueDate: Date;
      periodEnd: Date;
    }) => {
      const daysTilDue = daysUntil(r.dueDate, now) ?? 0;
      return {
        companyId: r.companyId,
        companyName: r.companyName,
        vatReturnId: r.vatReturnId,
        type: "vat",
        status: deadlineStatus(daysTilDue),
        dueDate: r.dueDate,
        periodEnd: r.periodEnd,
        daysTilDue,
      };
    }
  );

  res.json({ deadlines });
};

/** GET /firm/overview */
export const handleGetFirmOverview = async (req: Request, res: Response) => {
  const { id: userId, firmRole } = req.user!;
  const accessibleIds = await getAccessibleCompanyIds(
    userId,
    firmRole ?? "",
    req.user?.isAdmin === true
  );

  let clientIds: string[];
  if (accessibleIds === null) {
    const all = await db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.companyType, "client"), sql`${companies.deletedAt} IS NULL`));
    clientIds = all.map((c: { id: string }) => c.id);
  } else {
    clientIds = accessibleIds;
  }

  if (clientIds.length === 0) {
    return res.json({
      totalClients: 0,
      vatDueThisMonth: 0,
      overdueAr: 0,
      needsAttention: 0,
      missingDocuments: 0,
    });
  }

  const now = new Date();

  const [dashboard, receivables, missingDocsRow] = await Promise.all([
    // One VAT-due definition: the same cohort deadlines the portfolio "VAT due soon" filter uses.
    buildBookkeeperDashboard(userId, firmRole ?? "", req.user?.isAdmin === true),
    // Overdue A/R from the settlement rule, in AED (partial payments, credit notes, FX).
    firmReceivablesAed(clientIds),
    // Clients without ANY invoices yet — proxy for "missing docs"
    db
      .select({ companyId: invoices.companyId })
      .from(invoices)
      .where(inArray(invoices.companyId, clientIds))
      .groupBy(invoices.companyId)
      .then((rows: { companyId: string }[]) => rows.map((r) => r.companyId)),
  ]);

  const clientsWithInvoices = new Set(missingDocsRow as string[]);
  const missingDocuments = clientIds.filter((id) => !clientsWithInvoices.has(id)).length;

  const overdueAr = sumReceivables(receivables).overdue;
  const vatDueThisMonth = dashboard.summary.vatDue28Days;

  // "Needs attention" combines overdue VAT + clients with overdue AR
  const overdueArCompanies = [...receivables.values()]
    .filter((r) => r.overdueCount > 0)
    .map((r) => ({ companyId: r.companyId }));

  const overdueVatCompanies = await db
    .select({ companyId: vatReturns.companyId })
    .from(vatReturns)
    .where(
      and(
        inArray(vatReturns.companyId, clientIds),
        vatFilingOutstandingFilter,
        lt(vatReturns.dueDate, now)
      )
    )
    .groupBy(vatReturns.companyId);

  const attention = new Set<string>();
  for (const r of overdueArCompanies as { companyId: string }[]) attention.add(r.companyId);
  for (const r of overdueVatCompanies as { companyId: string }[]) attention.add(r.companyId);

  res.json({
    totalClients: clientIds.length,
    vatDueThisMonth,
    overdueAr,
    needsAttention: attention.size,
    missingDocuments,
  });
};
