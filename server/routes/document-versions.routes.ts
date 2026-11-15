import type { Express, Request, Response } from "express";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
import { storage } from "../storage";
import { pool } from "../db";
import {
  documentVersionCreateBody,
  type DocumentVersionCreateBody,
} from "../../shared/validators/portal";

/**
 * Document version history (W4-D, R16-10).
 *
 * A version is a SERVER-side snapshot of the document row and its lines, taken only after the
 * document is proven to exist in the caller's company. Numbers are allocated under a
 * per-document advisory lock inside the insert transaction, and (company, type, document,
 * version) is unique, so parallel writers can never produce duplicate numbers.
 */

const VALID_TYPES = ["invoice", "quote", "credit_note", "purchase_order", "receipt"] as const;
type DocType = (typeof VALID_TYPES)[number];

const SOURCES: Record<DocType, { sql: string; lines?: string }> = {
  invoice: {
    sql: `SELECT row_to_json(t) AS doc FROM (SELECT * FROM invoices WHERE id = $1 AND company_id = $2 AND invoice_type <> 'credit_note') t`,
    lines: `SELECT coalesce(json_agg(l ORDER BY l.id), '[]') AS lines FROM invoice_lines l WHERE l.invoice_id = $1`,
  },
  credit_note: {
    sql: `SELECT row_to_json(t) AS doc FROM (SELECT * FROM invoices WHERE id = $1 AND company_id = $2 AND invoice_type = 'credit_note') t`,
    lines: `SELECT coalesce(json_agg(l ORDER BY l.id), '[]') AS lines FROM invoice_lines l WHERE l.invoice_id = $1`,
  },
  quote: {
    sql: `SELECT row_to_json(t) AS doc FROM (SELECT * FROM quotes WHERE id = $1 AND company_id = $2) t`,
    lines: `SELECT coalesce(json_agg(l ORDER BY l.id), '[]') AS lines FROM quote_lines l WHERE l.quote_id = $1`,
  },
  purchase_order: {
    sql: `SELECT row_to_json(t) AS doc FROM (SELECT * FROM purchase_orders WHERE id = $1 AND company_id = $2) t`,
    lines: `SELECT coalesce(json_agg(l ORDER BY l.id), '[]') AS lines FROM purchase_order_lines l WHERE l.purchase_order_id = $1`,
  },
  receipt: {
    sql: `SELECT row_to_json(t) AS doc FROM (SELECT * FROM receipts WHERE id = $1 AND company_id = $2) t`,
  },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Server-side snapshot of a document of the company, or 404. */
export async function snapshotDocument(
  companyId: string,
  type: DocType,
  documentId: string
): Promise<Record<string, unknown>> {
  if (!UUID_RE.test(documentId)) throw new DomainError("DOCUMENT_NOT_FOUND", 404);
  const src = SOURCES[type];
  const { rows } = await pool.query(src.sql, [documentId, companyId]);
  const doc = rows[0]?.doc as Record<string, unknown> | undefined;
  if (!doc) {
    throw new DomainError("DOCUMENT_NOT_FOUND", 404, { documentType: type }, "Document not found");
  }
  const lines = src.lines ? (await pool.query(src.lines, [documentId])).rows[0]?.lines : undefined;
  // Never snapshot secrets or bulky blobs.
  for (const key of ["share_token", "share_token_expires_at", "einvoice_xml", "image_data"]) {
    delete doc[key];
  }
  return lines !== undefined ? { ...doc, lines } : doc;
}

/** Insert the next version number atomically. */
export async function createDocumentVersionAtomic(args: {
  companyId: string;
  documentType: DocType;
  documentId: string;
  changeDescription: string | null;
  changedBy: string;
  snapshot: Record<string, unknown>;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `docver:${args.companyId}:${args.documentType}:${args.documentId}`,
    ]);
    const { rows } = await client.query(
      `INSERT INTO document_versions
         (company_id, document_type, document_id, version, change_description, changed_by, snapshot_data)
       SELECT $1, $2, $3, COALESCE(MAX(version), 0) + 1, $4, $5, $6
         FROM document_versions
        WHERE company_id = $1 AND document_type = $2 AND document_id = $3
       RETURNING id, company_id AS "companyId", document_type AS "documentType",
                 document_id AS "documentId", version, change_description AS "changeDescription",
                 changed_by AS "changedBy", snapshot_data AS "snapshotData", created_at AS "createdAt"`,
      [
        args.companyId,
        args.documentType,
        args.documentId,
        args.changeDescription,
        args.changedBy,
        JSON.stringify(args.snapshot),
      ]
    );
    await client.query("COMMIT");
    return rows[0];
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

function diffSnapshots(a: Record<string, unknown>, b: Record<string, unknown>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changes: Array<{ field: string; from: unknown; to: unknown }> = [];
  for (const k of keys) {
    if (["updated_at"].includes(k)) continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k]))
      changes.push({ field: k, from: a[k], to: b[k] });
  }
  return changes;
}

