/**
 * Customer statement of account: JSON, PDF and email.
 * All three share one builder (customer-statement.service.ts) so the screen,
 * the PDF and the emailed copy can never disagree.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import { buildCustomerStatement, parseStatementDay } from "../services/customer-statement.service";
import { generateStatementPDF } from "../services/pdf-statement.service";
import {
  assertEmailSent,
  emailStatus,
  EMAIL_NOT_CONFIGURED_MESSAGE,
  sendStatementEmail,
} from "../services/email.service";
import { formatPdfDate } from "../services/pdf-format";
import { bilingualSubject, bilingualText, localized } from "../services/email-i18n";

const emailBodySchema = z.object({
  from: z.string(),
  to: z.string(),
  recipient: z.string().email("Invalid email address").optional(),
  subject: z.string().max(200).optional(),
  message: z.string().max(2000).optional(),
});

function periodFrom(source: { from?: unknown; to?: unknown }): { from: string; to: string } | { error: string } {
  const from = parseStatementDay(source.from);
  const to = parseStatementDay(source.to);
  if (!from || !to) return { error: "from and to are required as YYYY-MM-DD dates" };
  if (from > to) return { error: "from must not be after to" };
  return { from, to };
}

function safeFileKey(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "customer";
}

export function registerStatementRoutes(app: Express) {
  const base = "/api/companies/:companyId/contacts/:contactId/statement";

  /** Auth, tenant access, period parsing and the statement itself; null = response already sent. */
  async function load(
    req: Request,
    res: Response,
    source: { from?: unknown; to?: unknown }
  ) {
    const { companyId, contactId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      res.status(403).json({ message: "Access denied" });
      return null;
    }
    const period = periodFrom(source);
    if ("error" in period) {
      res.status(400).json({ message: period.error, code: "INVALID_PERIOD" });
      return null;
    }
    const statement = await buildCustomerStatement({ companyId, contactId, ...period });
    if (!statement) {
      res.status(404).json({ message: "Contact not found" });
      return null;
    }
    const company = await storage.getCompany(companyId);
    if (!company) {
      res.status(404).json({ message: "Company not found" });
      return null;
    }
    return { statement, company };
  }

  app.get(
    base,
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const loaded = await load(req, res, req.query);
      if (loaded) res.json(loaded.statement);
    })
  );

  app.get(
    `${base}/pdf`,
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const loaded = await load(req, res, req.query);
      if (!loaded) return;
      const pdf = await generateStatementPDF(loaded.statement, loaded.company);
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="statement-${safeFileKey(loaded.statement.contact.name)}-${loaded.statement.to}.pdf"`,
        "Content-Length": pdf.length.toString(),
      });
      res.send(pdf);
    })
  );

  app.post(
    `${base}/email`,
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = emailBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid request" });
      }
      const body = parsed.data;
      const loaded = await load(req, res, body);
      if (!loaded) return;
      const { statement, company } = loaded;

      const recipient = body.recipient ?? statement.contact.email ?? "";
      if (!z.string().email().safeParse(recipient).success) {
        return res.status(400).json({
          message: "This customer has no email address. Enter a recipient.",
          code: "NO_RECIPIENT",
        });
      }
      if (!emailStatus().configured) {
        return res.status(503).json({ message: EMAIL_NOT_CONFIGURED_MESSAGE, code: "EMAIL_NOT_CONFIGURED" });
      }

      const pdf = await generateStatementPDF(statement, company);
      const period = `${formatPdfDate(statement.from)} - ${formatPdfDate(statement.to)}`;
      assertEmailSent(
        await sendStatementEmail({
          to: recipient,
          // Defaults are Arabic then English; a subject or message the sender typed is sent as written.
          subject: body.subject || bilingualSubject(localized("statementSubject", { company: company.name, period })),
          message:
            body.message ||
            bilingualText(localized("statementCustomerBody", { name: statement.contact.name, period, balance: statement.closingBalance.toFixed(2), company: company.name })),
          fromName: company.name,
          pdf,
          filename: `statement-${safeFileKey(statement.contact.name)}-${statement.to}.pdf`,
        })
      );

      await storage.createActivityLog({
        userId: (req as any).user.id,
        companyId: req.params.companyId,
        action: "send",
        entityType: "customer_statement",
        entityId: statement.contact.id,
        description: `Statement ${statement.from} to ${statement.to} sent by email to ${recipient}`,
        metadata: JSON.stringify({ to: recipient, from: statement.from, until: statement.to }),
      });

      res.json({ message: `Statement sent to ${recipient}` });
    })
  );
}
