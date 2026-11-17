/**
 * Fixed-asset register routes (W4-B). The accounting lives in server/services/fixed-assets; every
 * journal goes through server/ledger. Bodies are validated with strictBody + shared validators.
 */
import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { pool } from "../db";
import { storage } from "../storage";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { createLogger } from "../config/logger";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
import { withLedgerTx } from "../ledger";
import { assertPeriodNotLocked } from "../services/period-lock.service";
import { recordAudit } from "../services/audit.service";
import { actorFromRequest, assertCompanyPermission } from "../services/approval-rules.service";
import { readFormat, sendTabular } from "../reporting/http";
import { fromFils, toFils } from "../../shared/money";
import {
  assetClassBody,
  capitalizeBody,
  createFixedAssetBody,
  depreciatePeriodBody,
  disposeBody,
  impairBody,
  importAssetsBody,
  isNonDepreciableCategory,
  revalueBody,
  runDepreciationBody,
  updateFixedAssetBody,
  type AssetClassBody,
  type CapitalizeBody,
  type CreateFixedAssetBody,
  type DepreciatePeriodBody,
  type DisposeBody,
  type ImpairBody,
  type ImportAssetsBody,
  type RevalueBody,
  type RunDepreciationBody,
  type UpdateFixedAssetBody,
} from "../../shared/validators/fixed-assets";
import {
  FA_SOURCE,
  IMPORT_COLUMNS,
  REGISTER_COLUMNS,
  assetRegister,
  capitalizeAsset,
  depreciateInTx,
  disposeAsset,
  impairAsset,
  loadAsset,
  parseCsv,
  recordEvent,
  revalueAsset,
  runDepreciation,
  scheduleTo,
  calcInput,
  type DepreciationOutcome,
} from "../services/fixed-assets";
import { assertAccount, q } from "../services/inventory/store";

const log = createLogger("fixed-assets");
const todayIso = () => new Date().toISOString().slice(0, 10);

async function assertAccess(req: Request, companyId: string): Promise<void> {
  const ok = await storage.hasCompanyAccess(req.user!.id, companyId);
  if (!ok) throw new DomainError("COMPANY_ACCESS_DENIED", 403, undefined, "Access denied");
}

async function assetForRequest(req: Request) {
  const r = await pool.query(`SELECT company_id FROM fixed_assets WHERE id = $1`, [req.params.id]);
  if (!r.rows[0])
    throw new DomainError("FIXED_ASSET_NOT_FOUND", 404, undefined, "Fixed asset not found");
  await assertAccess(req, r.rows[0].company_id);
  return r.rows[0].company_id as string;
}

/** Shape a depreciation outcome like the pre-W4-B single-asset response. */
function outcomeJson(o: DepreciationOutcome) {
  return {
    assetId: o.assetId,
    assetName: o.assetName,
    skipped: o.skipped,
    reason: o.reason,
    code: o.code,
    monthlyDepreciation: o.calc ? Number(fromFils(o.calc.amountFils)) : 0,
    prorationFactor: o.calc?.prorationFactor ?? 1,
    newAccumulatedDepreciation: o.calc ? Number(fromFils(o.calc.newAccumulatedFils)) : undefined,
    newNetBookValue: o.calc ? Number(fromFils(o.calc.newNetBookValueFils)) : undefined,
    journalEntryId: o.journalEntryId,
    scheduleId: o.scheduleId,
  };
}

interface ClassDefaults {
  is_depreciable: boolean;
  useful_life_years: number | null;
  depreciation_method: string;
  cost_account_id: string | null;
  accumulated_account_id: string | null;
  expense_account_id: string | null;
  tax_useful_life_years: number | null;
}

