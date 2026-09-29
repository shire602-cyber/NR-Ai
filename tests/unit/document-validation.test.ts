import { describe, it, expect } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  buildStorageKey,
  decodeBase64Payload,
  keyBelongsToCompany,
  parseStorageKey,
  sanitizeFilename,
  sniffContentType,
  validateUpload,
} from "../../server/services/document-validation";

const CO = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(8)]);
const HEIC = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypheic"), Buffer.alloc(8)]);
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(30)]);
const CSV = Buffer.from("date,amount\n2026-01-01,10.50\n");
const b64 = (b: Buffer) => b.toString("base64");

describe("sniffContentType", () => {
  it("recognises the magic bytes of each supported binary format", () => {
    expect(sniffContentType(PDF)).toBe("application/pdf");
    expect(sniffContentType(PNG)).toBe("image/png");
    expect(sniffContentType(JPEG)).toBe("image/jpeg");
    expect(sniffContentType(WEBP)).toBe("image/webp");
    expect(sniffContentType(HEIC)).toBe("image/heic");
    expect(sniffContentType(ZIP)).toBe("application/zip");
  });
  it("returns null for unknown binary and text content", () => {
    expect(sniffContentType(Buffer.from([1, 2, 3, 4, 5]))).toBeNull();
    expect(sniffContentType(CSV)).toBeNull();
  });
});

