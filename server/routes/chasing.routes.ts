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

// Walk the user's companies to find the invoice. Storage queries are
// tenant-scoped, so a hit also proves the user has access — the multi-tenant
// version of getInvoice requires companyId so we cannot fetch by id alone.
async function findInvoiceForUser(userId: string, invoiceId: string) {
  const userCompanies = await storage.getCompaniesByUserId(userId);
  for (const c of userCompanies) {
    const invoice = await storage.getInvoice(invoiceId, c.id);
    if (invoice) return invoice;
  }
  return undefined;
}

async function loadAgingRows(companyId: string): Promise<ChaseAgingRow[]> {
  // Fetch invoices and all their payments in two queries, not 1+N. Each
  // invoice row only needs its own payments, but a single SELECT scoped to
  // companyId is far cheaper than fanning out per-invoice on a large book.
  const [invoices, payments] = await Promise.all([
    storage.getInvoicesByCompanyId(companyId),
    storage.getInvoicePaymentsByCompanyId(companyId),
  ]);
  const flatPayments: ChasePayment[] = payments.map(p => ({
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
      },
      flatPayments,
    ),
  );
}

// Minimum seconds between successive chases for the same invoice — protects
// against double-clicks and concurrent bulk runs at the database layer. The
// human-readable frequency (chaseFrequencyDays) is enforced separately.
const CHASE_RACE_LOCKOUT_SECONDS = 30;

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

// Cap bulk-send batch size. The general API rate limiter (100 req/min) doesn't
// help here because one request can fan out into many DB writes; bound the
// blast radius per request and cap total candidates we'll process even when
// `invoiceIds` is omitted (i.e. "chase everything overdue").
const BULK_SEND_MAX = 200;

const bulkSendSchema = z.object({
  language: z.enum(['en', 'ar']).optional(),
  method: z.enum(['whatsapp', 'email', 'manual']).default('whatsapp'),
  paymentLink: z.string().url().optional().or(z.literal('')),
  senderName: z.string().min(1).max(200).optional(),
  invoiceIds: z.array(z.string().uuid()).max(BULK_SEND_MAX).optional(),
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

      const invoice = await findInvoiceForUser(userId, invoiceId);
      if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

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
        },
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

      // Atomically claim the chase slot — if another request just sent a
      // chase for this invoice, bail out with 409 instead of duplicating.
      const sentAt = new Date();
      const claimed = await storage.tryClaimChaseSlot(invoice.id, level, sentAt, CHASE_RACE_LOCKOUT_SECONDS);
      if (!claimed) {
        return res.status(409).json({ message: 'Another chase was just sent for this invoice — please wait a moment.' });
      }

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
        sentAt,
        triggeredBy: userId,
      });

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
      const candidatesAll = allRows
        .filter(isOverdueAndChaseable)
        .filter(r => (restrictTo ? restrictTo.has(r.invoice.id) : true))
        .filter(r => !(r.invoice.contactId && dnc.has(r.invoice.contactId)))
        .filter(r => isFrequencyEligible(r.invoice.lastChasedAt, frequency));
      const truncated = candidatesAll.length > BULK_SEND_MAX;
      const candidates = truncated ? candidatesAll.slice(0, BULK_SEND_MAX) : candidatesAll;

      // Cache templates and contacts within a single bulk run. Without this,
      // 100 invoices at L2 would issue 100 redundant template lookups and
      // potentially many redundant contact lookups.
      const templateCache = new Map<string, Awaited<ReturnType<typeof storage.getChaseTemplate>>>();
      const contactCache = new Map<string, Awaited<ReturnType<typeof storage.getCustomerContact>>>();
      const getTemplate = async (level: number) => {
        const key = `${level}:${language}`;
        if (templateCache.has(key)) return templateCache.get(key)!;
        const tpl = await storage.getChaseTemplate(level, language, companyId);
        templateCache.set(key, tpl);
        return tpl;
      };
      const getContact = async (id: string | null | undefined) => {
        if (!id) return null;
        if (contactCache.has(id)) return contactCache.get(id)!;
        const c = await storage.getCustomerContact(id);
        contactCache.set(id, c);
        return c ?? null;
      };

      const results: Array<{ invoiceId: string; level: number; status: string; waLink?: string | null; error?: string }> = [];
      for (const row of candidates) {
        const level = nextLevelFor(row, { maxLevel });
        if (!level) {
          results.push({ invoiceId: row.invoice.id, level: 0, status: 'skipped_max_level' });
          continue;
        }
        const template = await getTemplate(level);
        if (!template) {
          results.push({ invoiceId: row.invoice.id, level, status: 'skipped_no_template' });
          continue;
        }
        const contact = await getContact(row.invoice.contactId);
        const ctx = contextForInvoice(row, contact ? { id: contact.id, name: contact.name, phone: contact.phone, email: contact.email } : null, {
          senderName: body.senderName ?? company?.name ?? 'Accounting Team',
          paymentLink: body.paymentLink || '',
        });
        const messageText = renderTemplate(template.body, { ...ctx });
        try {
          const sentAt = new Date();
          // Atomic claim — if a concurrent run already sent this chase, skip.
          const claimed = await storage.tryClaimChaseSlot(row.invoice.id, level, sentAt, CHASE_RACE_LOCKOUT_SECONDS);
          if (!claimed) {
            results.push({ invoiceId: row.invoice.id, level, status: 'skipped_recent_chase' });
            continue;
          }
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
            sentAt,
            triggeredBy: userId,
          });
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
        truncated,
        maxBatch: BULK_SEND_MAX,
        eligibleTotal: candidatesAll.length,
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
      });
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
      // Missing row could mean: doesn't exist, belongs to another tenant, or
      // is a system default. Return 404 so we don't leak which case applies.
      const updated = await storage.updateChaseTemplate(id, companyId, parse.data);
      if (!updated) {
        return res.status(404).json({ message: 'Chase template not found' });
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
        return res.status(404).json({ message: 'Chase template not found' });
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
      });
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
      const invoice = await findInvoiceForUser(userId, invoiceId);
      if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
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
      const invoice = await findInvoiceForUser(userId, invoiceId);
      if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
      const chases = await storage.getPaymentChasesByInvoiceId(invoiceId);
      res.json(chases);
    }),
  );
}
