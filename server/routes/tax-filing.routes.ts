// Tax filing evidence (Phase 4.1 VAT, 4.2 corporate tax): record a filing,
// evidence files, payments, amendment. One set of handlers serves both kinds;
// the kind config supplies how to load a return and which service runs it.
//
// Muhasib never transmits a return to the FTA: "filed" is the user's own record
// of a filing made on EmaraTax, backed by the FTA reference and acknowledgement.

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import { sendStoredDocument } from "../services/document-upload.service";
import {
  addEvidence,
  getEvidenceForDownload,
  getFilingByReturn,
  removeEvidence,
  type FilingActor,
  type FilingKind,
} from "../services/tax-filing.service";
import {
  createVatAmendment,
  getVatReturnView,
  recordVatFiling,
  recordVatPayment,
} from "../services/vat-filing.service";
import {
  createCtAmendment,
  getCtReturnView,
  recordCtFiling,
  recordCtPayment,
} from "../services/ct-filing.service";

const idParam = z.string().uuid();

interface KindConfig {
  kind: FilingKind;
  base: string;
  /** Extra guard after authentication (corporate tax is a customer-only surface, like its other routes). */
  guard: Array<(req: Request, res: Response, next: any) => void>;
  load: (id: string) => Promise<{ id: string; companyId: string } | undefined>;
  view: (ret: any, userId: string) => Promise<unknown>;
  file: typeof recordVatFiling;
  pay: typeof recordVatPayment;
  amend: typeof createVatAmendment;
}

const KINDS: KindConfig[] = [
  {
    kind: "vat",
    base: "/api/vat-returns",
    guard: [],
    load: (id) => storage.getVatReturn(id),
    view: (ret, userId) => getVatReturnView(ret, userId),
    file: recordVatFiling,
    pay: recordVatPayment,
    amend: createVatAmendment,
  },
  {
    kind: "corporate_tax",
    base: "/api/corporate-tax/returns",
    guard: [requireCustomer],
    load: (id) => storage.getCorporateTaxReturn(id),
    view: (ret) => getCtReturnView(ret),
    file: recordCtFiling as unknown as typeof recordVatFiling,
    pay: recordCtPayment as unknown as typeof recordVatPayment,
    amend: createCtAmendment as unknown as typeof createVatAmendment,
  },
];

const evidenceBody = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().max(100).optional().nullable(),
  fileData: z.string().min(1),
});

const fileBody = z.object({
  ftaReferenceNumber: z.string().optional().nullable(),
  filedAt: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  evidence: evidenceBody.optional().nullable(),
});

const paymentBody = z.object({
  amount: z.union([z.number(), z.string()]),
  date: z.string().optional().nullable(),
  accountId: z.string(),
  reference: z.string().max(100).optional().nullable(),
});

const removeBody = z.object({ reason: z.string().optional() });

function actorOf(req: Request): FilingActor {
  const u = (req as any).user;
  return { id: u.id, isAdmin: u.isAdmin === true, firmRole: u.firmRole ?? null };
}

