import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  max,
  ne,
  sql,
  sum,
} from 'drizzle-orm';

import { db } from '../db';
import {
  anomalyAlerts,
  bankTransactions,
  clientCommunications,
  companies,
  complianceCalendar,
  complianceTasks,
  documentRequirements,
  documents,
  engagements,
  invoices,
  journalEntries,
  journalLines,
  receipts,
  serviceInvoices,
  taxReturnArchive,
  vatReturns,
} from '../../shared/schema';

type Priority = 'critical' | 'high' | 'medium' | 'low';
type ValueLane =
  | 'audit_defense'
  | 'bank_close'
  | 'penalty_prevention'
  | 'cash_recovery'
  | 'nra_profitability'
  | 'compliance_risk'
  | 'ai_review'
  | 'whatsapp_cockpit'
  | 'monthly_cfo_pack'
  | 'migration_concierge';

export interface ValueOpsClient {
  companyId: string;
  companyName: string;
  trn: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  scores: {
    auditDefense: number;
    closeReadiness: number;
    penaltyRisk: number;
    complianceRisk: number;
    migrationReadiness: number;
  };
  money: {
    revenue90d: number;
    expenses90d: number;
    net90d: number;
    overdueAr: number;
    openAr: number;
    vatPayable: number;
    nraMonthlyFee: number;
    nraServiceAr: number;
  };
  workload: {
    missingDocuments: number;
    overdueDocuments: number;
    unpostedReceipts: number;
    unreconciledBankTransactions: number;
    anomalyCount: number;
    reviewerQueueItems: number;
    whatsappQueueItems: number;
  };
  status: {
    latestVatStatus: string | null;
    vatDueDate: Date | null;
    daysToVatDue: number | null;
    lastBankActivity: Date | null;
    lastClientActivity: Date | null;
    hasBankFeedData: boolean;
    hasArchivedReturn: boolean;
    onboardingCompleted: boolean;
  };
}

export interface ValueOpsOpportunity {
  lane: ValueLane;
  title: string;
  valueMetric: string;
  count: number;
  impactAed: number;
  topClient: string | null;
}

export interface ValueOpsAction {
  id: string;
  lane: ValueLane;
  priority: Priority;
  companyId: string;
  companyName: string;
  title: string;
  detail: string;
  impactAed: number;
  href: string;
}

export interface ValueOpsDashboard {
  summary: {
    totalClients: number;
    cashAtRisk: number;
    penaltyRiskClients: number;
    auditPacksReady: number;
    closeReadyClients: number;
    reviewerQueueItems: number;
    whatsappQueueItems: number;
    projectedNraMonthlyRevenue: number;
    nraServiceAr: number;
    migrationBlockers: number;
  };
  opportunities: ValueOpsOpportunity[];
  actions: ValueOpsAction[];
  clients: ValueOpsClient[];
}

export interface ClientAuditPack {
  company: {
    id: string;
    name: string;
    trn: string | null;
  };
  vatReturn: {
    id: string;
    status: string;
    periodStart: Date;
    periodEnd: Date;
    dueDate: Date;
    payableTax: number;
    ftaReferenceNumber: string | null;
  } | null;
  evidence: Array<{
    label: string;
    status: 'ready' | 'attention' | 'missing';
    count: number;
    detail: string;
  }>;
  reviewerNotes: string[];
}

export interface ClientCfoPack {
  company: {
    id: string;
    name: string;
    trn: string | null;
  };
  period: { start: Date; end: Date };
  metrics: {
    revenue: number;
    expenses: number;
    net: number;
    openAr: number;
    overdueAr: number;
    vatPayable: number;
  };
  narrative: string[];
  nextActions: string[];
}

export type ReviewItemKind =
  | 'bank_match'
  | 'receipt_posting'
  | 'anomaly'
  | 'vat_review'
  | 'trial_balance'
  | 'document_request';

export interface FirmReviewItem {
  id: string;
  kind: ReviewItemKind;
  priority: Priority;
  companyId: string;
  companyName: string;
  entityId: string;
  entityType: string;
  title: string;
  explanation: string;
  suggestedAction: string;
  confidence: number;
  amountAed: number;
  dueDate: Date | null;
  href: string;
}

type CompanyRow = {
  id: string;
  name: string;
  trnVatNumber: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  onboardingCompleted: boolean;
  createdAt: Date;
  corporateTaxId: string | null;
};

function asNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function daysUntil(date: Date | string | null | undefined, now: Date): number | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
}

function daysSince(date: Date | string | null | undefined, now: Date): number | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((now.getTime() - d.getTime()) / 86_400_000);
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function priorityFromScore(score: number, inverse = false): Priority {
  const risk = inverse ? 100 - score : score;
  if (risk >= 80) return 'critical';
  if (risk >= 60) return 'high';
  if (risk >= 35) return 'medium';
  return 'low';
}

function priorityRank(priority: Priority): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[priority];
}

function priorityFromAmount(amount: number): Priority {
  const absolute = Math.abs(amount);
  if (absolute >= 100_000) return 'critical';
  if (absolute >= 25_000) return 'high';
  if (absolute >= 5_000) return 'medium';
  return 'low';
}

function latestDate(...dates: Array<Date | null | undefined>): Date | null {
  let latest: Date | null = null;
  for (const date of dates) {
    if (!date) continue;
    if (!latest || date > latest) latest = date;
  }
  return latest;
}

function topClientBy(
  clients: ValueOpsClient[],
  predicate: (client: ValueOpsClient) => boolean,
  score: (client: ValueOpsClient) => number,
): ValueOpsClient | null {
  return clients
    .filter(predicate)
    .sort((a, b) => score(b) - score(a))[0] ?? null;
}

