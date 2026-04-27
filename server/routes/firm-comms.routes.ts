import type { Request, Response } from 'express';
import { Router } from 'express';
import type { Express } from 'express';
import { z } from 'zod';

import { db } from '../db';
import { eq, and, desc, inArray, gte, lte, sql } from 'drizzle-orm';
import {
  clientCommunications,
  communicationTemplates,
  companies,
  invoices,
  vatReturns,
} from '../../shared/schema';
import { authMiddleware } from '../middleware/auth';
import { requireFirmRole, getAccessibleCompanyIds } from '../middleware/rbac';
import { asyncHandler } from '../middleware/errorHandler';
import { createLogger } from '../config/logger';
import {
  sendEmail,
  renderTemplate,
  hasSmtpConfig,
  sendGenericEmail,
} from '../services/email.service';
import { createAndEmitNotification } from '../services/socket.service';

const logger = createLogger('firm-comms-routes');

// ─── Schemas ──────────────────────────────────────────────────────────────────

const sendEmailSchema = z
  .object({
    companyId: z.string().uuid(),
    recipientEmail: z.string().email(),
    subject: z.string().min(1).optional(),
    body: z.string().min(1).optional(),
    templateType: z
      .enum(['vat_reminder', 'invoice', 'document_request', 'payment_confirmation', 'custom'])
      .optional(),
    templateId: z.string().uuid().optional(),
    invoiceId: z.string().uuid().optional(),
  })
  .refine((d) => (d.subject && d.body) || d.templateId, {
    message: 'Provide subject+body or a templateId',
  });

const sendWhatsAppSchema = z.object({
  companyId: z.string().uuid(),
  recipientPhone: z.string().min(1),
  body: z.string().min(1),
  templateType: z
    .enum(['vat_reminder', 'invoice', 'document_request', 'payment_confirmation', 'custom'])
    .optional(),
});

const templateSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  channel: z.enum(['whatsapp', 'email', 'sms']),
  templateType: z.enum([
    'vat_reminder',
    'invoice',
    'document_request',
    'payment_confirmation',
    'custom',
  ]),
  subjectTemplate: z.string().optional(),
  bodyTemplate: z.string().min(1),
  language: z.enum(['en', 'ar']).default('en'),
  isActive: z.boolean().default(true),
});

const bulkRemindSchema = z.object({
  daysAhead: z.number().int().min(1).max(30).default(7),
  dryRun: z.boolean().default(false),
});

// ─── Route registration ───────────────────────────────────────────────────────

