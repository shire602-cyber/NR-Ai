import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import crypto from "crypto";
import { db } from "../db";
import {
  accounts as accountsTable,
  invoiceLines as invoiceLinesTable,
  invoices as invoicesTable,
  journalEntries as journalEntriesTable,
  journalLines as journalLinesTable,
  receipts as receiptsTable,
  vatReturns as vatReturnsTable,
} from "../../shared/schema";

// JSON snapshots serialize Date columns as ISO strings; Drizzle timestamp
// columns require Date objects. Any value that is exactly an ISO timestamp
// string is coerced back.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
function coerceDates<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = { ...row };
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === 'string' && ISO_DATE.test(v)) out[k] = new Date(v);
  }
  return out as T;
}

export function registerBackupRoutes(app: Express) {
  // =====================================
  // DATA BACKUP & RESTORE
  // =====================================

  // Get all backups for company
  app.get("/api/companies/:companyId/backups", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId } = req.params;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const backupList = await storage.getBackupsByCompanyId(companyId);
    // Don't send the full data snapshot in the list
    const sanitizedBackups = backupList.map(({ dataSnapshot, ...backup }) => backup);
    res.json(sanitizedBackups);
  }));

  // Create a new backup
  app.post("/api/companies/:companyId/backups", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId } = req.params;
    const { name, description } = req.body;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Create initial backup record
    let backup = await storage.createBackup({
      companyId,
      name: name || `Backup ${new Date().toLocaleDateString()}`,
      description: description || 'Manual backup',
      backupType: 'manual',
      status: 'in_progress',
      createdBy: userId,
    });

    try {
      // Gather all financial data — parallelise the top-level fetches and
      // batch the lines instead of issuing one round-trip per parent row.
      const [accounts, journalEntries, invoices, receipts, vatReturns] = await Promise.all([
        storage.getAccountsByCompanyId(companyId),
        storage.getJournalEntriesByCompanyId(companyId),
        storage.getInvoicesByCompanyId(companyId),
        storage.getReceiptsByCompanyId(companyId),
        storage.getVatReturnsByCompanyId(companyId),
      ]);

      const [journalLines, invoiceLines] = await Promise.all([
        storage.getJournalLinesByEntryIds(journalEntries.map(e => e.id)),
        storage.getInvoiceLinesByInvoiceIds(invoices.map(i => i.id)),
      ]);

      // Create snapshot
      const snapshot = {
        version: '1.0',
        createdAt: new Date().toISOString(),
        companyId,
        data: {
          accounts,
          journalEntries,
          journalLines,
          invoices,
          invoiceLines,
          receipts,
          vatReturns,
        }
      };

      const snapshotJson = JSON.stringify(snapshot);

      // Calculate checksum (simple hash)
      const checksum = crypto.createHash('sha256').update(snapshotJson).digest('hex');

      // Update backup with data
      backup = await storage.updateBackup(backup.id, {
        status: 'completed',
        dataSnapshot: snapshotJson,
        checksum,
        sizeBytes: Buffer.byteLength(snapshotJson, 'utf8'),
        accountsCount: accounts.length,
        journalEntriesCount: journalEntries.length,
        invoicesCount: invoices.length,
        receiptsCount: receipts.length,
        vatReturnsCount: vatReturns.length,
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
      });

      // Log activity
      await storage.createActivityLog({
        companyId,
        userId,
        action: 'create',
        entityType: 'backup',
        entityId: backup.id,
        description: `Created backup: ${backup.name}`,
      });

      // Return without the full data snapshot
      const { dataSnapshot, ...sanitizedBackup } = backup;
      res.status(201).json(sanitizedBackup);
    } catch (error: any) {
      // Mark as failed
      await storage.updateBackup(backup.id, {
        status: 'failed',
      });
      throw error;
    }
  }));

  // Get backup details (without full data)
  app.get("/api/backups/:id", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { id } = req.params;

    const backup = await storage.getBackup(id);
    if (!backup) {
      return res.status(404).json({ message: 'Backup not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, backup.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Return without the full data snapshot for security
    const { dataSnapshot, ...sanitizedBackup } = backup;
    res.json(sanitizedBackup);
  }));

  // Download backup data (for export)
  app.get("/api/backups/:id/download", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { id } = req.params;

    const backup = await storage.getBackup(id);
    if (!backup) {
      return res.status(404).json({ message: 'Backup not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, backup.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (backup.status !== 'completed' || !backup.dataSnapshot) {
      return res.status(400).json({ message: 'Backup is not complete' });
    }

    // Log the download
    await storage.createActivityLog({
      companyId: backup.companyId,
      userId,
      action: 'view',
      entityType: 'backup',
      entityId: backup.id,
      description: `Downloaded backup: ${backup.name}`,
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${backup.name.replace(/[^a-z0-9]/gi, '_')}_${backup.id.slice(0, 8)}.json"`);
    res.send(backup.dataSnapshot);
  }));

  // Restore from backup (preview first)
  app.post("/api/backups/:id/restore-preview", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { id } = req.params;

    const backup = await storage.getBackup(id);
    if (!backup) {
      return res.status(404).json({ message: 'Backup not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, backup.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (backup.status !== 'completed' || !backup.dataSnapshot) {
      return res.status(400).json({ message: 'Backup is not complete' });
    }

    // Get current data counts for comparison
    const [currentAccounts, currentEntries, currentInvoices, currentReceipts] = await Promise.all([
      storage.getAccountsByCompanyId(backup.companyId),
      storage.getJournalEntriesByCompanyId(backup.companyId),
      storage.getInvoicesByCompanyId(backup.companyId),
      storage.getReceiptsByCompanyId(backup.companyId),
    ]);

    res.json({
      backup: {
        id: backup.id,
        name: backup.name,
        createdAt: backup.createdAt,
        accountsCount: backup.accountsCount,
        journalEntriesCount: backup.journalEntriesCount,
        invoicesCount: backup.invoicesCount,
        receiptsCount: backup.receiptsCount,
      },
      current: {
        accountsCount: currentAccounts.length,
        journalEntriesCount: currentEntries.length,
        invoicesCount: currentInvoices.length,
        receiptsCount: currentReceipts.length,
      },
      warning: 'Restoring will replace ALL current financial data with the backup data. This action cannot be undone.',
    });
  }));

  // Execute restore from backup
  app.post("/api/backups/:id/restore", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { id } = req.params;
    const { confirmRestore } = req.body;

    if (!confirmRestore) {
      return res.status(400).json({ message: 'You must confirm the restore operation' });
    }

    const backup = await storage.getBackup(id);
    if (!backup) {
      return res.status(404).json({ message: 'Backup not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, backup.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Check user role - only owner can restore
    const userRole = await storage.getUserRole(backup.companyId, userId);
    if (!userRole || userRole.role !== 'owner') {
      return res.status(403).json({ message: 'Only company owners can restore backups' });
    }

    if (backup.status !== 'completed' || !backup.dataSnapshot) {
      return res.status(400).json({ message: 'Backup is not complete' });
    }

    // Create a pre-restore backup first
    const preRestoreBackup = await storage.createBackup({
      companyId: backup.companyId,
      name: `Pre-restore backup (before restoring ${backup.name})`,
      description: 'Automatic backup created before restore operation',
      backupType: 'pre_restore',
      status: 'in_progress',
      createdBy: userId,
    });

    try {
      // Gather current data for pre-restore backup — parallel + batched.
      const [currentAccounts, currentEntries, currentInvoices, currentReceipts, currentVatReturns] = await Promise.all([
        storage.getAccountsByCompanyId(backup.companyId),
        storage.getJournalEntriesByCompanyId(backup.companyId),
        storage.getInvoicesByCompanyId(backup.companyId),
        storage.getReceiptsByCompanyId(backup.companyId),
        storage.getVatReturnsByCompanyId(backup.companyId),
      ]);

      const [currentJournalLines, currentInvoiceLines] = await Promise.all([
        storage.getJournalLinesByEntryIds(currentEntries.map(e => e.id)),
        storage.getInvoiceLinesByInvoiceIds(currentInvoices.map(i => i.id)),
      ]);

      const preRestoreSnapshot = {
        version: '1.0',
        createdAt: new Date().toISOString(),
        companyId: backup.companyId,
        data: {
          accounts: currentAccounts,
          journalEntries: currentEntries,
          journalLines: currentJournalLines,
          invoices: currentInvoices,
          invoiceLines: currentInvoiceLines,
          receipts: currentReceipts,
          vatReturns: currentVatReturns,
        }
      };

      const preRestoreJson = JSON.stringify(preRestoreSnapshot);
      const preRestoreChecksum = crypto.createHash('sha256').update(preRestoreJson).digest('hex');

      await storage.updateBackup(preRestoreBackup.id, {
        status: 'completed',
        dataSnapshot: preRestoreJson,
        checksum: preRestoreChecksum,
        sizeBytes: Buffer.byteLength(preRestoreJson, 'utf8'),
        accountsCount: currentAccounts.length,
        journalEntriesCount: currentEntries.length,
        invoicesCount: currentInvoices.length,
        receiptsCount: currentReceipts.length,
        vatReturnsCount: currentVatReturns.length,
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      });

      // Log activity
      await storage.createActivityLog({
        companyId: backup.companyId,
        userId,
        action: 'update',
        entityType: 'backup',
        entityId: backup.id,
        description: `Restored from backup: ${backup.name}`,
      });

      // Recovery restore: transactionally re-insert snapshot rows that no
      // longer exist (matched by primary key). Existing rows are never
      // touched and never deleted, so data created after the backup is safe
      // and foreign keys from tables outside the snapshot cannot break.
      const snapshot = JSON.parse(backup.dataSnapshot ?? '{}');
      if (backup.checksum) {
        const actual = crypto.createHash('sha256').update(backup.dataSnapshot ?? '').digest('hex');
        if (actual !== backup.checksum) {
          return res.status(409).json({ message: 'Backup integrity check failed — checksum mismatch' });
        }
      }
      const data = snapshot?.data ?? {};
      const restored: Record<string, number> = {};

      await db.transaction(async (tx: typeof db) => {
        const insertMissing = async (label: string, table: any, rows: unknown[] | undefined) => {
          if (!Array.isArray(rows) || rows.length === 0) {
            restored[label] = 0;
            return;
          }
          const result = await tx
            .insert(table)
            .values(rows.map((row) => coerceDates(row as Record<string, unknown>)) as any)
            .onConflictDoNothing()
            .returning({ id: (table as any).id });
          restored[label] = result.length;
        };

        // FK-safe order: parents before children.
        await insertMissing('accounts', accountsTable, data.accounts);
        await insertMissing('journalEntries', journalEntriesTable, data.journalEntries);
        await insertMissing('journalLines', journalLinesTable, data.journalLines);
        await insertMissing('invoices', invoicesTable, data.invoices);
        await insertMissing('invoiceLines', invoiceLinesTable, data.invoiceLines);
        await insertMissing('receipts', receiptsTable, data.receipts);
        await insertMissing('vatReturns', vatReturnsTable, data.vatReturns);
      });

      const totalRestored = Object.values(restored).reduce((sum, n) => sum + n, 0);
      res.json({
        success: true,
        message: totalRestored > 0
          ? `Restore complete: ${totalRestored} missing record(s) recovered from the backup.`
          : 'Restore complete: all backed-up records already exist — nothing was missing.',
        preRestoreBackupId: preRestoreBackup.id,
        restored,
        totalRestored,
        restoredFrom: {
          id: backup.id,
          name: backup.name,
          accountsCount: backup.accountsCount,
          journalEntriesCount: backup.journalEntriesCount,
          invoicesCount: backup.invoicesCount,
          receiptsCount: backup.receiptsCount,
        },
      });
    } catch (error: any) {
      await storage.updateBackup(preRestoreBackup.id, { status: 'failed' });
      throw error;
    }
  }));

  // Delete backup
  app.delete("/api/backups/:id", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { id } = req.params;

    const backup = await storage.getBackup(id);
    if (!backup) {
      return res.status(404).json({ message: 'Backup not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, backup.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Check user role - only owner can delete
    const userRole = await storage.getUserRole(backup.companyId, userId);
    if (!userRole || userRole.role !== 'owner') {
      return res.status(403).json({ message: 'Only company owners can delete backups' });
    }

    await storage.deleteBackup(id);

    await storage.createActivityLog({
      companyId: backup.companyId,
      userId,
      action: 'delete',
      entityType: 'backup',
      entityId: id,
      description: `Deleted backup: ${backup.name}`,
    });

    res.json({ message: 'Backup deleted successfully' });
  }));
}