export async function buildFirmValueOps(
  companyIds: string[],
  now: Date = new Date(),
): Promise<ValueOpsDashboard> {
  if (companyIds.length === 0) {
    return {
      summary: {
        totalClients: 0,
        cashAtRisk: 0,
        penaltyRiskClients: 0,
        auditPacksReady: 0,
        closeReadyClients: 0,
        reviewerQueueItems: 0,
        whatsappQueueItems: 0,
        projectedNraMonthlyRevenue: 0,
        nraServiceAr: 0,
        migrationBlockers: 0,
      },
      opportunities: [],
      actions: [],
      clients: [],
    };
  }

  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const companyRows = (await db
    .select({
      id: companies.id,
      name: companies.name,
      trnVatNumber: companies.trnVatNumber,
      contactEmail: companies.contactEmail,
      contactPhone: companies.contactPhone,
      onboardingCompleted: companies.onboardingCompleted,
      createdAt: companies.createdAt,
      corporateTaxId: companies.corporateTaxId,
    })
    .from(companies)
    .where(
      and(
        inArray(companies.id, companyIds),
        eq(companies.companyType, 'client'),
        sql`${companies.deletedAt} IS NULL`,
      ),
    )) as CompanyRow[];

  type InvoiceAggRow = {
    companyId: string;
    revenue90d: string | null;
    openAr: string | null;
    overdueAr: string | null;
    overdueCount: string | null;
    invoiceCount90d: string | null;
    lastInvoiceAt: Date | null;
  };
  const invoiceRows = (await db
    .select({
      companyId: invoices.companyId,
      revenue90d: sql<string>`sum(case when ${invoices.status} = 'paid' and ${invoices.date} >= ${ninetyDaysAgo} then ${invoices.total} else 0 end)`,
      openAr: sql<string>`sum(case when ${invoices.status} in ('sent', 'partial') then ${invoices.total} else 0 end)`,
      overdueAr: sql<string>`sum(case when ${invoices.status} in ('sent', 'partial') and ${invoices.dueDate} < ${now} then ${invoices.total} else 0 end)`,
      overdueCount: sql<string>`count(*) filter (where ${invoices.status} in ('sent', 'partial') and ${invoices.dueDate} < ${now})`,
      invoiceCount90d: sql<string>`count(*) filter (where ${invoices.date} >= ${ninetyDaysAgo})`,
      lastInvoiceAt: max(invoices.createdAt),
    })
    .from(invoices)
    .where(inArray(invoices.companyId, companyIds))
    .groupBy(invoices.companyId)) as InvoiceAggRow[];
  const invoiceMap = new Map(invoiceRows.map((r) => [r.companyId, r]));

  type ReceiptAggRow = {
    companyId: string;
    expenses90d: string | null;
    unposted: string | null;
    autoPosted: string | null;
    receiptCount90d: string | null;
    lastReceiptAt: Date | null;
  };
  const receiptRows = (await db
    .select({
      companyId: receipts.companyId,
      expenses90d: sql<string>`sum(case when ${receipts.createdAt} >= ${ninetyDaysAgo} then coalesce(${receipts.amount}, 0) + coalesce(${receipts.vatAmount}, 0) else 0 end)`,
      unposted: sql<string>`count(*) filter (where ${receipts.posted} = false)`,
      autoPosted: sql<string>`count(*) filter (where ${receipts.autoPosted} = true and ${receipts.createdAt} >= ${ninetyDaysAgo})`,
      receiptCount90d: sql<string>`count(*) filter (where ${receipts.createdAt} >= ${ninetyDaysAgo})`,
      lastReceiptAt: max(receipts.createdAt),
    })
    .from(receipts)
    .where(inArray(receipts.companyId, companyIds))
    .groupBy(receipts.companyId)) as ReceiptAggRow[];
  const receiptMap = new Map(receiptRows.map((r) => [r.companyId, r]));

  type BankAggRow = {
    companyId: string;
    total: number;
    unreconciled: string | null;
    suggested: string | null;
    lastBankAt: Date | null;
  };
  const bankRows = (await db
    .select({
      companyId: bankTransactions.companyId,
      total: count(),
      unreconciled: sql<string>`count(*) filter (where ${bankTransactions.isReconciled} = false)`,
      suggested: sql<string>`count(*) filter (where ${bankTransactions.matchStatus} = 'suggested')`,
      lastBankAt: max(bankTransactions.transactionDate),
    })
    .from(bankTransactions)
    .where(inArray(bankTransactions.companyId, companyIds))
    .groupBy(bankTransactions.companyId)) as BankAggRow[];
  const bankMap = new Map(bankRows.map((r) => [r.companyId, r]));

  type RequirementAggRow = {
    companyId: string;
    missing: string | null;
    overdue: string | null;
  };
  const requirementRows = (await db
    .select({
      companyId: documentRequirements.companyId,
      missing: sql<string>`count(*) filter (where ${documentRequirements.status} in ('pending', 'requested', 'overdue'))`,
      overdue: sql<string>`count(*) filter (where ${documentRequirements.status} = 'overdue' or ${documentRequirements.dueDate} < ${now})`,
    })
    .from(documentRequirements)
    .where(inArray(documentRequirements.companyId, companyIds))
    .groupBy(documentRequirements.companyId)) as RequirementAggRow[];
  const requirementMap = new Map(requirementRows.map((r) => [r.companyId, r]));

  type DocumentAggRow = {
    companyId: string;
    total: number;
    bankStatements: string | null;
    vatCertificates: string | null;
    auditReports: string | null;
    tradeLicenses: string | null;
  };
  const documentRows = (await db
    .select({
      companyId: documents.companyId,
      total: count(),
      bankStatements: sql<string>`count(*) filter (where ${documents.category} = 'bank_statement' and ${documents.isArchived} = false)`,
      vatCertificates: sql<string>`count(*) filter (where ${documents.category} = 'tax_certificate' and ${documents.isArchived} = false)`,
      auditReports: sql<string>`count(*) filter (where ${documents.category} = 'audit_report' and ${documents.isArchived} = false)`,
      tradeLicenses: sql<string>`count(*) filter (where ${documents.category} = 'trade_license' and ${documents.isArchived} = false)`,
    })
    .from(documents)
    .where(inArray(documents.companyId, companyIds))
    .groupBy(documents.companyId)) as DocumentAggRow[];
  const documentMap = new Map(documentRows.map((r) => [r.companyId, r]));

  type ComplianceAggRow = {
    companyId: string;
    openTasks: string | null;
    overdueTasks: string | null;
  };
  const complianceRows = (await db
    .select({
      companyId: complianceTasks.companyId,
      openTasks: sql<string>`count(*) filter (where ${complianceTasks.status} in ('pending', 'in_progress', 'overdue'))`,
      overdueTasks: sql<string>`count(*) filter (where ${complianceTasks.status} = 'overdue' or ${complianceTasks.dueDate} < ${now})`,
    })
    .from(complianceTasks)
    .where(inArray(complianceTasks.companyId, companyIds))
    .groupBy(complianceTasks.companyId)) as ComplianceAggRow[];
  const complianceMap = new Map(complianceRows.map((r) => [r.companyId, r]));

  type CalendarAggRow = {
    companyId: string;
    upcoming: string | null;
    overdue: string | null;
  };
  const calendarRows = (await db
    .select({
      companyId: complianceCalendar.companyId,
      upcoming: sql<string>`count(*) filter (where ${complianceCalendar.status} = 'upcoming' and ${complianceCalendar.eventDate} <= ${new Date(now.getTime() + 30 * 86_400_000)})`,
      overdue: sql<string>`count(*) filter (where ${complianceCalendar.status} = 'overdue' or ${complianceCalendar.eventDate} < ${now})`,
    })
    .from(complianceCalendar)
    .where(inArray(complianceCalendar.companyId, companyIds))
    .groupBy(complianceCalendar.companyId)) as CalendarAggRow[];
  const calendarMap = new Map(calendarRows.map((r) => [r.companyId, r]));

  const latestVatSub = db
    .select({
      companyId: vatReturns.companyId,
      maxPeriodEnd: max(vatReturns.periodEnd).as('max_period_end'),
    })
    .from(vatReturns)
    .where(inArray(vatReturns.companyId, companyIds))
    .groupBy(vatReturns.companyId)
    .as('latest_value_ops_vat');

  type VatRow = {
    companyId: string;
    id: string;
    status: string;
    dueDate: Date;
    periodStart: Date;
    periodEnd: Date;
    payableTax: number;
  };
  const vatRows = (await db
    .select({
      companyId: vatReturns.companyId,
      id: vatReturns.id,
      status: vatReturns.status,
      dueDate: vatReturns.dueDate,
      periodStart: vatReturns.periodStart,
      periodEnd: vatReturns.periodEnd,
      payableTax: vatReturns.box14PayableTax,
    })
    .from(vatReturns)
    .innerJoin(
      latestVatSub,
      and(
        eq(vatReturns.companyId, latestVatSub.companyId),
        eq(vatReturns.periodEnd, latestVatSub.maxPeriodEnd),
      ),
    )) as VatRow[];
  const vatMap = new Map(vatRows.map((r) => [r.companyId, r]));

  type ArchiveAggRow = { companyId: string; filedReturns: number; latestFiledAt: Date | null };
  const archiveRows = (await db
    .select({
      companyId: taxReturnArchive.companyId,
      filedReturns: count(),
      latestFiledAt: max(taxReturnArchive.filingDate),
    })
    .from(taxReturnArchive)
    .where(and(inArray(taxReturnArchive.companyId, companyIds), eq(taxReturnArchive.returnType, 'vat')))
    .groupBy(taxReturnArchive.companyId)) as ArchiveAggRow[];
  const archiveMap = new Map(archiveRows.map((r) => [r.companyId, r]));

  type AnomalyAggRow = { companyId: string; open: number; critical: string | null };
  const anomalyRows = (await db
    .select({
      companyId: anomalyAlerts.companyId,
      open: count(),
      critical: sql<string>`count(*) filter (where ${anomalyAlerts.severity} in ('high', 'critical'))`,
    })
    .from(anomalyAlerts)
    .where(and(inArray(anomalyAlerts.companyId, companyIds), eq(anomalyAlerts.isResolved, false)))
    .groupBy(anomalyAlerts.companyId)) as AnomalyAggRow[];
  const anomalyMap = new Map(anomalyRows.map((r) => [r.companyId, r]));

  type TrialBalanceRow = { companyId: string; debit: string | null; credit: string | null; lastJournalAt: Date | null };
  const trialRows = (await db
    .select({
      companyId: journalEntries.companyId,
      debit: sum(journalLines.debit),
      credit: sum(journalLines.credit),
      lastJournalAt: sql<Date | null>`max(coalesce(${journalEntries.updatedAt}, ${journalEntries.postedAt}, ${journalEntries.createdAt}))`,
    })
    .from(journalEntries)
    .innerJoin(journalLines, eq(journalLines.entryId, journalEntries.id))
    .where(and(inArray(journalEntries.companyId, companyIds), eq(journalEntries.status, 'posted')))
    .groupBy(journalEntries.companyId)) as TrialBalanceRow[];
  const trialMap = new Map(trialRows.map((r) => [r.companyId, r]));

  type EngagementRow = { companyId: string; monthlyFee: number | null };
  const engagementRows = (await db
    .select({
      companyId: engagements.companyId,
      monthlyFee: sql<number | null>`max(${engagements.monthlyFee})`,
    })
    .from(engagements)
    .where(and(inArray(engagements.companyId, companyIds), eq(engagements.status, 'active')))
    .groupBy(engagements.companyId)) as EngagementRow[];
  const engagementMap = new Map(engagementRows.map((r) => [r.companyId, r]));

  type ServiceArRow = { companyId: string; openAr: string | null; paidThisMonth: string | null };
  const serviceArRows = (await db
    .select({
      companyId: serviceInvoices.companyId,
      openAr: sql<string>`sum(case when ${serviceInvoices.status} in ('sent', 'overdue') then ${serviceInvoices.total} - coalesce(${serviceInvoices.paidAmount}, 0) else 0 end)`,
      paidThisMonth: sql<string>`sum(case when ${serviceInvoices.status} = 'paid' and ${serviceInvoices.paidAt} >= ${monthStart} then ${serviceInvoices.total} else 0 end)`,
    })
    .from(serviceInvoices)
    .where(inArray(serviceInvoices.companyId, companyIds))
    .groupBy(serviceInvoices.companyId)) as ServiceArRow[];
  const serviceArMap = new Map(serviceArRows.map((r) => [r.companyId, r]));

  type CommAggRow = { companyId: string; outbound30d: string | null; inbound30d: string | null };
  const commRows = (await db
    .select({
      companyId: clientCommunications.companyId,
      outbound30d: sql<string>`count(*) filter (where ${clientCommunications.direction} = 'outbound' and ${clientCommunications.sentAt} >= ${thirtyDaysAgo})`,
      inbound30d: sql<string>`count(*) filter (where ${clientCommunications.direction} = 'inbound' and ${clientCommunications.sentAt} >= ${thirtyDaysAgo})`,
    })
    .from(clientCommunications)
    .where(inArray(clientCommunications.companyId, companyIds))
    .groupBy(clientCommunications.companyId)) as CommAggRow[];
  const commMap = new Map(commRows.map((r) => [r.companyId, r]));

  const clients: ValueOpsClient[] = companyRows.map((company) => {
    const invoice = invoiceMap.get(company.id);
    const receipt = receiptMap.get(company.id);
    const bank = bankMap.get(company.id);
    const req = requirementMap.get(company.id);
    const doc = documentMap.get(company.id);
    const comp = complianceMap.get(company.id);
    const cal = calendarMap.get(company.id);
    const vat = vatMap.get(company.id);
    const archive = archiveMap.get(company.id);
    const anomaly = anomalyMap.get(company.id);
    const trial = trialMap.get(company.id);
    const engagement = engagementMap.get(company.id);
    const serviceAr = serviceArMap.get(company.id);
    const comm = commMap.get(company.id);

    const revenue90d = asNumber(invoice?.revenue90d);
    const expenses90d = asNumber(receipt?.expenses90d);
    const openAr = asNumber(invoice?.openAr);
    const overdueAr = asNumber(invoice?.overdueAr);
    const overdueInvoiceCount = asNumber(invoice?.overdueCount);
    const unpostedReceipts = asNumber(receipt?.unposted);
    const missingDocuments = asNumber(req?.missing);
    const overdueDocuments = asNumber(req?.overdue);
    const unreconciledBankTransactions = asNumber(bank?.unreconciled);
    const bankSuggested = asNumber(bank?.suggested);
    const anomalyCount = asNumber(anomaly?.open);
    const criticalAnomalies = asNumber(anomaly?.critical);
    const overdueTasks = asNumber(comp?.overdueTasks) + asNumber(cal?.overdue);
    const upcomingCompliance = asNumber(cal?.upcoming);
    const daysToVatDue = daysUntil(vat?.dueDate, now);
    const vatOpen = vat ? vat.status !== 'filed' && vat.status !== 'submitted' : true;
    const vatOverdue = vatOpen && daysToVatDue !== null && daysToVatDue < 0;
    const vatDueSoon = vatOpen && daysToVatDue !== null && daysToVatDue <= 14;
    const trialDiscrepancy = Math.abs(asNumber(trial?.debit) - asNumber(trial?.credit));
    const lastClientActivity = latestDate(invoice?.lastInvoiceAt, receipt?.lastReceiptAt, bank?.lastBankAt, trial?.lastJournalAt, company.createdAt);
    const inactiveDays = daysSince(lastClientActivity, now);
    const hasArchivedReturn = asNumber(archive?.filedReturns) > 0;
    const hasBankFeedData = (bank?.total ?? 0) > 0;

    const auditDefense = clampScore(
      100
        - (!company.trnVatNumber ? 18 : 0)
        - (!vat ? 18 : 0)
        - (vatOpen ? 10 : 0)
        - (!hasArchivedReturn ? 10 : 0)
        - (asNumber(doc?.bankStatements) === 0 ? 10 : 0)
        - Math.min(missingDocuments * 4, 20)
        - (criticalAnomalies > 0 ? 14 : 0),
    );
    const closeReadiness = clampScore(
      100
        - Math.min(unreconciledBankTransactions * 2, 30)
        - Math.min(unpostedReceipts * 3, 25)
        - (trialDiscrepancy > 0.01 ? 25 : 0)
        - (!hasBankFeedData ? 10 : 0)
        - (inactiveDays !== null && inactiveDays > 45 ? 10 : 0),
    );
    const penaltyRisk = clampScore(
      (vatOverdue ? 45 : vatDueSoon ? 28 : 0)
        + Math.min(overdueDocuments * 10, 25)
        + Math.min(overdueTasks * 12, 30)
        + (!company.trnVatNumber ? 10 : 0)
        + (!company.corporateTaxId ? 5 : 0),
    );
    const complianceRisk = clampScore(
      penaltyRisk
        + Math.min(missingDocuments * 5, 25)
        + Math.min(anomalyCount * 7, 25)
        + (asNumber(doc?.tradeLicenses) === 0 ? 8 : 0),
    );
    const migrationReadiness = clampScore(
      100
        - (!company.trnVatNumber ? 15 : 0)
        - (!company.contactEmail && !company.contactPhone ? 12 : 0)
        - (!hasBankFeedData ? 18 : 0)
        - (asNumber(invoice?.invoiceCount90d) === 0 ? 12 : 0)
        - (asNumber(receipt?.receiptCount90d) === 0 ? 12 : 0)
        - (!company.onboardingCompleted ? 14 : 0)
        - (asNumber(doc?.total) === 0 ? 10 : 0),
    );

    const reviewerQueueItems =
      unpostedReceipts +
      unreconciledBankTransactions +
      bankSuggested +
      anomalyCount +
      (vatDueSoon || vatOverdue ? 1 : 0) +
      (trialDiscrepancy > 0.01 ? 1 : 0);
    const whatsappQueueItems =
      missingDocuments +
      overdueInvoiceCount +
      (vatDueSoon || vatOverdue ? 1 : 0) +
      (asNumber(comm?.outbound30d) === 0 && (missingDocuments > 0 || overdueInvoiceCount > 0) ? 1 : 0);

    return {
      companyId: company.id,
      companyName: company.name,
      trn: company.trnVatNumber,
      contactEmail: company.contactEmail,
      contactPhone: company.contactPhone,
      scores: {
        auditDefense,
        closeReadiness,
        penaltyRisk,
        complianceRisk,
        migrationReadiness,
      },
      money: {
        revenue90d,
        expenses90d,
        net90d: revenue90d - expenses90d,
        overdueAr,
        openAr,
        vatPayable: asNumber(vat?.payableTax),
        nraMonthlyFee: asNumber(engagement?.monthlyFee),
        nraServiceAr: asNumber(serviceAr?.openAr),
      },
      workload: {
        missingDocuments,
        overdueDocuments,
        unpostedReceipts,
        unreconciledBankTransactions,
        anomalyCount,
        reviewerQueueItems,
        whatsappQueueItems,
      },
      status: {
        latestVatStatus: vat?.status ?? null,
        vatDueDate: vat?.dueDate ?? null,
        daysToVatDue,
        lastBankActivity: bank?.lastBankAt ?? null,
        lastClientActivity,
        hasBankFeedData,
        hasArchivedReturn,
        onboardingCompleted: company.onboardingCompleted,
      },
    };
  });

  const actionCandidates: ValueOpsAction[] = clients.flatMap((client) => {
    const actions: ValueOpsAction[] = [];
    if (client.scores.penaltyRisk >= 35) {
      actions.push({
        id: `${client.companyId}:penalty`,
        lane: 'penalty_prevention',
        priority: priorityFromScore(client.scores.penaltyRisk),
        companyId: client.companyId,
        companyName: client.companyName,
        title: 'Prevent filing or document penalty',
        detail: `${client.workload.overdueDocuments} overdue docs, VAT due ${client.status.daysToVatDue ?? 'unknown'} days`,
        impactAed: Math.max(client.money.vatPayable, 0),
        href: `/firm/clients/${client.companyId}`,
      });
    }
    if (client.money.overdueAr > 0) {
      actions.push({
        id: `${client.companyId}:cash`,
        lane: 'cash_recovery',
        priority: client.money.overdueAr >= 100_000 ? 'critical' : client.money.overdueAr >= 25_000 ? 'high' : 'medium',
        companyId: client.companyId,
        companyName: client.companyName,
        title: 'Recover overdue receivables',
        detail: `${client.workload.whatsappQueueItems} collection or document messages ready`,
        impactAed: client.money.overdueAr,
        href: `/firm/clients/${client.companyId}`,
      });
    }
    if (client.scores.closeReadiness < 75) {
      actions.push({
        id: `${client.companyId}:close`,
        lane: 'bank_close',
        priority: priorityFromScore(client.scores.closeReadiness, true),
        companyId: client.companyId,
        companyName: client.companyName,
        title: 'Unblock month-end close',
        detail: `${client.workload.unreconciledBankTransactions} bank items, ${client.workload.unpostedReceipts} receipts need review`,
        impactAed: 0,
        href: `/firm/clients/${client.companyId}`,
      });
    }
    if (client.scores.auditDefense < 80) {
      actions.push({
        id: `${client.companyId}:audit`,
        lane: 'audit_defense',
        priority: priorityFromScore(client.scores.auditDefense, true),
        companyId: client.companyId,
        companyName: client.companyName,
        title: 'Complete audit defense evidence',
        detail: `${client.workload.missingDocuments} missing documents; archived return ${client.status.hasArchivedReturn ? 'ready' : 'missing'}`,
        impactAed: client.money.vatPayable,
        href: `/firm/value-ops?client=${client.companyId}`,
      });
    }
    return actions;
  });

  const actions = actionCandidates
    .sort((a, b) => {
      const priorityRank: Record<Priority, number> = { critical: 4, high: 3, medium: 2, low: 1 };
      return priorityRank[b.priority] - priorityRank[a.priority] || b.impactAed - a.impactAed;
    })
    .slice(0, 12);

  const penaltyTop = topClientBy(clients, (c) => c.scores.penaltyRisk >= 35, (c) => c.scores.penaltyRisk);
  const cashTop = topClientBy(clients, (c) => c.money.overdueAr > 0, (c) => c.money.overdueAr);
  const closeTop = topClientBy(clients, (c) => c.scores.closeReadiness < 75, (c) => 100 - c.scores.closeReadiness);
  const auditTop = topClientBy(clients, (c) => c.scores.auditDefense < 80, (c) => 100 - c.scores.auditDefense);
  const riskTop = topClientBy(clients, (c) => c.scores.complianceRisk >= 45, (c) => c.scores.complianceRisk);
  const reviewTop = topClientBy(clients, (c) => c.workload.reviewerQueueItems > 0, (c) => c.workload.reviewerQueueItems);
  const whatsappTop = topClientBy(clients, (c) => c.workload.whatsappQueueItems > 0, (c) => c.workload.whatsappQueueItems);
  const cfoTop = topClientBy(clients, (c) => c.money.revenue90d > 0 || c.money.expenses90d > 0, (c) => c.money.revenue90d + c.money.expenses90d);
  const migrationTop = topClientBy(clients, (c) => c.scores.migrationReadiness < 75, (c) => 100 - c.scores.migrationReadiness);
  const profitTop = topClientBy(clients, (c) => c.money.nraMonthlyFee === 0 || c.money.nraServiceAr > 0, (c) => c.money.nraServiceAr + (c.money.nraMonthlyFee === 0 ? 1_000 : 0));

  const opportunities: ValueOpsOpportunity[] = [
    {
      lane: 'audit_defense',
      title: 'FTA audit defense packs',
      valueMetric: `${clients.filter((c) => c.scores.auditDefense >= 80).length} ready`,
      count: clients.filter((c) => c.scores.auditDefense < 80).length,
      impactAed: clients.reduce((sumAed, c) => sumAed + (c.scores.auditDefense < 80 ? c.money.vatPayable : 0), 0),
      topClient: auditTop?.companyName ?? null,
    },
    {
      lane: 'bank_close',
      title: 'Bank-feed close autopilot',
      valueMetric: `${clients.filter((c) => c.scores.closeReadiness >= 80).length} close-ready`,
      count: clients.filter((c) => c.scores.closeReadiness < 80).length,
      impactAed: 0,
      topClient: closeTop?.companyName ?? null,
    },
    {
      lane: 'penalty_prevention',
      title: 'Penalty prevention engine',
      valueMetric: `${clients.filter((c) => c.scores.penaltyRisk >= 35).length} clients at risk`,
      count: clients.filter((c) => c.scores.penaltyRisk >= 35).length,
      impactAed: clients.reduce((sumAed, c) => sumAed + (c.scores.penaltyRisk >= 35 ? c.money.vatPayable : 0), 0),
      topClient: penaltyTop?.companyName ?? null,
    },
    {
      lane: 'cash_recovery',
      title: 'AR cash recovery workflow',
      valueMetric: `${clients.reduce((sumCount, c) => sumCount + (c.money.overdueAr > 0 ? 1 : 0), 0)} clients`,
      count: clients.filter((c) => c.money.overdueAr > 0).length,
      impactAed: clients.reduce((sumAed, c) => sumAed + c.money.overdueAr, 0),
      topClient: cashTop?.companyName ?? null,
    },
    {
      lane: 'nra_profitability',
      title: 'NRA client profitability',
      valueMetric: `${clients.filter((c) => c.money.nraMonthlyFee > 0).length} priced clients`,
      count: clients.filter((c) => c.money.nraMonthlyFee === 0 || c.money.nraServiceAr > 0).length,
      impactAed: clients.reduce((sumAed, c) => sumAed + c.money.nraServiceAr, 0),
      topClient: profitTop?.companyName ?? null,
    },
    {
      lane: 'compliance_risk',
      title: 'Compliance risk scoring',
      valueMetric: `${clients.filter((c) => c.scores.complianceRisk >= 45).length} high-risk clients`,
      count: clients.filter((c) => c.scores.complianceRisk >= 45).length,
      impactAed: clients.reduce((sumAed, c) => sumAed + (c.scores.complianceRisk >= 45 ? c.money.vatPayable : 0), 0),
      topClient: riskTop?.companyName ?? null,
    },
    {
      lane: 'ai_review',
      title: 'AI reviewer queue',
      valueMetric: `${clients.reduce((sumCount, c) => sumCount + c.workload.reviewerQueueItems, 0)} review items`,
      count: clients.filter((c) => c.workload.reviewerQueueItems > 0).length,
      impactAed: 0,
      topClient: reviewTop?.companyName ?? null,
    },
    {
      lane: 'whatsapp_cockpit',
      title: 'Owner WhatsApp cockpit',
      valueMetric: `${clients.reduce((sumCount, c) => sumCount + c.workload.whatsappQueueItems, 0)} messages ready`,
      count: clients.filter((c) => c.workload.whatsappQueueItems > 0).length,
      impactAed: clients.reduce((sumAed, c) => sumAed + (c.workload.whatsappQueueItems > 0 ? c.money.overdueAr : 0), 0),
      topClient: whatsappTop?.companyName ?? null,
    },
    {
      lane: 'monthly_cfo_pack',
      title: 'Monthly CFO packs',
      valueMetric: `${clients.filter((c) => c.money.revenue90d > 0 || c.money.expenses90d > 0).length} pack-ready`,
      count: clients.filter((c) => c.money.revenue90d > 0 || c.money.expenses90d > 0).length,
      impactAed: clients.reduce((sumAed, c) => sumAed + Math.max(c.money.net90d, 0), 0),
      topClient: cfoTop?.companyName ?? null,
    },
    {
      lane: 'migration_concierge',
      title: 'Migration/import concierge',
      valueMetric: `${clients.filter((c) => c.scores.migrationReadiness < 75).length} onboarding blockers`,
      count: clients.filter((c) => c.scores.migrationReadiness < 75).length,
      impactAed: clients.reduce((sumAed, c) => sumAed + (c.scores.migrationReadiness < 75 ? c.money.nraMonthlyFee : 0), 0),
      topClient: migrationTop?.companyName ?? null,
    },
  ];

  return {
    summary: {
      totalClients: clients.length,
      cashAtRisk: clients.reduce((sumAed, c) => sumAed + c.money.overdueAr, 0),
      penaltyRiskClients: clients.filter((c) => c.scores.penaltyRisk >= 35).length,
      auditPacksReady: clients.filter((c) => c.scores.auditDefense >= 80).length,
      closeReadyClients: clients.filter((c) => c.scores.closeReadiness >= 80).length,
      reviewerQueueItems: clients.reduce((sumCount, c) => sumCount + c.workload.reviewerQueueItems, 0),
      whatsappQueueItems: clients.reduce((sumCount, c) => sumCount + c.workload.whatsappQueueItems, 0),
      projectedNraMonthlyRevenue: clients.reduce((sumAed, c) => sumAed + c.money.nraMonthlyFee, 0),
      nraServiceAr: clients.reduce((sumAed, c) => sumAed + c.money.nraServiceAr, 0),
      migrationBlockers: clients.filter((c) => c.scores.migrationReadiness < 75).length,
    },
    opportunities,
    actions,
    clients,
  };
}

