import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { AppError } from "../errors";
import { buildStorageKey, decodeBase64Payload, parseStorageKey } from "./document-validation";

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

const receiptsPrefix = "receipts";
// Resolved per call (not at import) so tests and odd launch directories agree
// with index.ts, which prepares <cwd>/uploads at boot.
const uploadsRoot = () => path.join(process.cwd(), "uploads");
const localReceiptsDir = () => path.join(uploadsRoot(), receiptsPrefix);

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
const VERCEL_BLOB_URL = /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//i;

/** Whether durable object storage is configured (for /health + integration-status). */
export function isObjectStorageConfigured(): boolean {
  return objectStorageBackend() !== "local-disk";
}

/** Human label for the active storage backend (integration-status). */
export function objectStorageBackend(
  env: NodeJS.ProcessEnv = process.env
): "vercel-blob" | "s3" | "local-disk" {
  if (env.BLOB_READ_WRITE_TOKEN) return "vercel-blob";
  if (env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) return "s3";
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
export function assessStorageDurability(
  uploadsDir: string,
  env: NodeJS.ProcessEnv = process.env
): StorageDurability {
  const backend = objectStorageBackend(env);
  if (backend !== "local-disk") {
    return { backend, durable: true, detail: `${backend} object storage` };
  }

  const resolvedUploads = path.resolve(uploadsDir);
  const volumeMount = env.RAILWAY_VOLUME_MOUNT_PATH;
  if (volumeMount) {
    const resolvedMount = path.resolve(volumeMount);
    const onVolume =
      resolvedUploads === resolvedMount ||
      resolvedUploads.startsWith(resolvedMount + path.sep);
    return onVolume
      ? { backend, durable: true, detail: `local disk on Railway volume (${resolvedMount})` }
      : {
          backend,
          durable: false,
          detail: `uploads dir ${resolvedUploads} is NOT under the Railway volume (${resolvedMount})`,
        };
  }

  if (env.UPLOADS_PERSISTENT === "true") {
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

export class StorageNotDurableError extends AppError {
  /** `detail` (a server path) is kept for logs only and is never put in the message. */
  constructor(public readonly detail: string) {
    super({
      message:
        "File uploads are temporarily unavailable: this server has no durable file storage, so files would be lost on the next deploy. " +
        "The administrator must configure object storage or a persistent volume.",
      statusCode: 503,
      code: "STORAGE_NOT_DURABLE",
    });
  }
}

/**
 * Production guard for EVERY upload. In production a write to a disk that is
 * wiped on redeploy is refused (503 STORAGE_NOT_DURABLE) instead of silently
 * succeeding. Development may use local disk. STORAGE_ALLOW_EPHEMERAL=true is
 * an explicit, discouraged opt-out (e.g. a throwaway staging box).
 */
export function assertStorageWritable(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  if (env.STORAGE_ALLOW_EPHEMERAL === "true") return;
  const durability = assessStorageDurability(uploadsRoot(), env);
  if (!durability.durable) throw new StorageNotDurableError(durability.detail);
}

function guessContentType(key: string): string {
  const ext = path.extname(key).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
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

/** Reject keys that escape the receipts/ prefix (defence against forged DB values). */
function assertSafeKey(imagePath: string): string {
  const normalized = path.posix.normalize(imagePath).replace(/^\/+/, "");
  if (!normalized.startsWith(receiptsPrefix + "/") || normalized.includes("..")) {
    throw new Error("Invalid image path");
  }
  return normalized;
}

/**
 * Save a base64-encoded image. Returns the relative key stored in the DB
 * (e.g. "receipts/abc123.jpg"). Uses object storage when configured, else disk.
 */
export async function saveReceiptImage(base64Data: string, filename: string): Promise<string> {
  assertStorageWritable();
  const raw = base64Data.replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(raw, "base64");
  const safeName = filename.replace(/[^a-z0-9_\-.]/gi, "_");
  const key = `${receiptsPrefix}/${safeName}`;

  if (isVercelBlobConfigured()) {
    const { put } = await loadVercelBlob();
    const { url } = await put(key, buffer, {
      access: "public",
      contentType: guessContentType(key),
      addRandomSuffix: true, // unguessable URL
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return url; // full Blob URL stored as image_path
  }

  const s3 = getS3();
  if (s3) {
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET!,
        Key: key,
        Body: buffer,
        ContentType: guessContentType(key),
      })
    );
    return key;
  }

  await fs.mkdir(localReceiptsDir(), { recursive: true });
  await fs.writeFile(path.join(localReceiptsDir(), safeName), buffer);
  return key;
}

/**
 * Read a receipt image by its DB key. Returns the bytes + content type, or null
 * if missing. The serve route sends this buffer (works the same on any host).
 */
export async function readReceiptImage(
  imagePath: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  // Vercel Blob: image_path is a full (Blob-domain only) URL — fetch the bytes.
  if (VERCEL_BLOB_URL.test(imagePath)) {
    try {
      // `redirect: "error"` hardens against SSRF: the URL is allow-listed to the
      // Blob domain, but a 3xx from that host could otherwise bounce us to an
      // internal address. Refuse to follow redirects so the allow-list holds.
      const res = await fetch(imagePath, { redirect: "error" });
      if (!res.ok) return null;
      return {
        buffer: Buffer.from(await res.arrayBuffer()),
        contentType: res.headers.get("content-type") || guessContentType(imagePath),
      };
    } catch {
      return null;
    }
  }

  const key = assertSafeKey(imagePath);
  const s3 = getS3();
  if (s3) {
    try {
      const res = await s3.send(
        new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key })
      );
      return { buffer: await streamToBuffer(res.Body), contentType: res.ContentType || guessContentType(key) };
    } catch {
      return null;
    }
  }
  try {
    const buffer = await fs.readFile(path.join(uploadsRoot(), key));
    return { buffer, contentType: guessContentType(key) };
  } catch {
    return null;
  }
}

/** Delete a receipt image by its DB key/URL. Silently ignores missing files. */
export async function deleteReceiptImage(imagePath: string): Promise<void> {
  if (VERCEL_BLOB_URL.test(imagePath)) {
    try {
      const { del } = await loadVercelBlob();
      await del(imagePath, { token: process.env.BLOB_READ_WRITE_TOKEN });
    } catch {
      /* already gone */
    }
    return;
  }

  let key: string;
  try {
    key = assertSafeKey(imagePath);
  } catch {
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
    await fs.unlink(path.join(uploadsRoot(), key));
  } catch {
    /* already gone */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// General company documents (uploads of any kind).
//
// Keys are `<companyId>/<category>/<uuid>-<filename>` (see document-validation).
// A key is NOT a URL and is never handed to a browser: files are private and are
// served only through authenticated download routes that call readDocument().
// Validation (type, size, magic bytes) happens before this layer; see
// document-upload.service.ts.
// ─────────────────────────────────────────────────────────────────────────────

export interface SaveDocumentInput {
  companyId: string;
  category: string;
  filename: string;
  contentType: string;
  base64?: string;
  buffer?: Buffer;
}

export interface SavedDocument {
  key: string;
  sizeBytes: number;
  contentType: string;
}

/** Local-disk path for a validated key, or null if it would leave the uploads root. */
function localDocumentPath(key: string): string | null {
  if (!parseStorageKey(key)) return null;
  const root = path.resolve(uploadsRoot());
  const abs = path.resolve(root, key);
  return abs.startsWith(root + path.sep) ? abs : null;
}

export async function saveDocument(input: SaveDocumentInput): Promise<SavedDocument> {
  assertStorageWritable();

  const buffer = input.buffer ?? (input.base64 ? decodeBase64Payload(input.base64) : null);
  if (!buffer || buffer.length === 0) throw new Error("saveDocument: no file data");

  const key = buildStorageKey({
    companyId: input.companyId,
    category: input.category,
    filename: input.filename,
    id: randomUUID(),
  });
  const saved = { key, sizeBytes: buffer.length, contentType: input.contentType };

  if (isVercelBlobConfigured()) {
    const { put } = await loadVercelBlob();
    // The pathname is the namespaced key and carries a uuid, so the (public but
    // unguessable) blob URL is never stored or returned - reads look it up by key.
    await put(key, buffer, {
      access: "public",
      contentType: input.contentType,
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return saved;
  }

  const s3 = getS3();
  if (s3) {
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET!,
        Key: key,
        Body: buffer,
        ContentType: input.contentType,
      })
    );
    return saved;
  }

  const abs = localDocumentPath(key);
  if (!abs) throw new Error("saveDocument: invalid storage key");
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer, { flag: "wx" });
  return saved;
}

async function findBlobUrl(key: string): Promise<string | null> {
  const { list } = await loadVercelBlob();
  const res = await list({ prefix: key, limit: 5, token: process.env.BLOB_READ_WRITE_TOKEN });
  const match = res.blobs.find((b: { pathname: string }) => b.pathname === key);
  // Same SSRF allow-list as receipts: only ever fetch from the Blob domain.
  return match && VERCEL_BLOB_URL.test(match.url) ? match.url : null;
}

/** Read a document by key. Returns null when the key is malformed or the file is gone. */
export async function readDocument(
  key: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!parseStorageKey(key)) return null;

  if (isVercelBlobConfigured()) {
    try {
      const url = await findBlobUrl(key);
      if (!url) return null;
      // redirect:"error": a 3xx from the allow-listed host must not bounce us
      // to an internal address.
      const res = await fetch(url, { redirect: "error" });
      if (!res.ok) return null;
      return {
        buffer: Buffer.from(await res.arrayBuffer()),
        contentType: res.headers.get("content-type") || guessContentType(key),
      };
    } catch {
      return null;
    }
  }

  const s3 = getS3();
  if (s3) {
    try {
      const res = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }));
      return {
        buffer: await streamToBuffer(res.Body),
        contentType: res.ContentType || guessContentType(key),
      };
    } catch {
      return null;
    }
  }

  const abs = localDocumentPath(key);
  if (!abs) return null;
  try {
    return { buffer: await fs.readFile(abs), contentType: guessContentType(key) };
  } catch {
    return null;
  }
}

/** Delete a document by key. Malformed keys and missing files are ignored. */
export async function deleteDocument(key: string): Promise<void> {
  if (!parseStorageKey(key)) return;

  if (isVercelBlobConfigured()) {
    try {
      const url = await findBlobUrl(key);
      if (url) {
        const { del } = await loadVercelBlob();
        await del(url, { token: process.env.BLOB_READ_WRITE_TOKEN });
      }
    } catch {
      /* already gone */
    }
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

  const abs = localDocumentPath(key);
  if (!abs) return;
  try {
    await fs.unlink(abs);
  } catch {
    /* already gone */
  }
}
