import { describe, it, expect } from "vitest";
import { runExclusive } from "../../server/services/document-queue";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("runExclusive", () => {
  it("runs callers for the same key one at a time, in order", async () => {
    let active = 0;
    let maxActive = 0;
    const order: number[] = [];
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        runExclusive("doc-1", async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          await sleep(3);
          order.push(i);
          active--;
        })
      )
    );
    expect(maxActive).toBe(1);
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("does not serialise different keys", async () => {
    let active = 0;
    let maxActive = 0;
    await Promise.all(
      ["a", "b", "c"].map((k) =>
        runExclusive(k, async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          await sleep(5);
          active--;
        })
      )
    );
    expect(maxActive).toBe(3);
  });

  it("a failing caller does not block the next one and its error propagates", async () => {
    const first = runExclusive("doc-2", async () => {
      throw new Error("boom");
    });
    const second = runExclusive("doc-2", async () => "ok");
    await expect(first).rejects.toThrow("boom");
    await expect(second).resolves.toBe("ok");
  });

  it("returns the callback's value and frees the key afterwards", async () => {
    expect(await runExclusive("doc-3", async () => 42)).toBe(42);
    expect(await runExclusive("doc-3", async () => 43)).toBe(43);
  });
});
