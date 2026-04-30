import type { Express, Request, Response } from 'express';
import { pool } from '../db';
import { storage } from '../storage';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { createLogger } from '../config/logger';
import { assertPeriodNotLocked } from '../services/period-lock.service';

const log = createLogger('fixed-assets');

// Same advisory-lock hash function used by storage.generateEntryNumber so
// concurrent batch runs serialise on the same key. Keeps tx-scoped JE
// numbering collision-free without piggy-backing on the storage layer.
function hashStringToInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

// Allocate the next entry number from a per-(company, date) counter held
// in-memory for the duration of a transaction. Caller must hold an advisory
// xact lock for the same (company, date) so a parallel transaction can't
// recompute the same MAX. Returns a closure that produces JE-YYYYMMDD-NNN.
async function makeEntryNumberAllocator(
  client: any,
  companyId: string,
  date: Date,
): Promise<() => string> {
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `JE-${dateStr}`;
  const counterStart = prefix.length + 2; // 1-based SUBSTRING start position
  const likePattern = prefix + '-%';

  const result = await client.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(entry_number FROM $1) AS INTEGER)), 0) AS max_seq
       FROM journal_entries
      WHERE company_id = $2 AND entry_number LIKE $3`,
    [counterStart, companyId, likePattern],
  );
  let nextSeq = Number(result.rows[0]?.max_seq ?? 0) + 1;
  return () => {
    const num = `${prefix}-${String(nextSeq).padStart(3, '0')}`;
    nextSeq++;
    return num;
  };
}

// Inline JE insert that participates in the caller's transaction. Mirrors
// storage.createJournalEntry's contract (balanced lines required) but keeps
// every write on the same connection so the outer BEGIN/COMMIT actually
// covers it.
async function insertJournalEntryTx(
  client: any,
  entry: {
    companyId: string;
    entryNumber: string;
    date: Date;
    memo: string;
    status: string;
    source: string;
    sourceId: string | null;
    createdBy: string;
    postedBy: string | null;
    postedAt: Date | null;
  },
  lines: Array<{ accountId: string; debit: number; credit: number; description: string }>,
): Promise<{ id: string }> {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('Journal entry must have at least one line');
  }
  const totalDebit = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(
      `Journal entry is unbalanced: debits ${totalDebit.toFixed(2)} ≠ credits ${totalCredit.toFixed(2)}`,
    );
  }

  const inserted = await client.query(
    `INSERT INTO journal_entries
       (company_id, entry_number, date, memo, status, source, source_id, created_by, posted_by, posted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      entry.companyId, entry.entryNumber, entry.date, entry.memo, entry.status,
      entry.source, entry.sourceId, entry.createdBy, entry.postedBy, entry.postedAt,
    ],
  );
  const entryId = inserted.rows[0].id;
  for (const line of lines) {
    await client.query(
      `INSERT INTO journal_lines (entry_id, account_id, debit, credit, description)
       VALUES ($1, $2, $3, $4, $5)`,
      [entryId, line.accountId, line.debit, line.credit, line.description],
    );
  }
  return { id: entryId };
}

// Round to 2dp using banker-safe HALF_UP (sufficient for AED).
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function daysInMonth(year: number, month: number): number {
  // month is 1-12. Date(year, month, 0) gives last day of (month).
  return new Date(year, month, 0).getDate();
}

// Land is held indefinitely and never depreciates under IAS 16. The check is
// case-insensitive so 'Land' from the UI dropdown and 'land' from raw API
// callers both match.
function isNonDepreciableCategory(category: string | null | undefined): boolean {
  return (category ?? '').trim().toLowerCase() === 'land';
}

interface DepreciationCalc {
  monthlyDepreciation: number;
  newAccumulatedDepreciation: number;
  newNetBookValue: number;
  prorationFactor: number; // 1.0 = full month, <1.0 = prorated first month
  fullyDepreciated: boolean;
  skipped?: boolean;
  skipReason?: string;
}

/**
 * Compute depreciation for a single (asset, period) using:
 *   - straight-line: remaining-depreciable / remaining-months,
 *     so a change to useful_life or salvage automatically reshapes
 *     the schedule for *future* periods only.
 *   - declining-balance: 2/n * NBV / 12.
 *
 * Both methods are capped so accumulated_depreciation never exceeds
 * (cost - salvage), and the first month posts a prorated amount
 * based on acquisition day (e.g. acquired on the 16th of a 30-day
 * month = 15/30 = 0.5 month).
 *
 * `monthsAlreadyDepreciated` is COUNT(*) of depreciation_schedules
 * rows strictly *before* this (year, month). Pass 0 for the first
 * period.
 */