export function registerFirmCommsRoutes(app: Express): void {
  const router = Router();

  // Scope auth + firm-role guards to /firm/* so this router (mounted at /api)
  // does not short-circuit unrelated /api requests like /api/health.
  router.use('/firm', authMiddleware as any);
  router.use('/firm', requireFirmRole());

  // ─── GET /api/firm/comms/log ──────────────────────────────────────────────
  router.get(
    '/firm/comms/log',
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId, firmRole } = (req as any).user;
      const { companyId, channel, from, to, page = '1', limit = '50' } =
        req.query as Record<string, string>;

      const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');

      if (accessibleIds !== null && accessibleIds.length === 0) {
        return res.json({ data: [], total: 0, page: 1, limit: 50 });
      }

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, parseInt(limit, 10) || 50);
      const offset = (pageNum - 1) * limitNum;

      const whereClause = and(
        accessibleIds !== null
          ? inArray(clientCommunications.companyId, accessibleIds)
          : undefined,
        companyId ? eq(clientCommunications.companyId, companyId) : undefined,
        channel ? eq(clientCommunications.channel, channel) : undefined,
        from ? gte(clientCommunications.sentAt, new Date(from)) : undefined,
        to ? lte(clientCommunications.sentAt, new Date(to)) : undefined,
      );

      const [rows, countResult] = await Promise.all([
        db
          .select({
            id: clientCommunications.id,
            companyId: clientCommunications.companyId,
            companyName: companies.name,
            userId: clientCommunications.userId,
            channel: clientCommunications.channel,
            direction: clientCommunications.direction,
            recipientPhone: clientCommunications.recipientPhone,
            recipientEmail: clientCommunications.recipientEmail,
            subject: clientCommunications.subject,
            body: clientCommunications.body,
            status: clientCommunications.status,
            templateType: clientCommunications.templateType,
            sentAt: clientCommunications.sentAt,
            createdAt: clientCommunications.createdAt,
          })
          .from(clientCommunications)
          .innerJoin(companies, eq(companies.id, clientCommunications.companyId))
          .where(whereClause)
          .orderBy(desc(clientCommunications.sentAt))
          .limit(limitNum)
          .offset(offset),
        db
          .select({ cnt: sql<number>`count(*)::int` })
          .from(clientCommunications)
          .where(whereClause)
          .then((r: { cnt: number }[]) => r[0]?.cnt ?? 0),
      ]);

      res.json({ data: rows, total: countResult, page: pageNum, limit: limitNum });
    })
  );

  // ─── GET /api/firm/comms/log/:companyId ───────────────────────────────────
  router.get(
    '/firm/comms/log/:companyId',
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const { id: userId, firmRole } = (req as any).user;

      const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');
      if (accessibleIds !== null && !accessibleIds.includes(companyId)) {
        return res.status(403).json({ message: 'Access denied to this client' });
      }

      const rows = await db
        .select()
        .from(clientCommunications)
        .where(eq(clientCommunications.companyId, companyId))
        .orderBy(desc(clientCommunications.sentAt))
        .limit(100);

      res.json(rows);
    })
  );

  // ─── POST /api/firm/comms/send-email ──────────────────────────────────────
  router.post(
    '/firm/comms/send-email',
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId, firmRole } = (req as any).user;
      const validated = sendEmailSchema.parse(req.body);

      const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');
      if (accessibleIds !== null && !accessibleIds.includes(validated.companyId)) {
        return res.status(403).json({ message: 'Access denied to this client' });
      }

      const [company] = await db
        .select()
        .from(companies)
        .where(eq(companies.id, validated.companyId))
        .limit(1);

      if (!company) {
        return res.status(404).json({ message: 'Company not found' });
      }

      // Resolve subject/body — either from request or from a saved template
      let subject = validated.subject ?? '';
      let body = validated.body ?? '';

      if (validated.templateId) {
        const [tmpl] = await db
          .select()
          .from(communicationTemplates)
          .where(eq(communicationTemplates.id, validated.templateId))
          .limit(1);

        if (!tmpl) {
          return res.status(404).json({ message: 'Template not found' });
        }

        // Build template variable substitutions
        const vars: Record<string, string> = {
          companyName: company.name,
          contactEmail: company.contactEmail ?? '',
          trnVatNumber: company.trnVatNumber ?? '',
        };

        // Enrich with invoice data when invoiceId is provided
        if (validated.invoiceId) {
          const [inv] = await db
            .select()
            .from(invoices)
            .where(and(eq(invoices.id, validated.invoiceId), eq(invoices.companyId, validated.companyId)))
            .limit(1);

          if (inv) {
            vars.invoiceNumber = inv.number;
            vars.customerName = inv.customerName;
            vars.invoiceDate = new Date(inv.date).toLocaleDateString('en-AE', { year: 'numeric', month: 'long', day: 'numeric' });
            vars.dueDate = inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('en-AE', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
            vars.total = `${inv.currency} ${inv.total.toFixed(2)}`;
            vars.subtotal = `${inv.currency} ${inv.subtotal.toFixed(2)}`;
            vars.vatAmount = `${inv.currency} ${inv.vatAmount.toFixed(2)}`;
            vars.currency = inv.currency;
            vars.invoiceStatus = inv.status;
          }
        }

        subject = subject || renderTemplate(tmpl.subjectTemplate ?? tmpl.name, vars);
        body = body || renderTemplate(tmpl.bodyTemplate, vars);
      }

      if (!subject || !body) {
        return res.status(400).json({ message: 'Could not resolve subject or body from template' });
      }

      const result = await sendEmail(validated.recipientEmail, subject, body, { fromName: company.name });

      const [comm] = await db
        .insert(clientCommunications)
        .values({
          companyId: validated.companyId,
          userId,
          channel: 'email',
          direction: 'outbound',
          recipientEmail: validated.recipientEmail,
          subject,
          body,
          status: result.sent ? 'sent' : 'failed',
          templateType: validated.templateType ?? 'custom',
          sentAt: new Date(),
          ...(validated.templateId || validated.invoiceId
            ? { metadata: JSON.stringify({ templateId: validated.templateId, invoiceId: validated.invoiceId, provider: result.provider }) }
            : {}),
        })
        .returning();

      createAndEmitNotification({
        userId,
        companyId: validated.companyId,
        type: 'communication',
        title: 'Email sent to client',
        message: `Email "${validated.subject}" sent to ${validated.recipientEmail}`,
        priority: 'normal',
        relatedEntityType: 'communication',
        relatedEntityId: comm.id,
        actionUrl: '/firm/comms',
      }).catch(() => {});

      res.json({
        success: result.sent,
        provider: result.provider,
        communication: comm,
        ...(result.error ? { note: result.error } : {}),
      });
    })
  );

  // ─── POST /api/firm/comms/send-whatsapp ───────────────────────────────────
  router.post(
    '/firm/comms/send-whatsapp',
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId, firmRole } = (req as any).user;
      const validated = sendWhatsAppSchema.parse(req.body);

      const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');
      if (accessibleIds !== null && !accessibleIds.includes(validated.companyId)) {
        return res.status(403).json({ message: 'Access denied to this client' });
      }

      const [comm] = await db
        .insert(clientCommunications)
        .values({
          companyId: validated.companyId,
          userId,
          channel: 'whatsapp',
          direction: 'outbound',
          recipientPhone: validated.recipientPhone,
          body: validated.body,
          status: 'sent',
          templateType: validated.templateType ?? 'custom',
          sentAt: new Date(),
        })
        .returning();

      createAndEmitNotification({
        userId,
        companyId: validated.companyId,
        type: 'communication',
        title: 'WhatsApp sent to client',
        message: `WhatsApp message sent to ${validated.recipientPhone}`,
        priority: 'normal',
        relatedEntityType: 'communication',
        relatedEntityId: comm.id,
        actionUrl: '/firm/comms',
      }).catch(() => {});

      res.json({
        success: true,
        communication: comm,
        note: 'WhatsApp Business API integration pending — message has been logged.',
      });
    })
  );

  // ─── GET /api/firm/comms/templates ────────────────────────────────────────
  router.get(
    '/firm/comms/templates',
    asyncHandler(async (_req: Request, res: Response) => {
      const templates = await db
        .select()
        .from(communicationTemplates)
        .orderBy(communicationTemplates.name);

      res.json(templates);
    })
  );

  // ─── POST /api/firm/comms/templates ───────────────────────────────────────
  router.post(
    '/firm/comms/templates',
    asyncHandler(async (req: Request, res: Response) => {
      const validated = templateSchema.parse(req.body);

      if (validated.id) {
        const [updated] = await db
          .update(communicationTemplates)
          .set({
            name: validated.name,
            channel: validated.channel,
            templateType: validated.templateType,
            subjectTemplate: validated.subjectTemplate,
            bodyTemplate: validated.bodyTemplate,
            language: validated.language,
            isActive: validated.isActive,
          })
          .where(eq(communicationTemplates.id, validated.id))
          .returning();
        res.json(updated);
      } else {
        const [created] = await db
          .insert(communicationTemplates)
          .values({
            name: validated.name,
            channel: validated.channel,
            templateType: validated.templateType,
            subjectTemplate: validated.subjectTemplate,
            bodyTemplate: validated.bodyTemplate,
            language: validated.language,
            isActive: validated.isActive,
          })
          .returning();
        res.status(201).json(created);
      }
    })
  );

  // ─── POST /api/firm/comms/bulk-remind ─────────────────────────────────────
  router.post(
    '/firm/comms/bulk-remind',
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId, firmRole } = (req as any).user;
      const { daysAhead, dryRun } = bulkRemindSchema.parse(req.body);

      const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');
      if (accessibleIds !== null && accessibleIds.length === 0) {
        return res.json({ sent: 0, failed: 0, results: [], preview: [] });
      }

      const now = new Date();
      const cutoff = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

      const dueSoon = await db
        .select({
          companyId: vatReturns.companyId,
          companyName: companies.name,
          contactEmail: companies.contactEmail,
          dueDate: vatReturns.dueDate,
          periodEnd: vatReturns.periodEnd,
          vatStatus: vatReturns.status,
        })
        .from(vatReturns)
        .innerJoin(companies, eq(companies.id, vatReturns.companyId))
        .where(
          and(
            eq(companies.companyType, 'client'),
            gte(vatReturns.dueDate, now),
            lte(vatReturns.dueDate, cutoff),
            accessibleIds !== null
              ? inArray(vatReturns.companyId, accessibleIds)
              : undefined,
          )
        )
        .orderBy(vatReturns.dueDate);

      // Deduplicate — keep earliest due date per company
      const seen = new Set<string>();
      const targets = dueSoon.filter((r: typeof dueSoon[number]) => {
        if (seen.has(r.companyId)) return false;
        seen.add(r.companyId);
        return true;
      });

      if (dryRun) {
        return res.json({ preview: targets, count: targets.length, dryRun: true });
      }

      const results: {
        companyId: string;
        companyName: string;
        sent: boolean;
        note?: string;
      }[] = [];

      for (const target of targets) {
        if (!target.contactEmail) {
          results.push({
            companyId: target.companyId,
            companyName: target.companyName,
            sent: false,
            note: 'No contact email on file',
          });
          continue;
        }

        const dueDate = new Date(target.dueDate).toLocaleDateString('en-AE', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
        const subject = `VAT Return Reminder — Due ${dueDate}`;
        const body = [
          `Dear ${target.companyName},`,
          '',
          `This is a reminder that your VAT return is due on ${dueDate}. Please ensure all documents are submitted to our team promptly.`,
          '',
          'If you have any questions, please do not hesitate to contact us.',
          '',
          'Kind regards,',
          'NR Accounting Team',
        ].join('\n');

        const result = await sendEmail(target.contactEmail, subject, body, { fromName: 'NR Accounting' });
        const sent = result.sent;
        const note = result.error;

        await db.insert(clientCommunications).values({
          companyId: target.companyId,
          userId,
          channel: 'email',
          direction: 'outbound',
          recipientEmail: target.contactEmail,
          subject,
          body,
          status: sent ? 'sent' : 'failed',
          templateType: 'vat_reminder',
          sentAt: new Date(),
          metadata: JSON.stringify({
            dueDate: target.dueDate,
            periodEnd: target.periodEnd,
            bulkSend: true,
          }),
        });

        results.push({ companyId: target.companyId, companyName: target.companyName, sent, ...(note ? { note } : {}) });
      }

      res.json({
        sent: results.filter((r) => r.sent).length,
        failed: results.filter((r) => !r.sent).length,
        results,
      });
    })
  );

  app.use('/api', router);
  logger.info('Firm comms routes registered at /api/firm/comms/*');
}