export async function buildClientAuditPack(companyId: string, now: Date = new Date()): Promise<ClientAuditPack | null> {
  const [company] = (await db
    .select({ id: companies.id, name: companies.name, trn: companies.trnVatNumber })
    .from(companies)
    .where(and(eq(companies.id, companyId), eq(companies.companyType, 'client'), sql`${companies.deletedAt} IS NULL`))
    .limit(1)) as Array<{ id: string; name: string; trn: string | null }>;
  if (!company) return null;

  const [vat] = (await db
    .select({
      id: vatReturns.id,
      status: vatReturns.status,
      periodStart: vatReturns.periodStart,
      periodEnd: vatReturns.periodEnd,
      dueDate: vatReturns.dueDate,
      payableTax: vatReturns.box14PayableTax,
      ftaReferenceNumber: vatReturns.ftaReferenceNumber,
    })
    .from(vatReturns)
    .where(eq(vatReturns.companyId, companyId))
    .orderBy(desc(vatReturns.periodEnd))
    .limit(1)) as Array<{
    id: string;
    status: string;
    periodStart: Date;
    periodEnd: Date;
    dueDate: Date;
    payableTax: number;
    ftaReferenceNumber: string | null;
  }>;

  const periodStart = vat?.periodStart ?? new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const periodEnd = vat?.periodEnd ?? now;

  const [salesEvidence, receiptEvidence, documentEvidence, archivedReturn, unresolvedAnomalies] = await Promise.all([
    db
      .select({ cnt: count(), vat: sum(invoices.vatAmount), total: sum(invoices.total) })
      .from(invoices)
      .where(and(eq(invoices.companyId, companyId), gte(invoices.date, periodStart), lte(invoices.date, periodEnd))),
    db
      .select({ cnt: count(), vat: sum(receipts.vatAmount), total: sum(receipts.amount) })
      .from(receipts)
      .where(and(eq(receipts.companyId, companyId), gte(receipts.createdAt, periodStart), lte(receipts.createdAt, periodEnd))),
    db
      .select({
        bankStatements: sql<string>`count(*) filter (where ${documents.category} = 'bank_statement' and ${documents.isArchived} = false)`,
        taxCertificates: sql<string>`count(*) filter (where ${documents.category} = 'tax_certificate' and ${documents.isArchived} = false)`,
        auditReports: sql<string>`count(*) filter (where ${documents.category} = 'audit_report' and ${documents.isArchived} = false)`,
      })
      .from(documents)
      .where(eq(documents.companyId, companyId)),
    db
      .select({ cnt: count() })
      .from(taxReturnArchive)
      .where(and(eq(taxReturnArchive.companyId, companyId), eq(taxReturnArchive.returnType, 'vat'))),
    db
      .select({ cnt: count() })
      .from(anomalyAlerts)
      .where(and(eq(anomalyAlerts.companyId, companyId), eq(anomalyAlerts.isResolved, false))),
  ]);

  const saleCount = salesEvidence[0]?.cnt ?? 0;
  const receiptCount = receiptEvidence[0]?.cnt ?? 0;
  const bankStatementCount = asNumber(documentEvidence[0]?.bankStatements);
  const taxCertificateCount = asNumber(documentEvidence[0]?.taxCertificates);
  const archiveCount = archivedReturn[0]?.cnt ?? 0;
  const anomalyCount = unresolvedAnomalies[0]?.cnt ?? 0;

  const evidence = [
    {
      label: 'VAT return calculation',
      status: vat ? ('ready' as const) : ('missing' as const),
      count: vat ? 1 : 0,
      detail: vat ? `${vat.status} return for ${periodStart.toISOString().slice(0, 10)} to ${periodEnd.toISOString().slice(0, 10)}` : 'No VAT return exists for this client',
    },
    {
      label: 'Sales invoice evidence',
      status: saleCount > 0 ? ('ready' as const) : ('attention' as const),
      count: saleCount,
      detail: `AED ${asNumber(salesEvidence[0]?.vat).toLocaleString('en-AE')} output VAT represented`,
    },
    {
      label: 'Expense receipt evidence',
      status: receiptCount > 0 ? ('ready' as const) : ('attention' as const),
      count: receiptCount,
      detail: `AED ${asNumber(receiptEvidence[0]?.vat).toLocaleString('en-AE')} input VAT represented`,
    },
    {
      label: 'Bank statement support',
      status: bankStatementCount > 0 ? ('ready' as const) : ('missing' as const),
      count: bankStatementCount,
      detail: 'Bank statement documents in the client vault',
    },
    {
      label: 'TRN/tax certificate',
      status: company.trn || taxCertificateCount > 0 ? ('ready' as const) : ('missing' as const),
      count: taxCertificateCount,
      detail: company.trn ? `TRN ${company.trn}` : 'No TRN or tax certificate evidence found',
    },
    {
      label: 'Filed-return archive',
      status: archiveCount > 0 ? ('ready' as const) : ('attention' as const),
      count: archiveCount,
      detail: 'Historical filed returns available for audit continuity',
    },
    {
      label: 'Open anomaly clearance',
      status: anomalyCount === 0 ? ('ready' as const) : ('attention' as const),
      count: anomalyCount,
      detail: 'Unresolved anomaly alerts before sign-off',
    },
  ];

  const reviewerNotes = evidence
    .filter((item) => item.status !== 'ready')
    .map((item) => `${item.label}: ${item.detail}`);

  return {
    company,
    vatReturn: vat
      ? {
          ...vat,
          payableTax: asNumber(vat.payableTax),
        }
      : null,
    evidence,
    reviewerNotes,
  };
}

