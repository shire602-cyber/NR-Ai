/**
 * Document vault with real file storage (W4-D: R16-09, R16-10, R16-16).
 *
 * - Uploads arrive as multipart/form-data (parsed here, size-capped while streaming) or as a
 *   base64 `fileData` JSON field. The type is decided by the bytes (magic numbers), never by the
 *   file name or the client's declared MIME type; a declared type that disagrees is rejected.
 * - Bytes go to the durable file store (server/services/fileStorage.ts: S3 / Vercel Blob /
 *   local disk) and the row keeps the storage key, size and SHA-256 — never a client URL.
 * - Every upload is a numbered row in document_file_versions (unique (document_id, version),
 *   numbered under a row lock); restore re-points to an earlier version as a new version;
 *   delete is soft.
 */
import crypto from "crypto";
import type { Request } from "express";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  documentFileVersions,
  documents,
  type Document,
  type DocumentFileVersion,
} from "../../shared/schema";
import { DomainError } from "../errors";
import { readReceiptImage, saveReceiptFile } from "./fileStorage";
import { sniffFileType } from "./upload-guard";
import { documentUploadBody, type DocumentUploadBody } from "../../shared/validators/portal";

export const MAX_VAULT_FILE_BYTES = 20 * 1024 * 1024;

export const VAULT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
] as const;
export type VaultMime = (typeof VAULT_MIME_TYPES)[number];

const EXT: Record<VaultMime, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
  "text/csv": "csv",
};

const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

function looksLikeText(buf: Buffer): boolean {
  const sample = buf.subarray(0, 8192);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(
      sample.subarray(0, Math.max(0, sample.length - 4))
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Decide the file type from its bytes. `declared` (client MIME) only chooses between types
 * the bytes cannot tell apart (doc/xls share the OLE container, txt/csv are both text).
 * Returns null for anything that is not an allowed type.
 */
export function sniffVaultType(buf: Buffer, declared?: string | null): VaultMime | null {
  const basic = sniffFileType(buf);
  if (basic) return basic.mime as VaultMime;
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    const head = buf.toString("latin1");
    if (head.includes("word/"))
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (head.includes("xl/"))
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    return null;
  }
  if (buf.length >= 8 && buf.subarray(0, 8).equals(OLE)) {
    return declared === "application/vnd.ms-excel"
      ? "application/vnd.ms-excel"
      : "application/msword";
  }
  if (looksLikeText(buf)) return declared === "text/csv" ? "text/csv" : "text/plain";
  return null;
}

export interface UploadedFile {
  buffer: Buffer;
  fileName: string;
  declaredMime: string | null;
}

export interface ParsedUpload {
  fields: Record<string, string>;
  file: UploadedFile | null;
}

/** Read the raw request body (multipart) with a hard byte cap. */
async function readBody(req: Request, cap: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > cap) {
      throw new DomainError(
        "FILE_TOO_LARGE",
        413,
        { maxBytes: MAX_VAULT_FILE_BYTES },
        `File exceeds the ${Math.round(MAX_VAULT_FILE_BYTES / 1048576)} MB limit`
      );
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Minimal multipart/form-data parser: text fields plus the first file part. */
export function parseMultipart(body: Buffer, contentType: string): ParsedUpload {
  const m = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!m) throw new DomainError("INVALID_MULTIPART", 400, undefined, "Missing multipart boundary");
  const boundary = Buffer.from(`--${(m[1] ?? m[2]).trim()}`);
  const fields: Record<string, string> = {};
  let file: UploadedFile | null = null;
  let pos = body.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length;
    if (body.subarray(start, start + 2).toString() === "--") break;
    const next = body.indexOf(boundary, start);
    if (next === -1) break;
    // part = CRLF headers CRLF CRLF content CRLF
    const part = body.subarray(start + 2, next - 2);
    const sep = part.indexOf("\r\n\r\n");
    if (sep !== -1) {
      const headers = part.subarray(0, sep).toString("utf8");
      const content = part.subarray(sep + 4);
      const disp = headers.match(/content-disposition:[^\r\n]*/i)?.[0] ?? "";
      const name = disp.match(/\bname="([^"]*)"/i)?.[1];
      const filename = disp.match(/\bfilename="([^"]*)"/i)?.[1];
      const ctype =
        headers
          .match(/content-type:\s*([^\r\n;]+)/i)?.[1]
          ?.trim()
          .toLowerCase() ?? null;
      if (filename !== undefined) {
        if (!file) file = { buffer: Buffer.from(content), fileName: filename, declaredMime: ctype };
      } else if (name) {
        fields[name] = content.toString("utf8");
      }
    }
    pos = next;
  }
  return { fields, file };
}

