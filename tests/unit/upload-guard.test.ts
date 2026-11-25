import { createHash } from "crypto";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Capture what fileStorage writes to disk instead of touching ./uploads.
const writes: Array<{ path: string; bytes: Buffer }> = [];
vi.mock("fs/promises", () => {
  const api = {
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async (p: string, b: Buffer) => {
      writes.push({ path: String(p), bytes: Buffer.from(b) });
    }),
    readFile: vi.fn(async (p: string) => {
      const hit = writes.find((w) => w.path === String(p));
      if (!hit) throw new Error("ENOENT");
      return hit.bytes;
    }),
    unlink: vi.fn(async () => undefined),
  };
  return { default: api, ...api };
});

import {
  inspectUpload,
  sniffFileType,
  stripImageMetadata,
  readImageDimensions,
  setVirusScanner,
  getUploadScanStatus,
  UploadRejectedError,
  MAX_UPLOAD_BYTES,
  ClamAvScanner,
} from "../../server/services/upload-guard";
import {
  saveReceiptImage,
  saveReceiptFile,
  readReceiptImage,
  assertStorageBootSafe,
  assertWithinStorageQuota,
} from "../../server/services/fileStorage";

// ---- fixtures -------------------------------------------------------------------

function pngBytes(width = 4, height = 4, extraChunks: Buffer[] = []): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    ...extraChunks,
    chunk("IDAT", Buffer.from([1, 2, 3])),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function gifBytes(): Buffer {
  const b = Buffer.alloc(20);
  b.write("GIF89a", 0, "latin1");
  b.writeUInt16LE(3, 6);
  b.writeUInt16LE(2, 8);
  return b;
}

/** JPEG with an APP1 Exif segment carrying GPS text + an Orientation tag. */
function jpegWithExif(orientation = 6): Buffer {
  const tiffHeader = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]);
  const ifd = Buffer.alloc(2 + 12 + 4);
  ifd.writeUInt16BE(1, 0);
  ifd.writeUInt16BE(0x0112, 2);
  ifd.writeUInt16BE(3, 4);
  ifd.writeUInt32BE(1, 6);
  ifd.writeUInt16BE(orientation, 10);
  const exifPayload = Buffer.concat([
    Buffer.from("Exif\0\0", "latin1"),
    tiffHeader,
    ifd,
    Buffer.from("GPSLatitude:25.2048N", "latin1"),
  ]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.alloc(2), exifPayload]);
  app1.writeUInt16BE(exifPayload.length + 2, 2);
  const sof = Buffer.from([
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x10, 0x00, 0x20, 0x01, 0x01, 0x11, 0x00,
  ]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x04, 0x00, 0x00, 0xaa, 0xbb, 0xff, 0xd9]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, sos]);
}

const b64 = (b: Buffer) => b.toString("base64");
const dataUrl = (mime: string, b: Buffer) => `data:${mime};base64,${b64(b)}`;

beforeEach(() => {
  writes.length = 0;
  setVirusScanner(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  setVirusScanner(undefined);
});

describe("R05-06 magic-byte sniffing", () => {
  it("R05-06 recognises JPEG, PNG, GIF, WebP and PDF from bytes", () => {
    expect(sniffFileType(jpegWithExif())?.mime).toBe("image/jpeg");
    expect(sniffFileType(pngBytes())?.mime).toBe("image/png");
    expect(sniffFileType(gifBytes())?.mime).toBe("image/gif");
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]);
    expect(sniffFileType(webp)?.mime).toBe("image/webp");
    expect(sniffFileType(Buffer.from("%PDF-1.7\n..."))?.mime).toBe("application/pdf");
    expect(sniffFileType(Buffer.from("<html><script>alert(1)</script>"))).toBeNull();
  });

  it("R05-06 / R17-11 HTML bytes labelled PNG are rejected with UNSUPPORTED_FILE", async () => {
    const html = Buffer.from("<html><script>alert(1)</script></html>");
    await expect(inspectUpload(dataUrl("image/png", html))).rejects.toMatchObject({
      status: 400,
      code: "UNSUPPORTED_FILE",
    });
  });

  it("R05-06 a real PNG labelled as JPEG is rejected (declared type must match content)", async () => {
    await expect(inspectUpload(dataUrl("image/jpeg", pngBytes()))).rejects.toMatchObject({
      status: 400,
      code: "UNSUPPORTED_FILE",
    });
  });

  it("R05-06 GIF content is stored with a .gif extension and served as image/gif", async () => {
    const inspected = await inspectUpload(dataUrl("image/gif", gifBytes()));
    expect(inspected.mime).toBe("image/gif");
    expect(inspected.ext).toBe("gif");
    const key = await saveReceiptFile(inspected.buffer, {
      mime: inspected.mime,
      ext: inspected.ext,
    });
    expect(key).toMatch(/^receipts\/[0-9a-f-]+\.gif$/);
    const served = await readReceiptImage(key);
    expect(served?.contentType).toBe("image/gif");
  });

  it("R05-06 saveReceiptImage ignores the caller's .jpg filename and uses the sniffed type", async () => {
    const key = await saveReceiptImage(dataUrl("image/png", pngBytes()), "abc.jpg");
    expect(key).toBe("receipts/abc.png");
    await expect(
      saveReceiptImage(b64(Buffer.from("not an image")), "x.jpg")
    ).rejects.toBeInstanceOf(UploadRejectedError);
  });
});

