// Pure upload validation: no I/O, no DB. Everything an uploaded file must pass
// before it may touch storage, plus the storage-key scheme.
//
// Rules: allow-list of content types; the bytes must match the claimed type
// (a "PDF" must start with %PDF); filenames are sanitised; size is capped; keys
// are namespaced by company so a forged DB value can never point at another
// tenant's files.

import { randomUUID } from "node:crypto";

/** 10 MB of decoded bytes (the JSON body limit for upload routes is raised to fit the base64 form). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_FILENAME_LENGTH = 120;
const TEXT_SNIFF_BYTES = 8192;

export type UploadErrorCode =
  | "FILE_MISSING"
  | "FILE_INVALID_ENCODING"
  | "FILE_EMPTY"
  | "FILE_TOO_LARGE"
  | "FILE_TYPE_NOT_ALLOWED"
  | "FILE_CONTENT_MISMATCH";

export type UploadValidation =
  | { ok: true; contentType: string; filename: string; buffer: Buffer }
  | { ok: false; status: 400 | 413; code: UploadErrorCode; message: string };

type Sniffed =
  | "application/pdf"
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif"
  | "image/heic"
  | "application/zip"
  | "application/x-ole";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Canonical content type -> what the bytes must look like. */
const ALLOWED: Record<string, { sniff: Sniffed | "text" }> = {
  "application/pdf": { sniff: "application/pdf" },
  "image/png": { sniff: "image/png" },
  "image/jpeg": { sniff: "image/jpeg" },
  "image/webp": { sniff: "image/webp" },
  "image/gif": { sniff: "image/gif" },
  "image/heic": { sniff: "image/heic" },
  [XLSX]: { sniff: "application/zip" },
  [DOCX]: { sniff: "application/zip" },
  "application/msword": { sniff: "application/x-ole" },
  "application/vnd.ms-excel": { sniff: "application/x-ole" },
  "text/csv": { sniff: "text" },
  "text/plain": { sniff: "text" },
  "application/json": { sniff: "text" },
};

const ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/heif": "image/heic",
  "application/csv": "text/csv",
  "text/x-csv": "text/csv",
};

const EXTENSION_TEXT_TYPES: Record<string, string> = {
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".json": "application/json",
};

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

/** Identify a binary format from its leading bytes. Text has no magic and returns null. */
export function sniffContentType(buf: Buffer): Sniffed | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  if (buf.length >= 6 && ["GIF87a", "GIF89a"].includes(buf.subarray(0, 6).toString("latin1"))) return "image/gif";
  if (buf.length >= 12 && buf.subarray(4, 8).toString("latin1") === "ftyp") {
    if (HEIC_BRANDS.has(buf.subarray(8, 12).toString("latin1"))) return "image/heic";
  }
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05) && (buf[3] === 0x04 || buf[3] === 0x06)) {
    return "application/zip";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0 &&
    buf[4] === 0xa1 && buf[5] === 0xb1 && buf[6] === 0x1a && buf[7] === 0xe1
  ) {
    return "application/x-ole";
  }
  return null;
}

function looksLikeText(buf: Buffer): boolean {
  const head = buf.subarray(0, TEXT_SNIFF_BYTES);
  for (let i = 0; i < head.length; i++) if (head[i] === 0x00) return false;
  return true;
}

const DATA_URL_PREFIX = /^data:[^,]*;base64,/i;
const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;

/** Decode a base64 string or data URL. Returns null when the text is not valid base64. */
export function decodeBase64Payload(input: string): Buffer | null {
  const stripped = input.replace(DATA_URL_PREFIX, "").replace(/\s+/g, "");
  if (!BASE64_BODY.test(stripped) || stripped.length % 4 === 1) return null;
  return Buffer.from(stripped, "base64");
}

/** Approximate decoded size without allocating (used to bail out early on huge payloads). */
export function estimateDecodedBytes(input: string): number {
  return Math.floor((input.length * 3) / 4);
}