export function isMultipart(req: Request): boolean {
  return /^multipart\/form-data/i.test(req.headers["content-type"] ?? "");
}

/** Parse a vault upload from a multipart request, or from a parsed JSON body with `fileData`. */
export async function readUpload(req: Request): Promise<ParsedUpload> {
  if (isMultipart(req)) {
    const body = await readBody(req, MAX_VAULT_FILE_BYTES + 512 * 1024);
    return parseMultipart(body, req.headers["content-type"] ?? "");
  }
  const json = (req.body ?? {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(json)) {
    if (k !== "fileData" && (typeof v === "string" || typeof v === "number")) fields[k] = String(v);
  }
  const data = typeof json.fileData === "string" ? json.fileData : null;
  if (!data) return { fields, file: null };
  const match = data.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/s);
  const base64 = (match ? match[2] : data).replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    throw new DomainError("UNSUPPORTED_FILE", 400, undefined, "fileData is not valid base64");
  }
  if (Math.floor((base64.length * 3) / 4) > MAX_VAULT_FILE_BYTES + 4) {
    throw new DomainError("FILE_TOO_LARGE", 413, { maxBytes: MAX_VAULT_FILE_BYTES });
  }
  return {
    fields,
    file: {
      buffer: Buffer.from(base64, "base64"),
      fileName: typeof json.fileName === "string" ? json.fileName : "document",
      declaredMime:
        (typeof json.mimeType === "string" ? json.mimeType.toLowerCase() : null) ??
        match?.[1]?.toLowerCase() ??
        null,
    },
  };
}

export interface InspectedFile {
  buffer: Buffer;
  mime: VaultMime;
  ext: string;
  size: number;
  sha256: string;
  fileName: string;
}

/** Magic-byte check + size cap + declared-type agreement. */
export function inspectVaultFile(file: UploadedFile): InspectedFile {
  if (!file.buffer.length) throw new DomainError("UNSUPPORTED_FILE", 400, undefined, "Empty file");
  if (file.buffer.length > MAX_VAULT_FILE_BYTES) {
    throw new DomainError("FILE_TOO_LARGE", 413, { maxBytes: MAX_VAULT_FILE_BYTES });
  }
  const declared =
    file.declaredMime && file.declaredMime !== "application/octet-stream"
      ? file.declaredMime === "image/jpg"
        ? "image/jpeg"
        : file.declaredMime
      : null;
  const mime = sniffVaultType(file.buffer, declared);
  if (!mime) {
    throw new DomainError(
      "UNSUPPORTED_FILE",
      400,
      undefined,
      "Unsupported file. Allowed: PDF, images, Word, Excel, text and CSV."
    );
  }
  if (declared && declared !== mime) {
    throw new DomainError(
      "FILE_TYPE_MISMATCH",
      400,
      { declared, detected: mime },
      `File content (${mime}) does not match the declared type (${declared})`
    );
  }
  const base = (file.fileName || "document").replace(/[\\/]/g, "_").replace(/[^\w.\- ()]/g, "_");
  const ext = EXT[mime];
  const fileName = base.toLowerCase().endsWith(`.${ext}`)
    ? base
    : `${base.replace(/\.[^.]*$/, "")}.${ext}`;
  return {
    buffer: file.buffer,
    mime,
    ext,
    size: file.buffer.length,
    sha256: crypto.createHash("sha256").update(file.buffer).digest("hex"),
    fileName: fileName.slice(0, 200),
  };
}

/**
 * Read + validate an upload request (multipart or JSON): metadata through the shared
 * validator (unknown or server-owned keys are a 400), file bytes through inspectVaultFile.
 */
export async function readValidatedUpload(
  req: Request
): Promise<{ meta: Omit<DocumentUploadBody, "fileData">; file: InspectedFile }> {
  const { fields, file } = await readUpload(req);
  if (!file) {
    throw new DomainError(
      "UPLOAD_REQUIRED",
      400,
      undefined,
      "Attach a file (multipart `file` or `fileData`)"
    );
  }
  const schema = documentUploadBody.omit({ fileData: true }).strict();
  const parsed = schema.safeParse(
    Object.fromEntries(Object.entries(fields).filter(([k]) => !["fileData", "file"].includes(k)))
  );
  if (!parsed.success) throw parsed.error;
  return { meta: parsed.data, file: inspectVaultFile(file) };
}

