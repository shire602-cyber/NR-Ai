/**
 * S5 generalised file storage (W5-A residual): one object store for receipts and report
 * delivery artifacts, prefix-guarded, with a pluggable adapter standing in for S3 in tests.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __setObjectStoreForTests,
  deleteObject,
  getObject,
  hasDurableObjectStore,
  putObject,
  readReceiptImage,
  saveReceiptFile,
  type ObjectStoreAdapter,
} from "../../server/services/fileStorage";

const PDF = Buffer.from("%PDF-1.4\n% test\n");

function memoryBucket() {
  const bucket = new Map<string, { buffer: Buffer; contentType: string }>();
  const adapter: ObjectStoreAdapter = {
    put: async (key, buffer, contentType) => {
      bucket.set(key, { buffer, contentType });
      return key;
    },
    get: async (key) => bucket.get(key) ?? null,
    del: async (key) => {
      bucket.delete(key);
    },
  };
  return { bucket, adapter };
}

afterEach(() => {
  __setObjectStoreForTests(null);
  vi.unstubAllEnvs();
});

describe("S5 object store", () => {
  it("is durable only with object storage (or the test adapter) configured", () => {
    expect(hasDurableObjectStore()).toBe(false);
    __setObjectStoreForTests(memoryBucket().adapter);
    expect(hasDurableObjectStore()).toBe(true);
  });

  it("requires object storage for Vercel uploads", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", undefined);
    vi.stubEnv("S3_BUCKET", undefined);
    await expect(putObject("receipts", "vercel.pdf", PDF, "application/pdf")).rejects.toThrow(
      "Private object storage is required"
    );
  });

  it("writes under the prefix with a sanitised name and reads back with the sniffed type", async () => {
    const { bucket, adapter } = memoryBucket();
    __setObjectStoreForTests(adapter);
    const key = await putObject("report-artifacts", "co/run/pack 1.pdf", PDF, "application/pdf");
    expect(key).toBe("report-artifacts/co_run_pack_1.pdf");
    expect(bucket.has(key)).toBe(true);
    const got = await getObject(key);
    expect(got?.buffer.equals(PDF)).toBe(true);
    expect(got?.contentType).toBe("application/pdf");
    expect(await getObject("report-artifacts/missing.pdf")).toBeNull();
    await deleteObject(key);
    expect(bucket.has(key)).toBe(false);
  });

  it("refuses unknown prefixes and keys that escape them; receipts reads stay receipts-only", async () => {
    __setObjectStoreForTests(memoryBucket().adapter);
    await expect(putObject("secrets" as never, "x", PDF, "application/pdf")).rejects.toThrow(
      /Unknown object prefix/
    );
    await expect(getObject("../etc/passwd")).rejects.toThrow(/Invalid/);
    await expect(getObject("report-artifacts/../../x")).rejects.toThrow(/Invalid/);
    const art = await putObject("report-artifacts", "a.pdf", PDF, "application/pdf");
    await expect(readReceiptImage(art)).rejects.toThrow(/Invalid/);
    await deleteObject("../nope"); // ignored, never throws
    const receipt = await saveReceiptFile(PDF, { mime: "application/pdf", id: "r1" });
    expect(receipt).toBe("receipts/r1.pdf");
    expect((await readReceiptImage(receipt))?.buffer.equals(PDF)).toBe(true);
  });
});
