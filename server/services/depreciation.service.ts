import { storage } from '../storage';
import { createLogger } from '../config/logger';
import type { FixedAsset, DepreciationSchedule, InsertDepreciationSchedule } from '../../shared/schema';

const log = createLogger('depreciation');

/**
 * Calculate monthly depreciation amount for an asset.
 */
export function calculateMonthlyDepreciation(
  method: string,
  purchasePrice: number,
  residualValue: number,
  usefulLifeMonths: number,
  currentBookValue: number,
): number {
  if (method === 'declining_balance') {
    const usefulLifeYears = usefulLifeMonths / 12;
    // When residualValue is 0, Math.pow(0/price, 1/n) = 0, making rate = 1.0 (100%).
    // Use double-declining balance method instead: rate = 2 / usefulLifeYears.
    const rate = residualValue <= 0
      ? (2 / usefulLifeYears)
      : 1 - Math.pow(residualValue / purchasePrice, 1 / usefulLifeYears);
    const annualDep = currentBookValue * rate;
    const monthly = annualDep / 12;
    // Don't depreciate below residual value (guard against negative values)
    return Math.max(0, Math.min(monthly, currentBookValue - residualValue));
  }

  // Default: straight_line
  const totalDepreciable = purchasePrice - residualValue;
  const monthly = totalDepreciable / usefulLifeMonths;
  // Guard against negative depreciation when bookValue < residualValue
  return Math.max(0, Math.min(monthly, currentBookValue - residualValue));
}

/**
 * Generate the full depreciation schedule for an asset.
 * Creates DepreciationSchedule records (status: pending) for each month
 * from purchase date through end of useful life.
 */
export async function generateDepreciationSchedule(assetId: string): Promise<DepreciationSchedule[]> {
  const asset = await storage.getFixedAsset(assetId);
  if (!asset) throw new Error('Asset not found');
  if (asset.status !== 'active') throw new Error('Asset is not active');

  // Delete any existing pending schedules
  await storage.deleteDepreciationSchedulesByAssetId(assetId);

  const schedules: DepreciationSchedule[] = [];
  let bookValue = asset.purchasePrice;
  let accumulatedDep = 0;
  const startDate = new Date(asset.purchaseDate);

  for (let month = 0; month < asset.usefulLifeMonths; month++) {
    const periodStart = new Date(startDate);
    periodStart.setMonth(periodStart.getMonth() + month);

    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    periodEnd.setDate(periodEnd.getDate() - 1);

    const depAmount = calculateMonthlyDepreciation(
      asset.depreciationMethod,
      asset.purchasePrice,
      asset.residualValue,
      asset.usefulLifeMonths,
      bookValue,
    );

    if (depAmount <= 0) break; // Fully depreciated

    accumulatedDep += depAmount;
    bookValue -= depAmount;

    const schedule = await storage.createDepreciationSchedule({
      fixedAssetId: assetId,
      periodStart,
      periodEnd,
      depreciationAmount: Math.round(depAmount * 100) / 100,
      accumulatedDepreciation: Math.round(accumulatedDep * 100) / 100,
      bookValue: Math.round(bookValue * 100) / 100,
      status: 'pending',
    });
    schedules.push(schedule);
  }

  log.info({ assetId, periods: schedules.length }, 'Depreciation schedule generated');
  return schedules;
}

/**
 * Post a depreciation entry -- creates a journal entry debiting depreciation expense
 * and crediting accumulated depreciation. Marks the schedule as posted.
 */
export async function postDepreciationEntry(
  scheduleId: string,
  userId: string,
): Promise<void> {
  const schedule = await storage.getDepreciationSchedule(scheduleId);
  if (!schedule) throw new Error('Schedule not found');
  if (schedule.status === 'posted') throw new Error('Already posted');

  const asset = await storage.getFixedAsset(schedule.fixedAssetId);
  if (!asset) throw new Error('Asset not found');
  if (!asset.depreciationExpenseAccountId || !asset.accumulatedDepAccountId) {
    throw new Error('Asset missing depreciation accounts');
  }

  const { entry } = await storage.createJournalEntryWithLines(
    asset.companyId,
    schedule.periodEnd,
    {
      memo: `Depreciation: ${asset.name} (${asset.assetCode}) — ${schedule.periodStart.toISOString().slice(0, 7)}`,
      status: 'posted',
      source: 'system',
      sourceId: asset.id,
      createdBy: userId,
      postedBy: userId,
    },
    [
      {
        accountId: asset.depreciationExpenseAccountId,
        debit: schedule.depreciationAmount,
        credit: 0,
        description: `Depreciation expense: ${asset.name}`,
      },
      {
        accountId: asset.accumulatedDepAccountId,
        debit: 0,
        credit: schedule.depreciationAmount,
        description: `Accumulated depreciation: ${asset.name}`,
      },
    ],
  );

  // Update schedule
  await storage.updateDepreciationSchedule(scheduleId, {
    status: 'posted',
    journalEntryId: entry.id,
  });

  // Check if fully depreciated
  const remainingSchedules = await storage.getDepreciationSchedulesByAssetId(asset.id);
  const allPosted = remainingSchedules.every((s: DepreciationSchedule) => s.status === 'posted');
  if (allPosted) {
    await storage.updateFixedAsset(asset.id, { status: 'fully_depreciated' });
    log.info({ assetId: asset.id }, 'Asset fully depreciated');
  }

  log.info({ scheduleId, entryId: entry.id }, 'Depreciation entry posted');
}