async function storeBytes(f: InspectedFile): Promise<string> {
  // fileStorage picks the durable backend (S3 / Blob / local disk) and returns the key.
  return saveReceiptFile(f.buffer, {
    mime: f.mime,
    ext: f.ext,
    id: `vault_${crypto.randomUUID()}`,
  });
}

export interface CreateVaultDocumentInput {
  companyId: string;
  uploadedBy: string;
  file: InspectedFile;
  name?: string | null;
  nameAr?: string | null;
  category?: string | null;
  description?: string | null;
  expiryDate?: string | null;
  reminderDays?: number | null;
  tags?: string | null;
  contactId?: string | null;
  source?: "staff" | "customer_portal";
  note?: string | null;
}

export async function createVaultDocument(input: CreateVaultDocumentInput): Promise<Document> {
  const key = await storeBytes(input.file);
  return db.transaction(async (tx: typeof db) => {
    const id = crypto.randomUUID();
    const [doc] = await tx
      .insert(documents)
      .values({
        id,
        companyId: input.companyId,
        name: input.name || input.file.fileName,
        nameAr: input.nameAr ?? null,
        category: input.category || "other",
        description: input.description ?? null,
        fileUrl: `/api/documents/${id}/download`,
        fileName: input.file.fileName,
        fileSize: input.file.size,
        mimeType: input.file.mime,
        expiryDate: input.expiryDate ? new Date(`${input.expiryDate}T00:00:00.000Z`) : null,
        reminderDays: input.reminderDays ?? 30,
        reminderSent: false,
        tags: input.tags ?? null,
        isArchived: false,
        uploadedBy: input.uploadedBy,
        storageKey: key,
        sha256: input.file.sha256,
        currentVersion: 1,
        contactId: input.contactId ?? null,
        source: input.source ?? "staff",
      })
      .returning();
    await tx.insert(documentFileVersions).values({
      companyId: input.companyId,
      documentId: id,
      version: 1,
      storageKey: key,
      fileName: input.file.fileName,
      mimeType: input.file.mime,
      fileSize: input.file.size,
      sha256: input.file.sha256,
      note: input.note ?? null,
      uploadedBy: input.uploadedBy,
    });
    return doc as Document;
  });
}

async function lockDocument(
  tx: typeof db,
  companyId: string,
  documentId: string
): Promise<Document> {
  await tx.execute(
    sql`SELECT id FROM documents WHERE id = ${documentId} AND company_id = ${companyId} FOR UPDATE`
  );
  const [doc] = await tx
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.companyId, companyId)));
  if (!doc) throw new DomainError("DOCUMENT_NOT_FOUND", 404, undefined, "Document not found");
  return doc as Document;
}

async function appendVersion(
  tx: typeof db,
  doc: Document,
  v: { storageKey: string; fileName: string; mimeType: string; fileSize: number; sha256: string },
  uploadedBy: string,
  note: string | null
): Promise<DocumentFileVersion> {
  const res = await tx.execute(
    sql`SELECT COALESCE(MAX(version), 0) + 1 AS next FROM document_file_versions WHERE document_id = ${doc.id}`
  );
  const rows = ((res as { rows?: unknown[] }).rows ?? res) as Array<{ next: number | string }>;
  const version = Number(rows[0]?.next ?? 1);
  const [row] = await tx
    .insert(documentFileVersions)
    .values({
      companyId: doc.companyId,
      documentId: doc.id,
      version,
      storageKey: v.storageKey,
      fileName: v.fileName,
      mimeType: v.mimeType,
      fileSize: v.fileSize,
      sha256: v.sha256,
      note,
      uploadedBy,
    })
    .returning();
  await tx
    .update(documents)
    .set({
      storageKey: v.storageKey,
      fileName: v.fileName,
      fileSize: v.fileSize,
      mimeType: v.mimeType,
      sha256: v.sha256,
      currentVersion: version,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, doc.id));
  return row as DocumentFileVersion;
}

