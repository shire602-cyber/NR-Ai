// The single door every upload goes through: validate -> durable storage ->
// ledger row. Routes never touch storage or trust client-supplied URLs.

import type { Response } from "express";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { storedFiles } from "../../shared/schema";
import { AppError } from "../errors";
import { createLogger } from "../config/logger";
import { deleteDocument, readDocument, saveDocument } from "./fileStorage";
import { keyBelongsToCompany, parseStorageKey, validateUpload } from "./document-validation";

const log = createLogger("document-upload");

export interface StoreUploadInput {
  companyId: string;
  /** Storage namespace: "documents", "tax-returns", "vat-evidence", "expense-receipts". */
  category: string;
  fileName?: string | null;
  mimeType?: string | null;
  /** Base64 or data URL. */
  fileData?: unknown;
  uploadedBy?: string | null;
}

export interface StoredUpload {
  key: string;
  sizeBytes: number;
  contentType: string;
  filename: string;
}

/**
 * Validate and persist an uploaded file. Throws AppError 400/413 for a bad file
 * (with a specific code) and 503 STORAGE_NOT_DURABLE when production has no
 * durable storage. Returns the storage key - never a URL.
 */
export async function storeUploadedFile(input: StoreUploadInput): Promise<StoredUpload> {
  const validation = validateUpload({
    filename: input.fileName,
    contentType: input.mimeType,
    base64: typeof input.fileData === "string" ? input.fileData : null,
  });
  if (!validation.ok) {
    throw new AppError({
      message: validation.message,
      statusCode: validation.status,
      code: validation.code,
    });
  }

  const saved = await saveDocument({
    companyId: input.companyId,
    category: input.category,
    filename: validation.filename,
    contentType: validation.contentType,
    buffer: validation.buffer,
  });

  try {
    await db.insert(storedFiles).values({
      companyId: input.companyId,
      storageKey: saved.key,
      category: input.category,
      filename: validation.filename,
      contentType: validation.contentType,
      sizeBytes: saved.sizeBytes,
      uploadedBy: input.uploadedBy ?? null,
    });
  } catch (err) {
    // Do not leave an untracked object behind.
    await deleteDocument(saved.key);
    throw err;
  }

  return {
    key: saved.key,
    sizeBytes: saved.sizeBytes,
    contentType: validation.contentType,
    filename: validation.filename,
  };
}

/** Record a file that was written through a legacy path (receipt images) so it counts towards usage. */
export async function recordStoredFile(input: {
  companyId: string;
  key: string;
  category: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy?: string | null;
}): Promise<void> {
  try {
    await db
      .insert(storedFiles)
      .values({
        companyId: input.companyId,
        storageKey: input.key,
        category: input.category,
        filename: input.filename,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        uploadedBy: input.uploadedBy ?? null,
      })
      .onConflictDoNothing();
  } catch (err) {
    // Usage accounting must never fail an otherwise successful upload.
    log.warn({ err: (err as Error).message, key: input.key }, "Failed to record stored file");
  }
}

/** Delete the stored object (if `key` is one of ours) and its ledger row. */
export async function removeStoredFile(key: string | null | undefined): Promise<void> {
  if (!key) return;
  if (parseStorageKey(key)) await deleteDocument(key);
  try {
    await db.delete(storedFiles).where(eq(storedFiles.storageKey, key));
  } catch (err) {
    log.warn({ err: (err as Error).message, key }, "Failed to delete stored file ledger row");
  }
}

/** Total bytes stored for a company (documents, receipts, evidence, ...). */
export async function getCompanyStorageBytes(companyId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${storedFiles.sizeBytes}), 0)` })
    .from(storedFiles)
    .where(eq(storedFiles.companyId, companyId));
  return Number(row?.total ?? 0);
}

const MIME_SAFE_FOR_DOWNLOAD = /^[a-z]+\/[a-z0-9.+-]+$/i;

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Authorised download: the caller has already checked the requester may read
 * `companyId`. Streams the bytes with `Content-Disposition: attachment`; the
 * storage location is never revealed. Returns false when nothing could be sent
 * (caller answers 404).
 */
export async function sendStoredDocument(
  res: Response,
  opts: { key: string | null | undefined; companyId: string; filename: string; contentType?: string | null }
): Promise<boolean> {
  // A key that is not namespaced to this company (legacy placeholder paths,
  // forged values, another tenant's key) is never read.
  if (!opts.key || !keyBelongsToCompany(opts.key, opts.companyId)) return false;
  const file = await readDocument(opts.key);
  if (!file) return false;

  const declared = opts.contentType && MIME_SAFE_FOR_DOWNLOAD.test(opts.contentType) ? opts.contentType : null;
  res.setHeader("Content-Type", declared ?? file.contentType ?? "application/octet-stream");
  res.setHeader("Content-Disposition", contentDisposition(opts.filename));
  res.setHeader("Content-Length", String(file.buffer.length));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.status(200).end(file.buffer);
  return true;
}
