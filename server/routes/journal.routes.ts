import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { storage } from '../storage';
import { insertJournalEntrySchema } from '../../shared/schema';
import { assertPeriodNotLocked } from '../services/period-lock.service';

export function registerJournalRoutes(app: Express) {
  // =====================================
  // Journal Entry Routes
  // =====================================

  // Customer-only: Full journal entries access
  app.get("/api/companies/:companyId/journal", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    // Check if user has access to this company
    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const entries = await storage.getJournalEntriesByCompanyId(companyId);

    // Fetch lines and accounts for each entry
    const entriesWithLines = await Promise.all(
      entries.map(async (entry) => {
        const lines = await storage.getJournalLinesByEntryId(entry.id);
        const linesWithAccounts = await Promise.all(
          lines.map(async (line) => {
            const account = await storage.getAccount(line.accountId);
            return { ...line, account };
          })
        );
        return { ...entry, lines: linesWithAccounts };
      })
    );

    res.json(entriesWithLines);
  }));

  // Customer-only: Create journal entries
  app.post("/api/companies/:companyId/journal", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;
    const { lines, date, status = 'draft', ...entryData } = req.body;

    // Check if user has access to this company
    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Validate at least 2 lines
    if (!lines || lines.length < 2) {
      return res.status(400).json({ message: 'Journal entry must have at least 2 lines' });
    }

    // Validate debits equal credits
    let totalDebit = 0;
    let totalCredit = 0;

    for (const line of lines) {
      totalDebit += Number(line.debit) || 0;
      totalCredit += Number(line.credit) || 0;
    }

    // Ensure at least one debit and one credit
    if (totalDebit === 0 || totalCredit === 0) {
      return res.status(400).json({ message: 'Entry must have at least one debit and one credit' });
    }

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return res.status(400).json({ message: `Debits (${totalDebit.toFixed(2)}) must equal credits (${totalCredit.toFixed(2)})` });
    }

    // Convert date string to Date object if it's a string
    const entryDate = typeof date === 'string' ? new Date(date) : date;

    // Block posting into a locked period. Drafts are also blocked because
    // their existence implies they will eventually be posted on this date.
    await assertPeriodNotLocked(companyId, entryDate);

    // Generate entry number atomically via storage helper
    const entryNumber = await storage.generateEntryNumber(companyId, entryDate);

    // Determine if posting immediately
    const isPosting = status === 'posted';

    // Create journal entry + lines atomically (storage validates balance & wraps in transaction)
    const entry = await storage.createJournalEntry(
      {
        ...entryData,
        date: entryDate,
        companyId,
        createdBy: userId,
        entryNumber,
        status: isPosting ? 'posted' : 'draft',
        source: entryData.source || 'manual',
        sourceId: entryData.sourceId || null,
        postedBy: isPosting ? userId : null,
        postedAt: isPosting ? new Date() : null,
      },
      lines.map((line: any) => ({
        accountId: line.accountId,
        debit: Number(line.debit) || 0,
        credit: Number(line.credit) || 0,
        description: line.description || null,
      }))
    );

    res.json({
      id: entry.id,
      entryNumber: entry.entryNumber,
      status: entry.status,
      message: isPosting ? 'Journal entry posted successfully' : 'Journal entry saved as draft'
    });
  }));

  // Customer-only: Get journal entry
  app.get("/api/journal/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    // Get journal entry
    const entry = await storage.getJournalEntry(id);
    if (!entry) {
      return res.status(404).json({ message: 'Journal entry not found' });
    }

    // Check if user has access to this company
    const hasAccess = await storage.hasCompanyAccess(userId, entry.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Get journal lines for this entry
    const lines = await storage.getJournalLinesByEntryId(id);

    res.json({
      ...entry,
      lines,
    });
  }));

  // Customer-only: Update journal entry
  app.put("/api/journal/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;
    const { lines, date, description, memo, notes, status: requestedStatus } = req.body;

    // Get journal entry to verify it exists and get company access
    const entry = await storage.getJournalEntry(id);
    if (!entry) {
      return res.status(404).json({ message: 'Journal entry not found' });
    }

    // Check if user has access to this company
    const hasAccess = await storage.hasCompanyAccess(userId, entry.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // IMMUTABILITY: Posted entries cannot be edited - must be reversed instead
    if (entry.status === 'posted') {
      return res.status(400).json({
        message: 'Posted journal entries cannot be edited. Use reversal to correct posted entries.',
        code: 'ENTRY_POSTED'
      });
    }

    // Void entries cannot be edited
    if (entry.status === 'void') {
      return res.status(400).json({
        message: 'Void journal entries cannot be edited.',
        code: 'ENTRY_VOID'
      });
    }

    // Validate at least 2 lines
    if (!lines || lines.length < 2) {
      return res.status(400).json({ message: 'Journal entry must have at least 2 lines' });
    }

    // Validate debits equal credits
    let totalDebit = 0;
    let totalCredit = 0;

    for (const line of lines) {
      totalDebit += Number(line.debit) || 0;
      totalCredit += Number(line.credit) || 0;
    }

    // Ensure at least one debit and one credit
    if (totalDebit === 0 || totalCredit === 0) {
      return res.status(400).json({ message: 'Entry must have at least one debit and one credit' });
    }

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return res.status(400).json({ message: `Debits (${totalDebit.toFixed(2)}) must equal credits (${totalCredit.toFixed(2)})` });
    }

    // Convert date string to Date object if it's a string
    const entryDate = typeof date === 'string' ? new Date(date) : date;

    // Block updates that would land in a locked period (either the existing
    // entry date or the requested new date).
    await assertPeriodNotLocked(entry.companyId, entry.date);
    if (entryDate) {
      await assertPeriodNotLocked(entry.companyId, entryDate);
    }

    // Whitelist: only safe fields can be edited via this endpoint.
    // Block changes to companyId, entryNumber, postedBy, source, sourceId, etc.
    // status may only transition between 'draft' and 'posted' (post path also
    // exists at /post; we permit 'posted' here for forms that submit-and-post).
    const safeUpdate: Record<string, any> = {
      date: entryDate,
      updatedBy: userId,
      updatedAt: new Date(),
    };
    if (description !== undefined) safeUpdate.description = description;
    if (memo !== undefined) safeUpdate.memo = memo;
    if (notes !== undefined) safeUpdate.notes = notes;
    if (requestedStatus !== undefined) {
      if (requestedStatus !== 'draft' && requestedStatus !== 'posted') {
        return res.status(400).json({
          message: `Invalid status '${requestedStatus}' — only 'draft' or 'posted' are accepted`,
        });
      }
      safeUpdate.status = requestedStatus;
      if (requestedStatus === 'posted') {
        safeUpdate.postedBy = userId;
        safeUpdate.postedAt = new Date();
      }
    }

    // Update journal entry + replace lines atomically (validates balance & wraps in transaction)
    const updatedEntry = await storage.updateJournalEntryWithLines(
      id,
      safeUpdate,
      lines.map((line: any) => ({
        accountId: line.accountId,
        debit: Number(line.debit) || 0,
        credit: Number(line.credit) || 0,
        description: line.description || null,
      }))
    );

    console.log('[Journal] Draft journal entry updated successfully:', id);
    res.json({ id: updatedEntry.id, status: updatedEntry.status, message: 'Draft entry updated successfully' });
  }));

  // Customer-only: Post a draft journal entry (makes it immutable)
  app.post("/api/journal/:id/post", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const entry = await storage.getJournalEntry(id);
    if (!entry) {
      return res.status(404).json({ message: 'Journal entry not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, entry.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (entry.status !== 'draft') {
      // Only draft entries can be posted - posted entries are immutable, void entries cannot be re-activated
      const errorMessage = entry.status === 'posted'
        ? 'Entry is already posted and cannot be modified'
        : 'Void entries cannot be posted or reactivated';
      return res.status(400).json({ message: errorMessage, code: `ENTRY_${entry.status.toUpperCase()}` });
    }

    // Validate debits = credits before posting
    const lines = await storage.getJournalLinesByEntryId(id);
    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of lines) {
      totalDebit += Number(line.debit) || 0;
      totalCredit += Number(line.credit) || 0;
    }

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return res.status(400).json({ message: 'Cannot post: Debits must equal credits' });
    }

    // Cannot post into a locked period.
    await assertPeriodNotLocked(entry.companyId, entry.date);

    const updatedEntry = await storage.updateJournalEntry(id, {
      status: 'posted',
      postedBy: userId,
      postedAt: new Date(),
    });

    console.log('[Journal] Entry posted successfully:', id);
    res.json({ id: updatedEntry.id, status: 'posted', message: 'Entry posted successfully' });
  }));

  // Customer-only: Reverse a posted journal entry (creates a new reversing entry)
  app.post("/api/journal/:id/reverse", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;
    const { reason } = req.body;

    const entry = await storage.getJournalEntry(id);
    if (!entry) {
      return res.status(404).json({ message: 'Journal entry not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, entry.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (entry.status !== 'posted') {
      return res.status(400).json({ message: 'Only posted entries can be reversed' });
    }

    // The reversal posts a new JE on `now`. Block if today is in a locked
    // period — reversing a posted entry into a closed period must go through
    // an unlock-and-amend flow instead.
    const now = new Date();
    await assertPeriodNotLocked(entry.companyId, now);

    // Get original lines
    const originalLines = await storage.getJournalLinesByEntryId(id);

    if (originalLines.length === 0) {
      return res.status(400).json({ message: 'Cannot reverse an entry with no lines' });
    }

    // Generate reversal entry number atomically via storage helper
    const reversalNumber = await storage.generateEntryNumber(entry.companyId, now);

    // Build swapped lines and verify the original was balanced before persisting reversal
    const reversalLines = originalLines.map((line) => ({
      accountId: line.accountId,
      debit: line.credit,
      credit: line.debit,
      description: `Reversal: ${line.description || ''}`,
    }));

    const totalDebit = reversalLines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
    const totalCredit = reversalLines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return res.status(400).json({
        message: `Cannot reverse: original entry is unbalanced (debits ${totalDebit.toFixed(2)} ≠ credits ${totalCredit.toFixed(2)})`,
      });
    }

    // Create reversing entry + lines atomically (storage re-validates balance inside transaction)
    const reversalEntry = await storage.createJournalEntry(
      {
        companyId: entry.companyId,
        date: now,
        memo: `Reversal of ${entry.entryNumber}: ${reason || 'No reason provided'}`,
        entryNumber: reversalNumber,
        status: 'posted',
        source: 'reversal',
        sourceId: id,
        reversedEntryId: id,
        reversalReason: reason || null,
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
      },
      reversalLines
    );

    // Mark original entry as void
    await storage.updateJournalEntry(id, {
      status: 'void',
      updatedBy: userId,
      updatedAt: new Date(),
    });

    console.log('[Journal] Entry reversed:', id, '-> new entry:', reversalEntry.id);
    res.json({
      originalId: id,
      reversalId: reversalEntry.id,
      reversalNumber: reversalEntry.entryNumber,
      message: 'Entry reversed successfully'
    });
  }));

  // Customer-only: Delete journal entry
  app.delete("/api/journal/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    // Get journal entry to verify it exists and get company access
    const entry = await storage.getJournalEntry(id);
    if (!entry) {
      return res.status(404).json({ message: 'Journal entry not found' });
    }

    // Check if user has access to this company
    const hasAccess = await storage.hasCompanyAccess(userId, entry.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // IMMUTABILITY: Posted entries cannot be deleted - must be reversed
    if (entry.status === 'posted') {
      return res.status(400).json({
        message: 'Posted entries cannot be deleted. Use the reverse action to void this entry.',
        code: 'ENTRY_POSTED'
      });
    }

    // Void entries should not be deleted either (audit trail)
    if (entry.status === 'void') {
      return res.status(400).json({
        message: 'Void entries cannot be deleted (required for audit trail).',
        code: 'ENTRY_VOID'
      });
    }

    // Only draft entries can be deleted
    await storage.deleteJournalEntry(id);
    console.log('[Journal] Draft entry deleted:', id);
    res.json({ message: 'Draft entry deleted successfully' });
  }));
}