/** Upload a new file version (numbered atomically under the document row lock). */
export async function addVaultVersion(args: {
  companyId: string;
  documentId: string;
  file: InspectedFile;
  uploadedBy: string;
  note?: string | null;
}): Promise<DocumentFileVersion> {
  const key = await storeBytes(args.file);
  return db.transaction(async (tx: typeof db) => {
    const doc = await lockDocument(tx, args.companyId, args.documentId);
    if (doc.deletedAt) throw new DomainError("DOCUMENT_DELETED", 409);
    return appendVersion(
      tx,
      doc,
      {
        storageKey: key,
        fileName: args.file.fileName,
        mimeType: args.file.mime,
        fileSize: args.file.size,
        sha256: args.file.sha256,
      },
      args.uploadedBy,
      args.note ?? null
    );
  });
}

/** Restore an earlier version: it becomes the newest version (history is never rewritten). */
export async function restoreVaultVersion(args: {
  companyId: string;
  documentId: string;
  version: number;
  userId: string;
}): Promise<DocumentFileVersion> {
  return db.transaction(async (tx: typeof db) => {
    const doc = await lockDocument(tx, args.companyId, args.documentId);
    const [old] = await tx
      .select()
      .from(documentFileVersions)
      .where(
        and(
          eq(documentFileVersions.documentId, doc.id),
          eq(documentFileVersions.version, args.version)
        )
      );
    if (!old) throw new DomainError("VERSION_NOT_FOUND", 404, undefined, "Version not found");
    if (doc.deletedAt) {
      await tx
        .update(documents)
        .set({ deletedAt: null, deletedBy: null })
        .where(eq(documents.id, doc.id));
    }
    return appendVersion(
      tx,
      doc,
      old as DocumentFileVersion,
      args.userId,
      `Restored version ${args.version}`
    );
  });
}

export async function listVaultVersions(companyId: string, documentId: string) {
  return db
    .select({
      id: documentFileVersions.id,
      version: documentFileVersions.version,
      fileName: documentFileVersions.fileName,
      mimeType: documentFileVersions.mimeType,
      fileSize: documentFileVersions.fileSize,
      sha256: documentFileVersions.sha256,
      note: documentFileVersions.note,
      uploadedBy: documentFileVersions.uploadedBy,
      createdAt: documentFileVersions.createdAt,
    })
    .from(documentFileVersions)
    .where(
      and(
        eq(documentFileVersions.companyId, companyId),
        eq(documentFileVersions.documentId, documentId)
      )
    )
    .orderBy(desc(documentFileVersions.version));
}

export async function softDeleteVaultDocument(
  companyId: string,
  documentId: string,
  userId: string
): Promise<boolean> {
  const rows = await db
    .update(documents)
    .set({ deletedAt: new Date(), deletedBy: userId, updatedAt: new Date() })
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.companyId, companyId),
        isNull(documents.deletedAt)
      )
    )
    .returning({ id: documents.id });
  return rows.length > 0;
}

export async function undeleteVaultDocument(
  companyId: string,
  documentId: string
): Promise<boolean> {
  const rows = await db
    .update(documents)
    .set({ deletedAt: null, deletedBy: null, updatedAt: new Date() })
    .where(and(eq(documents.id, documentId), eq(documents.companyId, companyId)))
    .returning({ id: documents.id });
  return rows.length > 0;
}

export async function listVaultDocuments(
  companyId: string,
  opts: { contactId?: string; includeDeleted?: boolean } = {}
): Promise<Document[]> {
  const conds = [eq(documents.companyId, companyId)];
  if (!opts.includeDeleted) conds.push(isNull(documents.deletedAt));
  if (opts.contactId) conds.push(eq(documents.contactId, opts.contactId));
  return (await db
    .select()
    .from(documents)
    .where(and(...conds))
    .orderBy(desc(documents.createdAt))) as Document[];
}

/** Bytes of a document (current or a given version). */
export async function readVaultFile(
  companyId: string,
  documentId: string,
  version?: number | null
): Promise<{ buffer: Buffer; mimeType: string; fileName: string } | null> {
  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.companyId, companyId)));
  if (!doc || !doc.storageKey) return null;
  let key = doc.storageKey;
  let mimeType = doc.mimeType ?? "application/octet-stream";
  let fileName = doc.fileName;
  if (version) {
    const [v] = await db
      .select()
      .from(documentFileVersions)
      .where(
        and(eq(documentFileVersions.documentId, doc.id), eq(documentFileVersions.version, version))
      );
    if (!v) return null;
    key = v.storageKey;
    mimeType = v.mimeType;
    fileName = v.fileName;
  }
  const file = await readReceiptImage(key);
  if (!file) return null;
  return { buffer: file.buffer, mimeType, fileName };
}

export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
