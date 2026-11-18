/**
 * WQ2 (8.2, 8.7, 4.7): AI capture of supplier bills and stored purchase documents.
 *
 * - captureBillFromDocument reads an uploaded PDF or image through the receipt OCR pipeline and
 *   returns a bill DRAFT with per-field confidence. It writes nothing: the editor shows the
 *   draft, the user saves it through POST /bills, and the file is then kept as the bill
 *   attachment (POST /bills/:id/attachment).
 * - assertNotOwnTrn refuses a bill whose seller TRN is the company's own TRN (a sales invoice of
 *   ours is never a purchase): 422 SELF_TRN_BILL on create / edit, 422 SELF_TRN_DOCUMENT on
 *   capture.
 * - storePurchaseFile keeps a file through fileStorage after the upload guard checked its bytes
 *   (magic number, size, malware scan); a rejected file is a 4xx DomainError, never a 500.
 * - signReceiptRef / verifyReceiptRef let an expense-claim item carry a file stored before the
 *   claim is saved without trusting a client-supplied storage key.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { pool } from "../db";
import { DomainError, errorCode } from "../errors";
import { loadBaseCurrency } from "../ledger";
import { inspectUpload, UploadRejectedError } from "./upload-guard";
import { saveReceiptFile } from "./fileStorage";
import { extractBillDocument } from "./ocr-extraction.service";
import {
  isOwnTrn,
  mapExtractionToBillDraft,
  SelfTrnDocumentError,
  type BillCaptureResult,
  type CaptureSupplier,
} from "../../shared/bill-capture";

/** The company's own TRN (companies.trn_vat_number), or null. */
export async function companyOwnTrn(companyId: string): Promise<string | null> {
  const r = await pool.query(`SELECT trn_vat_number FROM companies WHERE id = $1`, [companyId]);
  return (r.rows[0]?.trn_vat_number as string | null | undefined) ?? null;
}

/** 4.7: a bill may not carry the company's own TRN as the seller's TRN. */
export async function assertNotOwnTrn(companyId: string, sellerTrn: string | null | undefined) {
  if (!sellerTrn) return;
  if (isOwnTrn(sellerTrn, await companyOwnTrn(companyId))) {
    throw new DomainError(
      "SELF_TRN_BILL",
      422,
      { field: "vendor_trn" },
      "The supplier TRN on this bill is your own company's TRN. A document your company issued is a sales invoice, not a bill: check the supplier TRN."
    );
  }
}

function asDomainUploadError(err: unknown): never {
  if (err instanceof UploadRejectedError) {
    throw new DomainError(err.code, err.status, undefined, err.message);
  }
  throw err;
}

/** Inspect an uploaded file (base64 / data URL) without storing it. */
export async function inspectPurchaseFile(file: string) {
  try {
    return await inspectUpload(file);
  } catch (err) {
    return asDomainUploadError(err);
  }
}

/** Store an uploaded file after the upload guard accepted it; returns the storage key. */
export async function storePurchaseFile(file: string): Promise<string> {
  const inspected = await inspectPurchaseFile(file);
  // A random object name (never the client's file name, which two tenants could share).
  return saveReceiptFile(inspected.buffer, { mime: inspected.mime, ext: inspected.ext });
}

async function companySuppliers(companyId: string): Promise<CaptureSupplier[]> {
  const r = await pool.query(
    `SELECT id, name, name_ar, trn, payment_terms_days, default_expense_account_id
       FROM vendors WHERE company_id = $1 AND is_active = true ORDER BY name LIMIT 5000`,
    [companyId]
  );
  return r.rows.map((v) => ({
    id: v.id,
    name: v.name,
    nameAr: v.name_ar,
    trn: v.trn,
    paymentTermsDays: v.payment_terms_days,
    defaultExpenseAccountId: v.default_expense_account_id,
  }));
}

/**
 * Read a supplier invoice into a bill draft. 503 AI_NOT_CONFIGURED without a provider (the user
 * fills the form by hand and the file is still attached on save), 502 BILL_CAPTURE_FAILED when
 * every provider failed, 422 SELF_TRN_DOCUMENT for one of our own invoices.
 */
export async function captureBillFromDocument(args: {
  companyId: string;
  userId: string;
  file: string;
}): Promise<BillCaptureResult & { mime: string }> {
  const inspected = await inspectPurchaseFile(args.file);
  let extraction;
  try {
    extraction = await extractBillDocument({
      content: inspected.buffer,
      mimeType: inspected.mime,
      companyId: args.companyId,
      userId: args.userId,
    });
  } catch (err) {
    if (errorCode(err) === "AI_QUOTA_EXCEEDED") {
      throw new DomainError("AI_QUOTA_EXCEEDED", 429, undefined, (err as Error).message);
    }
    throw err;
  }
  if (extraction.status === "not_configured") {
    throw new DomainError(
      "AI_NOT_CONFIGURED",
      503,
      undefined,
      "Automatic reading is not enabled on this server. Fill in the bill by hand; the file is kept as its attachment."
    );
  }
  if (extraction.status === "failed" || !extraction.data) {
    throw new DomainError(
      "BILL_CAPTURE_FAILED",
      502,
      undefined,
      "The document could not be read. Fill in the bill by hand; the file is kept as its attachment."
    );
  }
  const [suppliers, companyTrn, baseCurrency] = await Promise.all([
    companySuppliers(args.companyId),
    companyOwnTrn(args.companyId),
    loadBaseCurrency(args.companyId),
  ]);
  try {
    const result = mapExtractionToBillDraft(extraction.data, {
      suppliers,
      companyTrn,
      baseCurrency,
      issues: extraction.issues,
    });
    return { ...result, mime: inspected.mime };
  } catch (err) {
    if (err instanceof SelfTrnDocumentError) {
      throw new DomainError(
        "SELF_TRN_DOCUMENT",
        422,
        undefined,
        "This document was issued by your own company (the seller TRN is your TRN). It is a sales invoice, not a bill."
      );
    }
    throw err;
  }
}

// ── Expense-claim receipt references ──────────────────────────────────────────

function refKey(): string {
  const key = process.env.SESSION_SECRET || process.env.JWT_SECRET;
  if (!key) throw new DomainError("SERVER_MISCONFIGURED", 500, undefined, "No signing secret");
  return key;
}

const sign = (companyId: string, path: string) =>
  createHmac("sha256", refKey()).update(`claim-receipt:${companyId}:${path}`).digest("base64url");

/** An opaque reference to a stored file, valid only for this company. */
export function signReceiptRef(companyId: string, path: string): string {
  return `${Buffer.from(path, "utf8").toString("base64url")}.${sign(companyId, path)}`;
}

/** The storage key behind a reference, or a 422 when it was not issued for this company. */
export function verifyReceiptRef(companyId: string, ref: string): string {
  const [encoded, mac] = ref.split(".");
  const path = encoded ? Buffer.from(encoded, "base64url").toString("utf8") : "";
  const expected = path ? sign(companyId, path) : "";
  const ok =
    !!mac &&
    !!expected &&
    mac.length === expected.length &&
    timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
  if (!ok) {
    throw new DomainError("RECEIPT_REF_INVALID", 422, undefined, "The receipt file is not valid");
  }
  return path;
}
