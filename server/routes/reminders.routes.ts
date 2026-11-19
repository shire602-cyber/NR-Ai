import type { Express, Request, Response } from "express";
import { invoiceHref } from "../../shared/app-links";
import { storage } from "../storage";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { pool } from "../db";
import { hasEmailProvider } from "../services/email.service";
import { asyncHandler } from "../middleware/errorHandler";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
import { receivableOpenSql } from "../reporting/settlement";
import {
  createReminderSettingBody,
  updateReminderSettingBody,
  type CreateReminderSettingBody,
  type UpdateReminderSettingBody,
} from "../../shared/validators/reminders";

export function registerReminderRoutes(app: Express) {
  // =====================================
  // REMINDER SETTINGS (Late Payment Reminders)
  // =====================================

  // Get reminder settings
  app.get(
    "/api/companies/:companyId/reminder-settings",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }

      const settings = await storage.getReminderSettingsByCompanyId(companyId);
      res.json(settings);
    })
  );

  // Create reminder setting
  app.post(
    "/api/companies/:companyId/reminder-settings",
    authMiddleware,
    strictBody(createReminderSettingBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }

      const validated = parsedBody<CreateReminderSettingBody>(req);
      const setting = await storage.createReminderSetting({
        ...validated,
        companyId,
      });
      res.json(setting);
    })
  );

  // Update reminder setting. The row is loaded by id, the caller's access to ITS company is
  // verified, and companyId is immutable (R16-01): another tenant gets a 404 and the row is
  // untouched.
  app.patch(
    "/api/reminder-settings/:id",
    authMiddleware,
    strictBody(updateReminderSettingBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = req.user!.id;
      const existing = await storage.getReminderSetting(id);
      if (!existing || !(await storage.hasCompanyAccess(userId, existing.companyId))) {
        throw new DomainError(
          "REMINDER_SETTING_NOT_FOUND",
          404,
          undefined,
          "Reminder setting not found"
        );
      }
      const patch = parsedBody<UpdateReminderSettingBody>(req);
      const setting = await storage.updateReminderSettingForCompany(id, existing.companyId, patch);
      if (!setting) {
        throw new DomainError(
          "REMINDER_SETTING_NOT_FOUND",
          404,
          undefined,
          "Reminder setting not found"
        );
      }
      res.json(setting);
    })
  );

  app.delete(
    "/api/reminder-settings/:id",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = req.user!.id;
      const existing = await storage.getReminderSetting(id);
      if (!existing || !(await storage.hasCompanyAccess(userId, existing.companyId))) {
        throw new DomainError(
          "REMINDER_SETTING_NOT_FOUND",
          404,
          undefined,
          "Reminder setting not found"
        );
      }
      await storage.deleteReminderSettingForCompany(id, existing.companyId);
      res.json({ success: true });
    })
  );

  // Get reminder logs
  app.get(
    "/api/companies/:companyId/reminder-logs",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }

      const { rows: logs } = await pool.query(
        `SELECT l.id, l.company_id AS "companyId", l.reminder_setting_id AS "reminderSettingId",
                l.reminder_type AS "reminderType", l.related_entity_type AS "relatedEntityType",
                l.related_entity_id AS "relatedEntityId", l.recipient_email AS "recipientEmail",
                l.recipient_phone AS "recipientPhone", l.channel, l.level,
                coalesce(o.status, l.status) AS status, l.status AS "logStatus",
                l.error_message AS "errorMessage", coalesce(o.last_error, l.error_message) AS "lastError",
                l.sent_at AS "sentAt", o.delivered_at AS "deliveredAt", o.bounced_at AS "bouncedAt",
                l.outbox_id AS "outboxId", l.created_at AS "createdAt", i.number AS "invoiceNumber"
           FROM reminder_logs l
           LEFT JOIN email_outbox o ON o.id = l.outbox_id
           LEFT JOIN invoices i ON i.id = l.related_entity_id
          WHERE l.company_id = $1
          ORDER BY l.created_at DESC
          LIMIT 500`,
        [companyId]
      );
      res.json(logs);
    })
  );

  // Run the dunning engine for this company now (same idempotent rules as the hourly job).
  app.post(
    "/api/companies/:companyId/reminders/run",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      if (!(await storage.hasCompanyAccess(userId, companyId))) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }
      const { runDunningScan } = await import("../services/scheduler.service");
      const summary = await runDunningScan(new Date(), { companyId });
      res.json({
        ...summary,
        emailConfigured: hasEmailProvider(),
        message: hasEmailProvider()
          ? null
          : "Email not configured — customer reminders are queued, not sent.",
      });
    })
  );

  // =====================================
  // UPCOMING DEADLINES (Smart Reminders)
  // =====================================

  // Get upcoming deadlines
  app.get(
    "/api/deadlines",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const { companyId } = req.query;

      if (!companyId) {
        return res.status(400).json({ message: "Company ID required", code: "COMPANY_REQUIRED" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, companyId as string);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }

      const company = await storage.getCompany(companyId as string);

      const deadlines: Array<
        Record<string, unknown> & { dueDate: string; daysRemaining: number; priority: string }
      > = [];
      const today = new Date();

      // VAT Return deadlines (based on filing frequency)
      if (company?.trnVatNumber) {
        const filingFrequency = company.vatFilingFrequency || "Quarterly";
        const nextDeadline = new Date();

        if (filingFrequency === "Monthly") {
          nextDeadline.setMonth(nextDeadline.getMonth() + 1);
          nextDeadline.setDate(28); // Due by 28th of next month
        } else if (filingFrequency === "Quarterly") {
          const currentQuarter = Math.floor(today.getMonth() / 3);
          nextDeadline.setMonth((currentQuarter + 1) * 3 + 1); // Month after quarter end
          nextDeadline.setDate(28);
        }

        deadlines.push({
          id: "vat-return",
          type: "vat_return",
          title: "VAT Return Due",
          description: `Submit VAT return for ${filingFrequency.toLowerCase()} period`,
          dueDate: nextDeadline.toISOString(),
          daysRemaining: Math.ceil(
            (nextDeadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
          ),
          priority:
            Math.ceil((nextDeadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) <= 7
              ? "high"
              : "normal",
          actionUrl: "/reports",
        });
      }

      // Unpaid invoice deadlines (R16-12): the invoice's own due date, every issued unpaid
      // status (sent / posted / partial), the remaining balance and the invoice currency.
      const { rows: open } = await pool.query(
        `SELECT i.id, i.number, i.customer_name, coalesce(i.currency, 'AED') AS currency,
                coalesce(i.due_date, i.date) AS due,
                ${receivableOpenSql("i")}::text AS remaining
           FROM invoices i
          WHERE i.company_id = $1 AND i.status IN ('sent', 'posted', 'partial')
            AND i.invoice_type <> 'credit_note'`,
        [companyId]
      );
      for (const inv of open as Array<{
        id: string;
        number: string;
        customer_name: string;
        currency: string;
        due: string;
        remaining: string;
      }>) {
        const remaining = Number(inv.remaining);
        if (!(remaining > 0)) continue;
        const dueDate = new Date(inv.due);
        const daysRemaining = Math.ceil(
          (dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        );
        const isOverdue = daysRemaining < 0;
        deadlines.push({
          id: `invoice-${inv.id}`,
          type: isOverdue ? "invoice_overdue" : "invoice_due",
          title: isOverdue ? `Invoice ${inv.number} Overdue` : `Invoice ${inv.number} Due Soon`,
          description: `${inv.customer_name} - ${inv.currency} ${remaining.toFixed(2)}`,
          dueDate: dueDate.toISOString(),
          daysRemaining,
          amountDue: remaining,
          currency: inv.currency,
          priority: isOverdue ? "urgent" : daysRemaining <= 7 ? "high" : "normal",
          actionUrl: invoiceHref(inv.id),
          relatedEntityType: "invoice",
          relatedEntityId: inv.id,
        });
      }

      // Sort by priority and due date
      deadlines.sort((a, b) => {
        const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
        const priorityDiff =
          priorityOrder[a.priority as keyof typeof priorityOrder] -
          priorityOrder[b.priority as keyof typeof priorityOrder];
        if (priorityDiff !== 0) return priorityDiff;
        return a.daysRemaining - b.daysRemaining;
      });

      res.json(deadlines);
    })
  );
}