describe("validateUpload", () => {
  it("accepts a real PDF and normalises the filename", () => {
    const r = validateUpload({ filename: "Q1 report.pdf", contentType: "application/pdf", base64: b64(PDF) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.contentType).toBe("application/pdf");
      expect(r.buffer.equals(PDF)).toBe(true);
      expect(r.filename).toBe("Q1 report.pdf");
    }
  });

  it("accepts a data URL and strips the prefix", () => {
    const r = validateUpload({
      filename: "a.png",
      contentType: "image/png",
      base64: `data:image/png;base64,${b64(PNG)}`,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a file whose bytes do not match its claimed type (fake PDF)", () => {
    const r = validateUpload({
      filename: "invoice.pdf",
      contentType: "application/pdf",
      base64: b64(Buffer.from("<html><script>alert(1)</script></html>")),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.code).toBe("FILE_CONTENT_MISMATCH");
    }
  });

  it("rejects a PNG uploaded as a PDF", () => {
    const r = validateUpload({ filename: "x.pdf", contentType: "application/pdf", base64: b64(PNG) });
    expect(r.ok).toBe(false);
  });

  it("rejects disallowed content types (svg, html, executables)", () => {
    for (const ct of ["image/svg+xml", "text/html", "application/x-msdownload", "application/javascript"]) {
      const r = validateUpload({ filename: "x.bin", contentType: ct, base64: b64(Buffer.from("hello")) });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("FILE_TYPE_NOT_ALLOWED");
    }
  });

  it("accepts xlsx/docx zip containers and csv text, rejects zip claimed as csv", () => {
    const xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(validateUpload({ filename: "a.xlsx", contentType: xlsx, base64: b64(ZIP) }).ok).toBe(true);
    expect(validateUpload({ filename: "a.docx", contentType: docx, base64: b64(ZIP) }).ok).toBe(true);
    expect(validateUpload({ filename: "a.csv", contentType: "text/csv", base64: b64(CSV) }).ok).toBe(true);
    expect(validateUpload({ filename: "a.csv", contentType: "text/csv", base64: b64(ZIP) }).ok).toBe(false);
    expect(validateUpload({ filename: "a.xlsx", contentType: xlsx, base64: b64(PDF) }).ok).toBe(false);
  });

  it("accepts heic and webp and jpeg (jpg alias)", () => {
    expect(validateUpload({ filename: "a.heic", contentType: "image/heic", base64: b64(HEIC) }).ok).toBe(true);
    expect(validateUpload({ filename: "a.webp", contentType: "image/webp", base64: b64(WEBP) }).ok).toBe(true);
    const r = validateUpload({ filename: "a.jpg", contentType: "image/jpg", base64: b64(JPEG) });
    expect(r.ok && r.contentType).toBe("image/jpeg");
  });

  it("infers the type from the bytes when the client sends octet-stream or nothing", () => {
    const r = validateUpload({ filename: "scan", contentType: "application/octet-stream", base64: b64(PDF) });
    expect(r.ok && r.contentType).toBe("application/pdf");
    const r2 = validateUpload({ filename: "scan", contentType: undefined, base64: b64(PNG) });
    expect(r2.ok && r2.contentType).toBe("image/png");
  });

  it("rejects text files containing binary NUL bytes", () => {
    const r = validateUpload({ filename: "a.csv", contentType: "text/csv", base64: b64(Buffer.from([65, 0, 66, 0])) });
    expect(r.ok).toBe(false);
  });

  it("rejects empty and non-base64 payloads", () => {
    expect(validateUpload({ filename: "a.pdf", contentType: "application/pdf", base64: "" }).ok).toBe(false);
    const r = validateUpload({ filename: "a.pdf", contentType: "application/pdf", base64: "not base64 !!!" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FILE_INVALID_ENCODING");
  });

  it("rejects files over the size cap with 413", () => {
    const big = Buffer.concat([PDF, Buffer.alloc(MAX_UPLOAD_BYTES)]);
    const r = validateUpload({ filename: "a.pdf", contentType: "application/pdf", base64: b64(big) });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(413);
      expect(r.code).toBe("FILE_TOO_LARGE");
    }
  });

  it("accepts a file exactly at the cap", () => {
    const exact = Buffer.concat([PDF, Buffer.alloc(MAX_UPLOAD_BYTES - PDF.length)]);
    expect(exact.length).toBe(MAX_UPLOAD_BYTES);
    expect(validateUpload({ filename: "a.pdf", contentType: "application/pdf", base64: b64(exact) }).ok).toBe(true);
  });
});

describe("decodeBase64Payload", () => {
  it("tolerates whitespace and line breaks in the payload", () => {
    const wrapped = b64(PDF).replace(/(.{20})/g, "$1\n");
    expect(decodeBase64Payload(wrapped)?.equals(PDF)).toBe(true);
  });
});

describe("sanitizeFilename", () => {
  it("removes path separators and traversal", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\me\\a.pdf")).toBe("a.pdf");
    expect(sanitizeFilename("a/b/c.pdf")).toBe("c.pdf");
  });
  it("removes control characters and null bytes", () => {
    expect(sanitizeFilename("a\u0000b\u001f\u007fc.pdf")).toBe("abc.pdf");
  });
  it("strips leading dots and caps the length while keeping the extension", () => {
    expect(sanitizeFilename(".htaccess")).toBe("htaccess");
    const long = "x".repeat(400) + ".pdf";
    const out = sanitizeFilename(long);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith(".pdf")).toBe(true);
  });
  it("keeps Arabic letters and falls back to a default for empty names", () => {
    expect(sanitizeFilename("فاتورة 2026.pdf")).toBe("فاتورة 2026.pdf");
    expect(sanitizeFilename("///")).toBe("file");
    expect(sanitizeFilename("")).toBe("file");
  });
  it("replaces shell and URL-hostile characters", () => {
    expect(sanitizeFilename('a<b>"c|d?e*.pdf')).toBe("a_b__c_d_e_.pdf");
  });
});

describe("storage keys", () => {
  it("namespaces keys by company/category/uuid-filename", () => {
    const key = buildStorageKey({
      companyId: CO,
      category: "documents",
      filename: "My File.pdf",
      id: "abcd1234-0000-4000-8000-000000000000",
    });
    expect(key).toBe(`${CO}/documents/abcd1234-0000-4000-8000-000000000000-My File.pdf`);
  });

  it("generates a unique id by default", () => {
    const a = buildStorageKey({ companyId: CO, category: "documents", filename: "a.pdf" });
    const b = buildStorageKey({ companyId: CO, category: "documents", filename: "a.pdf" });
    expect(a).not.toBe(b);
  });

  it("refuses a company id or category that could escape the namespace", () => {
    expect(() => buildStorageKey({ companyId: "../x", category: "documents", filename: "a" })).toThrow();
    expect(() => buildStorageKey({ companyId: CO, category: "../../etc", filename: "a" })).toThrow();
    expect(() => buildStorageKey({ companyId: CO, category: "a/b", filename: "a" })).toThrow();
  });

  it("parses valid keys and rejects traversal / foreign shapes", () => {
    const key = buildStorageKey({ companyId: CO, category: "vat-evidence", filename: "a.pdf" });
    expect(parseStorageKey(key)).toMatchObject({ companyId: CO, category: "vat-evidence" });
    expect(parseStorageKey(`${CO}/documents/../../x`)).toBeNull();
    expect(parseStorageKey(`/${CO}/documents/a.pdf`)).toBeNull();
    expect(parseStorageKey("receipts/abc.jpg")).toBeNull();
    expect(parseStorageKey("/uploads/placeholder.pdf")).toBeNull();
    expect(parseStorageKey("https://evil.example/a.pdf")).toBeNull();
  });

  it("checks company ownership of a key", () => {
    const key = buildStorageKey({ companyId: CO, category: "documents", filename: "a.pdf" });
    expect(keyBelongsToCompany(key, CO)).toBe(true);
    expect(keyBelongsToCompany(key, OTHER)).toBe(false);
    expect(keyBelongsToCompany("garbage", CO)).toBe(false);
  });
});
