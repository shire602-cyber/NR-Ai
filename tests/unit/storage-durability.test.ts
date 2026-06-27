import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { assessStorageDurability } from "../../server/services/fileStorage";

// These env vars steer the backend + volume detection. Save/restore so the
// suite never leaks state into other tests.
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
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("assessStorageDurability — local disk", () => {
  it("is durable when the uploads dir IS the Railway volume mount", () => {
    process.env.RAILWAY_VOLUME_MOUNT_PATH = "/app/uploads";
    const r = assessStorageDurability("/app/uploads");
    expect(r.backend).toBe("local-disk");
    expect(r.durable).toBe(true);
  });

  it("is durable for an uploads subdir under the volume mount", () => {
    process.env.RAILWAY_VOLUME_MOUNT_PATH = "/data";
    expect(assessStorageDurability("/data/uploads").durable).toBe(true);
  });

  it("is NOT durable when the uploads dir is outside the volume mount", () => {
    process.env.RAILWAY_VOLUME_MOUNT_PATH = "/data";
    expect(assessStorageDurability("/app/uploads").durable).toBe(false);
  });

  it("is NOT durable with no volume and no persistence flag (ephemeral)", () => {
    expect(assessStorageDurability("/app/uploads").durable).toBe(false);
  });

  it("respects the UPLOADS_PERSISTENT escape hatch for non-Railway mounts", () => {
    process.env.UPLOADS_PERSISTENT = "true";
    expect(assessStorageDurability("/srv/data/uploads").durable).toBe(true);
  });

  it("does not mistake a same-prefix sibling path for being on the volume", () => {
    // "/app/uploads" must NOT count as under "/app/up".
    process.env.RAILWAY_VOLUME_MOUNT_PATH = "/app/up";
    expect(assessStorageDurability("/app/uploads").durable).toBe(false);
  });
});
