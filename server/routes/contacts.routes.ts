import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { storage } from '../storage';
import { createLogger } from '../config/logger';
import { buildXlsxBufferFromRows, parseSpreadsheetBuffer } from '../utils/spreadsheet';

const log = createLogger('contacts');

const contactImportPreviewSchema = z.object({
  fileName: z.string().min(1).max(180).regex(/\.(xlsx|csv)$/i, 'Only .xlsx and .csv files are supported'),
  contentBase64: z.string().min(1),
});

const contactTemplateRows = [{
  Name: 'Example Company LLC',
  Email: 'contact@example.com',
  Phone: '+971-50-123-4567',
  TRN: '100123456700003',
  Address: '123 Business Bay',
  City: 'Dubai',
  Country: 'UAE',
}];

function pickImportValue(row: Record<string, any>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

function mapContactImportRow(row: Record<string, any>): Record<string, string> {
  return {
    name: pickImportValue(row, ['Name', 'name', 'Company Name', 'company_name']),
    email: pickImportValue(row, ['Email', 'email', 'E-mail']),
    phone: pickImportValue(row, ['Phone', 'phone', 'Phone Number', 'Mobile']),
    trnNumber: pickImportValue(row, ['TRN', 'trn', 'TRN Number', 'Tax Registration Number']),
    address: pickImportValue(row, ['Address', 'address']),
    city: pickImportValue(row, ['City', 'city']),
    country: pickImportValue(row, ['Country', 'country']) || 'UAE',
  };
}

export function registerContactRoutes(app: Express) {
  // =====================================
  // Customer Contacts Routes (for Customer users)
  // =====================================

  // Get all customer contacts for a company
  app.get("/api/companies/:companyId/customer-contacts", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const contacts = await storage.getCustomerContactsByCompanyId(companyId);
    res.json(contacts);
  }));

  // Create single customer contact
  app.post("/api/companies/:companyId/customer-contacts", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const contactData = { ...req.body, companyId };

    // Check for duplicate email within company
    if (contactData.email) {
      const existing = await storage.getCustomerContactByEmail(companyId, contactData.email);
      if (existing) {
        return res.status(400).json({ message: 'A contact with this email already exists' });
      }
    }

    const contact = await storage.createCustomerContact(contactData);
    res.json(contact);
  }));

  app.get("/api/companies/:companyId/customer-contacts/import-template", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const buffer = await buildXlsxBufferFromRows(contactTemplateRows, 'Contacts', [25, 28, 18, 18, 28, 16, 16]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=contact_import_template.xlsx');
    res.send(buffer);
  }));

  app.post("/api/companies/:companyId/customer-contacts/import-preview", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const parsedBody = contactImportPreviewSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ message: parsedBody.error.issues[0]?.message || 'Invalid import file' });
    }

    const buffer = Buffer.from(parsedBody.data.contentBase64, 'base64');
    if (buffer.byteLength > 5 * 1024 * 1024) {
      return res.status(413).json({ message: 'Contact import file must be 5 MB or smaller' });
    }

    const parsed = await parseSpreadsheetBuffer(buffer, parsedBody.data.fileName);
    const rows = parsed.rows.map(mapContactImportRow);
    res.json({ rows, count: rows.length });
  }));

  // Bulk import customer contacts from Excel
  app.post("/api/companies/:companyId/customer-contacts/import", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { contacts } = req.body;

    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ message: 'No contacts provided for import' });
    }

    const results = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [] as string[]
    };

    const contactsToCreate: any[] = [];

    for (const contact of contacts) {
      try {
        // Validate required fields
        if (!contact.name || !contact.email) {
          results.skipped++;
          results.errors.push(`Row skipped: Missing name or email`);
          continue;
        }

        // Check if contact exists by email
        const existing = await storage.getCustomerContactByEmail(companyId, contact.email);

        if (existing) {
          // Update existing contact
          await storage.updateCustomerContact(existing.id, {
            name: contact.name,
            phone: contact.phone || null,
            trnNumber: contact.trnNumber || contact.trn || null,
            address: contact.address || null,
            city: contact.city || null,
            country: contact.country || 'UAE',
          });
          results.updated++;
        } else {
          // Prepare for bulk insert
          contactsToCreate.push({
            companyId,
            email: contact.email,
            name: contact.name,
            phone: contact.phone || null,
            trnNumber: contact.trnNumber || contact.trn || null,
            address: contact.address || null,
            city: contact.city || null,
            country: contact.country || 'UAE',
            isActive: true,
          });
        }
      } catch (rowError: any) {
        results.skipped++;
        results.errors.push(`Error processing ${contact.email || 'unknown'}: ${rowError.message}`);
      }
    }

    // Bulk create new contacts
    if (contactsToCreate.length > 0) {
      try {
        await storage.createBulkCustomerContacts(contactsToCreate);
        results.created = contactsToCreate.length;
      } catch (bulkError: any) {
        results.errors.push(`Bulk insert error: ${bulkError.message}`);
      }
    }

    log.info({ results }, 'Customer contacts import completed');
    res.json({
      message: `Import completed: ${results.created} created, ${results.updated} updated, ${results.skipped} skipped`,
      ...results
    });
  }));

  // Preview impact of clearing all contacts (counts of contacts and invoices that would be detached)
  app.get("/api/companies/:companyId/customer-contacts/clear-preview", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const [contactCount, linkedInvoiceCount] = await Promise.all([
      storage.countCustomerContactsByCompanyId(companyId),
      storage.countInvoicesWithContactByCompanyId(companyId),
    ]);

    res.json({ contactCount, linkedInvoiceCount });
  }));

  // Clear all customer contacts for a company (destructive bulk delete)
  app.delete("/api/companies/:companyId/customer-contacts/clear-all", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Require an explicit confirmation phrase in the body to guard against accidental calls
    const { confirm } = req.body ?? {};
    if (confirm !== 'DELETE ALL') {
      return res.status(400).json({ message: 'Confirmation phrase required' });
    }

    const deletedCount = await storage.deleteAllCustomerContactsByCompanyId(companyId);

    log.info({ companyId, userId, deletedCount }, 'Cleared all customer contacts for company');
    res.json({
      message: `Deleted ${deletedCount} contact${deletedCount === 1 ? '' : 's'}`,
      deletedCount,
    });
  }));

  // Update customer contact
  app.put("/api/companies/:companyId/customer-contacts/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId, id } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Verify contact belongs to this company
    const existing = await storage.getCustomerContact(id);
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ message: 'Contact not found' });
    }

    const contact = await storage.updateCustomerContact(id, req.body);
    res.json(contact);
  }));

  // Delete customer contact
  app.delete("/api/companies/:companyId/customer-contacts/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId, id } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Verify contact belongs to this company
    const existing = await storage.getCustomerContact(id);
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ message: 'Contact not found' });
    }

    await storage.deleteCustomerContact(id);
    res.json({ message: 'Contact deleted successfully' });
  }));
}
