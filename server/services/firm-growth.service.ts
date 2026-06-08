import { and,desc,eq,inArray,sql } from 'drizzle-orm';

import {
bankTransactions,
companies,
firmGrowthActions,
firmGrowthOpportunities,
invoices,
receipts,
} from '../../shared/schema';
import { db } from '../db';

export type GrowthOpportunityStatus = 'open' | 'accepted' | 'snoozed' | 'dismissed' | 'completed';
export type GrowthOpportunityPriority = 'critical' | 'high' | 'medium' | 'low';
export type GrowthOpportunityType =
  | 'service_ar'
  | 'cleanup'
  | 'advisory_pack'
  | 'audit_pack'
  | 'cfo_pack'
  | 'compliance_extra';

export interface GrowthCandidate {
  companyId: string;
  sourceKey: string;
  opportunityType: GrowthOpportunityType;
  sourceSignal: string;
  title: string;
  reason: string;
  estimatedValue: number;
  confidence: number;
  priority: GrowthOpportunityPriority;
  dueDate?: Date | null;
  metadata?: Record<string, unknown>;
}

type GrowthInvoiceStats = {
  companyId: string;
  invoiceCount: string;
  openAr: string;
  overdueCount: string;
};

type GrowthReceiptStats = {
  companyId: string;
  unpostedCount: string;
  receiptCount: string;
};

type GrowthBankStats = {
  companyId: string;
  unreconciledCount: string;
  bankCount: string;
};

type GrowthSummary = {
  estimated: number;
  accepted: number;
  completed: number;
  missed: number;
  openCount: number;
};

