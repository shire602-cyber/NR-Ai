/**
 * R17-15: safeOutboundFetch resolves DNS once per hop, validates every address and
 * connects to the validated IP (Host preserved), so a rebinding resolver that answers
 * with an internal address on the second query cannot redirect the connection. Redirects
 * are re-validated hop by hop.
 *
 * The test treats 127.0.0.1 as "public" and 127.0.0.2 as "internal" through the guard's
 * test hook, and serves the "public" host from a local HTTP server.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  __setOutboundGuardForTests,
  OutboundUrlBlockedError,
  pinnedLookup,
  safeOutboundFetch,
  validateOutboundUrl,
} from "../../server/services/url-guard";

let server: http.Server;
let port = 0;
const seen: Array<{ host?: string; path?: string; method?: string }> = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({ host: req.headers.host, path: req.url, method: req.method });
    if (req.url === "/redirect-internal") {
      res.writeHead(302, { Location: `http://internal.test:${port}/secret` });
      return res.end();
    }
    if (req.url === "/redirect-ok") {
      res.writeHead(302, { Location: "/final" });
      return res.end();
    }
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(`hello ${req.url}`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

afterEach(() => {
  __setOutboundGuardForTests(null);
  seen.length = 0;
});

const isBlocked = (ip: string) => ip === "127.0.0.2";

describe("R17-15 DNS pinning", () => {
  it("[R17-15] a rebinding resolver is asked once and the connection uses the validated IP", async () => {
    let lookups = 0;
    __setOutboundGuardForTests({
      isBlocked,
      // First answer: "public". Any later answer would be internal (rebinding).
      resolve: async () => {
        lookups += 1;
        return lookups === 1
          ? [{ address: "127.0.0.1", family: 4 }]
          : [{ address: "127.0.0.2", family: 4 }];
      },
    });
    const res = await safeOutboundFetch(`http://rebind.test:${port}/hook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    });
    expect(lookups).toBe(1);
    expect(res.status).toBe(200);
    expect(res.bodyText).toBe("hello /hook");
    // Host header still names the original host (virtual hosting / SNI preserved).
    expect(seen[0]).toMatchObject({ host: `rebind.test:${port}`, method: "POST" });
  });

  it("[R17-15] the pinned lookup never consults DNS again", async () => {
    const lookup = pinnedLookup({ address: "127.0.0.1", family: 4 });
    const single = await new Promise<[string, number]>((resolve) =>
      lookup("anything.test", {}, (_e, address, family) => resolve([address as string, family!]))
    );
    expect(single).toEqual(["127.0.0.1", 4]);
    const all = await new Promise<unknown>((resolve) =>
      lookup("anything.test", { all: true }, (_e, address) => resolve(address))
    );
    expect(all).toEqual([{ address: "127.0.0.1", family: 4 }]);
  });

  it("[R17-15] an internal answer is refused before any connection", async () => {
    __setOutboundGuardForTests({
      isBlocked,
      resolve: async () => [
        { address: "127.0.0.1", family: 4 },
        { address: "127.0.0.2", family: 4 },
      ],
    });
    await expect(
      safeOutboundFetch(`http://mixed.test:${port}/x`, { method: "GET" })
    ).rejects.toBeInstanceOf(OutboundUrlBlockedError);
    expect(seen).toHaveLength(0);
    const verdict = await validateOutboundUrl(`http://mixed.test:${port}/x`);
    expect(verdict.ok).toBe(false);
  });

  it("does not send a request when DNS resolves after cancellation", async () => {
    let finishLookup!: () => void;
    const lookup = new Promise<void>((resolve) => {
      finishLookup = resolve;
    });
    __setOutboundGuardForTests({
      isBlocked,
      resolve: async () => {
        await lookup;
        return [{ address: "127.0.0.1", family: 4 }];
      },
    });
    const controller = new AbortController();
    const pending = safeOutboundFetch(`http://public.test:${port}/hook`, {
      method: "POST",
      body: "webhook",
      signal: controller.signal,
    });
    controller.abort();
    finishLookup();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(seen).toHaveLength(0);
  });

  it("[R17-15] redirects are returned as-is by default and re-validated hop by hop when followed", async () => {
    __setOutboundGuardForTests({
      isBlocked,
      resolve: async (host) =>
        host === "internal.test"
          ? [{ address: "127.0.0.2", family: 4 }]
          : [{ address: "127.0.0.1", family: 4 }],
    });
    const noFollow = await safeOutboundFetch(`http://public.test:${port}/redirect-internal`, {
      method: "GET",
    });
    expect(noFollow.status).toBe(302);

    await expect(
      safeOutboundFetch(
        `http://public.test:${port}/redirect-internal`,
        { method: "GET" },
        { maxRedirects: 3 }
      )
    ).rejects.toBeInstanceOf(OutboundUrlBlockedError);
    expect(seen.map((s) => s.path)).toEqual(["/redirect-internal", "/redirect-internal"]);

    const ok = await safeOutboundFetch(
      `http://public.test:${port}/redirect-ok`,
      { method: "POST", body: "x" },
      { maxRedirects: 3 }
    );
    expect(ok.status).toBe(200);
    expect(ok.hops).toBe(1);
    expect(seen.at(-1)).toMatchObject({ path: "/final", method: "GET" });
  });
});