/** Strip paths, control characters and hostile characters; keep letters of any script. */
export function sanitizeFilename(name: string): string {
  let s = String(name ?? "");
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
  s = s.split(/[/\\]/).pop() ?? "";
  s = s.replace(/[^\p{L}\p{N}\p{M} ._()\-+&,#@=]/gu, "_");
  s = s.replace(/\s+/g, " ").trim().replace(/^\.+/, "").replace(/[ .]+$/, "");
  if (!s) return "file";
  if (s.length > MAX_FILENAME_LENGTH) {
    const dot = s.lastIndexOf(".");
    const ext = dot > 0 && s.length - dot <= 10 ? s.slice(dot) : "";
    s = s.slice(0, MAX_FILENAME_LENGTH - ext.length) + ext;
  }
  return s;
}

function fail(status: 400 | 413, code: UploadErrorCode, message: string): UploadValidation {
  return { ok: false, status, code, message };
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

export function validateUpload(input: {
  filename?: string | null;
  contentType?: string | null;
  base64?: string | null;
}): UploadValidation {
  if (typeof input.base64 !== "string" || input.base64.length === 0) {
    return fail(400, "FILE_MISSING", "No file was provided.");
  }
  if (estimateDecodedBytes(input.base64) > MAX_UPLOAD_BYTES + 1024) {
    return fail(413, "FILE_TOO_LARGE", `File exceeds the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit.`);
  }
  const buffer = decodeBase64Payload(input.base64);
  if (!buffer) return fail(400, "FILE_INVALID_ENCODING", "The file data is not valid base64.");
  if (buffer.length === 0) return fail(400, "FILE_EMPTY", "The file is empty.");
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return fail(413, "FILE_TOO_LARGE", `File exceeds the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit.`);
  }

  const filename = sanitizeFilename(input.filename ?? "");
  const claimedRaw = (input.contentType ?? "").split(";")[0].trim().toLowerCase();
  const claimed = ALIASES[claimedRaw] ?? claimedRaw;
  const sniffed = sniffContentType(buffer);

  // No usable claim: work out the type from the bytes (or the extension for text).
  if (!claimed || claimed === "application/octet-stream") {
    const fromBytes = sniffed && sniffedToCanonical(sniffed, filename);
    if (fromBytes) return { ok: true, contentType: fromBytes, filename, buffer };
    const textType = EXTENSION_TEXT_TYPES[extensionOf(filename)];
    if (!sniffed && textType && looksLikeText(buffer)) return { ok: true, contentType: textType, filename, buffer };
    return fail(400, "FILE_TYPE_NOT_ALLOWED", "This file type is not allowed.");
  }

  const rule = ALLOWED[claimed];
  if (!rule) return fail(400, "FILE_TYPE_NOT_ALLOWED", "This file type is not allowed.");

  if (rule.sniff === "text") {
    if (sniffed || !looksLikeText(buffer)) {
      return fail(400, "FILE_CONTENT_MISMATCH", "The file content does not match its declared type.");
    }
    return { ok: true, contentType: claimed, filename, buffer };
  }

  // Windows browsers label CSV exports "application/vnd.ms-excel".
  if (claimed === "application/vnd.ms-excel" && !sniffed && looksLikeText(buffer)) {
    return { ok: true, contentType: "text/csv", filename, buffer };
  }

  if (sniffed !== rule.sniff) {
    return fail(400, "FILE_CONTENT_MISMATCH", "The file content does not match its declared type.");
  }
  return { ok: true, contentType: claimed, filename, buffer };
}

function sniffedToCanonical(sniffed: Sniffed, filename: string): string | null {
  switch (sniffed) {
    case "application/zip": {
      const ext = extensionOf(filename);
      if (ext === ".xlsx") return XLSX;
      if (ext === ".docx") return DOCX;
      return null;
    }
    case "application/x-ole": {
      const ext = extensionOf(filename);
      if (ext === ".xls") return "application/vnd.ms-excel";
      if (ext === ".doc") return "application/msword";
      return null;
    }
    default:
      return sniffed;
  }
}

// ── Storage keys ─────────────────────────────────────────────────────────────

const COMPANY_SEGMENT = /^[A-Za-z0-9-]{8,64}$/;
const CATEGORY_SEGMENT = /^[a-z0-9][a-z0-9-]{0,39}$/;
const KEY_PATTERN = /^([A-Za-z0-9-]{8,64})\/([a-z0-9][a-z0-9-]{0,39})\/([^/\\]+)$/;

/** `<companyId>/<category>/<uuid>-<sanitised filename>` */
export function buildStorageKey(input: {
  companyId: string;
  category: string;
  filename: string;
  id?: string;
}): string {
  if (!COMPANY_SEGMENT.test(input.companyId)) throw new Error("Invalid company id for storage key");
  if (!CATEGORY_SEGMENT.test(input.category)) throw new Error("Invalid storage category");
  return `${input.companyId}/${input.category}/${input.id ?? randomUUID()}-${sanitizeFilename(input.filename)}`;
}

export interface ParsedStorageKey {
  companyId: string;
  category: string;
  name: string;
}

/** Returns null for anything that is not a well-formed key (URLs, traversal, legacy paths). */
export function parseStorageKey(key: unknown): ParsedStorageKey | null {
  if (typeof key !== "string" || key.length > 400) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(key)) return null;
  const m = KEY_PATTERN.exec(key);
  if (!m) return null;
  const name = m[3];
  if (name === "." || name === "..") return null;
  return { companyId: m[1], category: m[2], name };
}

export function keyBelongsToCompany(key: unknown, companyId: string): boolean {
  return parseStorageKey(key)?.companyId === companyId;
}
