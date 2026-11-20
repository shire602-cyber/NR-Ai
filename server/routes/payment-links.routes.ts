/**
 * Staff payment-link management (W4-D, R16-14).
 *
 *   GET  /api/companies/:companyId/online-payments/status
 *   GET  /api/companies/:companyId/invoices/:invoiceId/payment-links
 *   POST /api/companies/:companyId/invoices/:invoiceId/payment-links   (503 when no gateway)
 *   POST /api/companies/:companyId/payment-links/:linkId/cancel
 */
import type { Express, Request, Response } from "express";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
import { storage } from "../storage";
import { createPaymentLinkBody, type CreatePaymentLinkBody } from "../../shared/validators/portal";
import {
  cancelPaymentLink,
  createPaymentLink,
  listPaymentLinks,
  paymentsAvailability,
} from "../services/payments";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function access(req: Request): Promise<string> {
  const { companyId } = req.params;
  const userId = (req.user as { id: string }).id;
  if (!UUID_RE.test(companyId) || !(await storage.hasCompanyAccess(userId, companyId))) {
    throw new DomainError("COMPANY_ACCESS_DENIED", 403, undefined, "Access denied");
  }
  return companyId;
}

export function registerPaymentLinkRoutes(app: Express): void {
  app.get(
    "/api/companies/:companyId/online-payments/status",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      await access(req);
      res.json(paymentsAvailability());
    })
  );

  app.get(
    "/api/companies/:companyId/invoices/:invoiceId/payment-links",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await access(req);
      if (!UUID_RE.test(req.params.invoiceId)) throw new DomainError("INVOICE_NOT_FOUND", 404);
      res.json({
        availability: paymentsAvailability(),
        links: await listPaymentLinks(companyId, req.params.invoiceId),
      });
    })
  );

  app.post(
    "/api/companies/:companyId/invoices/:invoiceId/payment-links",
    authMiddleware,
    requireCustomer,
    strictBody(createPaymentLinkBody),
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await access(req);
      if (!UUID_RE.test(req.params.invoiceId)) throw new DomainError("INVOICE_NOT_FOUND", 404);
      const body = parsedBody<CreatePaymentLinkBody>(req);
      const { view } = await createPaymentLink({
        companyId,
        invoiceId: req.params.invoiceId,
        createdBy: (req.user as { id: string }).id,
        provider: body.provider ?? null,
        expiresInDays: body.expiresInDays,
        depositAccountId: body.depositAccountId ?? null,
      });
      res.status(201).json(view);
    })
  );

  app.post(
    "/api/companies/:companyId/payment-links/:linkId/cancel",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await access(req);
      if (
        !UUID_RE.test(req.params.linkId) ||
        !(await cancelPaymentLink(companyId, req.params.linkId))
      ) {
        throw new DomainError("PAYMENT_LINK_NOT_FOUND", 404, undefined, "No active payment link");
      }
      res.json({ cancelled: true });
    })
  );
}
