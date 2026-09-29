import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const blob = vi.hoisted(() => ({ put: vi.fn(), list: vi.fn(), del: vi.fn() }));
vi.mock("@vercel/blob", () => blob);

import {
  assertStorageWritable,
  assessStorageDurability,
  saveDocument,
  readDocument,
  deleteDocument,
} from "../../server/services/fileStorage";

const CO = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";
const PDF = Buffer.from("%PDF-1.4\nhello\n%%EOF\n");

let tmp: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "muhasib-docs-"));
  vi.spyOn(process, "cwd").mockReturnValue(tmp);
  for (const k of [
    "BLOB_READ_WRITE_TOKEN",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "UPLOADS_PERSISTENT",
    "RAILWAY_VOLUME_MOUNT_PATH",
    "STORAGE_ALLOW_EPHEMERAL",
  ]) {
    delete process.env[k];
  }
  process.env.NODE_ENV = "development";
  Object.values(blob).forEach((f) => f.mockReset());
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...savedEnv };
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("assertStorageWritable (production safety)", () => {
  it("refuses with 503 STORAGE_NOT_DURABLE in production on an ephemeral disk", () => {
    process.env.NODE_ENV = "production";
    try {
      assertStorageWritable();
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(503);
      expect(err.code).toBe("STORAGE_NOT_DURABLE");
    }
  });

  it("allows production when a persistent volume is declared", () => {
    process.env.NODE_ENV = "production";
    process.env.UPLOADS_PERSISTENT = "true";
    expect(() => assertStorageWritable()).not.toThrow();
  });

  it("allows production when object storage is configured", () => {
    process.env.NODE_ENV = "production";
    process.env.S3_BUCKET = "b";
    process.env.S3_ACCESS_KEY_ID = "k";
    process.env.S3_SECRET_ACCESS_KEY = "s";
    expect(assessStorageDurability(path.join(tmp, "uploads")).durable).toBe(true);
    expect(() => assertStorageWritable()).not.toThrow();
  });

  it("allows an explicit STORAGE_ALLOW_EPHEMERAL opt-in in production", () => {
    process.env.NODE_ENV = "production";
    process.env.STORAGE_ALLOW_EPHEMERAL = "true";
    expect(() => assertStorageWritable()).not.toThrow();
  });

  it("allows local disk in development", () => {
    expect(() => assertStorageWritable()).not.toThrow();
  });

  it("blocks saveDocument in production before anything is written", async () => {
    process.env.NODE_ENV = "production";
    await expect(
      saveDocument({ companyId: CO, category: "documents", filename: "a.pdf", contentType: "application/pdf", buffer: PDF })
    ).rejects.toMatchObject({ code: "STORAGE_NOT_DURABLE" });
    expect(fs.existsSync(path.join(tmp, "uploads"))).toBe(false);
  });
});

describe("saveDocument / readDocument / deleteDocument on local disk", () => {
  it("round-trips bytes and returns a company-namespaced key, not a URL", async () => {
    const saved = await saveDocument({
      companyId: CO,
      category: "documents",
      filename: "../evil name.pdf",
      contentType: "application/pdf",
      buffer: PDF,
    });
    expect(saved.key.startsWith(`${CO}/documents/`)).toBe(true);
    expect(saved.key).not.toMatch(/^https?:/);
    expect(saved.key).not.toContain("..");
    expect(saved.sizeBytes).toBe(PDF.length);

    const read = await readDocument(saved.key);
    expect(read?.buffer.equals(PDF)).toBe(true);
    expect(read?.contentType).toBe("application/pdf");

    await deleteDocument(saved.key);
    expect(await readDocument(saved.key)).toBeNull();
  });

  it("accepts base64 input as well as a buffer", async () => {
    const saved = await saveDocument({
      companyId: CO,
      category: "vat-evidence",
      filename: "a.pdf",
      contentType: "application/pdf",
      base64: PDF.toString("base64"),
    });
    expect((await readDocument(saved.key))?.buffer.equals(PDF)).toBe(true);
  });

  it("refuses to read keys that are not well-formed namespaced keys", async () => {
    for (const bad of [
      "../../etc/passwd",
      `${CO}/documents/../../../secret`,
      "/uploads/placeholder.pdf",
      "receipts/abc.jpg",
      "https://internal.example/a.pdf",
    ]) {
      expect(await readDocument(bad)).toBeNull();
    }
  });

  it("delete of a malformed key is a silent no-op and never touches other files", async () => {
    const saved = await saveDocument({
      companyId: OTHER,
      category: "documents",
      filename: "keep.pdf",
      contentType: "application/pdf",
      buffer: PDF,
    });
    await deleteDocument("../uploads/" + saved.key);
    expect(await readDocument(saved.key)).not.toBeNull();
  });
});

describe("Vercel Blob backend", () => {
  beforeEach(() => {
    process.env.BLOB_READ_WRITE_TOKEN = "tok";
  });

  it("stores under the namespaced pathname and never returns the blob URL", async () => {
    blob.put.mockResolvedValue({ url: "https://abc123.public.blob.vercel-storage.com/x" });
    const saved = await saveDocument({
      companyId: CO,
      category: "documents",
      filename: "a.pdf",
      contentType: "application/pdf",
      buffer: PDF,
    });
    expect(saved.key.startsWith(`${CO}/documents/`)).toBe(true);
    expect(blob.put.mock.calls[0][0]).toBe(saved.key);
    expect(JSON.stringify(saved)).not.toContain("blob.vercel-storage.com");
  });

  it("fetches server-side from the allow-listed blob domain only (SSRF guard)", async () => {
    const key = `${CO}/documents/u-a.pdf`;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    blob.list.mockResolvedValue({ blobs: [{ pathname: key, url: "https://169.254.169.254/latest/meta-data" }] });
    expect(await readDocument(key)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    blob.list.mockResolvedValue({
      blobs: [{ pathname: key, url: "https://abc123.public.blob.vercel-storage.com/k" }],
    });
    fetchSpy.mockResolvedValue(new Response(PDF, { status: 200, headers: { "content-type": "application/pdf" } }));
    const read = await readDocument(key);
    expect(read?.buffer.equals(PDF)).toBe(true);
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ redirect: "error" });
  });
});