async function createAssetRecord(
  companyId: string,
  body: CreateFixedAssetBody,
  actorId: string,
  opts: { openingBalance?: boolean; openingAccumulatedFils?: number } = {}
) {
  return withLedgerTx(async (tx) => {
    let cls: ClassDefaults | null = null;
    if (body.assetClassId) {
      cls =
        (
          await q<ClassDefaults>(
            tx,
            sql`SELECT is_depreciable, useful_life_years, depreciation_method, cost_account_id,
                       accumulated_account_id, expense_account_id, tax_useful_life_years
                  FROM fixed_asset_classes WHERE id = ${body.assetClassId} AND company_id = ${companyId}`
          )
        )[0] ?? null;
      if (!cls) throw new DomainError("ASSET_CLASS_NOT_FOUND", 404);
    }
    const depreciable =
      !isNonDepreciableCategory(body.category) && (cls ? cls.is_depreciable : true);
    const life = depreciable ? (body.usefulLifeYears ?? cls?.useful_life_years ?? null) : null;
    if (depreciable && !life) {
      throw new DomainError(
        "USEFUL_LIFE_REQUIRED",
        400,
        { field: "usefulLifeYears" },
        "usefulLifeYears is required for depreciable assets"
      );
    }
    for (const id of [body.costAccountId, body.accumulatedAccountId]) {
      if (id) await assertAccount(tx, companyId, id, ["asset"]);
    }
    if (body.expenseAccountId)
      await assertAccount(tx, companyId, body.expenseAccountId, ["expense"]);
    if (body.costCenterId) {
      const cc = await q(
        tx,
        sql`SELECT 1 FROM cost_centers WHERE id = ${body.costCenterId} AND company_id = ${companyId}`
      );
      if (!cc[0])
        throw new DomainError("COST_CENTER_NOT_FOUND", 422, { costCenterId: body.costCenterId });
    }
    if (body.paymentAccountId) await assertAccount(tx, companyId, body.paymentAccountId);
    const cost = fromFils(body.purchaseCost);
    const [row] = await q<{ id: string }>(
      tx,
      sql`INSERT INTO fixed_assets (company_id, asset_name, asset_name_ar, asset_number, category, asset_class_id,
            purchase_date, purchase_cost, salvage_value, useful_life_years, depreciation_method,
            accumulated_depreciation, net_book_value, location, serial_number, notes, needs_capitalization_je,
            is_depreciable, cost_account_id, accumulated_account_id, expense_account_id, cost_center_id,
            tax_useful_life_years, tax_depreciation_method, acquisition_vat)
          VALUES (${companyId}, ${body.assetName}, ${body.assetNameAr ?? null}, ${body.assetNumber ?? null},
            ${body.category}, ${body.assetClassId ?? null}, ${body.purchaseDate}, ${cost},
            ${fromFils(body.salvageValue ?? 0)}, ${life},
            ${body.depreciationMethod ?? cls?.depreciation_method ?? "straight_line"}, 0, ${cost},
            ${body.location ?? null}, ${body.serialNumber ?? null}, ${body.notes ?? null}, true, ${depreciable},
            ${body.costAccountId ?? cls?.cost_account_id ?? null},
            ${body.accumulatedAccountId ?? cls?.accumulated_account_id ?? null},
            ${body.expenseAccountId ?? cls?.expense_account_id ?? null}, ${body.costCenterId ?? null},
            ${body.taxUsefulLifeYears ?? cls?.tax_useful_life_years ?? null}, ${body.taxDepreciationMethod ?? null},
            ${fromFils(body.paymentAccountId && body.inputVat ? body.inputVat : 0)})
          RETURNING id`
    );
    const asset = await loadAsset(tx, row.id, { lock: true });
    let capitalizationJournalEntryId: string | null = null;
    if ((body.paymentAccountId || opts.openingBalance) && body.purchaseCost > 0) {
      capitalizationJournalEntryId = await capitalizeAsset(tx, asset, {
        paymentAccountId: body.paymentAccountId ?? null,
        openingBalance: !body.paymentAccountId && opts.openingBalance === true,
        openingAccumulatedFils: opts.openingAccumulatedFils,
        actorId,
      });
    }
    const created = await loadAsset(tx, row.id);
    await recordEvent(tx, created, {
      type: "created",
      date: body.purchaseDate,
      amountFils: body.purchaseCost,
      details: { category: body.category, depreciable },
      actorId,
    });
    return { ...created, capitalizationJournalEntryId };
  });
}

