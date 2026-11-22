import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  BANK_AUTHORIZATION_RETURN_PATH,
  LEGACY_BANK_AUTHORIZATION_RETURN_PATH,
} from "../../shared/bank-authorization-paths";

const origin = "https://app.example.test";
const workerSource = readFileSync("client/public/sw.js", "utf8");

function worker() {
  const handlers = new Map<string, (event: unknown) => void>();
  const oldResponse = {
    url: origin + BANK_AUTHORIZATION_RETURN_PATH + "?code=fixture&state=fixture",
  };
  const versions = new Map([["muhasib-v2", new Map([["/", oldResponse]])]]);
  const put = vi.fn();
  const caches = {
    keys: async () => Array.from(versions.keys()),
    delete: async (key: string) => versions.delete(key),
    open: vi.fn(async (key: string) => {
      if (!versions.has(key)) versions.set(key, new Map());
      return { addAll: async () => {}, put };
    }),
  };
  const claim = vi.fn();
  const fetch = vi.fn(async (request: { url: string }) => ({
    ok: true,
    clone: () => ({ url: request.url }),
  }));
  runInNewContext(workerSource, {
    self: {
      location: { origin },
      addEventListener: (name: string, listener: (event: unknown) => void) =>
        handlers.set(name, listener),
      clients: { claim },
      skipWaiting: vi.fn(),
    },
    caches,
    fetch,
    URL,
  });
  return { handlers, versions, put, caches, claim, fetch };
}

describe("statement authorization navigation caching", () => {
  it("purges the old shell cache, including its response URL, when the worker activates", async () => {
    const { handlers, versions, claim } = worker();
    const waitUntil = vi.fn();
    handlers.get("install")?.({ waitUntil });
    await waitUntil.mock.calls[0][0];
    handlers.get("activate")?.({ waitUntil });
    await waitUntil.mock.calls[1][0];
    expect(Array.from(versions.keys())).toEqual(["muhasib-v3"]);
    expect(claim).toHaveBeenCalledOnce();
  });

  it.each([BANK_AUTHORIZATION_RETURN_PATH, LEGACY_BANK_AUTHORIZATION_RETURN_PATH])(
    "passes %s through without caching either the request or response URL",
    async (path) => {
      const { handlers, caches, fetch, put } = worker();
      const respondWith = vi.fn();
      handlers.get("fetch")?.({
        request: {
          url: origin + path + "?code=fixture&state=fixture",
          mode: "navigate",
          method: "GET",
        },
        respondWith,
      });
      expect(respondWith).not.toHaveBeenCalled();
      expect(caches.open).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();

      handlers.get("fetch")?.({
        request: { url: origin + "/dashboard", mode: "navigate", method: "GET" },
        respondWith,
      });
      await respondWith.mock.calls[0][0];
      expect(put).toHaveBeenCalledWith("/", { url: origin + "/dashboard" });
    }
  );
});