export async function buildClientCfoPack(companyId: string, now: Date = new Date()): Promise<ClientCfoPack | null> {
  const [company] = (await db
    .select({ id: companies.id, name: companies.name, trn: companies.trnVatNumber })
    .from(companies)
    .where(and(eq(companies.id, companyId), eq(companies.companyType, 'client'), sql`${companies.deletedAt} IS NULL`))
    .limit(1)) as Array<{ id: string; name: string; trn: string | null }>;
  if (!company) return null;

  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 1);

  const [revenueRow, expenseRow, arRow, vatRow] = await Promise.all([
    db
      .select({ total: sum(invoices.total) })
      .from(invoices)
      .where(and(eq(invoices.companyId, companyId), ne(invoices.status, 'void'), gte(invoices.date, start), lt(invoices.date, end))),
    db
      .select({ total: sql<string>`sum(coalesce(${receipts.amount}, 0) + coalesce(${receipts.vatAmount}, 0))` })
      .from(receipts)
      .where(and(eq(receipts.companyId, companyId), gte(receipts.createdAt, start), lt(receipts.createdAt, end))),
    db
      .select({
        openAr: sql<string>`sum(case when ${invoices.status} in ('sent', 'partial') then ${invoices.total} else 0 end)`,
        overdueAr: sql<string>`sum(case when ${invoices.status} in ('sent', 'partial') and ${invoices.dueDate} < ${now} then ${invoices.total} else 0 end)`,
      })
      .from(invoices)
      .where(eq(invoices.companyId, companyId)),
    db
      .select({
        payableTax: vatReturns.box14PayableTax,
        dueDate: vatReturns.dueDate,
        status: vatReturns.status,
      })
      .from(vatReturns)
      .where(eq(vatReturns.companyId, companyId))
      .orderBy(desc(vatReturns.periodEnd))
      .limit(1),
  ]);

  const revenue = asNumber(revenueRow[0]?.total);
  const expenses = asNumber(expenseRow[0]?.total);
  const net = revenue - expenses;
  const openAr = asNumber(arRow[0]?.openAr);
  const overdueAr = asNumber(arRow[0]?.overdueAr);
  const vatPayable = asNumber(vatRow[0]?.payableTax);

  const narrative = [
    `Revenue for the month was AED ${revenue.toLocaleString('en-AE')}.`,
    `Expenses were AED ${expenses.toLocaleString('en-AE')}, leaving AED ${net.toLocaleString('en-AE')} net before owner adjustments.`,
    `Open receivables stand at AED ${openAr.toLocaleString('en-AE')}, with AED ${overdueAr.toLocaleString('en-AE')} overdue.`,
    vatRow[0]
      ? `Latest VAT return is ${vatRow[0].status} with AED ${vatPayable.toLocaleString('en-AE')} payable.`
      : 'No VAT return is currently available for this client.',
  ];

  const nextActions = [
    ...(overdueAr > 0 ? [`Prioritize collections on AED ${overdueAr.toLocaleString('en-AE')} overdue AR.`] : []),
    ...(vatRow[0] && vatRow[0].status !== 'filed' && vatRow[0].status !== 'submitted'
      ? [`Review VAT return due ${vatRow[0].dueDate.toISOString().slice(0, 10)}.`]
      : []),
    ...(revenue === 0 && expenses === 0 ? ['Request missing bank statements or source documents for the month.'] : []),
  ];

  return {
    company,
    period: { start, end },
    metrics: {
      revenue,
      expenses,
      net,
      openAr,
      overdueAr,
      vatPayable,
    },
    narrative,
    nextActions,
  };
}

