/**
 * Payment Chasing Autopilot — HTTP routes (Phase 4).
 *
 * The pure logic lives in `payment-chasing.service.ts`. These routes are the
 * thin glue that:
 *   - loads invoices / payments / contacts from storage
 *   - asks the service to compute aging + recommended levels
 *   - writes paymentChases rows + updates invoice.chaseLevel when sending
 *   - returns wa.me deep links for the client to open
 *
 * All endpoints are companyId-scoped via `hasCompanyAccess`. The customer
 * /firm middleware split mirrors invoices.routes.ts.
 */

import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { storage } from '../storage';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { createLogger } from '../config/logger';
import { recordAudit } from '../services/audit.service';
import {
  type ChaseAgingRow,
  type ChaseInvoice,
  type ChasePayment,
  type ChaseLanguage,
  buildAgingRow,
  isOverdueAndChaseable,
  nextLevelFor,
  isFrequencyEligible,
  contextForInvoice,
  renderTemplate,
  groupByClient,
  renderGroupedMessage,
  computeEffectiveness,
  buildWaMeLink,
} from '../services/payment-chasing.service';

const log = createLogger('chasing');

// ─── Helpers ────────────────────────────────────────────────────────────────

async function loadAgingRows(companyId: string): Promise<ChaseAgingRow[]> {
  const invoices = await storage.getInvoicesByCompanyId(companyId);
  // Pull payments per invoice — done in parallel to keep the dashboard snappy
  // for companies with hundreds of invoices.
  const paymentLists = await Promise.all(
    invoices.map(inv => storage.getInvoicePaymentsByInvoiceId(inv.id)),
  );
  const flatPayments: ChasePayment[] = paymentLists.flat().map(p => ({
    invoiceId: p.invoiceId,
    amount: Number(p.amount) || 0,
  }));
  return invoices.map(inv =>
    buildAgingRow(
      {
        id: inv.id,
        number: inv.number,
        customerName: inv.customerName,
        currency: inv.currency,
        total: Number(inv.total) || 0,
        dueDate: inv.dueDate,
        status: inv.status,
        contactId: inv.contactId,
        chaseLevel: inv.chaseLevel ?? 0,
        lastChasedAt: inv.lastChasedAt,
        doNotChase: inv.doNotChase ?? false,
      } as ChaseInvoice,
      flatPayments,
    ),
  );
}

function parseDoNotChaseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// ─── Schemas ────────────────────────────────────────────────────────────────

const sendChaseSchema = z.object({
  level: z.number().int().min(1).max(4).optional(),
  language: z.enum(['en', 'ar']).optional(),
  method: z.enum(['whatsapp', 'email', 'manual']).default('whatsapp'),
  paymentLink: z.string().url().optional().or(z.literal('')),
  senderName: z.string().min(1).max(200).optional(),
});

const bulkSendSchema = z.object({
  language: z.enum(['en', 'ar']).optional(),
  method: z.enum(['whatsapp', 'email', 'manual']).default('whatsapp'),
  paymentLink: z.string().url().optional().or(z.literal('')),
  senderName: z.string().min(1).max(200).optional(),
  invoiceIds: z.array(z.string().uuid()).optional(),
});

const updateConfigSchema = z.object({
  autoChaseEnabled: z.boolean().optional(),
  chaseFrequencyDays: z.number().int().min(1).max(365).optional(),
  maxLevel: z.number().int().min(1).max(4).optional(),
  preferredMethod: z.enum(['whatsapp', 'email']).optional(),
  doNotChaseContactIds: z.array(z.string().uuid()).optional(),
  defaultLanguage: z.enum(['en', 'ar']).optional(),
});

const upsertTemplateSchema = z.object({
  level: z.number().int().min(1).max(4),
  language: z.enum(['en', 'ar']),
  subject: z.string().max(500).nullable().optional(),
  body: z.string().min(1).max(5000),
});

// ─── Registration ───────────────────────────────────────────────────────────

