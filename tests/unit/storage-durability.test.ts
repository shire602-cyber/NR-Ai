import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { assessStorageDurability } from "../../server/services/fileStorage";

const KEYS = [
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "BLOB_READ_WRITE_TOKEN",
  "RAILWAY_VOLUME_MOUNT_PATH",
  "UPLOADS_PERSISTENT",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("assessStorageDurability - local disk", () => {
  it("is durable when the uploads dir IS the Railway volume mount", () => {
    process.env.RAILWAY_VOLUME_MOUNT_PATH = "/app/uploads";
    const result = assessStorageDurability("/app/uploads");

    expect(result.backend).toBe("local-disk");
    expect(result.durable).toBe(true);
  });

  it("is durable for an uploads subdir under the volume mount", () => {
    process.env.RAILWAY_VOLUME_MOUNT_PATH = "/data";

    expect(assessStorageDurability("/data/uploads").durable).toBe(true);
  });

  it("is NOT durable when the uploads dir is outside the volume mount", () => {
    process.env.RAILWAY_VOLUME_MOUNT_PATH = "/data";

    expect(assessStorageDurability("/app/uploads").durable).toBe(false);
  });

  it("is NOT durable with no volume and no persistence flag", () => {
    expect(assessStorageDurability("/app/uploads").durable).toBe(false);
  });

  it("respects the UPLOADS_PERSISTENT escape hatch for non-Railway mounts", () => {
    process.env.UPLOADS_PERSISTENT = "true";

    expect(assessStorageDurability("/srv/data/uploads").durable).toBe(true);
  });

  it("does not mistake a same-prefix sibling path for being on the volume", () => {
    process.env.RAILWAY_VOLUME_MOUNT_PATH = "/app/up";

    expect(assessStorageDurability("/app/uploads").durable).toBe(false);
  });
});
