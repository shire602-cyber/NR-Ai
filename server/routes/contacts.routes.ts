import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { storage } from '../storage';
import { createLogger } from '../config/logger';
import { optionalTrnSchema, phoneSchema } from '../../shared/validators';

const log = createLogger('contacts');

const customerContactBodySchema = z.object({
  name: z.string().trim().min(1).max(255),
  nameAr: z.string().trim().max(255).nullish(),
  email: z.string().trim().email().max(255).optional().or(z.literal('').transform(() => undefined)),
  phone: phoneSchema.optional().or(z.literal('').transform(() => undefined)),
  trnNumber: optionalTrnSchema,
  address: z.string().max(500).nullish(),
  city: z.string().max(100).nullish(),
  country: z.string().max(100).default('UAE'),
  contactPerson: z.string().max(255).nullish(),
  paymentTerms: z.coerce.number().int().min(0).max(365).default(30),
  notes: z.string().max(5000).nullish(),
  isActive: z.boolean().default(true),
});

// Bulk import is more permissive: each row is validated and bad rows are
// reported back as skipped rather than failing the whole batch.
const importContactRowSchema = z.object({
  name: z.string().trim().min(1).max(255),
  email: z.string().trim().email().max(255),
  phone: phoneSchema.optional().nullish().or(z.literal('').transform(() => undefined)),
  // Excel imports often arrive with `trn` instead of `trnNumber`; the loop
  // already handles that mapping. Validate format if present.
  trnNumber: optionalTrnSchema,
  trn: optionalTrnSchema,
  address: z.string().max(500).nullish(),
  city: z.string().max(100).nullish(),
  country: z.string().max(100).default('UAE'),
});

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

    const parsed = customerContactBodySchema.parse(req.body);
    const contactData = { ...parsed, companyId };

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

    for (const rawContact of contacts) {
      try {
        const result = importContactRowSchema.safeParse(rawContact);
        if (!result.success) {
          results.skipped++;
          const reason = result.error.issues[0]?.message ?? 'invalid row';
          const id = (rawContact && typeof rawContact === 'object' && rawContact.email) || 'unknown';
          results.errors.push(`Row skipped (${id}): ${reason}`);
          continue;
        }
        const contact = result.data;
        const trnNumber = contact.trnNumber ?? contact.trn ?? null;

        // Check if contact exists by email
        const existing = await storage.getCustomerContactByEmail(companyId, contact.email);

        if (existing) {
          // Update existing contact
          await storage.updateCustomerContact(existing.id, {
            name: contact.name,
            phone: contact.phone ?? null,
            trnNumber,
            address: contact.address ?? null,
            city: contact.city ?? null,
            country: contact.country,
          });
          results.updated++;
        } else {
          // Prepare for bulk insert
          contactsToCreate.push({
            companyId,
            email: contact.email,
            name: contact.name,
            phone: contact.phone ?? null,
            trnNumber,
            address: contact.address ?? null,
            city: contact.city ?? null,
            country: contact.country,
            isActive: true,
          });
        }
      } catch (rowError: any) {
        results.skipped++;
        const id = (rawContact && typeof rawContact === 'object' && rawContact.email) || 'unknown';
        results.errors.push(`Error processing ${id}: ${rowError.message}`);
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

    const updates = customerContactBodySchema.partial().parse(req.body);
    const contact = await storage.updateCustomerContact(id, updates);
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