function calculateDepreciation(
  asset: any,
  periodYear: number,
  periodMonth: number,
  monthsAlreadyDepreciated: number,
): DepreciationCalc {
  const cost = parseFloat(asset.purchase_cost);
  const salvage = parseFloat(asset.salvage_value || 0);
  const usefulLifeYears = asset.useful_life_years;
  const currentAccDep = parseFloat(asset.accumulated_depreciation || 0);
  const method = asset.depreciation_method || 'straight_line';

  // Land never depreciates under IAS 16, and assets without a useful_life
  // can't be straight-lined. Bail out before any math runs so callers can
  // distinguish "skipped because non-depreciable" from "skipped because
  // already fully depreciated".
  if (isNonDepreciableCategory(asset.category) || usefulLifeYears === null || usefulLifeYears === undefined) {
    return {
      monthlyDepreciation: 0,
      newAccumulatedDepreciation: currentAccDep,
      newNetBookValue: round2(cost - currentAccDep),
      prorationFactor: 1,
      fullyDepreciated: false,
      skipped: true,
      skipReason: isNonDepreciableCategory(asset.category)
        ? 'Land is non-depreciable'
        : 'Asset has no useful_life_years',
    };
  }

  const totalMonths = usefulLifeYears * 12;
  const maxDepreciation = cost - salvage;
  const remainingDepreciable = Math.max(0, maxDepreciation - currentAccDep);

  let monthlyDepreciation = 0;

  if (remainingDepreciable <= 0) {
    return {
      monthlyDepreciation: 0,
      newAccumulatedDepreciation: currentAccDep,
      newNetBookValue: round2(cost - currentAccDep),
      prorationFactor: 1,
      fullyDepreciated: true,
    };
  }

  if (method === 'straight_line') {
    // Recompute over remaining life — change in useful_life or method
    // automatically propagates from this period forward without
    // touching past entries.
    const monthsRemaining = Math.max(1, totalMonths - monthsAlreadyDepreciated);
    monthlyDepreciation = remainingDepreciable / monthsRemaining;
  } else if (method === 'declining_balance') {
    const currentNBV = cost - currentAccDep;
    const annualRate = 2 / usefulLifeYears;
    monthlyDepreciation = (currentNBV * annualRate) / 12;
  } else {
    monthlyDepreciation = remainingDepreciable / Math.max(1, totalMonths - monthsAlreadyDepreciated);
  }

  // First-month proration — based on actual months elapsed between
  // acquisition and the depreciation period, not a row count. The first
  // posting period (whether it's the acquisition month or a backfill of
  // the acquisition month) gets the partial-day fraction; every subsequent
  // period gets a full month even if the schedule had gaps.
  const purchaseDate = asset.purchase_date instanceof Date
    ? asset.purchase_date
    : new Date(asset.purchase_date);
  const purchaseYear = purchaseDate.getUTCFullYear();
  const purchaseMonth = purchaseDate.getUTCMonth() + 1; // 1-12
  const purchaseDay = purchaseDate.getUTCDate();

  // Months elapsed from acquisition date to the END of the target period.
  // 0 for the acquisition month itself; 1 for the next calendar month; etc.
  const monthsElapsed =
    (periodYear - purchaseYear) * 12 + (periodMonth - purchaseMonth);

  let prorationFactor = 1;
  if (monthsElapsed === 0) {
    // Acquisition month — partial month based on purchase day.
    const dim = daysInMonth(periodYear, periodMonth);
    prorationFactor = (dim - purchaseDay + 1) / dim;
    monthlyDepreciation *= prorationFactor;
  }

  // Cap so accumulated_depreciation never breaches (cost - salvage)
  // and NBV never drifts below salvage from rounding.
  if (monthlyDepreciation > remainingDepreciable) {
    monthlyDepreciation = remainingDepreciable;
  }
  if (monthlyDepreciation < 0) {
    monthlyDepreciation = 0;
  }

  monthlyDepreciation = round2(monthlyDepreciation);
  const newAccDep = round2(currentAccDep + monthlyDepreciation);
  const newNBV = round2(cost - newAccDep);

  return {
    monthlyDepreciation,
    newAccumulatedDepreciation: newAccDep,
    newNetBookValue: newNBV,
    prorationFactor,
    fullyDepreciated: newAccDep >= maxDepreciation - 0.005,
  };
}