/**
 * Post all pending depreciation entries up to a given date.
 */
export async function postPendingDepreciation(
  companyId: string,
  throughDate: Date,
  userId: string,
): Promise<number> {
  const pending = await storage.getPendingDepreciationSchedules(companyId);
  let posted = 0;

  for (const schedule of pending) {
    if (schedule.periodEnd <= throughDate) {
      await postDepreciationEntry(schedule.id, userId);
      posted++;
    }
  }

  log.info({ companyId, posted, throughDate }, 'Batch depreciation posted');
  return posted;
}

/**
 * Record asset disposal -- creates a journal entry for the disposal
 * and marks the asset as disposed.
 */
export async function disposeAsset(
  assetId: string,
  disposalDate: Date,
  disposalPrice: number,
  userId: string,
): Promise<void> {
  const asset = await storage.getFixedAsset(assetId);
  if (!asset) throw new Error('Asset not found');
  if (asset.status === 'disposed') throw new Error('Asset already disposed');
  if (!asset.assetAccountId || !asset.accumulatedDepAccountId) {
    throw new Error('Asset missing accounts');
  }

  // Calculate accumulated depreciation from posted schedules
  const schedules = await storage.getDepreciationSchedulesByAssetId(assetId);
  const postedSchedules = schedules.filter((s: DepreciationSchedule) => s.status === 'posted');
  const accumulatedDep = postedSchedules.length > 0
    ? postedSchedules[postedSchedules.length - 1].accumulatedDepreciation
    : 0;

  const bookValue = asset.purchasePrice - accumulatedDep;
  const gainLoss = disposalPrice - bookValue;

  // Gain/loss account: use the depreciation expense account as a reasonable default
  const gainLossAccountId = asset.depreciationExpenseAccountId || asset.accumulatedDepAccountId;

  // Build lines conditionally
  const disposalLines: Array<{ accountId: string; debit: number; credit: number; description: string }> = [];

  // Debit accumulated depreciation (remove contra-asset)
  if (accumulatedDep > 0) {
    disposalLines.push({
      accountId: asset.accumulatedDepAccountId,
      debit: accumulatedDep,
      credit: 0,
      description: `Remove accumulated depreciation: ${asset.name}`,
    });
  }

  // Debit cash/bank for disposal proceeds
  if (disposalPrice > 0) {
    disposalLines.push({
      accountId: asset.assetAccountId,
      debit: disposalPrice,
      credit: 0,
      description: `Disposal proceeds: ${asset.name}`,
    });
  }

  // Credit the asset account (remove the asset at purchase price)
  disposalLines.push({
    accountId: asset.assetAccountId,
    debit: 0,
    credit: asset.purchasePrice,
    description: `Dispose asset: ${asset.name}`,
  });

  // Record gain or loss
  if (gainLoss > 0) {
    disposalLines.push({
      accountId: gainLossAccountId,
      debit: 0,
      credit: gainLoss,
      description: `Gain on disposal: ${asset.name}`,
    });
  } else if (gainLoss < 0) {
    disposalLines.push({
      accountId: gainLossAccountId,
      debit: Math.abs(gainLoss),
      credit: 0,
      description: `Loss on disposal: ${asset.name}`,
    });
  }

  const { entry } = await storage.createJournalEntryWithLines(
    asset.companyId,
    disposalDate,
    {
      memo: `Disposal of asset: ${asset.name} (${asset.assetCode})` +
        (gainLoss !== 0 ? ` — ${gainLoss > 0 ? 'gain' : 'loss'} of ${Math.abs(gainLoss).toFixed(2)} recorded to depreciation expense account` : ''),
      status: 'posted',
      source: 'system',
      sourceId: asset.id,
      createdBy: userId,
      postedBy: userId,
    },
    disposalLines,
  );

  // Delete remaining pending schedules
  await storage.deleteDepreciationSchedulesByAssetId(assetId);

  // Update asset
  await storage.updateFixedAsset(assetId, {
    status: 'disposed',
    disposalDate,
    disposalPrice,
    disposalJournalEntryId: entry.id,
  });

  log.info({ assetId, disposalPrice, gainLoss, entryId: entry.id }, 'Asset disposed');
}
