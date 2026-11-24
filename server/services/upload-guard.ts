import { MAX_UPLOAD_BYTES } from "../../shared/upload-limits";
import { AppError } from "../errors";
// Receipt upload guard (R05-06, R05-07, R05-08, R05-20, R17-11).
//
// Everything about an uploaded receipt is derived from its BYTES, never from the data-URL
// header or a filename: magic-byte sniffing (JPEG, PNG, WebP, GIF, PDF), per-file size cap,
// pixel-dimension cap, EXIF/metadata stripping, a sha256 of the stored content for
// duplicate detection, and an optional antivirus hook (ClamAV over TCP, enabled only when
// CLAMAV_HOST is set; otherwise its status is reported as `requires_external`).
//
// Metadata stripping is pure JS so it needs no native dependency. When `sharp` is
// installed it is additionally used to re-encode images (DEP-REQUEST: sharp) and to
// create thumbnails; without it, thumbnails report as unavailable.

import { createHash } from "crypto";
import net from "net";
import { createLogger } from "../config/logger";
import type sharpType from "sharp";

const log = createLogger("upload-guard");

export { MAX_UPLOAD_BYTES };
export const MAX_IMAGE_SIDE_PX = 12_000;
export const MAX_IMAGE_PIXELS = 100_000_000; // 100 megapixels

export type UploadMime =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif"
  | "application/pdf";

export const ALLOWED_UPLOAD_MIME: readonly UploadMime[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
];

const EXT_BY_MIME: Record<UploadMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

export class UploadRejectedError extends AppError {
  constructor(
    message: string,
    public readonly status: number,
    code:
      | "UNSUPPORTED_FILE"
      | "FILE_TOO_LARGE"
      | "IMAGE_TOO_LARGE"
      | "MALWARE_DETECTED"
      | "SCAN_UNAVAILABLE"
      | "STORAGE_QUOTA_EXCEEDED"
  ) {
    super({ message, statusCode: status, code });
  }
}

// ---- sniffing -------------------------------------------------------------------

export interface SniffedType {
  mime: UploadMime;
  ext: string;
}

export function sniffFileType(buf: Buffer): SniffedType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { mime: "image/png", ext: "png" };
  }
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString("latin1"))) {
    return { mime: "image/gif", ext: "gif" };
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return { mime: "image/webp", ext: "webp" };
  }
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") {
    return { mime: "application/pdf", ext: "pdf" };
  }
  return null;
}

export function extForMime(mime: string): string {
  return EXT_BY_MIME[mime as UploadMime] ?? "bin";
}

export function mimeForExt(ext: string): UploadMime | null {
  const e = ext.replace(/^\./, "").toLowerCase();
  const entry = (Object.entries(EXT_BY_MIME) as Array<[UploadMime, string]>).find(
    ([, v]) => v === e || (e === "jpeg" && v === "jpg")
  );
  return entry ? entry[0] : null;
}

// ---- dimensions -------------------------------------------------------------------

