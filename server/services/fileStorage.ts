import fs from "fs/promises";
import path from "path";
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
const localReceiptsDir = path.join(projectRoot, "uploads", receiptsPrefix);

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
 * Assess whether receipt-image storage will SURVIVE a redeploy.
 *
 *  - Object storage (Vercel Blob / S3) is always durable.
 *  - local-disk is durable ONLY when the uploads dir sits on a persistent
 *    volume. On Railway, an attached Volume is exposed via the
 *    `RAILWAY_VOLUME_MOUNT_PATH` env var; if the uploads dir lives under it, the
 *    disk is durable. A generic `UPLOADS_PERSISTENT=true` escape hatch covers
 *    non-Railway persistent mounts. Otherwise the container disk is ephemeral
 *    and images are lost on every redeploy.
 *
 * This deliberately does NOT treat "no object storage" as ephemeral — a
 * volume-backed disk (the current Railway setup) is perfectly durable.
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

  if (process.env.UPLOADS_PERSISTENT === "true") {
    return { backend, durable: true, detail: "local disk marked persistent (UPLOADS_PERSISTENT=true)" };
  }

  return {
    backend,
    durable: false,
    detail: `local disk at ${resolvedUploads} with no detected persistent volume — images are lost on redeploy`,
  };
}

function guessContentType(key: string): string {
  const ext = path.extname(key).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".pdf") return "application/pdf";
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

  await fs.mkdir(localReceiptsDir, { recursive: true });
  await fs.writeFile(path.join(localReceiptsDir, safeName), buffer);
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
    const buffer = await fs.readFile(path.join(projectRoot, "uploads", key));
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
    await fs.unlink(path.join(projectRoot, "uploads", key));
  } catch {
    /* already gone */
  }
}