export function registerTaxFilingRoutes(app: Express) {
  for (const cfg of KINDS) {
    /** Resolve the return and enforce read access to its company (404 hides other tenants' ids). */
    const loadAuthorised = async (req: Request, res: Response) => {
      const parsed = idParam.safeParse(req.params.id);
      if (!parsed.success) {
        res.status(404).json({ message: "Return not found", code: "RETURN_NOT_FOUND" });
        return null;
      }
      const ret = await cfg.load(parsed.data);
      if (!ret) {
        res.status(404).json({ message: "Return not found", code: "RETURN_NOT_FOUND" });
        return null;
      }
      if (!(await storage.hasCompanyAccess((req as any).user.id, ret.companyId))) {
        res.status(403).json({ message: "Access denied" });
        return null;
      }
      return ret;
    };

    // Full read model: snapshot figures, filing, evidence, payments, drift, lock, amendments.
    // (The corporate tax detail GET lives in corporate-tax.routes.ts and calls the same view.)
    const viewHandler = asyncHandler(async (req: Request, res: Response) => {
      const ret = await loadAuthorised(req, res);
      if (!ret) return;
      res.json(await cfg.view(ret, (req as any).user.id));
    });
    app.get(`${cfg.base}/:id/filing`, authMiddleware, ...cfg.guard, viewHandler);
    if (cfg.kind === "vat") app.get(`${cfg.base}/:id`, authMiddleware, viewHandler);

    // Record the return as filed.
    app.post(
      `${cfg.base}/:id/file`,
      authMiddleware,
      ...cfg.guard,
      asyncHandler(async (req: Request, res: Response) => {
        const ret = await loadAuthorised(req, res);
        if (!ret) return;
        const body = fileBody.safeParse(req.body ?? {});
        if (!body.success) {
          return res.status(400).json({ message: "Invalid filing details", code: "VALIDATION_ERROR" });
        }
        const filing = await cfg.file({
          user: actorOf(req),
          returnId: ret.id,
          input: {
            ftaReferenceNumber: body.data.ftaReferenceNumber,
            filedAt: body.data.filedAt,
            notes: body.data.notes,
            evidence: body.data.evidence ?? null,
          },
          req,
        });
        const fresh = await cfg.load(ret.id);
        res.status(201).json({
          filing: { id: filing.id, referenceNumber: filing.referenceNumber, filedAt: filing.filedAt, snapshotHash: filing.snapshotHash },
          transmittedByMuhasib: false,
          message:
            "Recorded as filed. Muhasib did not transmit this return: this is your record of a filing you made on EmaraTax.",
          view: await cfg.view(fresh, (req as any).user.id),
        });
      })
    );

    // Add an evidence file (more than one allowed).
    app.post(
      `${cfg.base}/:id/evidence`,
      authMiddleware,
      ...cfg.guard,
      asyncHandler(async (req: Request, res: Response) => {
        const ret = await loadAuthorised(req, res);
        if (!ret) return;
        const filing = await getFilingByReturn(cfg.kind, ret.id);
        if (!filing) {
          return res.status(409).json({ message: "Record the return as filed before attaching evidence.", code: "RETURN_NOT_FILED" });
        }
        const body = evidenceBody.safeParse(req.body ?? {});
        if (!body.success) {
          return res.status(400).json({ message: "A file is required", code: "FILE_MISSING" });
        }
        const row = await addEvidence({
          user: actorOf(req),
          companyId: ret.companyId,
          filing,
          upload: body.data,
          req,
        });
        res.status(201).json({
          id: row.id,
          filename: row.filename,
          contentType: row.contentType,
          sizeBytes: row.sizeBytes,
          createdAt: row.createdAt,
        });
      })
    );

    // Authenticated download (private storage, company-scoped key).
    app.get(
      `${cfg.base}/:id/evidence/:evidenceId/download`,
      authMiddleware,
      asyncHandler(async (req: Request, res: Response) => {
        const ret = await loadAuthorised(req, res);
        if (!ret) return;
        const evidenceId = idParam.safeParse(req.params.evidenceId);
        const filing = await getFilingByReturn(cfg.kind, ret.id);
        if (!evidenceId.success || !filing) return res.status(404).json({ message: "Evidence file not found" });
        const evidence = await getEvidenceForDownload(ret.companyId, filing.id, evidenceId.data);
        if (!evidence) return res.status(404).json({ message: "Evidence file not found" });
        const sent = await sendStoredDocument(res, {
          key: evidence.storageKey,
          companyId: ret.companyId,
          filename: evidence.filename,
          contentType: evidence.contentType,
        });
        if (!sent) return res.status(404).json({ message: "No file is stored for this evidence" });
      })
    );

    // Remove (soft, audit-logged, reason required). Owner / accountant only.
    app.delete(
      `${cfg.base}/:id/evidence/:evidenceId`,
      authMiddleware,
      ...cfg.guard,
      asyncHandler(async (req: Request, res: Response) => {
        const ret = await loadAuthorised(req, res);
        if (!ret) return;
        const evidenceId = idParam.safeParse(req.params.evidenceId);
        const filing = await getFilingByReturn(cfg.kind, ret.id);
        if (!evidenceId.success || !filing) return res.status(404).json({ message: "Evidence file not found" });
        const body = removeBody.safeParse(req.body ?? {});
        await removeEvidence({
          user: actorOf(req),
          companyId: ret.companyId,
          filing,
          evidenceId: evidenceId.data,
          reason: body.success ? body.data.reason : undefined,
          req,
        });
        res.json({ removed: true, retained: true });
      })
    );

    // Record a (possibly partial) payment / refund receipt.
    app.post(
      `${cfg.base}/:id/payments`,
      authMiddleware,
      ...cfg.guard,
      asyncHandler(async (req: Request, res: Response) => {
        const ret = await loadAuthorised(req, res);
        if (!ret) return;
        const body = paymentBody.safeParse(req.body ?? {});
        if (!body.success) {
          return res.status(400).json({ message: "Invalid payment details", code: "VALIDATION_ERROR" });
        }
        const result = await cfg.pay({ user: actorOf(req), returnId: ret.id, input: body.data, req });
        res.status(201).json({
          payment: result.payment,
          settlement: result.view,
          journalEntryId: result.entryId,
        });
      })
    );

    // Amendment (voluntary disclosure): a new linked return.
    app.post(
      `${cfg.base}/:id/amend`,
      authMiddleware,
      ...cfg.guard,
      asyncHandler(async (req: Request, res: Response) => {
        const ret = await loadAuthorised(req, res);
        if (!ret) return;
        const result = await cfg.amend({ user: actorOf(req), returnId: ret.id, req });
        res.status(201).json(result);
      })
    );
  }
}
