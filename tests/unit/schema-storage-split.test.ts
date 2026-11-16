/**
 * R20-09: shared/schema.ts and server/storage.ts are split into per-domain modules.
 *
 * - shared/schema.ts stays the drizzle-kit entry point (drizzle.config.ts) and the
 *   "@shared/schema" import, so it must re-export every domain module and nothing else
 *   may define tables there; the internal column helpers stay private.
 * - server/storage.ts composes DatabaseStorage from domain classes chained with
 *   `extends`; a method defined in two domain classes would silently shadow the other,
 *   so names must be unique along the chain.
 * - No module in either split may grow past 1,500 lines.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
  pool: { query: vi.fn() },
  rowsFromResult: vi.fn(() => []),
}));

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const lineCount = (p: string) => read(p).split("\n").length;
const tsFiles = (dir: string) =>
  readdirSync(join(root, dir))
    .filter((f) => f.endsWith(".ts"))
    .sort();

const MAX_LINES = 1500;

describe("R20-09 shared/schema.ts split", () => {
  const modules = tsFiles("shared/schema").map((f) => f.replace(/\.ts$/, ""));

  it("the barrel only re-exports every domain module (columns stays internal)", () => {
    const barrel = read("shared/schema.ts");
    const code = barrel.split("\n").filter((l) => l.trim() && !l.trim().startsWith("//"));
    expect(code.every((l) => /^export \* from "\.\/schema\/[a-z-]+";$/.test(l))).toBe(true);
    const reexported = code.map((l) => l.match(/schema\/([a-z-]+)/)![1]).sort();
    expect(reexported).toEqual(modules.filter((m) => m !== "columns"));
    expect(modules.length).toBeGreaterThan(20);
  });

  it("every export of every domain module is visible through the barrel", async () => {
    const barrel = (await import("../../shared/schema")) as Record<string, unknown>;
    let tables = 0;
    for (const m of modules.filter((x) => x !== "columns")) {
      const mod = (await import(`../../shared/schema/${m}.ts`)) as Record<string, unknown>;
      for (const [name, value] of Object.entries(mod)) {
        expect(barrel[name], `${m}.${name}`).toBe(value);
        if (value && typeof value === "object" && Symbol.for("drizzle:IsDrizzleTable") in value)
          tables++;
      }
    }
    expect(tables).toBeGreaterThan(150);
    // private column helpers are not part of the public schema surface
    for (const helper of ["money", "rate", "vatRateType", "ledgerDate"]) {
      expect(barrel[helper]).toBeUndefined();
    }
  });

  it("keeps every schema module under the size limit", () => {
    for (const m of modules) expect(lineCount(`shared/schema/${m}.ts`), m).toBeLessThan(MAX_LINES);
  });
});

describe("R20-09 server/storage.ts split", () => {
  it("composes DatabaseStorage from uniquely named domain methods", async () => {
    const { storage, DatabaseStorage } = await import("../../server/storage");
    expect(storage).toBeInstanceOf(DatabaseStorage);
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    let proto = Object.getPrototypeOf(storage);
    const chain: string[] = [];
    while (proto && proto !== Object.prototype) {
      chain.push(proto.constructor.name);
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === "constructor") continue;
        if (seen.has(name))
          duplicates.push(`${name} (${seen.get(name)} / ${proto.constructor.name})`);
        seen.set(name, proto.constructor.name);
        // class methods stay non-enumerable, as on the original single class
        expect(Object.getOwnPropertyDescriptor(proto, name)!.enumerable).toBe(false);
      }
      proto = Object.getPrototypeOf(proto);
    }
    expect(duplicates).toEqual([]);
    expect(chain[0]).toBe("DatabaseStorage");
    expect(chain.length).toBeGreaterThan(10);
    expect(seen.size).toBeGreaterThanOrEqual(418);
    for (const method of [
      "getUser",
      "getCompany",
      "createJournalEntry",
      "recordInvoicePayment",
      "postReceiptAtomic",
      "getReportDeliveryRuns",
      "getBankConnection",
      "upsertChaseConfig",
    ]) {
      expect(typeof (storage as unknown as Record<string, unknown>)[method], method).toBe(
        "function"
      );
    }
  });

  it("keeps the barrel thin and every storage module under the size limit", () => {
    expect(lineCount("server/storage.ts")).toBeLessThan(100);
    const parts = tsFiles("server/storage");
    expect(parts.length).toBeGreaterThan(10);
    for (const f of parts) expect(lineCount(`server/storage/${f}`), f).toBeLessThan(MAX_LINES);
  });
});
