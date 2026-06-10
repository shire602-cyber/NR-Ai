import type { Express, Request, Response } from 'express';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { requireFeature } from '../middleware/featureGate';
import { storage } from '../storage';
import { generateCreditNotePDF } from '../services/pdf-credit-note.service';
import { createLogger } from '../config/logger';

const logger = createLogger('credit-notes-routes');

export function registerCreditNoteRoutes(app: Express) {
  // =====================================
  // Credit Note Routes
  // =====================================

  // Customer-only: List credit notes by company
  app.get('/api/companies/:companyId/credit-notes', authMiddleware, requireCustomer,
    requireFeature('creditNotes'), asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const creditNotes = await storage.getCreditNotesByCompanyId(companyId);
      res.json(creditNotes);
    }));

  // Customer-only: Get single credit note with lines
  app.get('/api/credit-notes/:id', authMiddleware, requireCustomer, requireFeature('creditNotes'), asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const creditNote = await storage.getCreditNote(id);
    if (!creditNote) {
      return res.status(404).json({ message: 'Credit note not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, creditNote.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const lines = await storage.getCreditNoteLinesByCreditNoteId(id);
    res.json({ ...creditNote, lines });
  }));

  // Customer-only: Create credit note with lines
  app.post('/api/companies/:companyId/credit-notes', authMiddleware, requireCustomer,
    requireFeature('creditNotes'), asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const { lines, ...creditNoteData } = req.body;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const creditNote = await storage.createCreditNote({ ...creditNoteData, companyId });

      if (lines && Array.isArray(lines)) {
        for (const line of lines) {
          await storage.createCreditNoteLine({ ...line, creditNoteId: creditNote.id });
        }
      }

      const creditNoteLines = await storage.getCreditNoteLinesByCreditNoteId(creditNote.id);
      logger.info({ creditNoteId: creditNote.id, companyId }, 'Credit note created');
      res.status(201).json({ ...creditNote, lines: creditNoteLines });
    }));

  // Customer-only: Update credit note
  app.put('/api/credit-notes/:id', authMiddleware, requireCustomer, requireFeature('creditNotes'), asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;
    const { lines, ...updateData } = req.body;

    const creditNote = await storage.getCreditNote(id);
    if (!creditNote) {
      return res.status(404).json({ message: 'Credit note not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, creditNote.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (creditNote.status === 'issued' || creditNote.status === 'void') {
      return res.status(400).json({ message: 'Cannot update an issued or voided credit note' });
    }

    const updated = await storage.updateCreditNote(id, updateData);

    if (lines && Array.isArray(lines)) {
      await storage.deleteCreditNoteLinesByCreditNoteId(id);
      for (const line of lines) {
        await storage.createCreditNoteLine({ ...line, creditNoteId: id });
      }
    }

    const creditNoteLines = await storage.getCreditNoteLinesByCreditNoteId(id);
    res.json({ ...updated, lines: creditNoteLines });
  }));

  // Customer-only: Delete credit note
  app.delete('/api/credit-notes/:id', authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const creditNote = await storage.getCreditNote(id);
    if (!creditNote) {
      return res.status(404).json({ message: 'Credit note not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, creditNote.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (creditNote.status === 'issued') {
      return res.status(400).json({ message: 'Cannot delete an issued credit note. Void it instead.' });
    }

    await storage.deleteCreditNote(id);
    res.json({ message: 'Credit note deleted' });
  }));

  // Customer-only: Issue credit note (creates reversing journal entry)
  app.post('/api/credit-notes/:id/issue', authMiddleware, requireCustomer, requireFeature('creditNotes'), asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const creditNote = await storage.getCreditNote(id);
    if (!creditNote) {
      return res.status(404).json({ message: 'Credit note not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, creditNote.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (creditNote.status === 'issued') {
      return res.status(400).json({ message: 'Credit note already issued' });
    }

    if (creditNote.status === 'void') {
      return res.status(400).json({ message: 'Cannot issue a voided credit note' });
    }

    // Create reversing journal entry
    const accounts = await storage.getAccountsByCompanyId(creditNote.companyId);
    const accountsReceivable = accounts.find(a => a.nameEn === 'Accounts Receivable');
    const salesRevenue = accounts.find(a => a.nameEn === 'Sales Revenue');
    const vatPayable = accounts.find(a => a.nameEn === 'VAT Payable');

    if (!accountsReceivable || !salesRevenue) {
      return res.status(500).json({ message: 'Required accounts not found (Accounts Receivable, Sales Revenue)' });
    }

    const now = new Date();

    // Build lines array conditionally
    const lines: Array<{ accountId: string; debit: number; credit: number; description: string }> = [
      {
        accountId: salesRevenue.id,
        debit: creditNote.subtotal,
        credit: 0,
        description: `Credit note ${creditNote.number} - reverse sales revenue`,
      },
      {
        accountId: accountsReceivable.id,
        debit: 0,
        credit: creditNote.total,
        description: `Credit note ${creditNote.number} - reduce A/R`,
      },
    ];

    if (creditNote.vatAmount > 0 && vatPayable) {
      lines.push({
        accountId: vatPayable.id,
        debit: creditNote.vatAmount,
        credit: 0,
        description: `Credit note ${creditNote.number} - reverse VAT output`,
      });
    }

    const { entry } = await storage.createJournalEntryWithLines(
      creditNote.companyId,
      now,
      {
        memo: `Credit Note ${creditNote.number} - ${creditNote.customerName}`,
        status: 'posted',
        source: 'credit_note',
        sourceId: creditNote.id,
        createdBy: userId,
        postedBy: userId,
      },
      lines,
    );

    // Mark credit note as issued and link journal entry
    const updated = await storage.updateCreditNote(id, {
      status: 'issued',
      journalEntryId: entry.id,
    });

    logger.info({ creditNoteId: id, journalEntryNumber: entry.entryNumber }, 'Credit note issued');
    res.json({ ...updated, journalEntryId: entry.id, message: 'Credit note issued with reversing journal entry' });
  }));

  // Customer-only: Void credit note
  app.post('/api/credit-notes/:id/void', authMiddleware, requireCustomer, requireFeature('creditNotes'), asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const creditNote = await storage.getCreditNote(id);
    if (!creditNote) {
      return res.status(404).json({ message: 'Credit note not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, creditNote.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (creditNote.status === 'void') {
      return res.status(400).json({ message: 'Credit note already voided' });
    }

    const updated = await storage.updateCreditNote(id, {
      status: 'void',
    });

    logger.info({ creditNoteId: id }, 'Credit note voided');
    res.json({ ...updated, message: 'Credit note voided' });
  }));

  // Customer-only: Generate PDF
  app.get('/api/credit-notes/:id/pdf', authMiddleware, requireCustomer, requireFeature('creditNotes'), asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const creditNote = await storage.getCreditNote(id);
    if (!creditNote) {
      return res.status(404).json({ message: 'Credit note not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, creditNote.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const lines = await storage.getCreditNoteLinesByCreditNoteId(id);
    const company = await storage.getCompany(creditNote.companyId);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    const pdfBuffer = await generateCreditNotePDF(creditNote, lines, company);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="credit-note-${creditNote.number}.pdf"`,
      'Content-Length': pdfBuffer.length.toString(),
    });
    res.send(pdfBuffer);
  }));
}