async function countMonthsAlreadyDepreciated(
  assetId: string,
  beforeYear: number,
  beforeMonth: number,
): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS n
       FROM depreciation_schedules
      WHERE asset_id = $1
        AND (period_year < $2 OR (period_year = $2 AND period_month < $3))`,
    [assetId, beforeYear, beforeMonth],
  );
  return result.rows[0]?.n ?? 0;
}

export function registerFixedAssetRoutes(app: Express) {
  // =====================================
  // Fixed Asset CRUD
  // =====================================

  // List all fixed assets for a company
  app.get("/api/companies/:companyId/fixed-assets", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const result = await pool.query(
      `SELECT * FROM fixed_assets WHERE company_id = $1 ORDER BY created_at DESC`,
      [companyId]
    );
    res.json(result.rows);
  }));

  // Get single fixed asset
  app.get("/api/fixed-assets/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const result = await pool.query(`SELECT * FROM fixed_assets WHERE id = $1`, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Fixed asset not found' });
    }

    const asset = result.rows[0];
    const hasAccess = await storage.hasCompanyAccess(userId, asset.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(asset);
  }));

  // Create fixed asset
  app.post("/api/companies/:companyId/fixed-assets", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const {
      assetName, assetNameAr, assetNumber, category, purchaseDate,
      purchaseCost, salvageValue, usefulLifeYears, depreciationMethod,
      location, serialNumber, notes, paymentAccountId
    } = req.body;

    // Land has no useful life, so usefulLifeYears is optional for it but
    // mandatory for everything else. Validate accordingly.
    const isLand = isNonDepreciableCategory(category);
    if (!assetName || !category || !purchaseDate || purchaseCost === undefined) {
      return res.status(400).json({ message: 'assetName, category, purchaseDate, and purchaseCost are required' });
    }
    if (!isLand && !usefulLifeYears) {
      return res.status(400).json({ message: 'usefulLifeYears is required for depreciable assets' });
    }

    // Cost must be a non-negative number; salvage cannot exceed cost.
    const cost = parseFloat(purchaseCost);
    if (!Number.isFinite(cost) || cost < 0) {
      return res.status(400).json({ message: 'purchaseCost must be a non-negative number' });
    }
    const salvage = parseFloat(salvageValue || 0);
    if (!Number.isFinite(salvage) || salvage < 0) {
      return res.status(400).json({ message: 'salvageValue must be a non-negative number' });
    }
    if (salvage > cost) {
      return res.status(400).json({ message: 'salvageValue cannot exceed purchaseCost' });
    }

    // Block creating an asset purchased inside a locked period — the
    // capitalization/depreciation journal entries derive from purchase_date.
    await assertPeriodNotLocked(companyId, purchaseDate);

    // Resolve the payment account up-front so we can fail fast before
    // inserting the asset row when an invalid account id is supplied.
    let paymentAccount: any = null;
    if (paymentAccountId) {
      const companyAccounts = await storage.getAccountsByCompanyId(companyId);
      paymentAccount = companyAccounts.find(a => a.id === paymentAccountId);
      if (!paymentAccount) {
        return res.status(400).json({ message: `paymentAccountId ${paymentAccountId} not found in company chart of accounts` });
      }
    }

    const nbv = cost - 0; // Initial NBV = cost (no depreciation yet)
    const needsCapJe = !paymentAccountId;
    const lifeYears = isLand ? null : usefulLifeYears;

    const result = await pool.query(
      `INSERT INTO fixed_assets (company_id, asset_name, asset_name_ar, asset_number, category, purchase_date, purchase_cost, salvage_value, useful_life_years, depreciation_method, accumulated_depreciation, net_book_value, location, serial_number, notes, needs_capitalization_je)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, $11, $12, $13, $14, $15)
       RETURNING *`,
      [companyId, assetName, assetNameAr || null, assetNumber || null, category, purchaseDate, cost, salvage, lifeYears, depreciationMethod || 'straight_line', nbv, location || null, serialNumber || null, notes || null, needsCapJe]
    );

    const asset = result.rows[0];
    let capitalizationJournalEntryId: string | null = null;

    // If a paymentAccountId was supplied, post the capitalization JE:
    //   Dr  1290 Fixed Assets at Cost      cost
    //   Cr  <paymentAccountId>             cost
    // Failure rolls back the asset insert so we don't leave a dangling row
    // that would then need a manual correction.
    if (paymentAccount) {
      try {
        const companyAccounts = await storage.getAccountsByCompanyId(companyId);
        const fixedAssetCostAccount = companyAccounts.find(a => a.code === '1290' && a.isSystemAccount);
        if (!fixedAssetCostAccount) {
          throw new Error('Fixed Assets at Cost account (1290) not found — run migrations to create it');
        }

        const entryDate = new Date(purchaseDate);
        const entryNumber = await storage.generateEntryNumber(companyId, entryDate);
        const je = await storage.createJournalEntry(
          {
            companyId,
            date: entryDate,
            memo: `Capitalization: ${assetName}`,
            entryNumber,
            status: 'posted',
            source: 'system',
            sourceId: asset.id,
            createdBy: userId,
            postedBy: userId,
            postedAt: new Date(),
          },
          [
            { accountId: fixedAssetCostAccount.id, debit: round2(cost), credit: 0, description: `Capitalize ${assetName}` },
            { accountId: paymentAccount.id, debit: 0, credit: round2(cost), description: `Payment for ${assetName}` },
          ],
        );
        capitalizationJournalEntryId = je.id;
      } catch (err) {
        await pool
          .query(`DELETE FROM fixed_assets WHERE id = $1`, [asset.id])
          .catch((cleanupErr: unknown) => log.error({ assetId: asset.id, cleanupErr }, 'Failed to roll back asset insert after capitalization JE failure'));
        throw err;
      }
    }

    log.info({
      assetId: asset.id,
      companyId,
      capitalizationJournalEntryId,
      needsCapitalizationJe: needsCapJe,
    }, 'Fixed asset created');
    res.json({ ...asset, capitalizationJournalEntryId });
  }));

  // Update fixed asset
  app.patch("/api/fixed-assets/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const existing = await pool.query(`SELECT * FROM fixed_assets WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Fixed asset not found' });
    }

    const asset = existing.rows[0];
    const hasAccess = await storage.hasCompanyAccess(userId, asset.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const {
      assetName, assetNameAr, assetNumber, category, purchaseDate,
      purchaseCost, salvageValue, usefulLifeYears, depreciationMethod,
      location, serialNumber, notes, status
    } = req.body;

    // Block updates that touch a locked period — both the existing purchase
    // date and the requested new purchase date.
    await assertPeriodNotLocked(asset.company_id, asset.purchase_date);
    if (purchaseDate) {
      await assertPeriodNotLocked(asset.company_id, purchaseDate);
    }

    // Detect changes that require re-deriving future-period depreciation.
    // Past entries (rows already in depreciation_schedules) stay frozen — the
    // calculator treats already-depreciated months as immutable inputs and
    // spreads the remaining depreciable amount over the new remaining life.
    const willChangeUsefulLife = usefulLifeYears !== undefined
      && Number(usefulLifeYears) !== Number(asset.useful_life_years);
    const willChangeMethod = depreciationMethod !== undefined
      && depreciationMethod !== asset.depreciation_method;
    const willChangeSalvage = salvageValue !== undefined
      && parseFloat(salvageValue) !== parseFloat(asset.salvage_value || 0);
    const willChangePurchaseCost = purchaseCost !== undefined
      && parseFloat(purchaseCost) !== parseFloat(asset.purchase_cost);

    // Block useful-life shortening that would force the new schedule to
    // re-depreciate the past — i.e. months already booked must not exceed
    // the new total life.
    if (willChangeUsefulLife) {
      const monthsBooked = await countMonthsAlreadyDepreciated(id, 9999, 12);
      const newTotalMonths = Number(usefulLifeYears) * 12;
      if (monthsBooked >= newTotalMonths) {
        return res.status(400).json({
          message: `Cannot shorten useful life — ${monthsBooked} months already depreciated, new useful_life would only cover ${newTotalMonths} months`,
        });
      }
    }

    const result = await pool.query(
      `UPDATE fixed_assets SET
        asset_name = COALESCE($1, asset_name),
        asset_name_ar = COALESCE($2, asset_name_ar),
        asset_number = COALESCE($3, asset_number),
        category = COALESCE($4, category),
        purchase_date = COALESCE($5, purchase_date),
        purchase_cost = COALESCE($6, purchase_cost),
        salvage_value = COALESCE($7, salvage_value),
        useful_life_years = COALESCE($8, useful_life_years),
        depreciation_method = COALESCE($9, depreciation_method),
        location = COALESCE($10, location),
        serial_number = COALESCE($11, serial_number),
        notes = COALESCE($12, notes),
        status = COALESCE($13, status)
       WHERE id = $14
       RETURNING *`,
      [assetName, assetNameAr, assetNumber, category, purchaseDate, purchaseCost, salvageValue, usefulLifeYears, depreciationMethod, location, serialNumber, notes, status, id]
    );

    // Recalculate NBV after update
    const updated = result.rows[0];
    const nbv = round2(parseFloat(updated.purchase_cost) - parseFloat(updated.accumulated_depreciation || 0));
    await pool.query(`UPDATE fixed_assets SET net_book_value = $1 WHERE id = $2`, [nbv, id]);

    const final = await pool.query(`SELECT * FROM fixed_assets WHERE id = $1`, [id]);

    if (willChangeUsefulLife || willChangeMethod || willChangeSalvage || willChangePurchaseCost) {
      log.info({
        assetId: id,
        willChangeUsefulLife,
        willChangeMethod,
        willChangeSalvage,
        willChangePurchaseCost,
      }, 'Fixed asset updated — future depreciation will be recomputed');
    } else {
      log.info({ assetId: id }, 'Fixed asset updated');
    }

    res.json(final.rows[0]);
  }));

  // Delete fixed asset
  app.delete("/api/fixed-assets/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const existing = await pool.query(`SELECT * FROM fixed_assets WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Fixed asset not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, existing.rows[0].company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await pool.query(`DELETE FROM fixed_assets WHERE id = $1`, [id]);
    log.info({ assetId: id }, 'Fixed asset deleted');
    res.json({ message: 'Fixed asset deleted successfully' });
  }));

  // =====================================
  // Depreciation
  // =====================================

  // Calculate and record monthly depreciation for a single asset.
  // Body params:
  //   month?: 1-12   (defaults to current UTC month)
  //   year?:  YYYY   (defaults to current UTC year)
  // Idempotent: re-running the same (asset, month, year) returns 409.
  app.post("/api/fixed-assets/:id/depreciate", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const existing = await pool.query(`SELECT * FROM fixed_assets WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Fixed asset not found' });
    }

    const asset = existing.rows[0];
    const hasAccess = await storage.hasCompanyAccess(userId, asset.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (asset.status !== 'active') {
      return res.status(400).json({ message: 'Can only depreciate active assets' });
    }

    // Resolve target period — body wins, otherwise current UTC month.
    const now = new Date();
    const reqMonth = req.body?.month !== undefined ? Number(req.body.month) : now.getUTCMonth() + 1;
    const reqYear = req.body?.year !== undefined ? Number(req.body.year) : now.getUTCFullYear();

    if (!Number.isInteger(reqMonth) || reqMonth < 1 || reqMonth > 12) {
      return res.status(400).json({ message: 'month must be an integer 1-12' });
    }
    if (!Number.isInteger(reqYear) || reqYear < 1900 || reqYear > 2999) {
      return res.status(400).json({ message: 'year must be a valid 4-digit year' });
    }

    // Reject periods strictly before the acquisition month — depreciation
    // can't pre-date the asset.
    const purchaseDate = asset.purchase_date instanceof Date
      ? asset.purchase_date
      : new Date(asset.purchase_date);
    const purchaseYear = purchaseDate.getUTCFullYear();
    const purchaseMonth = purchaseDate.getUTCMonth() + 1;
    if (reqYear < purchaseYear || (reqYear === purchaseYear && reqMonth < purchaseMonth)) {
      return res.status(400).json({
        message: `Cannot depreciate before acquisition month (${purchaseMonth}/${purchaseYear})`,
      });
    }

    // Period-lock check uses the JE date — first day of the target month.
    const entryDate = new Date(Date.UTC(reqYear, reqMonth - 1, 1));
    await assertPeriodNotLocked(asset.company_id, entryDate);

    // Idempotency check first — cheap rejection before we spend a JE number.
    const already = await pool.query(
      `SELECT id, amount, journal_entry_id FROM depreciation_schedules
        WHERE asset_id = $1 AND period_year = $2 AND period_month = $3`,
      [id, reqYear, reqMonth],
    );
    if (already.rows.length > 0) {
      return res.status(409).json({
        message: 'Depreciation already posted for this period',
        period: { month: reqMonth, year: reqYear },
        existingScheduleId: already.rows[0].id,
        amount: already.rows[0].amount,
        journalEntryId: already.rows[0].journal_entry_id,
      });
    }

    const monthsAlreadyDepreciated = await countMonthsAlreadyDepreciated(id, reqYear, reqMonth);
    const calc = calculateDepreciation(asset, reqYear, reqMonth, monthsAlreadyDepreciated);

    if (calc.monthlyDepreciation <= 0) {
      return res.status(400).json({
        message: 'Asset is fully depreciated',
        netBookValue: calc.newNetBookValue,
        salvageValue: parseFloat(asset.salvage_value || 0),
      });
    }

    // Atomically claim the (asset, year, month) slot. The unique constraint
    // on depreciation_schedules forecloses concurrent double-posts; ON
    // CONFLICT lets us return a clean 409 instead of a DB error if a parallel
    // request slipped through the SELECT above.
    const claim = await pool.query(
      `INSERT INTO depreciation_schedules (company_id, asset_id, period_year, period_month, amount, posted_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (asset_id, period_year, period_month) DO NOTHING
       RETURNING id`,
      [asset.company_id, id, reqYear, reqMonth, calc.monthlyDepreciation, userId],
    );
    if (claim.rowCount === 0) {
      return res.status(409).json({
        message: 'Depreciation already posted for this period (race)',
        period: { month: reqMonth, year: reqYear },
      });
    }
    const scheduleId = claim.rows[0].id;

    // From here on, any failure must roll back the claim row to avoid leaving
    // an orphaned schedule entry that would block future retries.
    try {
      const companyAccounts = await storage.getAccountsByCompanyId(asset.company_id);
      const depExpenseAccount = companyAccounts.find(a => a.code === '5100' && a.isSystemAccount);
      const accDepAccount = companyAccounts.find(a => a.code === '1240' && a.isSystemAccount);

      if (!depExpenseAccount || !accDepAccount) {
        throw new Error('Depreciation system accounts (5100/1240) not found');
      }

      const entryNumber = await storage.generateEntryNumber(asset.company_id, entryDate);
      const memoSuffix = calc.prorationFactor < 1
        ? ` (${reqMonth}/${reqYear}, prorated ${(calc.prorationFactor * 100).toFixed(1)}%)`
        : ` (${reqMonth}/${reqYear})`;

      const je = await storage.createJournalEntry(
        {
          companyId: asset.company_id,
          date: entryDate,
          memo: `Depreciation: ${asset.asset_name}${memoSuffix}`,
          entryNumber,
          status: 'posted',
          source: 'system',
          sourceId: id,
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
        },
        [
          { accountId: depExpenseAccount.id, debit: calc.monthlyDepreciation, credit: 0, description: `Depreciation - ${asset.asset_name}` },
          { accountId: accDepAccount.id, debit: 0, credit: calc.monthlyDepreciation, description: `Accumulated depreciation - ${asset.asset_name}` },
        ],
      );

      await pool.query(
        `UPDATE depreciation_schedules SET journal_entry_id = $1 WHERE id = $2`,
        [je.id, scheduleId],
      );

      await pool.query(
        `UPDATE fixed_assets SET accumulated_depreciation = $1, net_book_value = $2 WHERE id = $3`,
        [calc.newAccumulatedDepreciation, calc.newNetBookValue, id],
      );

      log.info({
        assetId: id,
        period: { month: reqMonth, year: reqYear },
        amount: calc.monthlyDepreciation,
        newAccumulatedDepreciation: calc.newAccumulatedDepreciation,
        newNetBookValue: calc.newNetBookValue,
        prorationFactor: calc.prorationFactor,
        journalEntryId: je.id,
      }, 'Depreciation posted');

      const updated = await pool.query(`SELECT * FROM fixed_assets WHERE id = $1`, [id]);
      res.json({
        asset: updated.rows[0],
        period: { month: reqMonth, year: reqYear },
        monthlyDepreciation: calc.monthlyDepreciation,
        prorationFactor: calc.prorationFactor,
        newAccumulatedDepreciation: calc.newAccumulatedDepreciation,
        newNetBookValue: calc.newNetBookValue,
        journalEntryId: je.id,
        scheduleId,
      });
    } catch (err) {
      await pool
        .query(`DELETE FROM depreciation_schedules WHERE id = $1`, [scheduleId])
        .catch((cleanupErr: unknown) => log.error({ scheduleId, cleanupErr }, 'Failed to roll back schedule claim'));
      throw err;
    }
  }));

  // Run depreciation for all active assets for a given month.
  // Per-asset idempotency: if (asset, month, year) already exists in
  // depreciation_schedules, that asset is skipped and reported as such.
  app.post("/api/companies/:companyId/fixed-assets/run-depreciation", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { month, year } = req.body;
    if (!month || !year) {
      return res.status(400).json({ message: 'month and year are required' });
    }
    const reqMonth = Number(month);
    const reqYear = Number(year);
    if (!Number.isInteger(reqMonth) || reqMonth < 1 || reqMonth > 12) {
      return res.status(400).json({ message: 'month must be an integer 1-12' });
    }
    if (!Number.isInteger(reqYear) || reqYear < 1900 || reqYear > 2999) {
      return res.status(400).json({ message: 'year must be a valid 4-digit year' });
    }

    // Block batch depreciation when the target period is locked — the entries
    // are dated to (year, month, 1).
    const targetEntryDate = new Date(Date.UTC(reqYear, reqMonth - 1, 1));
    await assertPeriodNotLocked(companyId, targetEntryDate);

    // Resolve depreciation system accounts once for the batch — outside the
    // tx because chart-of-accounts is a separate concern and we want to fail
    // fast before opening a transaction if they're missing.
    const companyAccounts = await storage.getAccountsByCompanyId(companyId);
    const depExpenseAccount = companyAccounts.find(a => a.code === '5100' && a.isSystemAccount);
    const accDepAccount = companyAccounts.find(a => a.code === '1240' && a.isSystemAccount);
    if (!depExpenseAccount || !accDepAccount) {
      return res.status(500).json({
        message: 'Depreciation system accounts (5100/1240) not found — run migrations to create them',
      });
    }

    // ALL-OR-NOTHING: the entire batch runs on a single connection inside one
    // BEGIN/COMMIT. Any per-asset failure aborts the whole batch — partial
    // posting was the source of recurring "GL doesn't tie to schedules" bugs
    // when a mid-batch JE failed. Skips (already-depreciated, predates
    // acquisition, fully-depreciated, non-depreciable) are NOT failures and
    // do not roll back the rest.
    const client = await pool.connect();
    let results: any[] = [];
    try {
      await client.query('BEGIN');

      // Per-(company, JE date) advisory xact lock — auto-released on
      // COMMIT/ROLLBACK. Serialises concurrent batch runs so our in-memory
      // entry-number counter stays collision-free.
      const lockKey1 = hashStringToInt(companyId);
      const dateStr = targetEntryDate.toISOString().slice(0, 10).replace(/-/g, '');
      const lockKey2 = hashStringToInt(`JE-${dateStr}`);
      await client.query('SELECT pg_advisory_xact_lock($1, $2)', [lockKey1, lockKey2]);

      const allocateEntryNumber = await makeEntryNumberAllocator(client, companyId, targetEntryDate);

      const assetsResult = await client.query(
        `SELECT * FROM fixed_assets WHERE company_id = $1 AND status = 'active'`,
        [companyId],
      );

      for (const asset of assetsResult.rows) {
        // Skip assets purchased after this period — depreciation can't pre-date
        // the asset.
        const purchaseDate = asset.purchase_date instanceof Date
          ? asset.purchase_date
          : new Date(asset.purchase_date);
        const purchaseYear = purchaseDate.getUTCFullYear();
        const purchaseMonth = purchaseDate.getUTCMonth() + 1;
        if (reqYear < purchaseYear || (reqYear === purchaseYear && reqMonth < purchaseMonth)) {
          results.push({
            assetId: asset.id,
            assetName: asset.asset_name,
            skipped: true,
            reason: 'Period predates acquisition',
          });
          continue;
        }

        // Idempotency check — if this period is already booked for this asset,
        // skip cleanly. Reading inside the tx is fine; the schedule's UNIQUE
        // constraint prevents anyone else from inserting for this slot until
        // we commit.
        const already = await client.query(
          `SELECT id, amount FROM depreciation_schedules
            WHERE asset_id = $1 AND period_year = $2 AND period_month = $3`,
          [asset.id, reqYear, reqMonth],
        );
        if (already.rows.length > 0) {
          results.push({
            assetId: asset.id,
            assetName: asset.asset_name,
            skipped: true,
            reason: 'Already depreciated for this period',
            existingAmount: already.rows[0].amount,
          });
          continue;
        }

        const countResult = await client.query(
          `SELECT COUNT(*)::int AS n FROM depreciation_schedules
            WHERE asset_id = $1
              AND (period_year < $2 OR (period_year = $2 AND period_month < $3))`,
          [asset.id, reqYear, reqMonth],
        );
        const monthsAlreadyDepreciated = countResult.rows[0]?.n ?? 0;
        const calc = calculateDepreciation(asset, reqYear, reqMonth, monthsAlreadyDepreciated);

        if (calc.skipped) {
          results.push({
            assetId: asset.id,
            assetName: asset.asset_name,
            monthlyDepreciation: 0,
            skipped: true,
            reason: calc.skipReason ?? 'Skipped',
          });
          continue;
        }

        if (calc.monthlyDepreciation <= 0) {
          results.push({
            assetId: asset.id,
            assetName: asset.asset_name,
            monthlyDepreciation: 0,
            skipped: true,
            reason: 'Fully depreciated',
          });
          continue;
        }

        // Insert schedule and JE on the SAME connection. ON CONFLICT DO
        // NOTHING handles the race where another transaction committed first;
        // here we treat that as a hard error since we already saw an empty
        // row above — meaning a parallel batch beat us and we should abort
        // the whole thing rather than skip silently and leave the GL out of
        // step with the schedules they're being asked to honour.
        const claim = await client.query(
          `INSERT INTO depreciation_schedules (company_id, asset_id, period_year, period_month, amount, posted_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (asset_id, period_year, period_month) DO NOTHING
           RETURNING id`,
          [companyId, asset.id, reqYear, reqMonth, calc.monthlyDepreciation, userId],
        );
        if (claim.rowCount === 0) {
          throw new Error(
            `Concurrent batch already booked depreciation for asset ${asset.id} ${reqMonth}/${reqYear} — aborting to keep GL consistent with schedules`,
          );
        }
        const scheduleId = claim.rows[0].id;

        const memoSuffix = calc.prorationFactor < 1
          ? ` (${reqMonth}/${reqYear}, prorated ${(calc.prorationFactor * 100).toFixed(1)}%)`
          : ` (${reqMonth}/${reqYear})`;

        const je = await insertJournalEntryTx(
          client,
          {
            companyId,
            entryNumber: allocateEntryNumber(),
            date: targetEntryDate,
            memo: `Depreciation: ${asset.asset_name}${memoSuffix}`,
            status: 'posted',
            source: 'system',
            sourceId: asset.id,
            createdBy: userId,
            postedBy: userId,
            postedAt: new Date(),
          },
          [
            { accountId: depExpenseAccount.id, debit: calc.monthlyDepreciation, credit: 0, description: `Depreciation - ${asset.asset_name}` },
            { accountId: accDepAccount.id, debit: 0, credit: calc.monthlyDepreciation, description: `Accumulated depreciation - ${asset.asset_name}` },
          ],
        );

        await client.query(
          `UPDATE depreciation_schedules SET journal_entry_id = $1 WHERE id = $2`,
          [je.id, scheduleId],
        );

        await client.query(
          `UPDATE fixed_assets SET accumulated_depreciation = $1, net_book_value = $2 WHERE id = $3`,
          [calc.newAccumulatedDepreciation, calc.newNetBookValue, asset.id],
        );

        results.push({
          assetId: asset.id,
          assetName: asset.asset_name,
          monthlyDepreciation: calc.monthlyDepreciation,
          prorationFactor: calc.prorationFactor,
          newAccumulatedDepreciation: calc.newAccumulatedDepreciation,
          newNetBookValue: calc.newNetBookValue,
          journalEntryId: je.id,
          scheduleId,
        });
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch((rbErr: unknown) => log.error({ rbErr }, 'ROLLBACK failed'));
      throw err;
    } finally {
      client.release();
    }

    log.info({ companyId, month: reqMonth, year: reqYear, assetsProcessed: results.length }, 'Batch depreciation completed');
    res.json({
      month: reqMonth,
      year: reqYear,
      assetsProcessed: results.length,
      results,
    });
  }));

  // =====================================
  // Disposal
  // =====================================

  // Record disposal of an asset and post the disposal journal entry:
  //   Dr Cash                        proceeds
  //   Dr Accumulated Depreciation    accDep
  //   Dr Loss on Asset Disposal      loss   (if proceeds < NBV)
  //                            Cr Fixed Assets at Cost     cost
  //                            Cr Gain on Asset Disposal   gain   (if proceeds > NBV)
  app.post("/api/fixed-assets/:id/dispose", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const existing = await pool.query(`SELECT * FROM fixed_assets WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Fixed asset not found' });
    }

    const asset = existing.rows[0];
    const hasAccess = await storage.hasCompanyAccess(userId, asset.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (asset.status === 'disposed') {
      return res.status(400).json({ message: 'Asset is already disposed' });
    }

    const { disposalDate, disposalAmount, notes } = req.body;
    if (!disposalDate) {
      return res.status(400).json({ message: 'disposalDate is required' });
    }

    // Disposal posts a JE on disposalDate — block locked periods.
    await assertPeriodNotLocked(asset.company_id, disposalDate);

    const dispDate = new Date(disposalDate);
    if (isNaN(dispDate.getTime())) {
      return res.status(400).json({ message: 'disposalDate is not a valid date' });
    }

    const purchaseDate = asset.purchase_date instanceof Date
      ? asset.purchase_date
      : new Date(asset.purchase_date);
    if (dispDate.getTime() < purchaseDate.getTime()) {
      return res.status(400).json({ message: 'disposalDate cannot precede purchaseDate' });
    }

    const proceeds = round2(parseFloat(disposalAmount || 0));

    // Resolve all required system accounts before opening the transaction so
    // we fail fast on missing chart-of-accounts setup. We have to estimate
    // gain/loss using a tentative NBV here — the catch-up depreciation may
    // change accumulated_depreciation before the disposal JE actually posts.
    const companyAccounts = await storage.getAccountsByCompanyId(asset.company_id);
    const accDepAccount = companyAccounts.find(a => a.code === '1240' && a.isSystemAccount);
    const fixedAssetCostAccount = companyAccounts.find(a => a.code === '1290' && a.isSystemAccount);
    const cashAccount = companyAccounts.find(a => a.code === '1010' && a.isSystemAccount);
    const gainAccount = companyAccounts.find(a => a.code === '4080' && a.isSystemAccount);
    const lossAccount = companyAccounts.find(a => a.code === '5130' && a.isSystemAccount);
    const depExpenseAccount = companyAccounts.find(a => a.code === '5100' && a.isSystemAccount);

    const baseMissing: string[] = [];
    if (!accDepAccount) baseMissing.push('1240');
    if (!fixedAssetCostAccount) baseMissing.push('1290');
    if (proceeds > 0 && !cashAccount) baseMissing.push('1010');
    if (baseMissing.length > 0) {
      return res.status(500).json({
        message: `Disposal cannot post — missing system accounts: ${baseMissing.join(', ')}. Run migrations to create them.`,
      });
    }

    // Disposal catch-up + disposal JE run in one transaction. If any of the
    // catch-up depreciation entries fail, we don't want a half-depreciated
    // asset stranded between two states.
    const client = await pool.connect();
    let updatedAssetRow: any = null;
    let disposalJeId: string | null = null;
    let netBookValueAtDisposal = 0;
    let gainLoss = 0;
    let gainLossType: 'gain' | 'loss' | 'breakeven' = 'breakeven';
    const catchUpEntries: Array<{ year: number; month: number; amount: number; journalEntryId: string }> = [];

    try {
      await client.query('BEGIN');

      // Lock the asset row so concurrent depreciation/dispose calls serialise
      // here rather than racing on accumulated_depreciation.
      const lockedAsset = await client.query(
        `SELECT * FROM fixed_assets WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (lockedAsset.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Fixed asset not found' });
      }
      let workingAsset = lockedAsset.rows[0];
      if (workingAsset.status === 'disposed') {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Asset is already disposed' });
      }

      // Per-(company, JE date) advisory xact lock for the entry-number
      // allocator. Catch-up + disposal share the disposal-month numbering;
      // catch-up months in earlier periods get their own per-period locks.
      const lockKey1 = hashStringToInt(asset.company_id);
      const lockedDates = new Set<string>();
      const lockDate = async (d: Date) => {
        const key = d.toISOString().slice(0, 10);
        if (lockedDates.has(key)) return;
        const lockKey2 = hashStringToInt(`JE-${key.replace(/-/g, '')}`);
        await client.query('SELECT pg_advisory_xact_lock($1, $2)', [lockKey1, lockKey2]);
        lockedDates.add(key);
      };

      // -------------------- CATCH-UP DEPRECIATION ---------------------
      // Post depreciation for any month from the acquisition month through
      // the month BEFORE disposal that hasn't already been booked. Skip the
      // disposal month itself — full-month convention; the asset is gone
      // before the month closes. Skip entirely for non-depreciable (Land) or
      // assets with no useful_life_years.
      const skipCatchUp =
        isNonDepreciableCategory(workingAsset.category) ||
        workingAsset.useful_life_years === null ||
        workingAsset.useful_life_years === undefined;

      if (!skipCatchUp) {
        if (!depExpenseAccount) {
          throw new Error('Depreciation expense account (5100) not found — required for catch-up depreciation');
        }

        const purchaseYear = purchaseDate.getUTCFullYear();
        const purchaseMonth = purchaseDate.getUTCMonth() + 1;
        const dispYear = dispDate.getUTCFullYear();
        const dispMonth = dispDate.getUTCMonth() + 1;

        // Last full month to depreciate = month immediately before the
        // disposal month. If disposal happens in the acquisition month
        // itself, there's nothing to catch up.
        const endYear = dispMonth === 1 ? dispYear - 1 : dispYear;
        const endMonth = dispMonth === 1 ? 12 : dispMonth - 1;

        // Build list of (year, month) we need to consider.
        const periodsToConsider: Array<{ year: number; month: number }> = [];
        let curYear = purchaseYear;
        let curMonth = purchaseMonth;
        while (curYear < endYear || (curYear === endYear && curMonth <= endMonth)) {
          periodsToConsider.push({ year: curYear, month: curMonth });
          curMonth++;
          if (curMonth > 12) { curMonth = 1; curYear++; }
        }

        // Existing schedules in this asset's history — skip these.
        const existingResult = await client.query(
          `SELECT period_year, period_month FROM depreciation_schedules WHERE asset_id = $1`,
          [workingAsset.id],
        );
        const existing = new Set(
          existingResult.rows.map((r: any) => `${r.period_year}-${r.period_month}`),
        );

        for (const period of periodsToConsider) {
          if (existing.has(`${period.year}-${period.month}`)) continue;

          const entryDate = new Date(Date.UTC(period.year, period.month - 1, 1));
          await assertPeriodNotLocked(workingAsset.company_id, entryDate);

          // monthsAlreadyDepreciated counts schedules strictly before this
          // (year, month). Read from this client so we see in-progress
          // catch-up inserts above.
          const countResult = await client.query(
            `SELECT COUNT(*)::int AS n FROM depreciation_schedules
              WHERE asset_id = $1
                AND (period_year < $2 OR (period_year = $2 AND period_month < $3))`,
            [workingAsset.id, period.year, period.month],
          );
          const monthsAlreadyDepreciated = countResult.rows[0]?.n ?? 0;
          const calc = calculateDepreciation(workingAsset, period.year, period.month, monthsAlreadyDepreciated);

          if (calc.skipped || calc.monthlyDepreciation <= 0) continue;

          const claim = await client.query(
            `INSERT INTO depreciation_schedules (company_id, asset_id, period_year, period_month, amount, posted_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (asset_id, period_year, period_month) DO NOTHING
             RETURNING id`,
            [workingAsset.company_id, workingAsset.id, period.year, period.month, calc.monthlyDepreciation, userId],
          );
          if (claim.rowCount === 0) {
            // Someone slipped a row in between our read and write — abort
            // rather than skip, so the disposal isn't computed against an
            // accumulated_depreciation that doesn't reflect the GL.
            throw new Error(
              `Concurrent depreciation booked for asset ${workingAsset.id} ${period.month}/${period.year} during catch-up — aborting disposal`,
            );
          }
          const scheduleId = claim.rows[0].id;

          await lockDate(entryDate);
          const allocate = await makeEntryNumberAllocator(client, workingAsset.company_id, entryDate);
          const memoSuffix = calc.prorationFactor < 1
            ? ` (${period.month}/${period.year}, prorated ${(calc.prorationFactor * 100).toFixed(1)}%, catch-up)`
            : ` (${period.month}/${period.year}, catch-up)`;

          const je = await insertJournalEntryTx(
            client,
            {
              companyId: workingAsset.company_id,
              entryNumber: allocate(),
              date: entryDate,
              memo: `Depreciation: ${workingAsset.asset_name}${memoSuffix}`,
              status: 'posted',
              source: 'system',
              sourceId: workingAsset.id,
              createdBy: userId,
              postedBy: userId,
              postedAt: new Date(),
            },
            [
              { accountId: depExpenseAccount.id, debit: calc.monthlyDepreciation, credit: 0, description: `Depreciation - ${workingAsset.asset_name}` },
              { accountId: accDepAccount!.id, debit: 0, credit: calc.monthlyDepreciation, description: `Accumulated depreciation - ${workingAsset.asset_name}` },
            ],
          );

          await client.query(
            `UPDATE depreciation_schedules SET journal_entry_id = $1 WHERE id = $2`,
            [je.id, scheduleId],
          );
          await client.query(
            `UPDATE fixed_assets SET accumulated_depreciation = $1, net_book_value = $2 WHERE id = $3`,
            [calc.newAccumulatedDepreciation, calc.newNetBookValue, workingAsset.id],
          );

          // Update working copy so calculateDepreciation in subsequent
          // iterations sees the latest accumulated_depreciation.
          workingAsset = {
            ...workingAsset,
            accumulated_depreciation: calc.newAccumulatedDepreciation,
            net_book_value: calc.newNetBookValue,
          };

          catchUpEntries.push({
            year: period.year,
            month: period.month,
            amount: calc.monthlyDepreciation,
            journalEntryId: je.id,
          });
        }
      }

      // -------------------- DISPOSAL JE -------------------------------
      const cost = parseFloat(workingAsset.purchase_cost);
      const accDep = parseFloat(workingAsset.accumulated_depreciation || 0);
      const nbv = round2(cost - accDep);
      gainLoss = round2(proceeds - nbv);
      const isGain = gainLoss > 0;
      const isLoss = gainLoss < 0;
      gainLossType = isGain ? 'gain' : isLoss ? 'loss' : 'breakeven';
      netBookValueAtDisposal = nbv;

      const missing: string[] = [];
      if (isGain && !gainAccount) missing.push('4080');
      if (isLoss && !lossAccount) missing.push('5130');
      if (missing.length > 0) {
        throw new Error(
          `Disposal cannot post — missing system accounts: ${missing.join(', ')}. Run migrations to create them.`,
        );
      }

      type Line = { accountId: string; debit: number; credit: number; description: string };
      const lines: Line[] = [];
      if (proceeds > 0) {
        lines.push({ accountId: cashAccount!.id, debit: proceeds, credit: 0, description: `Proceeds from disposal of ${workingAsset.asset_name}` });
      }
      if (accDep > 0) {
        lines.push({ accountId: accDepAccount!.id, debit: round2(accDep), credit: 0, description: `Reverse accumulated depreciation on ${workingAsset.asset_name}` });
      }
      if (isLoss) {
        lines.push({ accountId: lossAccount!.id, debit: round2(-gainLoss), credit: 0, description: `Loss on disposal of ${workingAsset.asset_name}` });
      }
      lines.push({ accountId: fixedAssetCostAccount!.id, debit: 0, credit: round2(cost), description: `Remove cost of ${workingAsset.asset_name}` });
      if (isGain) {
        lines.push({ accountId: gainAccount!.id, debit: 0, credit: round2(gainLoss), description: `Gain on disposal of ${workingAsset.asset_name}` });
      }

      await lockDate(dispDate);
      const allocateDispNum = await makeEntryNumberAllocator(client, workingAsset.company_id, dispDate);
      const disposalJe = await insertJournalEntryTx(
        client,
        {
          companyId: workingAsset.company_id,
          entryNumber: allocateDispNum(),
          date: dispDate,
          memo: `Disposal: ${workingAsset.asset_name}`,
          status: 'posted',
          source: 'system',
          sourceId: id,
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
        },
        lines,
      );
      disposalJeId = disposalJe.id;

      await client.query(
        `UPDATE fixed_assets SET
          status = 'disposed',
          disposal_date = $1,
          disposal_amount = $2,
          net_book_value = 0,
          notes = COALESCE($3, notes)
         WHERE id = $4`,
        [dispDate, proceeds, notes || null, id],
      );
      const finalRow = await client.query(`SELECT * FROM fixed_assets WHERE id = $1`, [id]);
      updatedAssetRow = finalRow.rows[0];

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch((rbErr: unknown) => log.error({ rbErr }, 'ROLLBACK failed during disposal'));
      throw err;
    } finally {
      client.release();
    }

    log.info({
      assetId: id,
      proceeds,
      netBookValueAtDisposal,
      gainLoss,
      gainLossType,
      catchUpMonths: catchUpEntries.length,
      journalEntryId: disposalJeId,
    }, 'Asset disposed');
    res.json({
      asset: updatedAssetRow,
      disposalAmount: proceeds,
      netBookValueAtDisposal,
      gainLoss,
      gainLossType,
      journalEntryId: disposalJeId,
      catchUpDepreciation: catchUpEntries,
    });
  }));

  // =====================================
  // Summary
  // =====================================

  // Get summary of fixed assets by category
  app.get("/api/companies/:companyId/fixed-assets/summary", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Overall totals
    const totalsResult = await pool.query(
      `SELECT
        COUNT(*) as total_assets,
        COALESCE(SUM(purchase_cost), 0) as total_cost,
        COALESCE(SUM(accumulated_depreciation), 0) as total_accumulated_depreciation,
        COALESCE(SUM(net_book_value), 0) as total_net_book_value
       FROM fixed_assets
       WHERE company_id = $1 AND status = 'active'`,
      [companyId]
    );

    // By category
    const categoryResult = await pool.query(
      `SELECT
        category,
        COUNT(*) as count,
        COALESCE(SUM(purchase_cost), 0) as total_cost,
        COALESCE(SUM(accumulated_depreciation), 0) as total_accumulated_depreciation,
        COALESCE(SUM(net_book_value), 0) as total_net_book_value
       FROM fixed_assets
       WHERE company_id = $1 AND status = 'active'
       GROUP BY category
       ORDER BY total_cost DESC`,
      [companyId]
    );

    const totals = totalsResult.rows[0];
    res.json({
      totalAssets: parseInt(totals.total_assets),
      totalCost: parseFloat(totals.total_cost),
      totalAccumulatedDepreciation: parseFloat(totals.total_accumulated_depreciation),
      totalNetBookValue: parseFloat(totals.total_net_book_value),
      byCategory: categoryResult.rows.map((row: any) => ({
        category: row.category,
        count: parseInt(row.count),
        totalCost: parseFloat(row.total_cost),
        totalAccumulatedDepreciation: parseFloat(row.total_accumulated_depreciation),
        totalNetBookValue: parseFloat(row.total_net_book_value),
      })),
    });
  }));
}
