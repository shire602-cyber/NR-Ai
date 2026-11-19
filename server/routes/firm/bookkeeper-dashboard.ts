// Firm bookkeeper dashboard handler: per-client work queues, deadlines and intervention scoring.
// Handlers moved from firm.routes.ts (R20-09); the route registrations (paths and
// middleware order) stay in firm.routes.ts.
import { CLIENT_SERVICE_OPTIONS } from "@shared/client-services";
import type { Request, Response } from "express";
import {
  type VatCohort,
  type VatCohortKey,
  currentVatPeriodForCompany,
  nextCorporateTaxFilingWindow,
  resolveNrClientVatPeriodStartMonth,
  vatCohortFromPeriodStart,
} from "../../services/firm-clients.service";
import { and, count, eq, inArray, max, sql } from "drizzle-orm";
import {
  bankTransactions,
  companies,
  corporateTaxReturns,
  invoices,
  receipts,
  vatReturns,
} from "../../../shared/schema";
import { firmReceivablesAed } from "../../services/firm/receivables.service";
import { db } from "../../db";
import { aed, ledgerBalanceCheckByCompany } from "../../reporting";
import { getAccessibleCompanyIds } from "../../middleware/rbac";
import {
  type BookkeeperPriority,
  STANDARD_VAT_COHORTS,
  buildBookkeeperIntervention,
  daysSince,
  daysUntil,
  emptyBookkeeperDashboard,
  loadActiveServicePlans,
  maxPriority,
  mostRecentDate,
  priorityFromDueDays,
  priorityRank,
  assignedStaffByCompany,
  servicePlanFromEngagement,
  shortIso,
  sortBookkeeperQueue,
} from "./shared";

/** GET /firm/bookkeeper-dashboard */
export const handleGetFirmBookkeeperDashboard = async (req: Request, res: Response) => {
  const { id: userId, firmRole } = req.user!;
  res.json(await buildBookkeeperDashboard(userId, firmRole ?? "", req.user?.isAdmin === true));
};

/**
 * The bookkeeper dashboard for the clients this user may see. The firm overview reads its
 * summary (`vatDue28Days`) so the VAT-due count has one definition on every firm screen.
 */