export async function buildFirmReviewQueue(
  companyIds: string[],
  now: Date = new Date(),
): Promise<FirmReviewItem[]> {
  if (companyIds.length === 0) return [];

  type CompanyNameRow = { id: string; name: string };
  const companyRows = (await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(
      and(
        inArray(companies.id, companyIds),
        eq(companies.companyType, 'client'),
        sql`${companies.deletedAt} IS NULL`,
      ),
    )) as CompanyNameRow[];
  const companyName = new Map<string, string>(
    companyRows.map((company: CompanyNameRow) => [company.id, company.name]),
  );
  const dueSoon = new Date(now.getTime() + 14 * 86_400_000);

  type BankReviewRow = {
    id: string;
    companyId: string;
    transactionDate: Date;
    description: string;
    amount: number;
    matchStatus: string;
    matchConfidence: number | null;
  };
  const bankRows = (await db
    .select({
      id: bankTransactions.id,
      companyId: bankTransactions.companyId,
      transactionDate: bankTransactions.transactionDate,
      description: bankTransactions.description,
      amount: bankTransactions.amount,
      matchStatus: bankTransactions.matchStatus,
      matchConfidence: bankTransactions.matchConfidence,
    })
    .from(bankTransactions)
    .where(and(inArray(bankTransactions.companyId, companyIds), eq(bankTransactions.isReconciled, false)))
    .orderBy(desc(bankTransactions.transactionDate))
    .limit(80)) as BankReviewRow[];

  type ReceiptReviewRow = {
    id: string;
    companyId: string;
    merchant: string | null;
    date: Date | null;
    amount: number | null;
    vatAmount: number | null;
    classifierMethod: string | null;
    createdAt: Date;
  };
  const receiptRows = (await db
    .select({
      id: receipts.id,
      companyId: receipts.companyId,
      merchant: receipts.merchant,
      date: receipts.date,
      amount: receipts.amount,
      vatAmount: receipts.vatAmount,
      classifierMethod: receipts.classifierMethod,
      createdAt: receipts.createdAt,
    })
    .from(receipts)
    .where(and(inArray(receipts.companyId, companyIds), eq(receipts.posted, false)))
    .orderBy(desc(receipts.createdAt))
    .limit(80)) as ReceiptReviewRow[];

  type AnomalyReviewRow = {
    id: string;
    companyId: string;
    severity: string;
    title: string;
    description: string;
    relatedEntityType: string | null;
    relatedEntityId: string | null;
    aiConfidence: number | null;
    createdAt: Date;
  };
  const anomalyRows = (await db
    .select({
      id: anomalyAlerts.id,
      companyId: anomalyAlerts.companyId,
      severity: anomalyAlerts.severity,
      title: anomalyAlerts.title,
      description: anomalyAlerts.description,
      relatedEntityType: anomalyAlerts.relatedEntityType,
      relatedEntityId: anomalyAlerts.relatedEntityId,
      aiConfidence: anomalyAlerts.aiConfidence,
      createdAt: anomalyAlerts.createdAt,
    })
    .from(anomalyAlerts)
    .where(and(inArray(anomalyAlerts.companyId, companyIds), eq(anomalyAlerts.isResolved, false)))
    .orderBy(desc(anomalyAlerts.createdAt))
    .limit(80)) as AnomalyReviewRow[];

  type VatReviewRow = {
    id: string;
    companyId: string;
    status: string;
    dueDate: Date;
    periodStart: Date;
    periodEnd: Date;
    payableTax: number;
  };
  const vatRows = (await db
    .select({
      id: vatReturns.id,
      companyId: vatReturns.companyId,
      status: vatReturns.status,
      dueDate: vatReturns.dueDate,
      periodStart: vatReturns.periodStart,
      periodEnd: vatReturns.periodEnd,
      payableTax: vatReturns.box14PayableTax,
    })
    .from(vatReturns)
    .where(
      and(
        inArray(vatReturns.companyId, companyIds),
        ne(vatReturns.status, 'filed'),
        ne(vatReturns.status, 'submitted'),
        lte(vatReturns.dueDate, dueSoon),
      ),
    )
    .orderBy(vatReturns.dueDate)
    .limit(80)) as VatReviewRow[];

  type DocumentReviewRow = {
    id: string;
    companyId: string;
    documentType: string;
    description: string | null;
    dueDate: Date;
    status: string;
  };
  const documentRows = (await db
    .select({
      id: documentRequirements.id,
      companyId: documentRequirements.companyId,
      documentType: documentRequirements.documentType,
      description: documentRequirements.description,
      dueDate: documentRequirements.dueDate,
      status: documentRequirements.status,
    })
    .from(documentRequirements)
    .where(
      and(
        inArray(documentRequirements.companyId, companyIds),
        inArray(documentRequirements.status, ['pending', 'requested', 'overdue']),
        lte(documentRequirements.dueDate, dueSoon),
      ),
    )
    .orderBy(documentRequirements.dueDate)
    .limit(80)) as DocumentReviewRow[];

  type TrialReviewRow = {
    companyId: string;
    debit: string | null;
    credit: string | null;
    lastJournalAt: Date | null;
  };
  const trialRows = (await db
    .select({
      companyId: journalEntries.companyId,
      debit: sum(journalLines.debit),
      credit: sum(journalLines.credit),
      lastJournalAt: sql<Date | null>`max(coalesce(${journalEntries.updatedAt}, ${journalEntries.postedAt}, ${journalEntries.createdAt}))`,
    })
    .from(journalEntries)
    .innerJoin(journalLines, eq(journalLines.entryId, journalEntries.id))
    .where(and(inArray(journalEntries.companyId, companyIds), eq(journalEntries.status, 'posted')))
    .groupBy(journalEntries.companyId)) as TrialReviewRow[];

  const items: FirmReviewItem[] = [];

  for (const row of bankRows) {
    const amount = asNumber(row.amount);
    const suggested = row.matchStatus === 'suggested';
    const amountPriority = priorityFromAmount(amount);
    items.push({
      id: `bank:${row.id}`,
      kind: 'bank_match',
      priority: suggested ? amountPriority : amountPriority === 'critical' ? 'critical' : 'medium',
      companyId: row.companyId,
      companyName: companyName.get(row.companyId) ?? 'Unknown client',
      entityId: row.id,
      entityType: 'bank_transaction',
      title: suggested ? 'Confirm suggested bank match' : 'Match unreconciled bank transaction',
      explanation: `${row.description} for AED ${Math.abs(amount).toLocaleString('en-AE')} is not reconciled.`,
      suggestedAction: suggested ? 'Confirm the suggested match or correct the counterparty before close.' : 'Match to an invoice, receipt, journal entry, or create a transfer.',
      confidence: row.matchConfidence ?? (suggested ? 0.72 : 0.4),
      amountAed: Math.abs(amount),
      dueDate: null,
      href: `/firm/clients/${row.companyId}`,
    });
  }

  for (const row of receiptRows) {
    const amount = asNumber(row.amount) + asNumber(row.vatAmount);
    items.push({
      id: `receipt:${row.id}`,
      kind: 'receipt_posting',
      priority: priorityFromAmount(amount),
      companyId: row.companyId,
      companyName: companyName.get(row.companyId) ?? 'Unknown client',
      entityId: row.id,
      entityType: 'receipt',
      title: 'Review unposted receipt',
      explanation: `${row.merchant ?? 'Receipt'} has not posted to GL or VAT evidence yet.`,
      suggestedAction: row.classifierMethod ? 'Approve the suggested expense account or correct it before posting.' : 'Classify the receipt, confirm VAT treatment, then post.',
      confidence: row.classifierMethod ? 0.68 : 0.35,
      amountAed: amount,
      dueDate: row.date,
      href: `/firm/clients/${row.companyId}`,
    });
  }

  for (const row of anomalyRows) {
    const priority: Priority =
      row.severity === 'critical' ? 'critical' : row.severity === 'high' ? 'high' : 'medium';
    items.push({
      id: `anomaly:${row.id}`,
      kind: 'anomaly',
      priority,
      companyId: row.companyId,
      companyName: companyName.get(row.companyId) ?? 'Unknown client',
      entityId: row.relatedEntityId ?? row.id,
      entityType: row.relatedEntityType ?? 'anomaly',
      title: row.title,
      explanation: row.description,
      suggestedAction: 'Review the source transaction and resolve or document the exception.',
      confidence: row.aiConfidence ?? 0.55,
      amountAed: 0,
      dueDate: null,
      href: `/firm/clients/${row.companyId}`,
    });
  }

  for (const row of vatRows) {
    const dueIn = daysUntil(row.dueDate, now);
    const priority: Priority = dueIn !== null && dueIn < 0 ? 'critical' : dueIn !== null && dueIn <= 7 ? 'high' : 'medium';
    items.push({
      id: `vat:${row.id}`,
      kind: 'vat_review',
      priority,
      companyId: row.companyId,
      companyName: companyName.get(row.companyId) ?? 'Unknown client',
      entityId: row.id,
      entityType: 'vat_return',
      title: 'Review VAT return before deadline',
      explanation: `VAT return is ${row.status}; due ${row.dueDate.toISOString().slice(0, 10)}.`,
      suggestedAction: 'Open the audit pack, clear missing evidence, and submit or mark filed.',
      confidence: 0.95,
      amountAed: asNumber(row.payableTax),
      dueDate: row.dueDate,
      href: `/firm/value-ops?client=${row.companyId}`,
    });
  }

  for (const row of documentRows) {
    const overdue = row.status === 'overdue' || row.dueDate < now;
    items.push({
      id: `document:${row.id}`,
      kind: 'document_request',
      priority: overdue ? 'high' : 'medium',
      companyId: row.companyId,
      companyName: companyName.get(row.companyId) ?? 'Unknown client',
      entityId: row.id,
      entityType: 'document_requirement',
      title: `Request ${row.documentType.replace(/_/g, ' ')}`,
      explanation: row.description ?? `Required document is ${row.status}.`,
      suggestedAction: 'Send a WhatsApp document request and attach the received file to the client vault.',
      confidence: 0.9,
      amountAed: 0,
      dueDate: row.dueDate,
      href: `/firm/comms`,
    });
  }

  for (const row of trialRows) {
    const discrepancy = Math.round(Math.abs(asNumber(row.debit) - asNumber(row.credit)) * 100) / 100;
    if (discrepancy <= 0.01) continue;
    items.push({
      id: `trial:${row.companyId}`,
      kind: 'trial_balance',
      priority: 'critical',
      companyId: row.companyId,
      companyName: companyName.get(row.companyId) ?? 'Unknown client',
      entityId: row.companyId,
      entityType: 'trial_balance',
      title: 'Trial balance discrepancy',
      explanation: `Posted journals are out of balance by AED ${discrepancy.toLocaleString('en-AE')}.`,
      suggestedAction: 'Inspect recent posted journals and reverse or correct the unbalanced entry before close.',
      confidence: 1,
      amountAed: discrepancy,
      dueDate: row.lastJournalAt,
      href: `/firm/clients/${row.companyId}`,
    });
  }

  return items
    .sort((a, b) => {
      const rankDelta = priorityRank(b.priority) - priorityRank(a.priority);
      if (rankDelta !== 0) return rankDelta;
      const confidenceDelta = b.confidence - a.confidence;
      if (Math.abs(confidenceDelta) > 0.01) return confidenceDelta;
      return b.amountAed - a.amountAed;
    })
    .slice(0, 200);
}