export function registerChasingRoutes(app: Express) {
  // ── Aging ──────────────────────────────────────────────────────────────
  app.get(
    '/api/chasing/overdue/:companyId',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      if (!(await storage.hasCompanyAccess(userId, companyId))) {
        return res.status(403).json({ message: 'Access denied' });
      }
      const rows = await loadAgingRows(companyId);
      const overdue = rows.filter(isOverdueAndChaseable);
      res.json({
        rows: overdue,
        buckets: {
          '1-7': overdue.filter(r => r.bucket === '1-7').length,
          '8-30': overdue.filter(r => r.bucket === '8-30').length,
          '31-60': overdue.filter(r => r.bucket === '31-60').length,
          '60+': overdue.filter(r => r.bucket === '60+').length,
        },
        totalOutstanding: Math.round(
          overdue.reduce((s, r) => s + r.outstanding, 0) * 100,
        ) / 100,
      });
    }),
  );

  // ── Queue (eligible for next chase action) ─────────────────────────────
  app.get(
    '/api/chasing/queue/:companyId',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      if (!(await storage.hasCompanyAccess(userId, companyId))) {
        return res.status(403).json({ message: 'Access denied' });
      }
      const config = await storage.getChaseConfig(companyId);
      const frequency = config?.chaseFrequencyDays ?? 7;
      const maxLevel = config?.maxLevel ?? 4;
      const dnc = new Set(parseDoNotChaseList(config?.doNotChaseContactIds));

      const rows = await loadAgingRows(companyId);
      const queue = rows
        .filter(isOverdueAndChaseable)
        .filter(r => !(r.invoice.contactId && dnc.has(r.invoice.contactId)))
        .filter(r => isFrequencyEligible(r.invoice.lastChasedAt, frequency))
        .filter(r => nextLevelFor(r, { maxLevel }) !== null)
        .map(r => ({ ...r, nextLevel: nextLevelFor(r, { maxLevel }) }));

      res.json({
        queue,
        groups: groupByClient(queue),
        config: {
          frequencyDays: frequency,
          maxLevel,
          preferredMethod: config?.preferredMethod ?? 'whatsapp',
          autoChaseEnabled: config?.autoChaseEnabled ?? false,
        },
      });
    }),
  );

  // ── Send chase for a single invoice ───────────────────────────────────
  app.post(
    '/api/chasing/send/:invoiceId',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { invoiceId } = req.params;
      const userId = (req as any).user.id;

      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
      if (!(await storage.hasCompanyAccess(userId, invoice.companyId))) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const parse = sendChaseSchema.safeParse(req.body ?? {});
      if (!parse.success) return res.status(400).json({ message: 'Invalid payload', errors: parse.error.errors });
      const body = parse.data;

      const company = await storage.getCompany(invoice.companyId);
      const config = await storage.getChaseConfig(invoice.companyId);
      const language: ChaseLanguage = (body.language ?? config?.defaultLanguage ?? company?.locale ?? 'en') as ChaseLanguage;

      // Build aging row from this invoice + payments
      const payments = await storage.getInvoicePaymentsByInvoiceId(invoice.id);
      const row = buildAgingRow(
        {
          id: invoice.id,
          number: invoice.number,
          customerName: invoice.customerName,
          currency: invoice.currency,
          total: Number(invoice.total) || 0,
          dueDate: invoice.dueDate,
          status: invoice.status,
          contactId: invoice.contactId,
          chaseLevel: invoice.chaseLevel ?? 0,
          lastChasedAt: invoice.lastChasedAt,
          doNotChase: invoice.doNotChase ?? false,
        } as ChaseInvoice,
        payments.map(p => ({ invoiceId: p.invoiceId, amount: Number(p.amount) || 0 })),
      );

      if (invoice.doNotChase) {
        return res.status(409).json({ message: 'Invoice is marked do-not-chase' });
      }
      if (!isOverdueAndChaseable(row)) {
        return res.status(409).json({ message: 'Invoice is not eligible for chasing', row });
      }

      const level = body.level ?? nextLevelFor(row, { maxLevel: config?.maxLevel ?? 4 });
      if (!level) {
        return res.status(409).json({ message: 'Invoice has reached the maximum chase level' });
      }

      const template = await storage.getChaseTemplate(level, language, invoice.companyId);
      if (!template) {
        return res.status(500).json({ message: `No template found for level ${level} (${language})` });
      }

      const contact = invoice.contactId ? await storage.getCustomerContact(invoice.contactId) : null;
      const ctx = contextForInvoice(row, contact ? { id: contact.id, name: contact.name, phone: contact.phone, email: contact.email } : null, {
        senderName: body.senderName ?? company?.name ?? 'Accounting Team',
        paymentLink: body.paymentLink || '',
      });
      const messageText = renderTemplate(template.body, { ...ctx });
      const subject = template.subject ? renderTemplate(template.subject, { ...ctx }) : null;

      // Persist chase
      const chase = await storage.createPaymentChase({
        companyId: invoice.companyId,
        invoiceId: invoice.id,
        contactId: invoice.contactId ?? null,
        level,
        method: body.method,
        language,
        messageText,
        daysOverdueAtSend: row.daysOverdue,
        amountAtSend: row.outstanding,
        status: 'sent',
        sentAt: new Date(),
        triggeredBy: userId,
      } as any);

      // Mirror state on invoice
      await storage.setInvoiceChaseLevel(invoice.id, level, new Date());

      // Mirror in WhatsApp message log (only when method = whatsapp)
      let waLink: string | null = null;
      if (body.method === 'whatsapp' && contact?.phone) {
        waLink = buildWaMeLink(contact.phone, messageText);
        try {
          await storage.createWhatsappMessage({
            companyId: invoice.companyId,
            waMessageId: `chase_${chase.id}`,
            from: 'personal',
            to: contact.phone,
            messageType: 'text',
            content: messageText.slice(0, 5000),
            direction: 'outbound',
            status: 'sent',
          });
        } catch (e) {
          log.warn(`WhatsApp log failed for chase ${chase.id}: ${(e as Error).message}`);
        }
      }

      await recordAudit({
        userId,
        companyId: invoice.companyId,
        action: 'chase.sent',
        entityType: 'invoice',
        entityId: invoice.id,
        extra: { level, method: body.method, language, daysOverdue: row.daysOverdue },
        req,
      });

      log.info(`Chase L${level} (${language}/${body.method}) sent for invoice ${invoice.number} (company=${invoice.companyId})`);
      res.json({ chase, subject, message: messageText, waLink });
    }),
  );

  // ── Bulk send ─────────────────────────────────────────────────────────
  app.post(
    '/api/chasing/bulk-send/:companyId',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      if (!(await storage.hasCompanyAccess(userId, companyId))) {
        return res.status(403).json({ message: 'Access denied' });
      }
      const parse = bulkSendSchema.safeParse(req.body ?? {});
      if (!parse.success) return res.status(400).json({ message: 'Invalid payload', errors: parse.error.errors });
      const body = parse.data;

      const company = await storage.getCompany(companyId);
      const config = await storage.getChaseConfig(companyId);
      const language: ChaseLanguage = (body.language ?? config?.defaultLanguage ?? company?.locale ?? 'en') as ChaseLanguage;
      const maxLevel = config?.maxLevel ?? 4;
      const frequency = config?.chaseFrequencyDays ?? 7;
      const dnc = new Set(parseDoNotChaseList(config?.doNotChaseContactIds));
      const restrictTo = body.invoiceIds ? new Set(body.invoiceIds) : null;

      const allRows = await loadAgingRows(companyId);
      const candidates = allRows
        .filter(isOverdueAndChaseable)
        .filter(r => (restrictTo ? restrictTo.has(r.invoice.id) : true))
        .filter(r => !(r.invoice.contactId && dnc.has(r.invoice.contactId)))
        .filter(r => isFrequencyEligible(r.invoice.lastChasedAt, frequency));

      const results: Array<{ invoiceId: string; level: number; status: string; waLink?: string | null; error?: string }> = [];
      for (const row of candidates) {
        const level = nextLevelFor(row, { maxLevel });
        if (!level) {
          results.push({ invoiceId: row.invoice.id, level: 0, status: 'skipped_max_level' });
          continue;
        }
        const template = await storage.getChaseTemplate(level, language, companyId);
        if (!template) {
          results.push({ invoiceId: row.invoice.id, level, status: 'skipped_no_template' });
          continue;
        }
        const contact = row.invoice.contactId ? await storage.getCustomerContact(row.invoice.contactId) : null;
        const ctx = contextForInvoice(row, contact ? { id: contact.id, name: contact.name, phone: contact.phone, email: contact.email } : null, {
          senderName: body.senderName ?? company?.name ?? 'Accounting Team',
          paymentLink: body.paymentLink || '',
        });
        const messageText = renderTemplate(template.body, { ...ctx });
        try {
          const chase = await storage.createPaymentChase({
            companyId,
            invoiceId: row.invoice.id,
            contactId: row.invoice.contactId ?? null,
            level,
            method: body.method,
            language,
            messageText,
            daysOverdueAtSend: row.daysOverdue,
            amountAtSend: row.outstanding,
            status: 'sent',
            sentAt: new Date(),
            triggeredBy: userId,
          } as any);
          await storage.setInvoiceChaseLevel(row.invoice.id, level, new Date());
          const waLink = body.method === 'whatsapp' && contact?.phone ? buildWaMeLink(contact.phone, messageText) : null;
          results.push({ invoiceId: row.invoice.id, level, status: 'sent', waLink });
          log.info(`Bulk chase L${level} for invoice ${row.invoice.number} (chase=${chase.id})`);
        } catch (e) {
          log.error(`Bulk chase failed for invoice ${row.invoice.id}: ${(e as Error).message}`);
          results.push({ invoiceId: row.invoice.id, level, status: 'failed', error: (e as Error).message });
        }
      }

      await recordAudit({
        userId,
        companyId,
        action: 'chase.bulk_sent',
        entityType: 'company',
        entityId: companyId,
        extra: { sent: results.filter(r => r.status === 'sent').length, total: results.length },
        req,
      });

      res.json({
        sent: results.filter(r => r.status === 'sent').length,
        skipped: results.filter(r => r.status.startsWith('skipped')).length,
        failed: results.filter(r => r.status === 'failed').length,
        results,
      });
    }),
  );

  // ── Chase history ──────────────────────────────────────────────────────
  app.get(
    '/api/chasing/history/:companyId',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      if (!(await storage.hasCompanyAccess(userId, companyId))) {
        return res.status(403).json({ message: 'Access denied' });
      }
      const invoiceId = typeof req.query.invoiceId === 'string' ? req.query.invoiceId : undefined;
      const sinceDays = typeof req.query.sinceDays === 'string' ? Number(req.query.sinceDays) : undefined;
      const chases = await storage.getPaymentChasesByCompanyId(companyId, { invoiceId, sinceDays });
      res.json(chases);
    }),
  );

  // ── Effectiveness ──────────────────────────────────────────────────────
  app.get(
    '/api/chasing/effectiveness/:companyId',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      if (!(await storage.hasCompanyAccess(userId, companyId))) {
        return res.status(403).json({ message: 'Access denied' });
      }
      const sinceDays = typeof req.query.sinceDays === 'string' ? Number(req.query.sinceDays) : 90;
      const chases = await storage.getPaymentChasesByCompanyId(companyId, { sinceDays });
      const stats = computeEffectiveness(chases.map(c => ({
        invoiceId: c.invoiceId,
        level: c.level,
        sentAt: c.sentAt,
        paidAt: c.paidAt,
      })));
      res.json(stats);
    }),
  );

  // ── Templates ─────────────────────────────────────────────────────────
  app.get(
    '/api/chasing/templates/:companyId',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      if (!(await storage.hasCompanyAccess(userId, companyId))) {
        return res.status(403).json({ message: 'Access denied' });
      }
      const templates = await storage.getChaseTemplatesForCompany(companyId);
      res.json(templates);
    }),
  );

  app.post(
    '/api/chasing/templates/:companyId',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      if (!(await storage.hasCompanyAccess(userId, companyId))) {
        return res.status(403).json({ message: 'Access denied' });
      }
      const parse = upsertTemplateSchema.safeParse(req.body);
      if (!parse.success) return res.status(400).json({ message: 'Invalid payload', errors: parse.error.errors });
      const body = parse.data;
      const created = await storage.createChaseTemplate({
        companyId,
        level: body.level,
        language: body.language,
        subject: body.subject ?? null,
        body: body.body,
        isDefault: false,
      } as any);
      res.json(created);
    }),
  );

  app.patch(
    '/api/chasing/templates/:companyId/:id',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const userId = (req as any).user.id;
      if (!(await storage.hasCompanyAccess(userId, companyId))) {
        return res.status(403).json({ message: 'Access denied' });
      }
      const parse = upsertTemplateSchema.partial().safeParse(req.body);
      if (!parse.success) return res.status(400).json({ message: 'Invalid payload', errors: parse.error.errors });
      // Storage filters by (id, companyId) — guarantees a caller scoped to
      // company A cannot mutate company B's (or a system-default) template.
      const updated = await storage.updateChaseTemplate(id, companyId, parse.data as any);
      if (!updated) {
        return res.status(404).json({ message: 'Template not found' });
      }
      res.json(updated);
    }),
  );

  app.delete(
    '/api/chasing/templates/:companyId/:id',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const userId = (req as any).user.id;
      if (!(await storage.hasCompanyAccess(userId, companyId))) {
        return res.status(403).json({ message: 'Access denied' });
      }
      const removed = await storage.deleteChaseTemplate(id, companyId);
      if (!removed) {
        return res.status(404).json({ message: 'Template not found' });
      }
      res.json({ success: true });
    }),
  );

  // ── Config ────────────────────────────────────────────────────────────
  app.get(
    '/api/chasing/config/:companyId',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      if (!(await storage.hasCompanyAccess(userId, companyId))) {
        return res.status(403).json({ message: 'Access denied' });
      }
      const config = await storage.getChaseConfig(companyId);
      res.json(config ?? {
        companyId,
        autoChaseEnabled: false,
        chaseFrequencyDays: 7,
        maxLevel: 4,
        preferredMethod: 'whatsapp',
        doNotChaseContactIds: '[]',
        defaultLanguage: 'en',
      });
    }),
  );

  app.patch(
    '/api/chasing/config/:companyId',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      if (!(await storage.hasCompanyAccess(userId, companyId))) {
        return res.status(403).json({ message: 'Access denied' });
      }
      const parse = updateConfigSchema.safeParse(req.body);
      if (!parse.success) return res.status(400).json({ message: 'Invalid payload', errors: parse.error.errors });
      const { doNotChaseContactIds, ...rest } = parse.data;
      const updated = await storage.upsertChaseConfig(companyId, {
        ...rest,
        ...(doNotChaseContactIds ? { doNotChaseContactIds: JSON.stringify(doNotChaseContactIds) } : {}),
      } as any);
      res.json(updated);
    }),
  );

  // ── Per-invoice do-not-chase toggle ────────────────────────────────────
  app.patch(
    '/api/chasing/invoice/:invoiceId/do-not-chase',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { invoiceId } = req.params;
      const userId = (req as any).user.id;
      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
      if (!(await storage.hasCompanyAccess(userId, invoice.companyId))) {
        return res.status(403).json({ message: 'Access denied' });
      }
      const value = Boolean(req.body?.doNotChase);
      await storage.setInvoiceDoNotChase(invoiceId, value);
      res.json({ invoiceId, doNotChase: value });
    }),
  );

  // ── Invoice chase history (timeline) ───────────────────────────────────
  app.get(
    '/api/chasing/invoice/:invoiceId/history',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { invoiceId } = req.params;
      const userId = (req as any).user.id;
      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
      if (!(await storage.hasCompanyAccess(userId, invoice.companyId))) {
        return res.status(403).json({ message: 'Access denied' });
      }
      const chases = await storage.getPaymentChasesByInvoiceId(invoiceId);
      res.json(chases);
    }),
  );
}
