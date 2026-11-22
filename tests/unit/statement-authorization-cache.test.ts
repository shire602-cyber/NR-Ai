import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  BANK_AUTHORIZATION_RETURN_PATH,
  LEGACY_BANK_AUTHORIZATION_RETURN_PATH,
} from "../../shared/bank-authorization-paths";

const origin = "https://app.example.test";
const workerSource = readFileSync("client/public/sw.js", "utf8");
const bootstrap = readFileSync("client/public/statement-return-init.js", "utf8");

function worker() {
  const handlers = new Map<string, (event: unknown) => void>();
  const oldResponse = {
    url: origin + BANK_AUTHORIZATION_RETURN_PATH + "?code=fixture&state=fixture",
  };
  const cleanShell = { url: origin + "/index.html" };
  const versions = new Map([["muhasib-v3", new Map([["/", oldResponse]])]]);
  const put = vi.fn();
  const addAll = vi.fn();
  const caches = {
    keys: async () => Array.from(versions.keys()),
    delete: async (key: string) => versions.delete(key),
    open: vi.fn(async (key: string) => {
      if (!versions.has(key)) versions.set(key, new Map());
      return { addAll, put, match: async (path: string) => path === "/index.html" && cleanShell };
    }),
  };
  const claim = vi.fn();
  const fetch = vi.fn(async (request: { url: string }) => ({ ok: true, url: request.url }));
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
  return { handlers, versions, put, claim, fetch, addAll, cleanShell };
}

describe("statement authorization navigation caching", () => {
  it("precaches the clean shell and deletes the previous cache when activating", async () => {
    const { handlers, versions, claim, addAll } = worker();
    const waitUntil = vi.fn();
    handlers.get("install")?.({ waitUntil });
    await waitUntil.mock.calls[0][0];
    expect(addAll).toHaveBeenCalledWith(
      expect.arrayContaining(["/index.html", "/statement-return-init.js"])
    );
    handlers.get("activate")?.({ waitUntil });
    await waitUntil.mock.calls[1][0];
    expect(Array.from(versions.keys())).toEqual(["muhasib-v4"]);
    expect(claim).toHaveBeenCalledOnce();
  });

  it.each([BANK_AUTHORIZATION_RETURN_PATH, LEGACY_BANK_AUTHORIZATION_RETURN_PATH])(
    "uses the network for %s and opens the clean shell on failure",
    async (pathname) => {
      const { handlers, fetch, put, cleanShell } = worker();
      const respondWith = vi.fn();
      const search = "?code=opaque%252F&state=fixture";
      const request = { url: origin + pathname + search, mode: "navigate", method: "GET" };
      handlers.get("fetch")?.({ request, respondWith });
      expect(await respondWith.mock.calls[0][0]).toEqual({ ok: true, url: request.url });
      expect(fetch).toHaveBeenCalledWith(request, { cache: "no-store" });

      fetch.mockRejectedValueOnce(new TypeError("offline"));
      handlers.get("fetch")?.({ request, respondWith });
      expect(await respondWith.mock.calls[1][0]).toBe(cleanShell);
      expect(put).not.toHaveBeenCalled();

      expect(readFileSync("client/index.html", "utf8")).toContain(
        'src="/statement-return-init.js"'
      );
      const window = { location: { pathname, search } };
      const history = { state: { fixture: true }, replaceState: vi.fn() };
      const sessionStorage = { setItem: vi.fn() };
      runInNewContext(bootstrap, { window, history, sessionStorage, crypto: { randomUUID } });
      expect(window).toHaveProperty("__statementReturn.search", search);
      expect(history.replaceState).toHaveBeenCalledExactlyOnceWith(
        history.state,
        "",
        BANK_AUTHORIZATION_RETURN_PATH
      );
      expect(sessionStorage.setItem.mock.calls[0][1]).not.toMatch(/opaque|fixture/);
    }
  );
});