function money(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function priorityFor(value: number, critical: number, high: number): GrowthOpportunityPriority {
  if (value >= critical) return 'critical';
  if (value >= high) return 'high';
  return 'medium';
}

export async function buildGrowthCandidates(companyIds: string[]): Promise<GrowthCandidate[]> {
  if (companyIds.length === 0) return [];

  const [clientRows, invoiceRows, receiptRows, bankRows] = await Promise.all([
    db
      .select({
        id: companies.id,
        name: companies.name,
        trnVatNumber: companies.trnVatNumber,
        corporateTaxId: companies.corporateTaxId,
      })
      .from(companies)
      .where(and(inArray(companies.id, companyIds), eq(companies.companyType, 'client'))),
    db
      .select({
        companyId: invoices.companyId,
        invoiceCount: sql<string>`count(*)`,
        openAr: sql<string>`coalesce(sum(case when ${invoices.status} in ('sent','partial') then ${invoices.total} else 0 end), 0)`,
        overdueCount: sql<string>`count(*) filter (where ${invoices.status} in ('sent','partial') and ${invoices.dueDate} < now())`,
      })
      .from(invoices)
      .where(inArray(invoices.companyId, companyIds))
      .groupBy(invoices.companyId),
    db
      .select({
        companyId: receipts.companyId,
        unpostedCount: sql<string>`count(*) filter (where ${receipts.posted} = false)`,
        receiptCount: sql<string>`count(*)`,
      })
      .from(receipts)
      .where(inArray(receipts.companyId, companyIds))
      .groupBy(receipts.companyId),
    db
      .select({
        companyId: bankTransactions.companyId,
        unreconciledCount: sql<string>`count(*) filter (where ${bankTransactions.isReconciled} = false)`,
        bankCount: sql<string>`count(*)`,
      })
      .from(bankTransactions)
      .where(inArray(bankTransactions.companyId, companyIds))
      .groupBy(bankTransactions.companyId),
  ]);

  const invoicesByCompany = new Map<string, GrowthInvoiceStats>(
    (invoiceRows as GrowthInvoiceStats[]).map((row: GrowthInvoiceStats) => [row.companyId, row]),
  );
  const receiptsByCompany = new Map<string, GrowthReceiptStats>(
    (receiptRows as GrowthReceiptStats[]).map((row: GrowthReceiptStats) => [row.companyId, row]),
  );
  const bankByCompany = new Map<string, GrowthBankStats>(
    (bankRows as GrowthBankStats[]).map((row: GrowthBankStats) => [row.companyId, row]),
  );
  const candidates: GrowthCandidate[] = [];

  for (const client of clientRows) {
    const invoiceStats = invoicesByCompany.get(client.id);
    const receiptStats = receiptsByCompany.get(client.id);
    const bankStats = bankByCompany.get(client.id);
    const openAr = money(invoiceStats?.openAr);
    const overdueCount = Number(invoiceStats?.overdueCount ?? 0);
    const invoiceCount = Number(invoiceStats?.invoiceCount ?? 0);
    const unpostedCount = Number(receiptStats?.unpostedCount ?? 0);
    const unreconciledCount = Number(bankStats?.unreconciledCount ?? 0);
    const cleanupItems = unpostedCount + unreconciledCount;

    if (openAr >= 2500 || overdueCount > 0) {
      candidates.push({
        companyId: client.id,
        sourceKey: `${client.id}:service-ar`,
        opportunityType: 'service_ar',
        sourceSignal: 'overdue_service_ar',
        title: 'Recover NRA service AR',
        reason: `${client.name} has ${overdueCount} overdue invoice(s) and AED ${Math.round(openAr).toLocaleString('en-AE')} open AR.`,
        estimatedValue: Math.max(500, Math.round(openAr * 0.05)),
        confidence: 0.78,
        priority: priorityFor(openAr, 25000, 10000),
        metadata: { openAr, overdueCount },
      });
    }

    if (cleanupItems >= 5) {
      candidates.push({
        companyId: client.id,
        sourceKey: `${client.id}:cleanup`,
        opportunityType: 'cleanup',
        sourceSignal: 'cleanup_workload',
        title: 'Bill cleanup work',
        reason: `${cleanupItems} VAT/bookkeeping source items need cleanup before the file is ready.`,
        estimatedValue: Math.max(750, cleanupItems * 45),
        confidence: 0.72,
        priority: priorityFor(cleanupItems, 40, 15),
        metadata: { unpostedCount, unreconciledCount },
      });
    }

    if (invoiceCount >= 30 || openAr >= 50000) {
      candidates.push({
        companyId: client.id,
        sourceKey: `${client.id}:cfo-pack`,
        opportunityType: 'cfo_pack',
        sourceSignal: 'high_activity_client',
        title: 'Offer monthly CFO pack',
        reason: `${client.name} has enough transaction volume or AR exposure for a higher-value advisory cadence.`,
        estimatedValue: 2500,
        confidence: 0.62,
        priority: openAr >= 75000 ? 'high' : 'medium',
        metadata: { invoiceCount, openAr },
      });
    }

    if (!client.trnVatNumber || !client.corporateTaxId) {
      const missing = [
        !client.trnVatNumber ? 'VAT TRN' : null,
        !client.corporateTaxId ? 'corporate tax registration' : null,
      ].filter(Boolean).join(' and ');
      candidates.push({
        companyId: client.id,
        sourceKey: `${client.id}:compliance-extra`,
        opportunityType: 'compliance_extra',
        sourceSignal: 'missing_tax_registration',
        title: 'Compliance setup opportunity',
        reason: `${client.name} is missing ${missing}.`,
        estimatedValue: 1200,
        confidence: 0.68,
        priority: 'high',
        metadata: { missingTrn: !client.trnVatNumber, missingCorporateTaxId: !client.corporateTaxId },
      });
    }
  }

  return candidates;
}

export async function refreshGrowthOpportunities(companyIds: string[]) {
  const candidates = await buildGrowthCandidates(companyIds);
  if (candidates.length === 0) return { generated: 0, skippedClosed: 0 };

  const existing = await db
    .select({
      sourceKey: firmGrowthOpportunities.sourceKey,
      status: firmGrowthOpportunities.status,
    })
    .from(firmGrowthOpportunities)
    .where(inArray(firmGrowthOpportunities.sourceKey, candidates.map(c => c.sourceKey)));

  const closed = new Set(
    (existing as Array<{ sourceKey: string; status: string }>)
      .filter((row: { sourceKey: string; status: string }) => row.status === 'completed' || row.status === 'dismissed')
      .map((row: { sourceKey: string; status: string }) => row.sourceKey),
  );
  let generated = 0;
  let skippedClosed = 0;

  for (const candidate of candidates) {
    if (closed.has(candidate.sourceKey)) {
      skippedClosed += 1;
      continue;
    }

    await db
      .insert(firmGrowthOpportunities)
      .values({
        companyId: candidate.companyId,
        sourceKey: candidate.sourceKey,
        opportunityType: candidate.opportunityType,
        sourceSignal: candidate.sourceSignal,
        title: candidate.title,
        reason: candidate.reason,
        estimatedValue: candidate.estimatedValue,
        confidence: candidate.confidence,
        priority: candidate.priority,
        status: 'open',
        dueDate: candidate.dueDate ?? null,
        metadata: candidate.metadata ?? {},
      } as any)
      .onConflictDoUpdate({
        target: firmGrowthOpportunities.sourceKey,
        set: {
          title: candidate.title,
          reason: candidate.reason,
          estimatedValue: candidate.estimatedValue,
          confidence: candidate.confidence,
          priority: candidate.priority,
          dueDate: candidate.dueDate ?? null,
          metadata: candidate.metadata ?? {},
          updatedAt: new Date(),
        } as any,
      });
    generated += 1;
  }

  return { generated, skippedClosed };
}

export async function listGrowthOpportunities(companyIds: string[]) {
  if (companyIds.length === 0) {
    return {
      summary: { estimated: 0, accepted: 0, completed: 0, missed: 0, openCount: 0 },
      opportunities: [],
    };
  }

  const rows = await db
    .select({
      id: firmGrowthOpportunities.id,
      companyId: firmGrowthOpportunities.companyId,
      companyName: companies.name,
      sourceKey: firmGrowthOpportunities.sourceKey,
      opportunityType: firmGrowthOpportunities.opportunityType,
      sourceSignal: firmGrowthOpportunities.sourceSignal,
      title: firmGrowthOpportunities.title,
      reason: firmGrowthOpportunities.reason,
      estimatedValue: firmGrowthOpportunities.estimatedValue,
      confidence: firmGrowthOpportunities.confidence,
      priority: firmGrowthOpportunities.priority,
      status: firmGrowthOpportunities.status,
      ownerUserId: firmGrowthOpportunities.ownerUserId,
      dueDate: firmGrowthOpportunities.dueDate,
      snoozedUntil: firmGrowthOpportunities.snoozedUntil,
      resolvedAt: firmGrowthOpportunities.resolvedAt,
      resolutionNote: firmGrowthOpportunities.resolutionNote,
      metadata: firmGrowthOpportunities.metadata,
      createdAt: firmGrowthOpportunities.createdAt,
      updatedAt: firmGrowthOpportunities.updatedAt,
    })
    .from(firmGrowthOpportunities)
    .leftJoin(companies, eq(companies.id, firmGrowthOpportunities.companyId))
    .where(inArray(firmGrowthOpportunities.companyId, companyIds))
    .orderBy(desc(firmGrowthOpportunities.updatedAt));

  const summary = (rows as Array<{ estimatedValue: unknown; status: string }>).reduce<GrowthSummary>(
    (acc: GrowthSummary, row: { estimatedValue: unknown; status: string }) => {
      const value = money(row.estimatedValue);
      if (row.status === 'completed') acc.completed += value;
      else if (row.status === 'accepted') acc.accepted += value;
      else if (row.status === 'dismissed') acc.missed += value;
      else {
        acc.estimated += value;
        acc.openCount += 1;
      }
      return acc;
    },
    { estimated: 0, accepted: 0, completed: 0, missed: 0, openCount: 0 },
  );

  return { summary, opportunities: rows };
}

export async function updateGrowthOpportunity(
  opportunityId: string,
  actorUserId: string,
  data: {
    status?: GrowthOpportunityStatus;
    ownerUserId?: string | null;
    snoozedUntil?: Date | null;
    resolutionNote?: string | null;
    note?: string | null;
    actionType: string;
  },
) {
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (data.status) update.status = data.status;
  if ('ownerUserId' in data) update.ownerUserId = data.ownerUserId ?? null;
  if ('snoozedUntil' in data) update.snoozedUntil = data.snoozedUntil ?? null;
  if ('resolutionNote' in data) update.resolutionNote = data.resolutionNote ?? null;
  if (data.status === 'completed' || data.status === 'dismissed') update.resolvedAt = new Date();

  const [updated] = await db
    .update(firmGrowthOpportunities)
    .set(update as any)
    .where(eq(firmGrowthOpportunities.id, opportunityId))
    .returning();

  if (!updated) return null;

  await db.insert(firmGrowthActions).values({
    opportunityId,
    actorUserId,
    actionType: data.actionType,
    channel: 'internal',
    deliveryState: 'logged',
    note: data.note ?? data.resolutionNote ?? null,
    metadata: {
      status: data.status,
      ownerUserId: data.ownerUserId,
      snoozedUntil: data.snoozedUntil?.toISOString(),
    },
  } as any);

  return updated;
}
