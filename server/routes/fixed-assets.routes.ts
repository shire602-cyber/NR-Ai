import type { Express, Request, Response } from 'express';
import { pool } from '../db';
import { storage } from '../storage';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { createLogger } from '../config/logger';

const log = createLogger('fixed-assets');

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
      location, serialNumber, notes
    } = req.body;

    if (!assetName || !category || !purchaseDate || purchaseCost === undefined || !usefulLifeYears) {
      return res.status(400).json({ message: 'assetName, category, purchaseDate, purchaseCost, and usefulLifeYears are required' });
    }

    const cost = parseFloat(purchaseCost);
    const salvage = parseFloat(salvageValue || 0);
    const nbv = cost - 0; // Initial NBV = cost (no depreciation yet)

    const result = await pool.query(
      `INSERT INTO fixed_assets (company_id, asset_name, asset_name_ar, asset_number, category, purchase_date, purchase_cost, salvage_value, useful_life_years, depreciation_method, accumulated_depreciation, net_book_value, location, serial_number, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, $11, $12, $13, $14)
       RETURNING *`,
      [companyId, assetName, assetNameAr || null, assetNumber || null, category, purchaseDate, cost, salvage, usefulLifeYears, depreciationMethod || 'straight_line', nbv, location || null, serialNumber || null, notes || null]
    );

    log.info({ assetId: result.rows[0].id, companyId }, 'Fixed asset created');
    res.json(result.rows[0]);
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
    const nbv = parseFloat(updated.purchase_cost) - parseFloat(updated.accumulated_depreciation || 0);
    await pool.query(`UPDATE fixed_assets SET net_book_value = $1 WHERE id = $2`, [nbv, id]);

    const final = await pool.query(`SELECT * FROM fixed_assets WHERE id = $1`, [id]);
    log.info({ assetId: id }, 'Fixed asset updated');
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

  // Calculate and record monthly depreciation for a single asset
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

    const cost = parseFloat(asset.purchase_cost);
    const salvage = parseFloat(asset.salvage_value || 0);
    const usefulLifeYears = asset.useful_life_years;
    const currentAccDep = parseFloat(asset.accumulated_depreciation || 0);
    const method = asset.depreciation_method || 'straight_line';

    let monthlyDepreciation = 0;

    if (method === 'straight_line') {
      // Straight-line: (cost - salvage) / (useful_life * 12) per month
      monthlyDepreciation = (cost - salvage) / (usefulLifeYears * 12);
    } else if (method === 'declining_balance') {
      // Declining balance: 2 * (1/useful_life) * NBV per year / 12 per month
      const currentNBV = cost - currentAccDep;
      const annualRate = 2 / usefulLifeYears;
      monthlyDepreciation = (currentNBV * annualRate) / 12;
      // Don't depreciate below salvage value
      if (currentNBV - monthlyDepreciation < salvage) {
        monthlyDepreciation = Math.max(0, currentNBV - salvage);
      }
    }

    // Don't depreciate beyond (cost - salvage)
    const maxDepreciation = cost - salvage;
    if (currentAccDep + monthlyDepreciation > maxDepreciation) {
      monthlyDepreciation = Math.max(0, maxDepreciation - currentAccDep);
    }

    monthlyDepreciation = Math.round(monthlyDepreciation * 100) / 100;
    const newAccDep = Math.round((currentAccDep + monthlyDepreciation) * 100) / 100;
    const newNBV = Math.round((cost - newAccDep) * 100) / 100;

    await pool.query(
      `UPDATE fixed_assets SET accumulated_depreciation = $1, net_book_value = $2 WHERE id = $3`,
      [newAccDep, newNBV, id]
    );

    const updated = await pool.query(`SELECT * FROM fixed_assets WHERE id = $1`, [id]);
    log.info({ assetId: id, monthlyDepreciation, newAccDep, newNBV }, 'Depreciation recorded');
    res.json({
      asset: updated.rows[0],
      monthlyDepreciation,
      previousAccumulatedDepreciation: currentAccDep,
      newAccumulatedDepreciation: newAccDep,
      newNetBookValue: newNBV,
    });
  }));

  // Run depreciation for all active assets for a given month
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

    const assetsResult = await pool.query(
      `SELECT * FROM fixed_assets WHERE company_id = $1 AND status = 'active'`,
      [companyId]
    );

    const results: any[] = [];

    for (const asset of assetsResult.rows) {
      const cost = parseFloat(asset.purchase_cost);
      const salvage = parseFloat(asset.salvage_value || 0);
      const usefulLifeYears = asset.useful_life_years;
      const currentAccDep = parseFloat(asset.accumulated_depreciation || 0);
      const method = asset.depreciation_method || 'straight_line';
      const maxDepreciation = cost - salvage;

      let monthlyDepreciation = 0;

      if (method === 'straight_line') {
        monthlyDepreciation = (cost - salvage) / (usefulLifeYears * 12);
      } else if (method === 'declining_balance') {
        const currentNBV = cost - currentAccDep;
        const annualRate = 2 / usefulLifeYears;
        monthlyDepreciation = (currentNBV * annualRate) / 12;
        if (currentNBV - monthlyDepreciation < salvage) {
          monthlyDepreciation = Math.max(0, currentNBV - salvage);
        }
      }

      // Don't depreciate beyond max
      if (currentAccDep + monthlyDepreciation > maxDepreciation) {
        monthlyDepreciation = Math.max(0, maxDepreciation - currentAccDep);
      }

      if (monthlyDepreciation <= 0) {
        results.push({ assetId: asset.id, assetName: asset.asset_name, monthlyDepreciation: 0, skipped: true, reason: 'Fully depreciated' });
        continue;
      }

      monthlyDepreciation = Math.round(monthlyDepreciation * 100) / 100;
      const newAccDep = Math.round((currentAccDep + monthlyDepreciation) * 100) / 100;
      const newNBV = Math.round((cost - newAccDep) * 100) / 100;

      await pool.query(
        `UPDATE fixed_assets SET accumulated_depreciation = $1, net_book_value = $2 WHERE id = $3`,
        [newAccDep, newNBV, asset.id]
      );

      results.push({
        assetId: asset.id,
        assetName: asset.asset_name,
        monthlyDepreciation,
        newAccumulatedDepreciation: newAccDep,
        newNetBookValue: newNBV,
      });
    }

    log.info({ companyId, month, year, assetsProcessed: results.length }, 'Batch depreciation completed');
    res.json({
      month,
      year,
      assetsProcessed: results.length,
      results,
    });
  }));

  // =====================================
  // Disposal
  // =====================================

  // Record disposal of an asset
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

    const dispAmount = parseFloat(disposalAmount || 0);
    const nbv = parseFloat(asset.net_book_value || 0);
    const gainLoss = Math.round((dispAmount - nbv) * 100) / 100;

    await pool.query(
      `UPDATE fixed_assets SET
        status = 'disposed',
        disposal_date = $1,
        disposal_amount = $2,
        notes = COALESCE($3, notes)
       WHERE id = $4`,
      [disposalDate, dispAmount, notes || null, id]
    );

    const updated = await pool.query(`SELECT * FROM fixed_assets WHERE id = $1`, [id]);
    log.info({ assetId: id, disposalAmount: dispAmount, gainLoss }, 'Asset disposed');
    res.json({
      asset: updated.rows[0],
      disposalAmount: dispAmount,
      netBookValueAtDisposal: nbv,
      gainLoss,
      gainLossType: gainLoss >= 0 ? 'gain' : 'loss',
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