describe("R05-07 size and dimension caps", () => {
  it("R05-07 oversize files are rejected with 413 FILE_TOO_LARGE", async () => {
    const big = Buffer.concat([pngBytes(), Buffer.alloc(MAX_UPLOAD_BYTES + 10)]);
    await expect(inspectUpload(dataUrl("image/png", big))).rejects.toMatchObject({
      status: 413,
      code: "FILE_TOO_LARGE",
    });
  });

  it("R05-07 images over the pixel-dimension cap are rejected with IMAGE_TOO_LARGE", async () => {
    await expect(inspectUpload(dataUrl("image/png", pngBytes(30000, 30000)))).rejects.toMatchObject(
      {
        status: 413,
        code: "IMAGE_TOO_LARGE",
      }
    );
  });

  it("R05-07 reads dimensions from PNG, GIF and JPEG headers", () => {
    expect(readImageDimensions(pngBytes(640, 480), "image/png")).toEqual({
      width: 640,
      height: 480,
    });
    expect(readImageDimensions(gifBytes(), "image/gif")).toEqual({ width: 3, height: 2 });
    expect(readImageDimensions(jpegWithExif(), "image/jpeg")).toEqual({ width: 32, height: 16 });
  });
});

describe("R05-08 PDF on the server route path", () => {
  it("R05-08 accepts PDFs and reports application/pdf with a .pdf extension", async () => {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");
    const inspected = await inspectUpload(dataUrl("application/pdf", pdf));
    expect(inspected.mime).toBe("application/pdf");
    expect(inspected.ext).toBe("pdf");
    expect(inspected.width).toBeNull();
  });
});

describe("R05-20 EXIF strip, hash, antivirus hook, quota", () => {
  it("R05-20 removes EXIF/GPS but keeps orientation so photos are not rotated", async () => {
    const original = jpegWithExif(6);
    expect(original.includes(Buffer.from("GPSLatitude"))).toBe(true);
    const inspected = await inspectUpload(dataUrl("image/jpeg", original));
    expect(inspected.buffer.includes(Buffer.from("GPSLatitude"))).toBe(false);
    // minimal orientation-only EXIF is retained
    expect(inspected.buffer.includes(Buffer.from("Exif\0\0", "latin1"))).toBe(true);
    const o = stripImageMetadata(original, "image/jpeg");
    expect(o.length).toBeLessThan(original.length);
  });

  it("R05-20 strips PNG text/EXIF chunks", () => {
    const chunk = (type: string, data: Buffer) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      return Buffer.concat([len, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
    };
    const withText = pngBytes(4, 4, [chunk("tEXt", Buffer.from("Author\0Alice"))]);
    expect(withText.includes(Buffer.from("Alice"))).toBe(true);
    expect(stripImageMetadata(withText, "image/png").includes(Buffer.from("Alice"))).toBe(false);
  });

  it("R05-18 records the sha256 of the stored content", async () => {
    const inspected = await inspectUpload(dataUrl("image/png", pngBytes()));
    expect(inspected.sha256).toBe(createHash("sha256").update(inspected.buffer).digest("hex"));
    const again = await inspectUpload(dataUrl("image/png", pngBytes()));
    expect(again.sha256).toBe(inspected.sha256);
  });

  it("R05-20 antivirus status is requires_external unless a scanner is configured", async () => {
    expect(getUploadScanStatus({})).toBe("requires_external");
    expect(getUploadScanStatus({ CLAMAV_HOST: "clam.internal" })).toBe("enabled");
    const inspected = await inspectUpload(dataUrl("image/png", pngBytes()));
    expect(inspected.scan).toBe("requires_external");
  });

  it("R05-20 an infected file is rejected with 422 MALWARE_DETECTED", async () => {
    setVirusScanner({ scan: async () => ({ clean: false, signature: "Eicar-Test" }) });
    await expect(inspectUpload(dataUrl("image/png", pngBytes()))).rejects.toMatchObject({
      status: 422,
      code: "MALWARE_DETECTED",
    });
  });

  it("R05-20 a clean scan marks the upload clean; a failing scanner fails closed with 503", async () => {
    setVirusScanner({ scan: async () => ({ clean: true }) });
    expect((await inspectUpload(dataUrl("image/png", pngBytes()))).scan).toBe("clean");
    setVirusScanner({
      scan: async () => {
        throw new Error("connection refused");
      },
    });
    await expect(inspectUpload(dataUrl("image/png", pngBytes()))).rejects.toMatchObject({
      status: 503,
      code: "SCAN_UNAVAILABLE",
    });
  });

  it("R05-20 ClamAV adapter is constructed from host/port", () => {
    expect(new ClamAvScanner("clam.internal", 3310)).toBeInstanceOf(ClamAvScanner);
  });

  it("R05-20 per-company storage quota rejects uploads past the limit", async () => {
    vi.stubEnv("COMPANY_STORAGE_QUOTA_MB", "1");
    await expect(
      assertWithinStorageQuota("co-1", 600_000, async () => 600_000)
    ).rejects.toMatchObject({ status: 413, code: "STORAGE_QUOTA_EXCEEDED" });
    await expect(assertWithinStorageQuota("co-1", 1000, async () => 1000)).resolves.toBeUndefined();
  });
});

describe("R05-07 production storage guard", () => {
  const prod = { NODE_ENV: "production" } as Record<string, string | undefined>;

  it("R05-07 refuses to boot on local-disk storage in production", () => {
    expect(() => assertStorageBootSafe(prod, "/app/uploads")).toThrow(/ALLOW_LOCAL_STORAGE/);
  });

  it("R05-07 boots with ALLOW_LOCAL_STORAGE=true, and in non-production", () => {
    expect(() => assertStorageBootSafe({ ...prod, ALLOW_LOCAL_STORAGE: "true" })).not.toThrow();
    expect(() => assertStorageBootSafe({ NODE_ENV: "development" })).not.toThrow();
  });
});
