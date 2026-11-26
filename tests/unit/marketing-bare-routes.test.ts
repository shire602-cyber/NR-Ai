import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalMarketingPath } from "../../client/src/components/marketing/phase/route-content";
import { bareMarketingRedirect } from "../../client/src/components/marketing/phase/routes";
import { documentStatus, redirectBareMarketing } from "../../server/vite";

const BARE: Array<[string, string]> = [
  ["/pricing", "/en/pricing"],
  ["/e-invoicing", "/en/uae-e-invoicing"],
  ["/free-tools", "/en/tools"],
  ["/accounting-firms", "/en/solutions/accounting-firms"],
  ["/small-business", "/en/solutions/small-business"],
  ["/compare", "/en/compare"],
  ["/compare/wafeq", "/en/compare/wafeq"],
  ["/compare/zoho-books", "/en/compare/zoho"],
];

describe("bare marketing URLs", () => {
  it.each(BARE)("%s maps to %s, a real page", (bare, target) => {
    expect(bareMarketingRedirect(bare)).toBe(target);
    expect(bareMarketingRedirect(`${bare}/`)).toBe(target);
    expect(documentStatus(target), target).toBe(200);
  });

  it("agrees with the in-locale aliases and ignores other paths", () => {
    for (const [bare, target] of BARE) {
      if (bare === "/pricing") continue;
      expect(target).toBe(`/en${canonicalMarketingPath(bare)}`);
    }
    for (const other of ["/", "/en/pricing", "/login", "/dashboard", "/pricing/x"]) {
      expect(bareMarketingRedirect(other), other).toBeUndefined();
    }
  });
});

describe("bare marketing redirect middleware", () => {
  let server: import("node:http").Server;
  let base = "";
  beforeAll(() => {
    const app = express();
    app.use(redirectBareMarketing);
    app.use("*", (_req, res) => res.status(200).send("spa"));
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server?.close());

  it.each(BARE)("301s %s to %s and keeps the query string", async (bare, target) => {
    const res = await fetch(`${base}${bare}?utm_source=ad`, { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`${target}?utm_source=ad`);
  });

  it("leaves other URLs and non-GET requests alone", async () => {
    expect((await fetch(`${base}/en/pricing`, { redirect: "manual" })).status).toBe(200);
    expect((await fetch(`${base}/dashboard`, { redirect: "manual" })).status).toBe(200);
    expect((await fetch(`${base}/pricing`, { method: "POST", redirect: "manual" })).status).toBe(
      200
    );
  });
});
