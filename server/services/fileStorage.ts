import fs from "fs/promises";
import path from "path";
import { sniffFileType, extForMime, mimeForExt, UploadRejectedError } from "./upload-guard";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

// Receipt-image storage with a pluggable backend.
//
//  • When S3-compatible object storage is configured (S3_BUCKET + creds) — e.g.
//    Cloudflare R2 or AWS S3 — images are stored durably in the bucket. This is
//    REQUIRED on Railway (ephemeral disk) and on Vercel (no persistent disk at
//    all). The DB stores the object key (e.g. "receipts/abc.jpg").
//  • Otherwise images fall back to <cwd>/uploads/receipts on local disk — fine
//    for local dev only.
//
// The DB value (image_path) is identical in both modes ("receipts/<file>"), so
// switching backends needs no data migration for new uploads.

const projectRoot = process.cwd();
const receiptsPrefix = "receipts";

// ── S3 / R2 backend (lazy) ──────────────────────────────────────────────────
let _s3: S3Client | null | undefined;
function getS3(): S3Client | null {
  if (_s3 !== undefined) return _s3;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) {
    _s3 = null;
    return _s3;
  }
  _s3 = new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: Boolean(process.env.S3_ENDPOINT), // R2/MinIO want path-style
  });
  return _s3;
}

// ── Vercel Blob backend (native to a Vercel stack; preferred when configured) ──
function isVercelBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

// Lazy-load the SDK so the dependency is only needed when Blob is actually used.
async function loadVercelBlob() {
  // @ts-ignore optional dependency — installed in deploy environments
  return import("@vercel/blob");
}

// Vercel Blob stores a full public-but-unguessable URL as the DB image_path.
// Restrict reads to the Blob domain so a forged DB value can't trigger SSRF.
const VERCEL_BLOB_URL = /^https:\/\/[a-z0-9]+\.(?:public|private)\.blob\.vercel-storage\.com\//i;

// Blob objects are PRIVATE by default (R05-06/R17-11): reads are proxied through the app with
// the store token, so a leaked URL alone is not enough. BLOB_ACCESS=public restores the legacy
// unguessable-URL behaviour for stores that cannot create private blobs.
function blobAccess(): "public" | "private" {
  return process.env.BLOB_ACCESS === "public" ? "public" : "private";
}

/** Whether durable object storage is configured (for /health + integration-status). */
export function isObjectStorageConfigured(): boolean {
  return isVercelBlobConfigured() || getS3() !== null;
}

/** Human label for the active storage backend (integration-status). */
export function objectStorageBackend(): "vercel-blob" | "s3" | "local-disk" {
  if (isVercelBlobConfigured()) return "vercel-blob";
  if (getS3() !== null) return "s3";
  return "local-disk";
}

export interface StorageDurability {
  backend: "vercel-blob" | "s3" | "local-disk";
  /** True when receipt images will survive a redeploy. */
  durable: boolean;
  /** Human-readable explanation for logs. */
  detail: string;
}

/**
 * Assess whether receipt-image storage will survive a redeploy.
 *
 * Object storage is always durable. Local disk is durable only when the uploads
 * dir is under a persistent Railway volume or explicitly marked persistent.
 */
export function assessStorageDurability(uploadsDir: string): StorageDurability {
  const backend = objectStorageBackend();
  if (backend !== "local-disk") {
    return { backend, durable: true, detail: `${backend} object storage` };
  }

  const resolvedUploads = path.resolve(uploadsDir);
  const volumeMount = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  if (volumeMount) {
    const resolvedMount = path.resolve(volumeMount);
    const onVolume =
      resolvedUploads === resolvedMount || resolvedUploads.startsWith(resolvedMount + path.sep);
    return onVolume
      ? { backend, durable: true, detail: `local disk on Railway volume (${resolvedMount})` }
      : {
          backend,
          durable: false,
          detail: `uploads dir ${resolvedUploads} is NOT under the Railway volume (${resolvedMount})`,
        };
  }

  if (process.env.UPLOADS_PERSISTENT === "true") {
    return {
      backend,
      durable: true,
      detail: "local disk marked persistent (UPLOADS_PERSISTENT=true)",
    };
  }

  return {
    backend,
    durable: false,
    detail: `local disk at ${resolvedUploads} with no detected persistent volume - images are lost on redeploy`,
  };
}

