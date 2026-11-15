import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
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
      const userId = (req as any).user?.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
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
      const userId = (req as any).user?.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
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
      const userId = (req as any).user?.id;
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
      const userId = (req as any).user?.id;
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
      const userId = (req as any).user?.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const logs = await storage.getReminderLogsByCompanyId(companyId);
      res.json(logs);
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
      const userId = (req as any).user?.id;
      const { companyId } = req.query;

      if (!companyId) {
        return res.status(400).json({ message: "Company ID required" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, companyId as string);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const company = await storage.getCompany(companyId as string);
      const invoices = await storage.getInvoicesByCompanyId(companyId as string);

      const deadlines: any[] = [];
      const today = new Date();

      // VAT Return deadlines (based on filing frequency)
      if (company?.trnVatNumber) {
        const filingFrequency = company.vatFilingFrequency || "Quarterly";
        let nextDeadline = new Date();

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

      // Unpaid invoice deadlines
      const unpaidInvoices = invoices.filter((inv) => inv.status === "sent");
      unpaidInvoices.forEach((inv) => {
        const invoiceDate = new Date(inv.date);
        const dueDate = new Date(invoiceDate);
        dueDate.setDate(dueDate.getDate() + 30); // Assume 30-day payment terms

        const daysRemaining = Math.ceil(
          (dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        );
        const isOverdue = daysRemaining < 0;

        deadlines.push({
          id: `invoice-${inv.id}`,
          type: isOverdue ? "invoice_overdue" : "invoice_due",
          title: isOverdue ? `Invoice ${inv.number} Overdue` : `Invoice ${inv.number} Due Soon`,
          description: `${inv.customerName} - AED ${inv.total.toFixed(2)}`,
          dueDate: dueDate.toISOString(),
          daysRemaining,
          priority: isOverdue ? "urgent" : daysRemaining <= 7 ? "high" : "normal",
          actionUrl: `/invoices/${inv.id}`,
          relatedEntityType: "invoice",
          relatedEntityId: inv.id,
        });
      });

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
