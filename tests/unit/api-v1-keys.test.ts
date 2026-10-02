import { describe, it, expect } from "vitest";
import {
  generateApiKey,
  parseApiKey,
  keyMatches,
  hashApiKey,
  parseScopes,
  serializeScopes,
  isKnownScope,
  ALL_SCOPES,
} from "../../server/api-v1/keys";
import { decodeCursor, encodeCursor, pageFromRows, parseLimit } from "../../server/api-v1/cursor";

describe("api key format", () => {
  it("is muh_<8>_<32> and hashes with SHA-256", () => {
    const { key, prefix, hash } = generateApiKey();
    expect(key).toMatch(/^muh_[a-z0-9]{8}_[a-z0-9]{32}$/);
    expect(prefix).toHaveLength(8);
    expect(key.startsWith(`muh_${prefix}_`)).toBe(true);
    expect(hash).toBe(hashApiKey(key));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("parses only well-formed keys", () => {
    const { key, prefix } = generateApiKey();
    expect(parseApiKey(key)).toEqual({ prefix });
    for (const bad of ["", "muh_short_x", key + "x", key.toUpperCase(), "Bearer " + key, undefined, null]) {
      expect(parseApiKey(bad as any)).toBeNull();
    }
  });
  it("matches in constant time against the stored hash", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(keyMatches(a.key, a.hash)).toBe(true);
    expect(keyMatches(b.key, a.hash)).toBe(false);
    expect(keyMatches(a.key, "zz")).toBe(false);
  });
  it("makes unique keys", () => {
    expect(new Set(Array.from({ length: 50 }, () => generateApiKey().key)).size).toBe(50);
  });
});

describe("scopes", () => {
  it("round-trips through the text column and de-duplicates", () => {
    expect(parseScopes(serializeScopes(["read:invoices", "read:invoices", "write:bills"]))).toEqual([
      "read:invoices",
      "write:bills",
    ]);
    expect(parseScopes(null)).toEqual([]);
    expect(parseScopes("read")).toEqual(["read"]);
  });
  it("knows exactly read/write x six resources plus read:reports", () => {
    expect(ALL_SCOPES).toHaveLength(13);
    expect(isKnownScope("read:reports")).toBe(true);
    expect(isKnownScope("write:reports")).toBe(false);
    expect(isKnownScope("webhooks:manage")).toBe(false);
  });
});

describe("cursor pagination", () => {
  it("round-trips and rejects junk", () => {
    const c = { t: "2026-10-02T10:00:00.000Z", id: "3f8f4c6e-0000-4000-8000-000000000001" };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor(Buffer.from('{"t":"x","id":"y"}').toString("base64url"))).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });
  it("validates limit 1..200", () => {
    expect(parseLimit(undefined)).toBe(50);
    expect(parseLimit("200")).toBe(200);
    expect(parseLimit("201")).toBeNull();
    expect(parseLimit("0")).toBeNull();
    expect(parseLimit("abc")).toBeNull();
    expect(parseLimit("1.5")).toBeNull();
  });
  it("pages limit+1 rows", () => {
    const rows = [1, 2, 3].map((i) => ({ id: `3f8f4c6e-0000-4000-8000-00000000000${i}`, ts: `2026-01-0${i}T00:00:00.000000` }));
    const first = pageFromRows(rows, 2);
    expect(first.rows).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    expect(pageFromRows(rows.slice(0, 2), 2).nextCursor).toBeNull();
  });
});