function guessContentType(key: string): string {
  const mime = mimeForExt(path.extname(key));
  return mime ?? "application/octet-stream";
}

/** True content type: sniffed from the bytes, falling back to the stored/extension hint. */
function trueContentType(buffer: Buffer, hint: string): string {
  return sniffFileType(buffer)?.mime ?? hint;
}

async function streamToBuffer(body: any): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body?.transformToByteArray === "function") {
    return Buffer.from(await body.transformToByteArray());
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

// ── Generic object store (S5) ──────────────────────────────────────────────────
//
// Receipts, report-delivery artifacts and other durable files share one backend
// choice: Vercel Blob, then S3/R2, then local disk under <cwd>/uploads/<prefix>.
// Keys are always "<prefix>/<name>" (Blob returns its full URL instead). Only the
// prefixes below can be written or read, so a forged DB value cannot escape them.

export const OBJECT_PREFIXES = ["receipts", "report-artifacts"] as const;
export type ObjectPrefix = (typeof OBJECT_PREFIXES)[number];

/** Pluggable backend for tests (an in-memory bucket standing in for S3). */
export interface ObjectStoreAdapter {
  put(key: string, buffer: Buffer, contentType: string): Promise<string>;
  get(key: string): Promise<{ buffer: Buffer; contentType?: string } | null>;
  del(key: string): Promise<void>;
}

let adapterOverride: ObjectStoreAdapter | null = null;

/** Test hook: route every object read/write through `adapter` (null restores the env backend). */
export function __setObjectStoreForTests(adapter: ObjectStoreAdapter | null): void {
  adapterOverride = adapter;
}

/**
 * True when writes land in durable object storage (Blob / S3, or the test adapter). Callers that
 * have a database fallback (report-delivery artifacts) use the DB when this is false instead of
 * writing to possibly ephemeral local disk.
 */
export function hasDurableObjectStore(): boolean {
  return adapterOverride !== null || isObjectStorageConfigured();
}

/** Reject keys that escape the allowed prefixes (defence against forged DB values). */
function assertSafeKey(key: string, prefixes: readonly string[] = OBJECT_PREFIXES): string {
  const normalized = path.posix.normalize(key).replace(/^\/+/, "");
  if (!prefixes.some((p) => normalized.startsWith(p + "/")) || normalized.includes("..")) {
    throw new Error("Invalid image path");
  }
  return normalized;
}

function safeObjectName(name: string): string {
  return name.replace(/[^a-z0-9_\-.]/gi, "_");
}

/** Store bytes under `<prefix>/<name>`. Returns the value to persist (key, or Blob URL). */
export async function putObject(
  prefix: ObjectPrefix,
  name: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  if (!OBJECT_PREFIXES.includes(prefix)) throw new Error(`Unknown object prefix "${prefix}"`);
  const safeName = safeObjectName(name);
  const key = `${prefix}/${safeName}`;

  if (adapterOverride) return adapterOverride.put(key, buffer, contentType);

  if (isVercelBlobConfigured()) {
    const { put } = await loadVercelBlob();
    const { url } = await put(key, buffer, {
      access: blobAccess(),
      contentType,
      addRandomSuffix: true, // unguessable URL
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return url; // full Blob URL is the stored reference
  }

  const s3 = getS3();
  if (s3) {
    // Objects stay private (no public ACL); reads are proxied through getObject.
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET!,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );
    return key;
  }

  const dir = path.join(projectRoot, "uploads", prefix);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, safeName), buffer);
  return key;
}