export async function buildBookkeeperDashboard(userId: string, firmRole: string, isAdmin: boolean) {
  const accessibleIds = await getAccessibleCompanyIds(userId, firmRole, isAdmin);

  type BookkeeperClientRow = {
    id: string;
    name: string;
    trnVatNumber: string | null;
    vatFilingFrequency: string | null;
    vatPeriodStartMonth: number;
    fiscalYearStartMonth: number;
    corporateTaxId: string | null;
    createdAt: Date;
  };

  let clientList: BookkeeperClientRow[];
  if (accessibleIds === null) {
    clientList = await db
      .select({
        id: companies.id,
        name: companies.name,
        trnVatNumber: companies.trnVatNumber,
        vatFilingFrequency: companies.vatFilingFrequency,
        vatPeriodStartMonth: companies.vatPeriodStartMonth,
        fiscalYearStartMonth: companies.fiscalYearStartMonth,
        corporateTaxId: companies.corporateTaxId,
        createdAt: companies.createdAt,
      })
      .from(companies)
      .where(and(eq(companies.companyType, "client"), sql`${companies.deletedAt} IS NULL`));
  } else if (accessibleIds.length === 0) {
    return emptyBookkeeperDashboard();
  } else {
    clientList = await db
      .select({
        id: companies.id,
        name: companies.name,
        trnVatNumber: companies.trnVatNumber,
        vatFilingFrequency: companies.vatFilingFrequency,
        vatPeriodStartMonth: companies.vatPeriodStartMonth,
        fiscalYearStartMonth: companies.fiscalYearStartMonth,
        corporateTaxId: companies.corporateTaxId,
        createdAt: companies.createdAt,
      })
      .from(companies)
      .where(and(inArray(companies.id, accessibleIds), sql`${companies.deletedAt} IS NULL`));
  }

  const clientIds = clientList.map((client) => client.id);
  if (clientIds.length === 0) return emptyBookkeeperDashboard();
  const servicePlans = await loadActiveServicePlans(clientIds);

  const now = new Date();

  const latestVatSub = db
    .select({
      companyId: vatReturns.companyId,
      maxPeriodEnd: max(vatReturns.periodEnd).as("max_period_end"),
    })
    .from(vatReturns)
    .where(inArray(vatReturns.companyId, clientIds))
    .groupBy(vatReturns.companyId)
    .as("latest_vat_for_bookkeeper");

  const latestCorporateTaxSub = db
    .select({
      companyId: corporateTaxReturns.companyId,
      maxPeriodEnd: max(corporateTaxReturns.taxPeriodEnd).as("max_period_end"),
    })
    .from(corporateTaxReturns)
    .where(inArray(corporateTaxReturns.companyId, clientIds))
    .groupBy(corporateTaxReturns.companyId)
    .as("latest_ct_for_bookkeeper");

  type VatRow = {
    companyId: string;
    periodStart: Date;
    periodEnd: Date;
    dueDate: Date;
    status: string;
    payableTax: number;
    submittedAt: Date | null;
    updatedAt: Date | null;
  };
  type CorporateTaxRow = {
    companyId: string;
    taxPeriodStart: Date;
    taxPeriodEnd: Date;
    status: string;
    taxPayable: number;
    filedAt: Date | null;
  };
  type InvoiceOpsRow = {
    companyId: string;
    invoiceCount: number;
    missingCustomerTrnCount: string | null;
    latestInvoiceDate: Date | null;
  };
  type ReceiptOpsRow = {
    companyId: string;
    receiptCount: number;
    unpostedCount: string | null;
    latestReceiptDate: Date | null;
  };
  type BankOpsRow = {
    companyId: string;
    bankCount: number;
    unreconciledCount: string | null;
    latestBankDate: Date | null;
  };

  const [
    vatRows,
    corporateTaxRows,
    invoiceRows,
    receiptRows,
    bankRows,
    trialBalanceMap,
    staffByCompany,
    receivableMap,
  ] = await Promise.all([
    db
      .select({
        companyId: vatReturns.companyId,
        periodStart: vatReturns.periodStart,
        periodEnd: vatReturns.periodEnd,
        dueDate: vatReturns.dueDate,
        status: vatReturns.status,
        payableTax: vatReturns.box14PayableTax,
        submittedAt: vatReturns.submittedAt,
        updatedAt: vatReturns.updatedAt,
      })
      .from(vatReturns)
      .innerJoin(
        latestVatSub,
        and(
          eq(vatReturns.companyId, latestVatSub.companyId),
          eq(vatReturns.periodEnd, latestVatSub.maxPeriodEnd)
        )
      ) as Promise<VatRow[]>,
    db
      .select({
        companyId: corporateTaxReturns.companyId,
        taxPeriodStart: corporateTaxReturns.taxPeriodStart,
        taxPeriodEnd: corporateTaxReturns.taxPeriodEnd,
        status: corporateTaxReturns.status,
        taxPayable: corporateTaxReturns.taxPayable,
        filedAt: corporateTaxReturns.filedAt,
      })
      .from(corporateTaxReturns)
      .innerJoin(
        latestCorporateTaxSub,
        and(
          eq(corporateTaxReturns.companyId, latestCorporateTaxSub.companyId),
          eq(corporateTaxReturns.taxPeriodEnd, latestCorporateTaxSub.maxPeriodEnd)
        )
      ) as Promise<CorporateTaxRow[]>,
    db
      .select({
        companyId: invoices.companyId,
        invoiceCount: count(),
        missingCustomerTrnCount: sql<string>`count(*) filter (where ${invoices.vatAmount} > 0 and (${invoices.customerTrn} is null or ${invoices.customerTrn} = ''))`,
        latestInvoiceDate: max(invoices.createdAt),
      })
      .from(invoices)
      .where(inArray(invoices.companyId, clientIds))
      .groupBy(invoices.companyId) as Promise<InvoiceOpsRow[]>,
    db
      .select({
        companyId: receipts.companyId,
        receiptCount: count(),
        unpostedCount: sql<string>`count(*) filter (where ${receipts.posted} = false)`,
        latestReceiptDate: max(receipts.createdAt),
      })
      .from(receipts)
      .where(inArray(receipts.companyId, clientIds))
      .groupBy(receipts.companyId) as Promise<ReceiptOpsRow[]>,
    db
      .select({
        companyId: bankTransactions.companyId,
        bankCount: count(),
        unreconciledCount: sql<string>`count(*) filter (where ${bankTransactions.isReconciled} = false)`,
        latestBankDate: max(bankTransactions.transactionDate),
      })
      .from(bankTransactions)
      .where(inArray(bankTransactions.companyId, clientIds))
      .groupBy(bankTransactions.companyId) as Promise<BankOpsRow[]>,
    ledgerBalanceCheckByCompany(clientIds),
    assignedStaffByCompany(clientIds),
    firmReceivablesAed(clientIds),
  ]);

  const vatMap = new Map<string, VatRow>(vatRows.map((row) => [row.companyId, row]));
  const corporateTaxMap = new Map<string, CorporateTaxRow>(
    corporateTaxRows.map((row) => [row.companyId, row])
  );
  const invoiceMap = new Map<string, InvoiceOpsRow>(invoiceRows.map((row) => [row.companyId, row]));
  const receiptMap = new Map<string, ReceiptOpsRow>(receiptRows.map((row) => [row.companyId, row]));
  const bankMap = new Map<string, BankOpsRow>(bankRows.map((row) => [row.companyId, row]));
  const staffMap = staffByCompany;

  const clients = clientList.map((company) => {
    const servicePlan = servicePlans.get(company.id) ?? servicePlanFromEngagement(undefined);
    const services = servicePlan.servicesIncluded;
    const hasVatService = services.includes("vat");
    const hasCorporateTaxService = services.includes("corporate_tax");
    const hasBookkeepingService = services.includes("bookkeeping");
    const hasAccountingService = services.includes("accounting");
    const vatPeriodStartMonth = resolveNrClientVatPeriodStartMonth(
      company.name,
      company.vatPeriodStartMonth,
      "client"
    );
    const vatCohort = vatCohortFromPeriodStart(vatPeriodStartMonth, company.vatFilingFrequency);
    const plannedVat = currentVatPeriodForCompany(
      now,
      vatPeriodStartMonth,
      company.vatFilingFrequency
    );
    const latestVat = vatMap.get(company.id) ?? null;
    const latestVatIsOpen =
      latestVat &&
      latestVat.status !== "filed" &&
      latestVat.status !== "submitted" &&
      new Date(latestVat.dueDate) <= plannedVat.dueDate;
    const vatWindow = latestVatIsOpen ? latestVat : plannedVat;
    const vatDueDate = latestVatIsOpen ? latestVat.dueDate : plannedVat.dueDate;
    const vatDaysTilDue = daysUntil(vatDueDate, now);

    const invoiceOps = invoiceMap.get(company.id);
    const receiptOps = receiptMap.get(company.id);
    const bankOps = bankMap.get(company.id);
    const trialBalance = trialBalanceMap.get(company.id);
    const assignedStaff = staffMap.get(company.id) ?? [];

    const missingCustomerTrnCount = Number(invoiceOps?.missingCustomerTrnCount ?? 0);
    const unpostedReceiptCount = Number(receiptOps?.unpostedCount ?? 0);
    const unreconciledBankCount = Number(bankOps?.unreconciledCount ?? 0);
    const overdueInvoiceCount = receivableMap.get(company.id)?.overdueCount ?? 0;
    const totalInvoices = Number(invoiceOps?.invoiceCount ?? 0);
    const totalReceipts = Number(receiptOps?.receiptCount ?? 0);
    const totalBankLines = Number(bankOps?.bankCount ?? 0);
    const openAr = receivableMap.get(company.id)?.open ?? 0;

    const discrepancy = aed(trialBalance?.differenceFils ?? 0);

    const lastActivity = mostRecentDate(
      invoiceOps?.latestInvoiceDate,
      receiptOps?.latestReceiptDate,
      bankOps?.latestBankDate,
      trialBalance?.lastJournalAt,
      latestVat?.updatedAt,
      company.createdAt
    );
    const daysSinceActivity = daysSince(lastActivity, now);
    const noOperatingDocs = totalInvoices === 0 && totalReceipts === 0 && totalBankLines === 0;

    const vatBlockers: string[] = [];
    if (!company.trnVatNumber) vatBlockers.push("Missing VAT TRN");
    if (missingCustomerTrnCount > 0)
      vatBlockers.push(`${missingCustomerTrnCount} taxable invoices missing customer TRN`);
    if (unpostedReceiptCount > 0) vatBlockers.push(`${unpostedReceiptCount} receipts not posted`);
    if (unreconciledBankCount > 0)
      vatBlockers.push(`${unreconciledBankCount} bank lines unreconciled`);
    if (latestVatIsOpen && latestVat.status === "pending_review")
      vatBlockers.push("VAT return pending review");

    const vatFiled =
      latestVat &&
      (latestVat.status === "filed" || latestVat.status === "submitted") &&
      new Date(latestVat.periodEnd) >= plannedVat.periodEnd;
    const vatPriority = !hasVatService
      ? "on_track"
      : vatFiled
        ? "on_track"
        : maxPriority(
            priorityFromDueDays(vatDaysTilDue, 28, 0),
            vatBlockers.length > 0 ? "attention" : "on_track"
          );

    const ctWindow = nextCorporateTaxFilingWindow(now, company.fiscalYearStartMonth);
    const latestCorporateTax = corporateTaxMap.get(company.id) ?? null;
    const ctFiled =
      latestCorporateTax &&
      (latestCorporateTax.status === "filed" || latestCorporateTax.status === "paid") &&
      new Date(latestCorporateTax.taxPeriodEnd) >= ctWindow.periodEnd;
    const ctDaysTilDue = daysUntil(ctWindow.dueDate, now);
    const ctBlockers: string[] = [];
    if (!company.corporateTaxId) ctBlockers.push("Missing corporate tax registration");
    if (discrepancy > 0.01) ctBlockers.push("Trial balance not balanced");
    if (unpostedReceiptCount > 0) ctBlockers.push("Expense receipts not posted");
    if (unreconciledBankCount > 0) ctBlockers.push("Bank reconciliation incomplete");
    const ctPriority = !hasCorporateTaxService
      ? "on_track"
      : ctFiled
        ? "on_track"
        : maxPriority(
            priorityFromDueDays(ctDaysTilDue, 90, 0),
            ctBlockers.length > 0 && ctDaysTilDue !== null && ctDaysTilDue <= 180
              ? "attention"
              : "on_track"
          );

    const bookkeepingBlockers: string[] = [];
    if (noOperatingDocs) bookkeepingBlockers.push("No operating documents loaded");
    if (unpostedReceiptCount > 0)
      bookkeepingBlockers.push(`${unpostedReceiptCount} unposted receipts`);
    if (unreconciledBankCount > 0)
      bookkeepingBlockers.push(`${unreconciledBankCount} unreconciled bank lines`);
    if (overdueInvoiceCount > 0)
      bookkeepingBlockers.push(`${overdueInvoiceCount} overdue invoices`);
    if (daysSinceActivity !== null && daysSinceActivity > 30)
      bookkeepingBlockers.push("No activity in 30+ days");
    const closeProgress = Math.max(
      0,
      Math.min(
        100,
        100 -
          Math.min(35, unreconciledBankCount * 3) -
          Math.min(25, unpostedReceiptCount * 5) -
          Math.min(20, missingCustomerTrnCount * 4) -
          (noOperatingDocs ? 35 : 0) -
          (daysSinceActivity !== null && daysSinceActivity > 30 ? 15 : 0)
      )
    );
    const bookkeepingPriority: BookkeeperPriority = !hasBookkeepingService
      ? "on_track"
      : noOperatingDocs || unreconciledBankCount > 25 || unpostedReceiptCount > 15
        ? "critical"
        : bookkeepingBlockers.length > 0
          ? "attention"
          : "on_track";

    const accountingBlockers: string[] = [];
    if (discrepancy > 0.01)
      accountingBlockers.push(`Trial balance off by AED ${discrepancy.toFixed(2)}`);
    if (!trialBalance) accountingBlockers.push("No posted journals");
    const accountingPriority: BookkeeperPriority = !hasAccountingService
      ? "on_track"
      : discrepancy > 0.01
        ? "critical"
        : accountingBlockers.length > 0
          ? "attention"
          : "on_track";

    const priority = maxPriority(vatPriority, ctPriority, bookkeepingPriority, accountingPriority);
    const nextBestAction =
      vatPriority === "critical"
        ? "Clear VAT filing blockers"
        : ctPriority === "critical"
          ? "Prepare corporate tax filing"
          : bookkeepingPriority === "critical"
            ? "Load and reconcile source documents"
            : accountingPriority === "critical"
              ? "Fix trial balance discrepancy"
              : vatPriority === "attention"
                ? "Prepare upcoming VAT return"
                : ctPriority === "attention"
                  ? "Review corporate tax readiness"
                  : bookkeepingPriority === "attention"
                    ? "Finish monthly close"
                    : accountingPriority === "attention"
                      ? "Post journal activity"
                      : "Ready for review";
    const intervention = buildBookkeeperIntervention({
      priority,
      nextBestAction,
      assignedStaffCount: assignedStaff.length,
      vatDaysTilDue,
      ctDaysTilDue,
      vatBlockers,
      ctBlockers,
      bookkeepingBlockers,
      accountingBlockers,
      closeProgress,
      openAr,
      overdueInvoiceCount,
      missingCustomerTrnCount,
      unpostedReceiptCount,
      unreconciledBankCount,
      daysSinceActivity,
      noOperatingDocs,
      discrepancy,
    });

    return {
      companyId: company.id,
      companyName: company.name,
      trn: company.trnVatNumber,
      serviceScope: services,
      servicePlan,
      assignedStaff: assignedStaff.map((staff) => ({
        id: staff.id,
        name: staff.name,
        email: staff.email,
        role: staff.role,
      })),
      priority,
      nextBestAction,
      intervention,
      lastActivity: shortIso(lastActivity),
      vat: {
        cohortKey: vatCohort.key,
        cohortLabel: vatCohort.label,
        closeMonths: vatCohort.closeMonths,
        periodStart: shortIso(
          "periodStart" in vatWindow ? vatWindow.periodStart : plannedVat.periodStart
        ),
        periodEnd: shortIso("periodEnd" in vatWindow ? vatWindow.periodEnd : plannedVat.periodEnd),
        dueDate: shortIso(vatDueDate),
        daysTilDue: vatDaysTilDue,
        status: vatFiled ? "filed" : vatPriority,
        payableTax: latestVat ? Number(latestVat.payableTax ?? 0) : null,
        blockers: hasVatService ? vatBlockers : [],
      },
      corporateTax: {
        periodStart: shortIso(ctWindow.periodStart),
        periodEnd: shortIso(ctWindow.periodEnd),
        dueDate: shortIso(ctWindow.dueDate),
        daysTilDue: ctDaysTilDue,
        status: ctFiled ? "filed" : ctPriority,
        taxPayable: latestCorporateTax ? Number(latestCorporateTax.taxPayable ?? 0) : null,
        blockers: hasCorporateTaxService ? ctBlockers : [],
      },
      bookkeeping: {
        closeProgress,
        status: bookkeepingPriority,
        blockers: hasBookkeepingService ? bookkeepingBlockers : [],
        openAr,
        overdueInvoiceCount,
        missingCustomerTrnCount,
        unpostedReceiptCount,
        unreconciledBankCount,
        daysSinceActivity,
      },
      accounting: {
        status: accountingPriority,
        trialBalanceBalanced: discrepancy <= 0.01,
        discrepancy,
        blockers: hasAccountingService ? accountingBlockers : [],
      },
    };
  });

  const summary = clients.reduce(
    (acc, client) => {
      acc.totalClients += 1;
      if (client.priority === "critical") acc.critical += 1;
      else if (client.priority === "attention") acc.attention += 1;
      else acc.onTrack += 1;
      if (
        client.serviceScope.includes("vat") &&
        client.vat.status !== "filed" &&
        client.vat.daysTilDue !== null &&
        client.vat.daysTilDue <= 28
      ) {
        acc.vatDue28Days += 1;
      }
      if (
        client.serviceScope.includes("corporate_tax") &&
        client.corporateTax.status !== "filed" &&
        client.corporateTax.daysTilDue !== null &&
        client.corporateTax.daysTilDue <= 90
      ) {
        acc.corporateTaxDue90Days += 1;
      }
      if (client.serviceScope.includes("bookkeeping") && client.bookkeeping.status !== "on_track")
        acc.bookkeepingBlocked += 1;
      if (client.intervention.level === "high") acc.interventionHigh += 1;
      if (client.intervention.level === "medium") acc.interventionMedium += 1;
      return acc;
    },
    {
      totalClients: 0,
      critical: 0,
      attention: 0,
      onTrack: 0,
      vatDue28Days: 0,
      corporateTaxDue90Days: 0,
      bookkeepingBlocked: 0,
      interventionHigh: 0,
      interventionMedium: 0,
    }
  );

  const cohortMap = new Map<VatCohortKey, VatCohort>();
  for (const cohort of STANDARD_VAT_COHORTS) cohortMap.set(cohort.key, cohort);
  for (const client of clients.filter((client) => client.serviceScope.includes("vat"))) {
    if (!cohortMap.has(client.vat.cohortKey as VatCohortKey)) {
      cohortMap.set(client.vat.cohortKey as VatCohortKey, {
        key: client.vat.cohortKey as VatCohortKey,
        label: client.vat.cohortLabel,
        closeMonths: client.vat.closeMonths,
        closeMonthLabels: client.vat.closeMonths.map((month) =>
          new Intl.DateTimeFormat("en", { month: "short" }).format(
            new Date(Date.UTC(2026, month - 1, 1))
          )
        ),
      });
    }
  }

  const vatCohorts = Array.from(cohortMap.values()).map((cohort) => {
    const cohortClients = clients
      .filter(
        (client) => client.serviceScope.includes("vat") && client.vat.cohortKey === cohort.key
      )
      .sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority));
    return {
      key: cohort.key,
      label: cohort.label,
      closeMonths: cohort.closeMonths,
      closeMonthLabels: cohort.closeMonthLabels,
      clientCount: cohortClients.length,
      dueSoon: cohortClients.filter(
        (client) => client.vat.daysTilDue !== null && client.vat.daysTilDue <= 28
      ).length,
      blocked: cohortClients.filter((client) => client.vat.blockers.length > 0).length,
      ready: cohortClients.filter(
        (client) => client.vat.blockers.length === 0 && client.vat.status !== "critical"
      ).length,
      clients: cohortClients.map((client) => ({
        companyId: client.companyId,
        companyName: client.companyName,
        priority: client.priority,
        dueDate: client.vat.dueDate,
        daysTilDue: client.vat.daysTilDue,
        status: client.vat.status,
        blockers: client.vat.blockers,
        nextBestAction: client.nextBestAction,
      })),
    };
  });

  const ownerNames = (client: (typeof clients)[number]) =>
    client.assignedStaff.length > 0
      ? client.assignedStaff.map((staff) => staff.name)
      : ["Unassigned"];

  const queues = {
    vat: sortBookkeeperQueue(
      clients
        .filter(
          (client) =>
            client.serviceScope.includes("vat") &&
            client.vat.status !== "filed" &&
            client.vat.status !== "on_track"
        )
        .map((client) => ({
          companyId: client.companyId,
          companyName: client.companyName,
          priority: client.vat.status as BookkeeperPriority,
          ownerNames: ownerNames(client),
          dueDate: client.vat.dueDate,
          daysTilDue: client.vat.daysTilDue,
          metric:
            client.vat.payableTax !== null
              ? `AED ${Math.round(client.vat.payableTax).toLocaleString("en-AE")} payable`
              : client.vat.cohortLabel,
          action: client.vat.blockers[0] ?? "Prepare upcoming VAT return",
          blockers: client.vat.blockers,
        }))
    ).slice(0, 12),
    corporateTax: sortBookkeeperQueue(
      clients
        .filter(
          (client) =>
            client.serviceScope.includes("corporate_tax") &&
            client.corporateTax.status !== "filed" &&
            client.corporateTax.status !== "on_track"
        )
        .map((client) => ({
          companyId: client.companyId,
          companyName: client.companyName,
          priority: client.corporateTax.status as BookkeeperPriority,
          ownerNames: ownerNames(client),
          dueDate: client.corporateTax.dueDate,
          daysTilDue: client.corporateTax.daysTilDue,
          metric:
            client.corporateTax.taxPayable !== null
              ? `AED ${Math.round(client.corporateTax.taxPayable).toLocaleString("en-AE")} payable`
              : "CT readiness",
          action: client.corporateTax.blockers[0] ?? "Review corporate tax readiness",
          blockers: client.corporateTax.blockers,
        }))
    ).slice(0, 12),
    bookkeeping: sortBookkeeperQueue(
      clients
        .filter(
          (client) =>
            client.serviceScope.includes("bookkeeping") && client.bookkeeping.status !== "on_track"
        )
        .map((client) => ({
          companyId: client.companyId,
          companyName: client.companyName,
          priority: client.bookkeeping.status,
          ownerNames: ownerNames(client),
          dueDate: client.vat.dueDate,
          daysTilDue: client.vat.daysTilDue,
          metric: `${client.bookkeeping.closeProgress}% close-ready`,
          action: client.bookkeeping.blockers[0] ?? "Finish monthly close",
          blockers: client.bookkeeping.blockers,
        }))
    ).slice(0, 12),
    accounting: sortBookkeeperQueue(
      clients
        .filter(
          (client) =>
            client.serviceScope.includes("accounting") && client.accounting.status !== "on_track"
        )
        .map((client) => ({
          companyId: client.companyId,
          companyName: client.companyName,
          priority: client.accounting.status,
          ownerNames: ownerNames(client),
          dueDate: null,
          daysTilDue: null,
          metric:
            client.accounting.discrepancy > 0
              ? `AED ${client.accounting.discrepancy.toLocaleString("en-AE")} variance`
              : "Review required",
          action: client.accounting.blockers[0] ?? "Post journal activity",
          blockers: client.accounting.blockers,
        }))
    ).slice(0, 12),
  };

  const workloadMap = new Map<
    string,
    {
      staffId: string | null;
      name: string;
      email: string | null;
      clientCount: number;
      critical: number;
      attention: number;
      vatDue28Days: number;
      corporateTaxDue90Days: number;
      bookkeepingBlocked: number;
      closeProgressTotal: number;
    }
  >();

  for (const client of clients) {
    const owners =
      client.assignedStaff.length > 0
        ? client.assignedStaff
        : [{ id: null, name: "Unassigned", email: null, role: "unassigned" }];

    for (const owner of owners) {
      const key = owner.id ?? "unassigned";
      const entry = workloadMap.get(key) ?? {
        staffId: owner.id,
        name: owner.name,
        email: owner.email,
        clientCount: 0,
        critical: 0,
        attention: 0,
        vatDue28Days: 0,
        corporateTaxDue90Days: 0,
        bookkeepingBlocked: 0,
        closeProgressTotal: 0,
      };

      entry.clientCount += 1;
      if (client.priority === "critical") entry.critical += 1;
      if (client.priority === "attention") entry.attention += 1;
      if (
        client.serviceScope.includes("vat") &&
        client.vat.status !== "filed" &&
        client.vat.daysTilDue !== null &&
        client.vat.daysTilDue <= 28
      ) {
        entry.vatDue28Days += 1;
      }
      if (
        client.serviceScope.includes("corporate_tax") &&
        client.corporateTax.status !== "filed" &&
        client.corporateTax.daysTilDue !== null &&
        client.corporateTax.daysTilDue <= 90
      ) {
        entry.corporateTaxDue90Days += 1;
      }
      if (client.serviceScope.includes("bookkeeping") && client.bookkeeping.status !== "on_track")
        entry.bookkeepingBlocked += 1;
      entry.closeProgressTotal += client.bookkeeping.closeProgress;
      workloadMap.set(key, entry);
    }
  }

  const workloadOwners = Array.from(workloadMap.values())
    .map(({ closeProgressTotal, ...owner }) => ({
      ...owner,
      averageCloseProgress:
        owner.clientCount > 0 ? Math.round(closeProgressTotal / owner.clientCount) : 0,
    }))
    .sort((a, b) => {
      const riskDelta = b.critical + b.attention - (a.critical + a.attention);
      if (riskDelta !== 0) return riskDelta;
      return b.clientCount - a.clientCount;
    });

  const sortedClients = clients.sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority));
  const serviceMatrix = CLIENT_SERVICE_OPTIONS.map((option) => {
    const serviceClients = clients.filter((client) => client.serviceScope.includes(option.code));
    return {
      code: option.code,
      label: option.label,
      shortLabel: option.shortLabel,
      clientCount: serviceClients.length,
      critical: serviceClients.filter((client) => client.priority === "critical").length,
      attention: serviceClients.filter((client) => client.priority === "attention").length,
    };
  });

  return {
    generatedAt: now.toISOString(),
    summary,
    serviceMatrix,
    vatCohorts,
    queues,
    workload: {
      owners: workloadOwners,
      unassignedClients: workloadOwners.find((owner) => owner.staffId === null)?.clientCount ?? 0,
      overloadedStaff: workloadOwners.filter(
        (owner) => owner.staffId !== null && (owner.critical >= 3 || owner.clientCount >= 15)
      ).length,
    },
    clients: sortedClients,
  };
}