export function registerFixedAssetRoutes(app: Express) {
  // =====================================
  // Asset classes (R10-17)
  // =====================================

  app.get(
    "/api/companies/:companyId/fixed-asset-classes",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      await assertAccess(req, req.params.companyId);
      const r = await pool.query(
        `SELECT * FROM fixed_asset_classes WHERE company_id = $1 ORDER BY code`,
        [req.params.companyId]
      );
      res.json(r.rows);
    })
  );

  app.post(
    "/api/companies/:companyId/fixed-asset-classes",
    authMiddleware,
    requireCustomer,
    strictBody(assetClassBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      const b = parsedBody<AssetClassBody>(req);
      const row = await withLedgerTx(async (tx) => {
        for (const id of [b.costAccountId, b.accumulatedAccountId]) {
          if (id) await assertAccount(tx, companyId, id, ["asset"]);
        }
        if (b.expenseAccountId) await assertAccount(tx, companyId, b.expenseAccountId, ["expense"]);
        const depreciable = b.isDepreciable !== false;
        if (depreciable && !b.usefulLifeYears) {
          throw new DomainError("USEFUL_LIFE_REQUIRED", 400, { field: "usefulLifeYears" });
        }
        return (
          await q(
            tx,
            sql`INSERT INTO fixed_asset_classes (company_id, code, name, name_ar, is_depreciable, useful_life_years,
                  depreciation_method, cost_account_id, accumulated_account_id, expense_account_id, tax_useful_life_years)
                VALUES (${companyId}, ${b.code}, ${b.name}, ${b.nameAr ?? null}, ${depreciable},
                  ${depreciable ? b.usefulLifeYears : null}, ${b.depreciationMethod ?? "straight_line"},
                  ${b.costAccountId ?? null}, ${b.accumulatedAccountId ?? null}, ${b.expenseAccountId ?? null},
                  ${b.taxUsefulLifeYears ?? null})
                RETURNING *`
          )
        )[0];
      });
      res.status(201).json(row);
    })
  );

  app.delete(
    "/api/companies/:companyId/fixed-asset-classes/:classId",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, classId } = req.params;
      await assertAccess(req, companyId);
      const used = await pool.query(
        `SELECT 1 FROM fixed_assets WHERE asset_class_id = $1 LIMIT 1`,
        [classId]
      );
      if (used.rows.length) throw new DomainError("ASSET_CLASS_IN_USE", 409);
      const r = await pool.query(
        `DELETE FROM fixed_asset_classes WHERE id = $1 AND company_id = $2`,
        [classId, companyId]
      );
      if (!r.rowCount) throw new DomainError("ASSET_CLASS_NOT_FOUND", 404);
      res.json({ message: "Asset class deleted" });
    })
  );

  // =====================================
  // Register
  // =====================================

  app.get(
    "/api/companies/:companyId/fixed-assets",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      await assertAccess(req, req.params.companyId);
      const result = await pool.query(
        `SELECT * FROM fixed_assets WHERE company_id = $1 ORDER BY created_at DESC`,
        [req.params.companyId]
      );
      res.json(result.rows);
    })
  );

  app.get(
    "/api/companies/:companyId/fixed-assets/summary",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      const totals = (
        await pool.query(
          `SELECT COUNT(*) AS total_assets,
                  COALESCE(SUM(purchase_cost), 0) AS total_cost,
                  COALESCE(SUM(accumulated_depreciation), 0) AS total_accumulated_depreciation,
                  COALESCE(SUM(net_book_value), 0) AS total_net_book_value
             FROM fixed_assets WHERE company_id = $1 AND status = 'active'`,
          [companyId]
        )
      ).rows[0];
      const byCategory = await pool.query(
        `SELECT category, COUNT(*) AS count,
                COALESCE(SUM(purchase_cost), 0) AS total_cost,
                COALESCE(SUM(accumulated_depreciation), 0) AS total_accumulated_depreciation,
                COALESCE(SUM(net_book_value), 0) AS total_net_book_value
           FROM fixed_assets WHERE company_id = $1 AND status = 'active'
          GROUP BY category ORDER BY total_cost DESC`,
        [companyId]
      );
      res.json({
        totalAssets: parseInt(totals.total_assets),
        totalCost: parseFloat(totals.total_cost),
        totalAccumulatedDepreciation: parseFloat(totals.total_accumulated_depreciation),
        totalNetBookValue: parseFloat(totals.total_net_book_value),
        byCategory: (
          byCategory.rows as Array<{
            category: string;
            count: string;
            total_cost: string;
            total_accumulated_depreciation: string;
            total_net_book_value: string;
          }>
        ).map((row) => ({
          category: row.category,
          count: parseInt(row.count),
          totalCost: parseFloat(row.total_cost),
          totalAccumulatedDepreciation: parseFloat(row.total_accumulated_depreciation),
          totalNetBookValue: parseFloat(row.total_net_book_value),
        })),
      });
    })
  );

  // Asset register export (book vs tax), json | xlsx | csv (R10-17).
  app.get(
    "/api/companies/:companyId/fixed-assets/register",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      const format = readFormat(req.query.format);
      const asOf =
        typeof req.query.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.asOf)
          ? req.query.asOf
          : todayIso();
      const rows = await assetRegister(companyId, asOf);
      if (format === "json") return res.json({ asOf, rows });
      await sendTabular(res, format, `fixed-asset-register-${asOf}`, [
        { sheetName: "Fixed Asset Register", columns: REGISTER_COLUMNS, rows },
      ]);
    })
  );

  // CSV bulk import with row validation (R10-17).
  app.post(
    "/api/companies/:companyId/fixed-assets/import",
    authMiddleware,
    requireCustomer,
    strictBody(importAssetsBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      const body = parsedBody<ImportAssetsBody>(req);
      const table = parseCsv(body.csv);
      if (table.length < 2)
        throw new DomainError("IMPORT_EMPTY", 400, undefined, "The CSV has no data rows");
      const header = table[0].map((h) => h.trim());
      const unknown = header.filter((h) => !(IMPORT_COLUMNS as readonly string[]).includes(h));
      if (unknown.length) {
        throw new DomainError("IMPORT_UNKNOWN_COLUMNS", 400, { unknown, allowed: IMPORT_COLUMNS });
      }
      const classes = (
        await pool.query(`SELECT id, code FROM fixed_asset_classes WHERE company_id = $1`, [
          companyId,
        ])
      ).rows as Array<{ id: string; code: string }>;
      const errors: Array<{ row: number; field?: string; message: string }> = [];
      const valid: Array<{ row: number; body: CreateFixedAssetBody; accumulatedFils: number }> = [];
      table.slice(1).forEach((cells, i) => {
        const rowNo = i + 2;
        const rec: Record<string, unknown> = {};
        header.forEach((h, k) => {
          const v = (cells[k] ?? "").trim();
          if (v !== "") rec[h] = v;
        });
        const { classCode, accumulatedDepreciation, ...rest } = rec as Record<string, string>;
        if (classCode) {
          const c = classes.find((x) => x.code === classCode);
          if (!c) {
            errors.push({
              row: rowNo,
              field: "classCode",
              message: `Unknown asset class ${classCode}`,
            });
            return;
          }
          (rest as Record<string, unknown>).assetClassId = c.id;
        }
        const parsed = createFixedAssetBody.safeParse(rest);
        if (!parsed.success) {
          for (const issue of parsed.error.issues) {
            errors.push({ row: rowNo, field: issue.path.join("."), message: issue.message });
          }
          return;
        }
        let accFils = 0;
        if (accumulatedDepreciation) {
          try {
            accFils = toFils(accumulatedDepreciation);
          } catch {
            errors.push({
              row: rowNo,
              field: "accumulatedDepreciation",
              message: "Invalid amount",
            });
            return;
          }
        }
        valid.push({ row: rowNo, body: parsed.data, accumulatedFils: accFils });
      });
      if (errors.length || body.dryRun) {
        return res.status(errors.length ? 422 : 200).json({
          code: errors.length ? "IMPORT_INVALID" : undefined,
          dryRun: body.dryRun === true,
          validRows: valid.length,
          errors,
          created: [],
        });
      }
      const created: string[] = [];
      for (const v of valid) {
        await assertPeriodNotLocked(companyId, v.body.purchaseDate);
        const a = await createAssetRecord(companyId, v.body, req.user!.id, {
          openingBalance: body.openingBalance === true,
          openingAccumulatedFils: v.accumulatedFils,
        });
        created.push(a.id);
      }
      res.status(201).json({ dryRun: false, validRows: valid.length, errors: [], created });
    })
  );

  app.get(
    "/api/fixed-assets/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      await assetForRequest(req);
      const r = await pool.query(`SELECT * FROM fixed_assets WHERE id = $1`, [req.params.id]);
      res.json(r.rows[0]);
    })
  );

  // Per-asset audit trail (R10-17).
  app.get(
    "/api/fixed-assets/:id/events",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      await assetForRequest(req);
      const r = await pool.query(
        `SELECT e.*, je.entry_number FROM fixed_asset_events e
           LEFT JOIN journal_entries je ON je.id = e.journal_entry_id
          WHERE e.asset_id = $1 ORDER BY e.created_at, e.id`,
        [req.params.id]
      );
      res.json(r.rows);
    })
  );

  // Projected book + tax schedule (no posting).
  app.get(
    "/api/fixed-assets/:id/schedule",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      await assetForRequest(req);
      const out = await withLedgerTx(async (tx) => {
        const a = await loadAsset(tx, req.params.id);
        const c = calcInput(a);
        const life = a.useful_life_years ?? 0;
        const [y, m] = a.purchase_iso.split("-").map(Number);
        const endY = y + life + 1;
        const book = scheduleTo({ ...c, revaluationFils: 0, impairmentFils: 0 }, endY, m);
        const tax = scheduleTo(
          {
            ...c,
            usefulLifeYears: a.tax_useful_life_years ?? a.useful_life_years,
            method: a.tax_depreciation_method ?? a.depreciation_method,
            revaluationFils: 0,
            impairmentFils: 0,
          },
          endY,
          m
        );
        return {
          book: book.months.map((p) => ({ ...p, amount: Number(fromFils(p.amountFils)) })),
          tax: tax.months.map((p) => ({ ...p, amount: Number(fromFils(p.amountFils)) })),
        };
      });
      res.json(out);
    })
  );

  // Create (Land / non-depreciable classes need no useful life: R10-04). 201.
  app.post(
    "/api/companies/:companyId/fixed-assets",
    authMiddleware,
    requireCustomer,
    strictBody(createFixedAssetBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      const body = parsedBody<CreateFixedAssetBody>(req);
      await assertPeriodNotLocked(companyId, body.purchaseDate);
      const asset = await createAssetRecord(companyId, body, req.user!.id);
      log.info({ assetId: asset.id, companyId }, "Fixed asset created");
      res.status(201).json(asset);
    })
  );

  app.patch(
    "/api/fixed-assets/:id",
    authMiddleware,
    requireCustomer,
    strictBody(updateFixedAssetBody),
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await assetForRequest(req);
      const body = parsedBody<UpdateFixedAssetBody>(req);
      const out = await withLedgerTx(async (tx) => {
        const a = await loadAsset(tx, req.params.id, { lock: true });
        await assertPeriodNotLocked(companyId, a.purchase_iso);
        if (body.purchaseDate) await assertPeriodNotLocked(companyId, body.purchaseDate);
        const onGl = !!a.capitalization_entry_id || !a.needs_capitalization_je;
        const booked = await q<{ n: number }>(
          tx,
          sql`SELECT COUNT(*)::int AS n FROM depreciation_schedules WHERE asset_id = ${a.id}`
        );
        if (onGl && (body.purchaseCost !== undefined || body.purchaseDate !== undefined)) {
          const costChanged =
            body.purchaseCost !== undefined &&
            fromFils(body.purchaseCost) !== Number(a.purchase_cost).toFixed(2);
          const dateChanged =
            body.purchaseDate !== undefined && body.purchaseDate !== a.purchase_iso;
          if (costChanged || dateChanged) {
            throw new DomainError(
              "ASSET_ON_GL",
              409,
              undefined,
              "Cost and purchase date are fixed once the asset is capitalised; revalue or impair instead"
            );
          }
        }
        const category = body.category ?? a.category;
        const depreciable = !isNonDepreciableCategory(category) && a.is_depreciable !== false;
        let life = body.usefulLifeYears === undefined ? a.useful_life_years : body.usefulLifeYears;
        if (!depreciable) life = null;
        // A2 (H9): a draft from a bill may be saved without a life; it stays a draft until set.
        if (depreciable && !life && a.status !== "draft")
          throw new DomainError("USEFUL_LIFE_REQUIRED", 400);
        if (life && booked[0].n >= life * 12 && body.usefulLifeYears !== undefined) {
          throw new DomainError(
            "USEFUL_LIFE_TOO_SHORT",
            400,
            { monthsBooked: booked[0].n },
            `Cannot shorten useful life — ${booked[0].n} months already depreciated`
          );
        }
        if (body.costCenterId) {
          const cc = await q(
            tx,
            sql`SELECT 1 FROM cost_centers WHERE id = ${body.costCenterId} AND company_id = ${companyId}`
          );
          if (!cc[0]) throw new DomainError("COST_CENTER_NOT_FOUND", 422);
        }
        const salvage =
          body.salvageValue === undefined || body.salvageValue === null
            ? null
            : fromFils(body.salvageValue);
        const cost = body.purchaseCost === undefined ? null : fromFils(body.purchaseCost);
        await tx.execute(
          sql`UPDATE fixed_assets SET
                asset_name = COALESCE(${body.assetName ?? null}, asset_name),
                asset_name_ar = COALESCE(${body.assetNameAr ?? null}, asset_name_ar),
                asset_number = COALESCE(${body.assetNumber ?? null}, asset_number),
                category = ${category},
                is_depreciable = ${depreciable},
                purchase_date = COALESCE(${body.purchaseDate ?? null}::timestamp, purchase_date),
                purchase_cost = COALESCE(${cost}::numeric, purchase_cost),
                salvage_value = COALESCE(${salvage}::numeric, salvage_value),
                useful_life_years = ${life},
                depreciation_method = COALESCE(${body.depreciationMethod ?? null}, depreciation_method),
                tax_useful_life_years = COALESCE(${body.taxUsefulLifeYears ?? null}, tax_useful_life_years),
                tax_depreciation_method = COALESCE(${body.taxDepreciationMethod ?? null}, tax_depreciation_method),
                cost_center_id = COALESCE(${body.costCenterId ?? null}, cost_center_id),
                location = COALESCE(${body.location ?? null}, location),
                serial_number = COALESCE(${body.serialNumber ?? null}, serial_number),
                notes = COALESCE(${body.notes ?? null}, notes),
                status = CASE WHEN status = 'draft' AND (${life}::int IS NOT NULL OR NOT ${depreciable})
                              THEN 'active' ELSE status END
              WHERE id = ${a.id}`
        );
        await tx.execute(
          sql`UPDATE fixed_assets SET net_book_value = purchase_cost + revaluation_surplus
                     - COALESCE(accumulated_depreciation, 0) - impairment_loss
               WHERE id = ${a.id} AND status = 'active'`
        );
        await recordEvent(tx, a, {
          type: "updated",
          details: { fields: Object.keys(body) },
          actorId: req.user!.id,
        });
        return (await q(tx, sql`SELECT * FROM fixed_assets WHERE id = ${a.id}`))[0];
      });
      res.json(out);
    })
  );

  app.delete(
    "/api/fixed-assets/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await assetForRequest(req);
      const posted = await pool.query(
        `SELECT 1 FROM journal_entries WHERE company_id = $1 AND source IN ('system', $2) AND source_id = $3
            AND status = 'posted' LIMIT 1`,
        [companyId, FA_SOURCE, req.params.id]
      );
      // A2 (H9): an asset bought on a bill is capitalised by the bill's journal; deleting the
      // register entry would leave it on the GL undepreciated. Void or revise the bill instead.
      const fromBill = await pool.query(
        `SELECT 1 FROM fixed_assets WHERE id = $1 AND source_bill_id IS NOT NULL`,
        [req.params.id]
      );
      if (fromBill.rows.length) {
        throw new DomainError(
          "ASSET_FROM_BILL",
          409,
          undefined,
          "This asset was capitalised by a supplier bill. Void or revise the bill to remove it."
        );
      }
      if (posted.rows.length) {
        return res.status(409).json({
          message:
            "Cannot delete a fixed asset that has posted journal entries (capitalization/depreciation). " +
            "Dispose of the asset instead so the general ledger stays consistent.",
          code: "ASSET_HAS_POSTED_JE",
        });
      }
      const before = (
        await pool.query(`SELECT asset_name, asset_number FROM fixed_assets WHERE id = $1`, [
          req.params.id,
        ])
      ).rows[0];
      await pool.query(`DELETE FROM fixed_assets WHERE id = $1`, [req.params.id]);
      await recordAudit({
        userId: req.user!.id,
        companyId,
        action: "fixed_asset.delete",
        entityType: "fixed_asset",
        entityId: req.params.id,
        before: { assetName: before?.asset_name, assetNumber: before?.asset_number },
        after: null,
        req,
      });
      res.json({ message: "Fixed asset deleted successfully" });
    })
  );

  // Capitalise an asset registered without a payment account.
  app.post(
    "/api/fixed-assets/:id/capitalize",
    authMiddleware,
    requireCustomer,
    strictBody(capitalizeBody),
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await assetForRequest(req);
      await assertCompanyPermission(actorFromRequest(req), companyId, ["ledger.post"]);
      const body = parsedBody<CapitalizeBody>(req);
      const entryId = await withLedgerTx(async (tx) => {
        const a = await loadAsset(tx, req.params.id, { lock: true });
        return capitalizeAsset(tx, a, {
          paymentAccountId: body.paymentAccountId ?? null,
          openingBalance: body.openingBalance === true,
          date: body.date ?? null,
          actorId: req.user!.id,
        });
      });
      res.json({ capitalizationJournalEntryId: entryId });
    })
  );

  // =====================================
  // Depreciation
  // =====================================

  app.post(
    "/api/fixed-assets/:id/depreciate",
    authMiddleware,
    requireCustomer,
    strictBody(depreciatePeriodBody),
    asyncHandler(async (req: Request, res: Response) => {
      await assetForRequest(req);
      const body = parsedBody<DepreciatePeriodBody>(req);
      const now = new Date();
      const month = body.month ?? now.getUTCMonth() + 1;
      const year = body.year ?? now.getUTCFullYear();
      const result = await withLedgerTx(async (tx) => {
        const a = await loadAsset(tx, req.params.id, { lock: true });
        if (a.status !== "active")
          throw new DomainError(
            "ASSET_NOT_ACTIVE",
            400,
            undefined,
            "Can only depreciate active assets"
          );
        const o = await depreciateInTx(tx, a, year, month, req.user!.id);
        return { o, asset: await loadAsset(tx, a.id) };
      });
      const o = result.o;
      if (o.skipped) {
        const status =
          o.code === "ASSET_NOT_CAPITALIZED" ? 422 : o.code === "ALREADY_DEPRECIATED" ? 409 : 400;
        return res.status(status).json({
          message:
            o.code === "ASSET_NOT_CAPITALIZED"
              ? "This asset is not on the general ledger, so it cannot be depreciated. Capitalise it first (POST /api/fixed-assets/:id/capitalize)."
              : o.reason,
          code: o.code,
          period: { month, year },
          existingScheduleId: o.scheduleId,
        });
      }
      res.json({
        asset: result.asset,
        period: { month, year },
        ...outcomeJson(o),
      });
    })
  );

  app.post(
    "/api/companies/:companyId/fixed-assets/run-depreciation",
    authMiddleware,
    requireCustomer,
    strictBody(runDepreciationBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      const { month, year } = parsedBody<RunDepreciationBody>(req);
      await assertPeriodNotLocked(companyId, `${year}-${String(month).padStart(2, "0")}-01`);
      const results = await runDepreciation(companyId, year, month, req.user!.id);
      res.json({
        month,
        year,
        assetsProcessed: results.length,
        posted: results.filter((r) => !r.skipped).length,
        results: results.map(outcomeJson),
      });
    })
  );

  // =====================================
  // Revaluation / impairment (R10-17)
  // =====================================

  app.post(
    "/api/fixed-assets/:id/revalue",
    authMiddleware,
    requireCustomer,
    strictBody(revalueBody),
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await assetForRequest(req);
      await assertCompanyPermission(actorFromRequest(req), companyId, ["ledger.post"]);
      const b = parsedBody<RevalueBody>(req);
      const out = await withLedgerTx(async (tx) => {
        const a = await loadAsset(tx, req.params.id, { lock: true });
        return revalueAsset(tx, a, {
          date: b.date,
          fairValueFils: b.fairValue,
          notes: b.notes,
          actorId: req.user!.id,
        });
      });
      res.status(201).json({ journalEntryId: out.journalEntryId, change: fromFils(out.deltaFils) });
    })
  );

  app.post(
    "/api/fixed-assets/:id/impair",
    authMiddleware,
    requireCustomer,
    strictBody(impairBody),
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await assetForRequest(req);
      await assertCompanyPermission(actorFromRequest(req), companyId, ["ledger.post"]);
      const b = parsedBody<ImpairBody>(req);
      const out = await withLedgerTx(async (tx) => {
        const a = await loadAsset(tx, req.params.id, { lock: true });
        return impairAsset(tx, a, {
          date: b.date,
          amountFils: b.amount,
          notes: b.notes,
          actorId: req.user!.id,
        });
      });
      res.status(201).json(out);
    })
  );

  // =====================================
  // Disposal (R10-08)
  // =====================================

  app.post(
    "/api/fixed-assets/:id/dispose",
    authMiddleware,
    requireCustomer,
    strictBody(disposeBody),
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await assetForRequest(req);
      const b = parsedBody<DisposeBody>(req);
      await assertPeriodNotLocked(companyId, b.disposalDate);
      const out = await disposeAsset(req.params.id, companyId, {
        disposalDate: b.disposalDate,
        proceedsFils: b.disposalAmount ?? 0,
        proceedsAccountId: b.proceedsAccountId ?? null,
        onCredit: b.onCredit === true,
        buyerName: b.buyerName ?? null,
        vatTreatment: b.vatTreatment,
        notes: b.notes ?? null,
        actorId: req.user!.id,
      });
      res.json(out);
    })
  );
}