export function registerDocumentVersionRoutes(app: Express) {
  const access = async (req: Request) => {
    const userId = (req as any).user.id;
    const { companyId, documentType } = req.params;
    if (!(await storage.hasCompanyAccess(userId, companyId))) {
      throw new DomainError("COMPANY_ACCESS_DENIED", 403, undefined, "Access denied");
    }
    if (documentType !== undefined && !(VALID_TYPES as readonly string[]).includes(documentType)) {
      throw new DomainError(
        "INVALID_DOCUMENT_TYPE",
        400,
        { allowed: VALID_TYPES },
        `Invalid document type. Must be one of: ${VALID_TYPES.join(", ")}`
      );
    }
    return companyId;
  };

  app.get(
    "/api/companies/:companyId/document-versions/:documentType/:documentId",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await access(req);
      const { documentType, documentId } = req.params;
      if (!UUID_RE.test(documentId)) throw new DomainError("DOCUMENT_NOT_FOUND", 404);
      res.json(await storage.getDocumentVersions(companyId, documentType, documentId));
    })
  );

  // Compare two versions: ?from=1&to=2 (defaults: the two latest).
  app.get(
    "/api/companies/:companyId/document-versions/:documentType/:documentId/diff",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await access(req);
      const { documentType, documentId } = req.params;
      if (!UUID_RE.test(documentId)) throw new DomainError("DOCUMENT_NOT_FOUND", 404);
      const versions = await storage.getDocumentVersions(companyId, documentType, documentId);
      const pick = (n: unknown, fallback: number) => {
        const v = Number(n);
        return versions.find((x) => x.version === (Number.isInteger(v) && v > 0 ? v : fallback));
      };
      const to = pick(req.query.to, versions[0]?.version ?? 0);
      const from = pick(req.query.from, versions[1]?.version ?? 0);
      if (!to || !from)
        throw new DomainError("VERSION_NOT_FOUND", 404, undefined, "Version not found");
      const parse = (s: string | null) => {
        try {
          return (s ? JSON.parse(s) : {}) as Record<string, unknown>;
        } catch {
          return {};
        }
      };
      res.json({
        from: from.version,
        to: to.version,
        changes: diffSnapshots(parse(from.snapshotData), parse(to.snapshotData)),
      });
    })
  );

  // Record a version. The snapshot is taken by the server; a client-supplied snapshotData is
  // rejected by strictBody (unknown key).
  app.post(
    "/api/companies/:companyId/document-versions",
    authMiddleware,
    requireCustomer,
    strictBody(documentVersionCreateBody),
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await access(req);
      const body = parsedBody<DocumentVersionCreateBody>(req);
      const snapshot = await snapshotDocument(companyId, body.documentType, body.documentId);
      const version = await createDocumentVersionAtomic({
        companyId,
        documentType: body.documentType,
        documentId: body.documentId,
        changeDescription: body.changeDescription ?? null,
        changedBy: (req as any).user.id,
        snapshot,
      });
      res.status(201).json(version);
    })
  );
}