export function readImageDimensions(
  buf: Buffer,
  mime: string
): { width: number; height: number } | null {
  try {
    if (mime === "image/png" && buf.length >= 24) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mime === "image/gif" && buf.length >= 10) {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    if (mime === "image/jpeg") {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = buf[i + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          i += 2;
          continue;
        }
        const len = buf.readUInt16BE(i + 2);
        // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC)
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
      return null;
    }
    if (mime === "image/webp" && buf.length >= 30) {
      const kind = buf.subarray(12, 16).toString("latin1");
      if (kind === "VP8X") {
        return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      }
      if (kind === "VP8 ") {
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      }
      if (kind === "VP8L") {
        const bits = buf.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
    }
  } catch {
    return null;
  }
  return null;
}

// ---- metadata stripping (pure JS) -------------------------------------------------

/** Read the EXIF Orientation (1-8) from a JPEG APP1 segment, if present. */
function jpegOrientation(buf: Buffer): number | null {
  let i = 2;
  while (i + 4 < buf.length && buf[i] === 0xff) {
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xe1 && buf.subarray(i + 4, i + 10).toString("latin1") === "Exif\0\0") {
      const tiff = i + 10;
      const little = buf.subarray(tiff, tiff + 2).toString("latin1") === "II";
      const u16 = (o: number) => (little ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
      const u32 = (o: number) => (little ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
      const ifd = tiff + u32(tiff + 4);
      const count = u16(ifd);
      for (let n = 0; n < count; n++) {
        const entry = ifd + 2 + n * 12;
        if (entry + 12 > buf.length) break;
        if (u16(entry) === 0x0112) {
          const value = u16(entry + 8);
          return value >= 1 && value <= 8 ? value : null;
        }
      }
      return null;
    }
    if (marker === 0xda) break;
    i += 2 + len;
  }
  return null;
}

/** Minimal APP1 carrying only Orientation, so phone photos keep their rotation. */
function orientationOnlyExif(orientation: number): Buffer {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write("MM", 0, "latin1");
  tiff.writeUInt16BE(0x002a, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8);
  tiff.writeUInt16BE(0x0112, 10);
  tiff.writeUInt16BE(3, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt16BE(orientation, 18);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const header = Buffer.from([0xff, 0xe1, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

function stripJpeg(buf: Buffer): Buffer {
  const orientation = jpegOrientation(buf);
  const out: Buffer[] = [buf.subarray(0, 2)];
  let injected = false;
  let i = 2;
  while (i + 4 <= buf.length && buf[i] === 0xff) {
    const marker = buf[i + 1];
    if (marker === 0xda) break; // start of scan: copy the rest verbatim
    const len = buf.readUInt16BE(i + 2);
    const segment = buf.subarray(i, i + 2 + len);
    // Drop APP1 (EXIF/XMP), APP3-APP15 (vendor/IPTC/Photoshop) and COM; keep APP0 (JFIF) and
    // APP2 (ICC colour profile).
    const drop = marker === 0xfe || (marker >= 0xe3 && marker <= 0xef) || marker === 0xe1;
    if (!drop) out.push(segment);
    if (!injected && marker === 0xe0 && orientation && orientation !== 1) {
      out.push(orientationOnlyExif(orientation));
      injected = true;
    }
    i += 2 + len;
  }
  if (!injected && orientation && orientation !== 1)
    out.splice(1, 0, orientationOnlyExif(orientation));
  out.push(buf.subarray(i));
  return Buffer.concat(out);
}

const PNG_DROP_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

function stripPng(buf: Buffer): Buffer {
  const out: Buffer[] = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString("latin1");
    const end = i + 12 + len;
    if (end > buf.length) {
      out.push(buf.subarray(i));
      break;
    }
    if (!PNG_DROP_CHUNKS.has(type)) out.push(buf.subarray(i, end));
    i = end;
  }
  return Buffer.concat(out);
}

function stripWebp(buf: Buffer): Buffer {
  const chunks: Buffer[] = [];
  let i = 12;
  while (i + 8 <= buf.length) {
    const type = buf.subarray(i, i + 4).toString("latin1");
    const size = buf.readUInt32LE(i + 4);
    const padded = size + (size % 2);
    const end = Math.min(buf.length, i + 8 + padded);
    if (type !== "EXIF" && type !== "XMP ") {
      const chunk = Buffer.from(buf.subarray(i, end));
      if (type === "VP8X" && chunk.length >= 9) chunk[8] = chunk[8] & ~0x0c; // clear EXIF + XMP flags
      chunks.push(chunk);
    }
    i = end;
  }
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), ...chunks]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

/** Remove EXIF/XMP/GPS and other embedded metadata. PDFs and GIFs are returned unchanged. */
export function stripImageMetadata(buf: Buffer, mime: UploadMime): Buffer {
  try {
    if (mime === "image/jpeg") return stripJpeg(buf);
    if (mime === "image/png") return stripPng(buf);
    if (mime === "image/webp") return stripWebp(buf);
  } catch (err) {
    log.warn({ err: (err as Error).message }, "Metadata strip failed; rejecting file");
    throw new UploadRejectedError("The image file is corrupt", 400, "UNSUPPORTED_FILE");
  }
  return buf;
}

// ---- antivirus hook ---------------------------------------------------------------

export interface ScanResult {
  clean: boolean;
  signature?: string;
}

export interface VirusScanner {
  scan(buffer: Buffer): Promise<ScanResult>;
}

/** ClamAV over TCP using the INSTREAM protocol. */
export class ClamAvScanner implements VirusScanner {
  constructor(
    private readonly host: string,
    private readonly port = 3310,
    private readonly timeoutMs = 15_000
  ) {}

  scan(buffer: Buffer): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      let response = "";
      socket.setTimeout(this.timeoutMs, () => {
        socket.destroy();
        reject(new Error("ClamAV scan timed out"));
      });
      socket.on("error", reject);
      socket.on("data", (d) => (response += d.toString("utf8")));
      socket.on("close", () => {
        const text = response.replace(/\0/g, "").trim();
        if (/OK$/.test(text)) return resolve({ clean: true });
        const found = text.match(/stream:\s*(.+?)\s+FOUND/);
        if (found) return resolve({ clean: false, signature: found[1] });
        reject(new Error(`Unexpected ClamAV response: ${text || "(empty)"}`));
      });
      socket.on("connect", () => {
        socket.write("zINSTREAM\0");
        const CHUNK = 64 * 1024;
        for (let o = 0; o < buffer.length; o += CHUNK) {
          const part = buffer.subarray(o, o + CHUNK);
          const len = Buffer.alloc(4);
          len.writeUInt32BE(part.length, 0);
          socket.write(len);
          socket.write(part);
        }
        socket.write(Buffer.alloc(4)); // zero-length chunk terminates the stream
      });
    });
  }
}

let scannerOverride: VirusScanner | null | undefined;

/** Test hook / alternative scanner registration. Pass undefined to restore env-based behaviour. */
export function setVirusScanner(scanner: VirusScanner | null | undefined): void {
  scannerOverride = scanner;
}

function activeScanner(env: Record<string, string | undefined> = process.env): VirusScanner | null {
  if (scannerOverride !== undefined) return scannerOverride;
  if (!env.CLAMAV_HOST) return null;
  return new ClamAvScanner(env.CLAMAV_HOST, env.CLAMAV_PORT ? Number(env.CLAMAV_PORT) : 3310);
}

/** `enabled` when a scanner is wired; otherwise malware scanning requires an external service. */
export function getUploadScanStatus(
  env: Record<string, string | undefined> = process.env
): "enabled" | "requires_external" {
  return activeScanner(env) ? "enabled" : "requires_external";
}

// ---- optional sharp ---------------------------------------------------------------

type SharpFactory = typeof sharpType;

async function loadSharp(): Promise<SharpFactory | null> {
  try {
    const name = "sharp";
    const mod = (await import(/* @vite-ignore */ name)) as SharpFactory & {
      default?: SharpFactory;
    };
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

export async function generateThumbnail(
  buffer: Buffer,
  mime: string,
  maxSide = 320
): Promise<Buffer | null> {
  if (!mime.startsWith("image/")) return null;
  const sharp = await loadSharp();
  if (!sharp) return null;
  try {
    return await sharp(buffer)
      .rotate()
      .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
  } catch (err) {
    log.warn({ err: (err as Error).message }, "Thumbnail generation failed");
    return null;
  }
}

// ---- main entry -------------------------------------------------------------------

export interface InspectedUpload {
  buffer: Buffer;
  mime: UploadMime;
  ext: string;
  size: number;
  sha256: string;
  width: number | null;
  height: number | null;
  scan: "clean" | "requires_external";
}

export function parseDataUrl(input: string): { declaredMime: string | null; base64: string } {
  const match = input.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/s);
  if (match) return { declaredMime: match[1] ? match[1].toLowerCase() : null, base64: match[2] };
  return { declaredMime: null, base64: input };
}

/**
 * Validate and sanitise an uploaded file supplied as a base64 string or data URL.
 * Throws UploadRejectedError (400/413/422/503) for anything that is not an acceptable file.
 */
export async function inspectUpload(
  imageData: string,
  opts: { maxBytes?: number; scanner?: VirusScanner | null } = {}
): Promise<InspectedUpload> {
  if (typeof imageData !== "string" || imageData.length === 0) {
    throw new UploadRejectedError("Invalid image data", 400, "UNSUPPORTED_FILE");
  }
  const maxBytes = Math.min(opts.maxBytes ?? MAX_UPLOAD_BYTES, MAX_UPLOAD_BYTES);
  const { declaredMime, base64 } = parseDataUrl(imageData);

  // Reject before decoding: base64 expands by 4/3.
  if (Math.floor((base64.length * 3) / 4) > maxBytes + 4) {
    throw new UploadRejectedError(
      `File exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit`,
      413,
      "FILE_TOO_LARGE"
    );
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64.replace(/\s/g, ""))) {
    throw new UploadRejectedError("Invalid base64 image data", 400, "UNSUPPORTED_FILE");
  }
  const raw = Buffer.from(base64, "base64");
  if (raw.length === 0) throw new UploadRejectedError("Empty file", 400, "UNSUPPORTED_FILE");
  if (raw.length > maxBytes) {
    throw new UploadRejectedError(
      `File exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit`,
      413,
      "FILE_TOO_LARGE"
    );
  }

  const sniffed = sniffFileType(raw);
  if (!sniffed) {
    throw new UploadRejectedError(
      "Unsupported file. Allowed: JPEG, PNG, WebP, GIF and PDF.",
      400,
      "UNSUPPORTED_FILE"
    );
  }
  if (
    declaredMime &&
    declaredMime !== sniffed.mime &&
    !(declaredMime === "image/jpg" && sniffed.mime === "image/jpeg")
  ) {
    throw new UploadRejectedError(
      `File content (${sniffed.mime}) does not match the declared type (${declaredMime})`,
      400,
      "UNSUPPORTED_FILE"
    );
  }

  let width: number | null = null;
  let height: number | null = null;
  if (sniffed.mime.startsWith("image/")) {
    const dims = readImageDimensions(raw, sniffed.mime);
    if (!dims || dims.width < 1 || dims.height < 1) {
      throw new UploadRejectedError("The image file is corrupt", 400, "UNSUPPORTED_FILE");
    }
    if (
      dims.width > MAX_IMAGE_SIDE_PX ||
      dims.height > MAX_IMAGE_SIDE_PX ||
      dims.width * dims.height > MAX_IMAGE_PIXELS
    ) {
      throw new UploadRejectedError(
        `Image dimensions ${dims.width}x${dims.height} exceed the allowed maximum`,
        413,
        "IMAGE_TOO_LARGE"
      );
    }
    width = dims.width;
    height = dims.height;
  }

  const buffer = stripImageMetadata(raw, sniffed.mime);

  const scanner = opts.scanner === undefined ? activeScanner() : opts.scanner;
  let scan: InspectedUpload["scan"] = "requires_external";
  if (scanner) {
    try {
      const result = await scanner.scan(buffer);
      if (!result.clean) {
        throw new UploadRejectedError(
          `File rejected by antivirus scan${result.signature ? ` (${result.signature})` : ""}`,
          422,
          "MALWARE_DETECTED"
        );
      }
      scan = "clean";
    } catch (err) {
      if (err instanceof UploadRejectedError) throw err;
      log.error({ err: (err as Error).message }, "Antivirus scan failed");
      throw new UploadRejectedError(
        "Antivirus scanning is temporarily unavailable. Try again shortly.",
        503,
        "SCAN_UNAVAILABLE"
      );
    }
  }

  return {
    buffer,
    mime: sniffed.mime,
    ext: sniffed.ext,
    size: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    width,
    height,
    scan,
  };
}
