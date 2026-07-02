/**
 * Stale-chunk recovery logic (client/src/lib/lazyWithReload.tsx).
 *
 * After a deploy, dynamic-import of a now-deleted chunk throws "Failed to fetch
 * dynamically imported module". This must: succeed on a transient retry;
 * hard-reload exactly once for a persistent chunk error; never reload for
 * unrelated errors; and never loop.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isChunkLoadError,
  loadWithChunkRetry,
  clearChunkReloadGuards,
} from "../../client/src/lib/lazyWithReload";

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    removeItem: (k: string) => m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, v),
  } as Storage;
}

const CHUNK_ERR = new Error(
  "Failed to fetch dynamically imported module: https://x/assets/Dashboard-abc.js"
);

describe("isChunkLoadError", () => {
  it("detects the known dynamic-import failure messages", () => {
    expect(isChunkLoadError(CHUNK_ERR)).toBe(true);
    expect(isChunkLoadError(new Error("error loading dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new Error("Importing a module script failed"))).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError(new TypeError("x is not a function"))).toBe(false);
  });
});

describe("loadWithChunkRetry", () => {
  let reload: ReturnType<typeof vi.fn>;
  let storage: Storage;

  beforeEach(() => {
    reload = vi.fn();
    storage = memoryStorage();
  });

  it("returns the module on first success (no retry, no reload)", async () => {
    const factory = vi.fn(async () => "OK");
    const result = await loadWithChunkRetry(factory, { key: "k", reload, storage, delayMs: 0 });
    expect(result).toBe("OK");
    expect(factory).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("recovers on a transient chunk error via one retry", async () => {
    const factory = vi.fn().mockRejectedValueOnce(CHUNK_ERR).mockResolvedValueOnce("RECOVERED");
    const result = await loadWithChunkRetry(factory, { key: "k", reload, storage, delayMs: 0 });
    expect(result).toBe("RECOVERED");
    expect(factory).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
  });

  it("hard-reloads once for a persistent chunk error, then rethrows next time", async () => {
    const factory = vi.fn().mockRejectedValue(CHUNK_ERR);

    // First encounter: retries, still fails → reloads once (promise never resolves).
    let settled = false;
    void loadWithChunkRetry(factory, { key: "k", reload, storage, delayMs: 0 }).then(
      () => (settled = true),
      () => (settled = true)
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false); // never resolves — reload takes over
    expect(storage.getItem("chunk-reload:k")).toBe("1");

    // Second encounter (guard already set, e.g. reload didn't fix it): rethrows.
    await expect(
      loadWithChunkRetry(factory, { key: "k", reload, storage, delayMs: 0 })
    ).rejects.toThrow(/dynamically imported module/);
    expect(reload).toHaveBeenCalledTimes(1); // no second reload — no loop
  });

  it("does not retry or reload for a non-chunk error", async () => {
    const boom = new Error("Cannot read properties of undefined");
    const factory = vi.fn().mockRejectedValue(boom);
    await expect(
      loadWithChunkRetry(factory, { key: "k", reload, storage, delayMs: 0 })
    ).rejects.toThrow(boom);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("clearChunkReloadGuards removes only reload guard keys", () => {
    storage.setItem("chunk-reload:a", "1");
    storage.setItem("chunk-reload:b", "1");
    storage.setItem("keep-me", "yes");
    clearChunkReloadGuards(storage);
    expect(storage.getItem("chunk-reload:a")).toBeNull();
    expect(storage.getItem("chunk-reload:b")).toBeNull();
    expect(storage.getItem("keep-me")).toBe("yes");
  });
});
