import type { Express, Request, Response } from "express";
import { dubaiDayTextSql } from "../services/vat-dubai-day";
import { pool } from "../db";
import { storage } from "../storage";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { createLogger } from "../config/logger";
import { assertPeriodNotLocked } from "../services/period-lock.service";
import { recordAudit } from "../services/audit.service";
import { isBankOrCashAccount } from "../services/bank-posting-common";
import { isNonDepreciableCategory } from "../services/fixed-asset-depreciation-math";
import {
  depreciateThrough,
  hashStringToInt,
  insertJournalEntryTx,
  makeEntryNumberAllocator,
  monthEnd,
  withPurchaseDay,
  type DepreciateThroughResult,
} from "../services/fixed-asset-depreciation.service";

const log = createLogger("fixed-assets");

// Round to 2dp using banker-safe HALF_UP (sufficient for AED).
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function countMonthsAlreadyDepreciated(
  assetId: string,
  beforeYear: number,
  beforeMonth: number
): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS n
       FROM depreciation_schedules
      WHERE asset_id = $1
        AND (period_year < $2 OR (period_year = $2 AND period_month < $3))`,
    [assetId, beforeYear, beforeMonth]
  );
  return result.rows[0]?.n ?? 0;
}

export function registerFixedAssetRoutes(app: Express) {
  // =====================================
  // Fixed Asset CRUD
  // =====================================

  // List all fixed assets for a company
  app.get(
    "/api/companies/:companyId/fixed-assets",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const result = await pool.query(
        `SELECT * FROM fixed_assets WHERE company_id = $1 ORDER BY created_at DESC`,
        [companyId]
      );
      res.json(result.rows);
    })
  );

  // Get single fixed asset
  app.get(
    "/api/fixed-assets/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const result = await pool.query(`SELECT * FROM fixed_assets WHERE id = $1`, [id]);
      if (result.rows.length === 0) {
        return res.status(404).json({ message: "Fixed asset not found" });
      }

      const asset = result.rows[0];
      const hasAccess = await storage.hasCompanyAccess(userId, asset.company_id);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      res.json(asset);
    })
  );

  // Create fixed asset
  app.post(
    "/api/companies/:companyId/fixed-assets",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const {
        assetName,
        assetNameAr,
        assetNumber,
        category,
        purchaseDate,
        purchaseCost,
        salvageValue,
        usefulLifeYears,
        depreciationMethod,
        location,
        serialNumber,
        notes,
        paymentAccountId,
      } = req.body;

      // Land has no useful life, so usefulLifeYears is optional for it but
      // mandatory for everything else. Validate accordingly.
      const isLand = isNonDepreciableCategory(category);
      if (!assetName || !category || !purchaseDate || purchaseCost === undefined) {
        return res
          .status(400)
          .json({ message: "assetName, category, purchaseDate, and purchaseCost are required" });
      }
      if (!isLand && !usefulLifeYears) {
        return res
          .status(400)
          .json({ message: "usefulLifeYears is required for depreciable assets" });
      }

      // Cost must be a non-negative number; salvage cannot exceed cost.
      const cost = parseFloat(purchaseCost);
      if (!Number.isFinite(cost) || cost < 0) {
        return res.status(400).json({ message: "purchaseCost must be a non-negative number" });
      }
      const salvage = parseFloat(salvageValue || 0);
      if (!Number.isFinite(salvage) || salvage < 0) {
        return res.status(400).json({ message: "salvageValue must be a non-negative number" });
      }
      if (salvage > cost) {
        return res.status(400).json({ message: "salvageValue cannot exceed purchaseCost" });
      }

      // Block creating an asset purchased inside a locked period — the
      // capitalization/depreciation journal entries derive from purchase_date.
      await assertPeriodNotLocked(companyId, purchaseDate);

      // Resolve the payment account up-front so we can fail fast before
      // inserting the asset row when an invalid account id is supplied.
      let paymentAccount: any = null;
      if (paymentAccountId) {
        const companyAccounts = await storage.getAccountsByCompanyId(companyId);
        paymentAccount = companyAccounts.find((a) => a.id === paymentAccountId);
        if (!paymentAccount) {
          return res.status(400).json({
            message: `paymentAccountId ${paymentAccountId} not found in company chart of accounts`,
          });
        }
      }

      const nbv = cost - 0; // Initial NBV = cost (no depreciation yet)
      const needsCapJe = !paymentAccountId;
      // land is not depreciated; the column is NOT NULL, so 0 stands for "no useful life" (category land skips every month)
      const lifeYears = isLand ? 0 : usefulLifeYears;

      const result = await pool.query(
        `INSERT INTO fixed_assets (company_id, asset_name, asset_name_ar, asset_number, category, purchase_date, purchase_cost, salvage_value, useful_life_years, depreciation_method, accumulated_depreciation, net_book_value, location, serial_number, notes, needs_capitalization_je)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, $11, $12, $13, $14, $15)
       RETURNING *`,
        [
          companyId,
          assetName,
          assetNameAr || null,
          assetNumber || null,
          category,
          purchaseDate,
          cost,
          salvage,
          lifeYears,
          depreciationMethod || "straight_line",
          nbv,
          location || null,
          serialNumber || null,
          notes || null,
          needsCapJe,
        ]
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
          const fixedAssetCostAccount = companyAccounts.find(
            (a) => a.code === "1290" && a.isSystemAccount
          );
          if (!fixedAssetCostAccount) {
            throw new Error(
              "Fixed Assets at Cost account (1290) not found — run migrations to create it"
            );
          }

          const entryDate = new Date(purchaseDate);
          const entryNumber = await storage.generateEntryNumber(companyId, entryDate);
          const je = await storage.createJournalEntry(
            {
              companyId,
              date: entryDate,
              memo: `Capitalization: ${assetName}`,
              entryNumber,
              status: "posted",
              source: "system",
              sourceId: asset.id,
              createdBy: userId,
              postedBy: userId,
              postedAt: new Date(),
            },
            [
              {
                accountId: fixedAssetCostAccount.id,
                debit: round2(cost),
                credit: 0,
                description: `Capitalize ${assetName}`,
              },
              {
                accountId: paymentAccount.id,
                debit: 0,
                credit: round2(cost),
                description: `Payment for ${assetName}`,
              },
            ]
          );
          capitalizationJournalEntryId = je.id;
        } catch (err) {
          await pool
            .query(`DELETE FROM fixed_assets WHERE id = $1`, [asset.id])
            .catch((cleanupErr: unknown) =>
              log.error(
                { assetId: asset.id, cleanupErr },
                "Failed to roll back asset insert after capitalization JE failure"
              )
            );
          throw err;
        }
      }

      log.info(
        {
          assetId: asset.id,
          companyId,
          capitalizationJournalEntryId,
          needsCapitalizationJe: needsCapJe,
        },
        "Fixed asset created"
      );
      res.json({ ...asset, capitalizationJournalEntryId });
    })
  );

  // Update fixed asset
  app.patch(
    "/api/fixed-assets/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const existing = await pool.query(`SELECT * FROM fixed_assets WHERE id = $1`, [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ message: "Fixed asset not found" });
      }

      const asset = withPurchaseDay(existing.rows[0]);
      const hasAccess = await storage.hasCompanyAccess(userId, asset.company_id);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const {
        assetName,
        assetNameAr,
        assetNumber,
        category,
        purchaseDate,
        purchaseCost,
        salvageValue,
        usefulLifeYears,
        depreciationMethod,
        location,
        serialNumber,
        notes,
        status,
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
      const willChangeUsefulLife =
        usefulLifeYears !== undefined &&
        Number(usefulLifeYears) !== Number(asset.useful_life_years);
      const willChangeMethod =
        depreciationMethod !== undefined && depreciationMethod !== asset.depreciation_method;
      const willChangeSalvage =
        salvageValue !== undefined &&
        parseFloat(salvageValue) !== parseFloat(asset.salvage_value || 0);
      const willChangePurchaseCost =
        purchaseCost !== undefined && parseFloat(purchaseCost) !== parseFloat(asset.purchase_cost);

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
        [
          assetName,
          assetNameAr,
          assetNumber,
          category,
          purchaseDate,
          purchaseCost,
          salvageValue,
          usefulLifeYears,
          depreciationMethod,
          location,
          serialNumber,
          notes,
          status,
          id,
        ]
      );

      // Recalculate NBV after update
      const updated = result.rows[0];
      const nbv = round2(
        parseFloat(updated.purchase_cost) - parseFloat(updated.accumulated_depreciation || 0)
      );
      await pool.query(`UPDATE fixed_assets SET net_book_value = $1 WHERE id = $2`, [nbv, id]);

      const final = await pool.query(`SELECT * FROM fixed_assets WHERE id = $1`, [id]);

      if (willChangeUsefulLife || willChangeMethod || willChangeSalvage || willChangePurchaseCost) {
        log.info(
          {
            assetId: id,
            willChangeUsefulLife,
            willChangeMethod,
            willChangeSalvage,
            willChangePurchaseCost,
          },
          "Fixed asset updated — future depreciation will be recomputed"
        );
      } else {
        log.info({ assetId: id }, "Fixed asset updated");
      }

      res.json(final.rows[0]);
    })
  );

  // Delete fixed asset
  app.delete(
    "/api/fixed-assets/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const existing = await pool.query(`SELECT * FROM fixed_assets WHERE id = $1`, [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ message: "Fixed asset not found" });
      }

      const asset = withPurchaseDay(existing.rows[0]);
      const hasAccess = await storage.hasCompanyAccess(userId, asset.company_id);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // S-H5: a fixed asset with posted journal entries (capitalization,
      // depreciation, disposal) is a financial record. Hard-deleting it would
      // orphan those posted GL entries and bypass FTA 5-year retention. Refuse
      // and require disposal instead, mirroring the invoice "void, don't delete"
      // rule. Assets that were never capitalized (no posted JE) stay deletable.
      const assetEntries = await storage.getJournalEntriesBySource(asset.company_id, "system", id);
      const postedEntries = assetEntries.filter((e) => e.status === "posted");
      if (postedEntries.length > 0) {
        return res.status(409).json({
          message:
            "Cannot delete a fixed asset that has posted journal entries (capitalization/depreciation). " +
            "Dispose of the asset instead so the general ledger stays consistent.",
          code: "ASSET_HAS_POSTED_JE",
        });
      }

      await pool.query(`DELETE FROM fixed_assets WHERE id = $1`, [id]);
      log.info({ assetId: id, userId }, "Fixed asset deleted");
      await recordAudit({
        userId,
        companyId: asset.company_id,
        action: "fixed_asset.delete",
        entityType: "fixed_asset",
        entityId: id,
        before: { assetName: asset.asset_name, assetNumber: asset.asset_number },
        after: null,
        req,
      });
      res.json({ message: "Fixed asset deleted successfully" });
    })
  );

  // =====================================
  // Depreciation
  // =====================================

  // Calculate and record monthly depreciation for a single asset.
  // Body params:
  //   month?: 1-12   (defaults to current UTC month)
  //   year?:  YYYY   (defaults to current UTC year)
  // Idempotent: re-running the same (asset, month, year) returns 409.
  app.post(
    "/api/fixed-assets/:id/depreciate",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const existing = await pool.query(`SELECT *, ${dubaiDayTextSql("purchase_date")} AS purchase_day FROM fixed_assets WHERE id = $1`, [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ message: "Fixed asset not found" });
      }

      const asset = withPurchaseDay(existing.rows[0]);
      const hasAccess = await storage.hasCompanyAccess(userId, asset.company_id);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (asset.status !== "active") {
        return res.status(400).json({ message: "Can only depreciate active assets" });
      }

      // The asset must be ON the books before it can be written down.
      //
      // Capitalization only posts when the asset is created with a
      // paymentAccountId. Without it the asset exists in the register but never
      // reaches the general ledger — and depreciating it then produced
      // accumulated depreciation against an asset worth nothing: assets 0,
      // liabilities 333.33, equity -333.33. A balance sheet that says the
      // company owns nothing and owes the depreciation it just charged itself.
      //
      // Refuse, and tell the user the two legitimate ways to fix it. We do not
      // silently invent an opening-balance entry — that would post to equity on
      // the user's behalf without their knowledge.
      const capitalized = await pool.query(
        `SELECT 1 FROM journal_entries
          WHERE company_id = $1 AND source = 'system' AND source_id = $2 AND status = 'posted'
          LIMIT 1`,
        [asset.company_id, asset.id]
      );
      if (capitalized.rows.length === 0) {
        return res.status(422).json({
          message:
            "This asset is not on the general ledger, so it cannot be depreciated — doing so would " +
            "charge depreciation against an asset the books say you do not own. Either record the " +
            "purchase (recreate the asset with a payment account), or post an opening-balance " +
            "journal debiting Fixed Assets at Cost (1290).",
          code: "ASSET_NOT_CAPITALIZED",
        });
      }

      // Resolve target period — body wins, otherwise current UTC month.
      const now = new Date();
      const reqMonth =
        req.body?.month !== undefined ? Number(req.body.month) : now.getUTCMonth() + 1;
      const reqYear = req.body?.year !== undefined ? Number(req.body.year) : now.getUTCFullYear();

      if (!Number.isInteger(reqMonth) || reqMonth < 1 || reqMonth > 12) {
        return res.status(400).json({ message: "month must be an integer 1-12" });
      }
      if (!Number.isInteger(reqYear) || reqYear < 1900 || reqYear > 2999) {
        return res.status(400).json({ message: "year must be a valid 4-digit year" });
      }

      // Reject periods strictly before the acquisition month — depreciation
      // can't pre-date the asset.
      const purchaseDate =
        asset.purchase_date instanceof Date ? asset.purchase_date : new Date(asset.purchase_date);
      const purchaseYear = purchaseDate.getUTCFullYear();
      const purchaseMonth = purchaseDate.getUTCMonth() + 1;
      if (reqYear < purchaseYear || (reqYear === purchaseYear && reqMonth < purchaseMonth)) {
        return res.status(400).json({
          message: `Cannot depreciate before acquisition month (${purchaseMonth}/${purchaseYear})`,
        });
      }

      // The entry is dated the month end; the target month must be open.
      await assertPeriodNotLocked(asset.company_id, monthEnd(reqYear, reqMonth));

      // Idempotency check first — cheap rejection before anything is posted.
      const already = await pool.query(
        `SELECT id, amount, journal_entry_id FROM depreciation_schedules
        WHERE asset_id = $1 AND period_year = $2 AND period_month = $3`,
        [id, reqYear, reqMonth]
      );
      if (already.rows.length > 0) {
        return res.status(409).json({
          message: "Depreciation already posted for this period",
          period: { month: reqMonth, year: reqYear },
          existingScheduleId: already.rows[0].id,
          amount: already.rows[0].amount,
          journalEntryId: already.rows[0].journal_entry_id,
        });
      }

      const companyAccounts = await storage.getAccountsByCompanyId(asset.company_id);
      const depExpenseAccount = companyAccounts.find((a) => a.code === "5100" && a.isSystemAccount);
      const accDepAccount = companyAccounts.find((a) => a.code === "1240" && a.isSystemAccount);
      if (!depExpenseAccount || !accDepAccount) {
        throw new Error("Depreciation system accounts (5100/1240) not found");
      }

      // Every unposted month from the first depreciation month up to this one is posted (oldest first, one journal per
      // month dated the month end), all in one transaction: running October catches the asset up.
      const client = await pool.connect();
      let outcome: DepreciateThroughResult;
      try {
        await client.query("BEGIN");
        const locked = await client.query(`SELECT *, ${dubaiDayTextSql("purchase_date")} AS purchase_day FROM fixed_assets WHERE id = $1 FOR UPDATE`, [id]);
        outcome = await depreciateThrough(client, {
          asset: locked.rows[0],
          toYear: reqYear,
          toMonth: reqMonth,
          userId,
          depExpenseAccountId: depExpenseAccount.id,
          accDepAccountId: accDepAccount.id,
          mode: "run",
          confirmBackdated: req.body?.confirmBackdated === true,
        });
        if (!outcome.target) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            message: "Asset is fully depreciated",
            netBookValue: outcome.netBookValue,
            salvageValue: parseFloat(asset.salvage_value || 0),
          });
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch((rbErr: unknown) => log.error({ rbErr }, "ROLLBACK failed"));
        throw err;
      } finally {
        client.release();
      }

      log.info(
        { assetId: id, period: { month: reqMonth, year: reqYear }, amount: outcome.target.amount, months: outcome.posted.length, newAccumulatedDepreciation: outcome.accumulated },
        "Depreciation posted"
      );
      const updated = await pool.query(`SELECT * FROM fixed_assets WHERE id = $1`, [id]);
      res.json({
        asset: updated.rows[0],
        period: { month: reqMonth, year: reqYear },
        monthlyDepreciation: outcome.target.amount,
        prorationFactor: outcome.target.prorationFactor,
        newAccumulatedDepreciation: outcome.accumulated,
        newNetBookValue: outcome.netBookValue,
        journalEntryId: outcome.target.journalEntryId,
        scheduleId: outcome.target.scheduleId,
        catchUp: outcome.posted.filter((m) => m !== outcome.target),
        // months that fall in a locked or closed period: one labelled journal dated the first open day
        priorPeriodCatchUp: outcome.catchUp,
      });
    })
  );

  // Run depreciation for all active assets for a given month.
  // Per-asset idempotency: if (asset, month, year) already exists in
  // depreciation_schedules, that asset is skipped and reported as such.
  app.post(
    "/api/companies/:companyId/fixed-assets/run-depreciation",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { month, year } = req.body;
      if (!month || !year) {
        return res.status(400).json({ message: "month and year are required" });
      }
      const reqMonth = Number(month);
      const reqYear = Number(year);
      if (!Number.isInteger(reqMonth) || reqMonth < 1 || reqMonth > 12) {
        return res.status(400).json({ message: "month must be an integer 1-12" });
      }
      if (!Number.isInteger(reqYear) || reqYear < 1900 || reqYear > 2999) {
        return res.status(400).json({ message: "year must be a valid 4-digit year" });
      }

      // Block batch depreciation when the target period is locked: the entries are dated the month end.
      await assertPeriodNotLocked(companyId, monthEnd(reqYear, reqMonth));

      const companyAccounts = await storage.getAccountsByCompanyId(companyId);
      const depExpenseAccount = companyAccounts.find((a) => a.code === "5100" && a.isSystemAccount);
      const accDepAccount = companyAccounts.find((a) => a.code === "1240" && a.isSystemAccount);
      if (!depExpenseAccount || !accDepAccount) {
        return res.status(500).json({
          message:
            "Depreciation system accounts (5100/1240) not found — run migrations to create them",
        });
      }

      // ALL-OR-NOTHING: the entire batch runs on a single connection inside one BEGIN/COMMIT. Each asset is caught up
      // (every unposted month from its first depreciation month to the target month, one journal per month dated the
      // month end). Skips (already depreciated, predates acquisition, fully depreciated, non-depreciable) are not failures.
      const client = await pool.connect();
      const results: any[] = [];
      try {
        await client.query("BEGIN");
        const assetsResult = await client.query(
          `SELECT *, ${dubaiDayTextSql("purchase_date")} AS purchase_day FROM fixed_assets WHERE company_id = $1 AND status = 'active' ORDER BY purchase_date, id FOR UPDATE`,
          [companyId]
        );

        for (const asset of assetsResult.rows.map(withPurchaseDay)) {
          const purchaseDate =
            asset.purchase_date instanceof Date ? asset.purchase_date : new Date(asset.purchase_date);
          const purchaseYear = purchaseDate.getUTCFullYear();
          const purchaseMonth = purchaseDate.getUTCMonth() + 1;
          if (reqYear < purchaseYear || (reqYear === purchaseYear && reqMonth < purchaseMonth)) {
            results.push({ assetId: asset.id, assetName: asset.asset_name, skipped: true, reason: "Period predates acquisition" });
            continue;
          }

          const already = await client.query(
            `SELECT id, amount FROM depreciation_schedules WHERE asset_id = $1 AND period_year = $2 AND period_month = $3`,
            [asset.id, reqYear, reqMonth]
          );
          const targetAlreadyPosted = already.rows.length > 0;

          const outcome = await depreciateThrough(client, {
            asset,
            toYear: reqYear,
            toMonth: reqMonth,
            userId,
            depExpenseAccountId: depExpenseAccount.id,
            accDepAccountId: accDepAccount.id,
            mode: "run",
            confirmBackdated: req.body?.confirmBackdated === true,
          });

          if (targetAlreadyPosted && outcome.posted.length === 0 && !outcome.catchUp) {
            results.push({ assetId: asset.id, assetName: asset.asset_name, skipped: true, reason: "Already depreciated for this period", existingAmount: already.rows[0].amount });
            continue;
          }
          if (!outcome.target && outcome.posted.length === 0 && !outcome.catchUp) {
            const nonDep = isNonDepreciableCategory(asset.category) || asset.useful_life_years == null;
            results.push({
              assetId: asset.id,
              assetName: asset.asset_name,
              monthlyDepreciation: 0,
              skipped: true,
              reason: isNonDepreciableCategory(asset.category) ? "Land is non-depreciable" : nonDep ? "Asset has no useful_life_years" : "Fully depreciated",
            });
            continue;
          }
          const shown = outcome.target ?? outcome.posted[outcome.posted.length - 1];
          results.push({
            assetId: asset.id,
            assetName: asset.asset_name,
            monthlyDepreciation: shown?.amount ?? outcome.catchUp?.total ?? 0,
            prorationFactor: shown?.prorationFactor ?? 1,
            newAccumulatedDepreciation: outcome.accumulated,
            newNetBookValue: outcome.netBookValue,
            journalEntryId: shown?.journalEntryId ?? outcome.catchUp?.journalEntryId,
            scheduleId: shown?.scheduleId,
            monthsPosted: outcome.posted.length + (outcome.catchUp?.months.length ?? 0),
            catchUp: outcome.posted.filter((m) => m !== outcome.target),
            priorPeriodCatchUp: outcome.catchUp,
          });
        }

        await client.query("COMMIT");
      } catch (err) {
        await client
          .query("ROLLBACK")
          .catch((rbErr: unknown) => log.error({ rbErr }, "ROLLBACK failed"));
        throw err;
      } finally {
        client.release();
      }

      log.info(
        { companyId, month: reqMonth, year: reqYear, assetsProcessed: results.length },
        "Batch depreciation completed"
      );
      res.json({
        month: reqMonth,
        year: reqYear,
        assetsProcessed: results.length,
        results,
      });
    })
  );

  // =====================================
  // Disposal
  // =====================================

  // Record disposal of an asset and post the disposal journal entry:
  //   Dr Cash                        proceeds
  //   Dr Accumulated Depreciation    accDep
  //   Dr Loss on Asset Disposal      loss   (if proceeds < NBV)
  //                            Cr Fixed Assets at Cost     cost
  //                            Cr Gain on Asset Disposal   gain   (if proceeds > NBV)
  app.post(
    "/api/fixed-assets/:id/dispose",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const existing = await pool.query(`SELECT *, ${dubaiDayTextSql("purchase_date")} AS purchase_day FROM fixed_assets WHERE id = $1`, [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ message: "Fixed asset not found" });
      }

      const asset = withPurchaseDay(existing.rows[0]);
      const hasAccess = await storage.hasCompanyAccess(userId, asset.company_id);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (asset.status === "disposed") {
        return res.status(400).json({ message: "Asset is already disposed" });
      }

      const { disposalDate, disposalAmount, notes, proceedsAccountId } = req.body;
      if (!disposalDate) {
        return res.status(400).json({ message: "disposalDate is required" });
      }

      // Disposal posts a JE on disposalDate — block locked periods.
      await assertPeriodNotLocked(asset.company_id, disposalDate);

      const dispDate = new Date(disposalDate);
      if (isNaN(dispDate.getTime())) {
        return res.status(400).json({ message: "disposalDate is not a valid date" });
      }

      const purchaseDate =
        asset.purchase_date instanceof Date ? asset.purchase_date : new Date(asset.purchase_date);
      if (dispDate.getTime() < purchaseDate.getTime()) {
        return res.status(400).json({ message: "disposalDate cannot precede purchaseDate" });
      }

      const proceeds = round2(parseFloat(disposalAmount || 0));

      // Resolve all required system accounts before opening the transaction so
      // we fail fast on missing chart-of-accounts setup. We have to estimate
      // gain/loss using a tentative NBV here — the catch-up depreciation may
      // change accumulated_depreciation before the disposal JE actually posts.
      const companyAccounts = await storage.getAccountsByCompanyId(asset.company_id);
      const accDepAccount = companyAccounts.find((a) => a.code === "1240" && a.isSystemAccount);
      const fixedAssetCostAccount = companyAccounts.find(
        (a) => a.code === "1290" && a.isSystemAccount
      );
      const cashAccount = companyAccounts.find((a) => a.code === "1010" && a.isSystemAccount);
      // Proceeds go to the bank or cash account the money arrived in (default: 1010 Cash). The account must be this
      // company's, active, and of bank/cash type.
      let proceedsAccount = cashAccount;
      if (proceedsAccountId !== undefined && proceedsAccountId !== null && proceedsAccountId !== "") {
        const managed = new Set(
          (await storage.getBankAccountsByCompanyId(asset.company_id)).map((b) => b.glAccountId).filter((v): v is string => !!v)
        );
        const chosen = companyAccounts.find((a) => a.id === proceedsAccountId);
        if (!chosen || chosen.isActive === false || chosen.isArchived === true || !isBankOrCashAccount(chosen, managed, chosen.id)) {
          return res.status(422).json({
            message: "The proceeds account must be an active bank or cash account of this company.",
            code: "PROCEEDS_ACCOUNT_INVALID",
          });
        }
        proceedsAccount = chosen;
      }
      const gainAccount = companyAccounts.find((a) => a.code === "4080" && a.isSystemAccount);
      const lossAccount = companyAccounts.find((a) => a.code === "5130" && a.isSystemAccount);
      const depExpenseAccount = companyAccounts.find((a) => a.code === "5100" && a.isSystemAccount);

      const baseMissing: string[] = [];
      if (!accDepAccount) baseMissing.push("1240");
      if (!fixedAssetCostAccount) baseMissing.push("1290");
      if (proceeds > 0 && !proceedsAccount) baseMissing.push("1010");
      if (baseMissing.length > 0) {
        return res.status(500).json({
          message: `Disposal cannot post — missing system accounts: ${baseMissing.join(", ")}. Run migrations to create them.`,
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
      let gainLossType: "gain" | "loss" | "breakeven" = "breakeven";
      const catchUpEntries: Array<{
        year: number;
        month: number;
        amount: number;
        journalEntryId: string;
      }> = [];

      try {
        await client.query("BEGIN");

        // Lock the asset row so concurrent depreciation/dispose calls serialise
        // here rather than racing on accumulated_depreciation.
        const lockedAsset = await client.query(
          `SELECT *, ${dubaiDayTextSql("purchase_date")} AS purchase_day FROM fixed_assets WHERE id = $1 FOR UPDATE`,
          [id]
        );
        if (lockedAsset.rows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ message: "Fixed asset not found" });
        }
        let workingAsset = withPurchaseDay(lockedAsset.rows[0]);
        if (workingAsset.status === "disposed") {
          await client.query("ROLLBACK");
          return res.status(400).json({ message: "Asset is already disposed" });
        }

        // Per-(company, JE date) advisory xact lock for the entry-number
        // allocator. Catch-up + disposal share the disposal-month numbering;
        // catch-up months in earlier periods get their own per-period locks.
        const lockKey1 = hashStringToInt(asset.company_id);
        const lockedDates = new Set<string>();
        const lockDate = async (d: Date) => {
          const key = d.toISOString().slice(0, 10);
          if (lockedDates.has(key)) return;
          const lockKey2 = hashStringToInt(`JE-${key.replace(/-/g, "")}`);
          await client.query("SELECT pg_advisory_xact_lock($1, $2)", [lockKey1, lockKey2]);
          lockedDates.add(key);
        };

        // -------------------- CATCH-UP DEPRECIATION ---------------------
        // Post every unposted month from the first depreciation month through the month BEFORE disposal (full-month
        // convention: the asset is gone before the disposal month closes), each dated its month end, in order.
        if (!depExpenseAccount) {
          throw new Error("Depreciation expense account (5100) not found — required for catch-up depreciation");
        }
        {
          const dispYear = dispDate.getUTCFullYear();
          const dispMonth = dispDate.getUTCMonth() + 1;
          const endYear = dispMonth === 1 ? dispYear - 1 : dispYear;
          const endMonth = dispMonth === 1 ? 12 : dispMonth - 1;
          const caught = await depreciateThrough(client, {
            asset: workingAsset,
            toYear: endYear,
            toMonth: endMonth,
            userId,
            depExpenseAccountId: depExpenseAccount.id,
            accDepAccountId: accDepAccount!.id,
            // nothing is backdated: one journal, dated the disposal date, for every month not yet posted
            mode: "disposal",
            disposalDate: dispDate,
          });
          for (const m of caught.catchUp?.months ?? []) {
            catchUpEntries.push({ year: m.year, month: m.month, amount: m.amount, journalEntryId: caught.catchUp!.journalEntryId });
          }
          if (caught.catchUp) {
            workingAsset = { ...workingAsset, accumulated_depreciation: caught.accumulated, net_book_value: caught.netBookValue };
          }
        }

        // -------------------- DISPOSAL JE -------------------------------
        const cost = parseFloat(workingAsset.purchase_cost);
        const accDep = parseFloat(workingAsset.accumulated_depreciation || 0);
        const nbv = round2(cost - accDep);
        gainLoss = round2(proceeds - nbv);
        const isGain = gainLoss > 0;
        const isLoss = gainLoss < 0;
        gainLossType = isGain ? "gain" : isLoss ? "loss" : "breakeven";
        netBookValueAtDisposal = nbv;

        const missing: string[] = [];
        if (isGain && !gainAccount) missing.push("4080");
        if (isLoss && !lossAccount) missing.push("5130");
        if (missing.length > 0) {
          throw new Error(
            `Disposal cannot post — missing system accounts: ${missing.join(", ")}. Run migrations to create them.`
          );
        }

        type Line = { accountId: string; debit: number; credit: number; description: string };
        const lines: Line[] = [];
        if (proceeds > 0) {
          lines.push({
            accountId: proceedsAccount!.id,
            debit: proceeds,
            credit: 0,
            description: `Proceeds from disposal of ${workingAsset.asset_name}`,
          });
        }
        if (accDep > 0) {
          lines.push({
            accountId: accDepAccount!.id,
            debit: round2(accDep),
            credit: 0,
            description: `Reverse accumulated depreciation on ${workingAsset.asset_name}`,
          });
        }
        if (isLoss) {
          lines.push({
            accountId: lossAccount!.id,
            debit: round2(-gainLoss),
            credit: 0,
            description: `Loss on disposal of ${workingAsset.asset_name}`,
          });
        }
        lines.push({
          accountId: fixedAssetCostAccount!.id,
          debit: 0,
          credit: round2(cost),
          description: `Remove cost of ${workingAsset.asset_name}`,
        });
        if (isGain) {
          lines.push({
            accountId: gainAccount!.id,
            debit: 0,
            credit: round2(gainLoss),
            description: `Gain on disposal of ${workingAsset.asset_name}`,
          });
        }

        await lockDate(dispDate);
        const allocateDispNum = await makeEntryNumberAllocator(
          client,
          workingAsset.company_id,
          dispDate
        );
        const disposalJe = await insertJournalEntryTx(
          client,
          {
            companyId: workingAsset.company_id,
            entryNumber: allocateDispNum(),
            date: dispDate,
            memo: `Disposal: ${workingAsset.asset_name}`,
            status: "posted",
            source: "system",
            sourceId: id,
            createdBy: userId,
            postedBy: userId,
            postedAt: new Date(),
          },
          lines
        );
        disposalJeId = disposalJe.id;

        await client.query(
          `UPDATE fixed_assets SET
          status = 'disposed',
          disposal_date = $1,
          disposal_amount = $2,
          net_book_value = 0,
          notes = COALESCE($3, notes),
          disposal_journal_id = $5,
          disposal_account_id = $6
         WHERE id = $4`,
          [dispDate, proceeds, notes || null, id, disposalJeId, proceeds > 0 ? proceedsAccount!.id : null]
        );
        const finalRow = await client.query(`SELECT * FROM fixed_assets WHERE id = $1`, [id]);
        updatedAssetRow = finalRow.rows[0];

        await client.query("COMMIT");
      } catch (err) {
        await client
          .query("ROLLBACK")
          .catch((rbErr: unknown) => log.error({ rbErr }, "ROLLBACK failed during disposal"));
        throw err;
      } finally {
        client.release();
      }

      log.info(
        {
          assetId: id,
          proceeds,
          netBookValueAtDisposal,
          gainLoss,
          gainLossType,
          catchUpMonths: catchUpEntries.length,
          journalEntryId: disposalJeId,
        },
        "Asset disposed"
      );
      res.json({
        asset: updatedAssetRow,
        disposalAmount: proceeds,
        netBookValueAtDisposal,
        gainLoss,
        gainLossType,
        journalEntryId: disposalJeId,
        catchUpDepreciation: catchUpEntries,
      });
    })
  );

  // =====================================
  // Summary
  // =====================================

  // Get summary of fixed assets by category
  app.get(
    "/api/companies/:companyId/fixed-assets/summary",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
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
    })
  );
}