/** Read bytes by stored reference. Null when missing or unreadable. */
export async function getObject(
  ref: string,
  prefixes: readonly string[] = OBJECT_PREFIXES
): Promise<{ buffer: Buffer; contentType: string } | null> {
  // Vercel Blob: the reference is a full (Blob-domain only) URL — fetch the bytes.
  if (VERCEL_BLOB_URL.test(ref)) {
    try {
      // `redirect: "error"` hardens against SSRF: the URL is allow-listed to the
      // Blob domain, but a 3xx from that host could otherwise bounce us to an
      // internal address. Refuse to follow redirects so the allow-list holds.
      const res = await fetch(ref, {
        redirect: "error",
        headers: process.env.BLOB_READ_WRITE_TOKEN
          ? { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` }
          : undefined,
      });
      if (!res.ok) return null;
      const buffer = Buffer.from(await res.arrayBuffer());
      return {
        buffer,
        contentType: trueContentType(
          buffer,
          res.headers.get("content-type") || guessContentType(ref)
        ),
      };
    } catch {
      return null;
    }
  }

  const key = assertSafeKey(ref, prefixes);
  if (adapterOverride) {
    const got = await adapterOverride.get(key);
    if (!got) return null;
    return {
      buffer: got.buffer,
      contentType: trueContentType(got.buffer, got.contentType || guessContentType(key)),
    };
  }
  const s3 = getS3();
  if (s3) {
    try {
      const res = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }));
      const buffer = await streamToBuffer(res.Body);
      return {
        buffer,
        contentType: trueContentType(buffer, res.ContentType || guessContentType(key)),
      };
    } catch {
      return null;
    }
  }
  try {
    const buffer = await fs.readFile(path.join(projectRoot, "uploads", key));
    return { buffer, contentType: trueContentType(buffer, guessContentType(key)) };
  } catch {
    return null;
  }
}

/** Delete by stored reference. Silently ignores missing objects and invalid references. */
export async function deleteObject(
  ref: string,
  prefixes: readonly string[] = OBJECT_PREFIXES
): Promise<void> {
  if (VERCEL_BLOB_URL.test(ref)) {
    try {
      const { del } = await loadVercelBlob();
      await del(ref, { token: process.env.BLOB_READ_WRITE_TOKEN });
    } catch {
      /* already gone */
    }
    return;
  }

  let key: string;
  try {
    key = assertSafeKey(ref, prefixes);
  } catch {
    return;
  }
  if (adapterOverride) {
    await adapterOverride.del(key).catch(() => undefined);
    return;
  }
  const s3 = getS3();
  if (s3) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }));
    } catch {
      /* already gone */
    }
    return;
  }
  try {
    await fs.unlink(path.join(projectRoot, "uploads", key));
  } catch {
    /* already gone */
  }
}

/**
 * S8: like `deleteObject`, but a backend failure throws so a caller can retry it later (the
 * object-deletion queue). A missing object is success; an invalid reference is ignored (nothing
 * under the allowed prefixes can exist for it).
 */
export async function deleteObjectOrThrow(
  ref: string,
  prefixes: readonly string[] = OBJECT_PREFIXES
): Promise<void> {
  if (VERCEL_BLOB_URL.test(ref)) {
    const { del } = await loadVercelBlob();
    await del(ref, { token: process.env.BLOB_READ_WRITE_TOKEN });
    return;
  }
  let key: string;
  try {
    key = assertSafeKey(ref, prefixes);
  } catch {
    return;
  }
  if (adapterOverride) {
    await adapterOverride.del(key);
    return;
  }
  const s3 = getS3();
  if (s3) {
    // S3 DeleteObject is idempotent: a missing key is a 204, so any error is a real failure.
    await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }));
    return;
  }
  try {
    await fs.unlink(path.join(projectRoot, "uploads", key));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

// ── Receipts (thin wrappers over the object store) ──────────────────────────────

const RECEIPT_PREFIXES = [receiptsPrefix] as const;

/**
 * Persist already-validated bytes (see upload-guard `inspectUpload`). The key extension and
 * stored content type come from the sniffed MIME type, never from the client. Returns the
 * value stored in receipts.image_path.
 */
export async function saveReceiptFile(
  buffer: Buffer,
  info: { mime: string; ext?: string; id?: string }
): Promise<string> {
  const { randomUUID } = await import("crypto");
  const ext = info.ext ?? extForMime(info.mime);
  return putObject(receiptsPrefix, `${info.id ?? randomUUID()}.${ext}`, buffer, info.mime);
}

/**
 * Save a base64-encoded image/PDF. Returns the relative key stored in the DB
 * (e.g. "receipts/abc123.png"). The file type is sniffed from the bytes; unknown content
 * is rejected. Uses object storage when configured, else disk. `filename` is accepted for
 * backward compatibility but its extension is ignored.
 */
export async function saveReceiptImage(base64Data: string, filename?: string): Promise<string> {
  const raw = base64Data.replace(/^data:[^,]*;base64,/, "");
  const buffer = Buffer.from(raw, "base64");
  const sniffed = sniffFileType(buffer);
  if (!sniffed) {
    throw new UploadRejectedError(
      "Unsupported file. Allowed: JPEG, PNG, WebP, GIF and PDF.",
      400,
      "UNSUPPORTED_FILE"
    );
  }
  const id = filename ? path.basename(filename, path.extname(filename)) : undefined;
  return saveReceiptFile(buffer, { mime: sniffed.mime, ext: sniffed.ext, id });
}

/**
 * Read a receipt image by its DB key. Returns the bytes + content type, or null
 * if missing. The serve route sends this buffer (works the same on any host).
 * Throws "Invalid image path" for a key outside receipts/.
 */
export async function readReceiptImage(
  imagePath: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  return getObject(imagePath, RECEIPT_PREFIXES);
}

/** Delete a receipt image by its DB key/URL. Silently ignores missing files. */
export async function deleteReceiptImage(imagePath: string): Promise<void> {
  return deleteObject(imagePath, RECEIPT_PREFIXES);
}

// ── Quota and boot-time safety ────────────────────────────────────────────────

const DEFAULT_COMPANY_QUOTA_MB = 2048;

export function companyStorageQuotaBytes(
  env: Record<string, string | undefined> = process.env
): number {
  const mb = Number(env.COMPANY_STORAGE_QUOTA_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_COMPANY_QUOTA_MB) * 1024 * 1024;
}

/** Bytes of receipt files stored for a company (receipts.file_size; legacy rows count as 0). */
export async function getCompanyStorageUsage(companyId: string): Promise<number> {
  const { pool } = await import("../db");
  const r = await (pool as any).query(
    `SELECT COALESCE(SUM(file_size),0)::float8 AS used FROM receipts WHERE company_id = $1`,
    [companyId]
  );
  return Number(r.rows[0]?.used ?? 0);
}

/** Throws a 413 STORAGE_QUOTA_EXCEEDED rejection if adding `incomingBytes` exceeds the quota. */
export async function assertWithinStorageQuota(
  companyId: string,
  incomingBytes: number,
  usage: (companyId: string) => Promise<number> = getCompanyStorageUsage
): Promise<void> {
  const used = await usage(companyId);
  const quota = companyStorageQuotaBytes();
  if (used + incomingBytes > quota) {
    throw new UploadRejectedError(
      "Storage quota for this company has been reached. Delete old receipts or contact support.",
      413,
      "STORAGE_QUOTA_EXCEEDED"
    );
  }
}

/**
 * Production must not silently write receipts to ephemeral local disk (R05-07).
 * Throws unless object storage is configured, a persistent volume is declared, or
 * ALLOW_LOCAL_STORAGE=true is set explicitly.
 */
export function assertStorageBootSafe(
  env: Record<string, string | undefined> = process.env,
  uploadsDir: string = path.join(projectRoot, "uploads")
): void {
  if (env.NODE_ENV !== "production") return;
  if (env.ALLOW_LOCAL_STORAGE === "true") return;
  if (isObjectStorageConfigured()) return;
  const durability = assessStorageDurability(uploadsDir);
  if (durability.durable) return;
  throw new Error(
    "Refusing to start: receipt storage is local disk in production (" +
      durability.detail +
      "). Configure S3_BUCKET/BLOB_READ_WRITE_TOKEN, mount a persistent volume, or set " +
      "ALLOW_LOCAL_STORAGE=true to accept the risk."
  );
}
