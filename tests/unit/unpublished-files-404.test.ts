import { readFileSync } from "node:fs";
import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { documentStatus, rejectUnpublishedFiles, serveSitemap } from "../../server/vite";

// Behaviour test of the middleware in front of a stand-in SPA fallback.
let server: import("node:http").Server;
let base = "";

beforeAll(() => {
  const app = express();
  app.get("/sitemap.xml", serveSitemap);
  app.use(rejectUnpublishedFiles);
  app.use("*", (_req, res) => res.status(200).type("html").send("<!doctype html><div id=root>"));
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server?.close());

describe("unpublished crawler files", () => {
  it.each(["/llms.txt", "/.well-known/security.txt"])(
    "%s is a 404, not the SPA shell",
    async (p) => {
      const res = await fetch(base + p);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).not.toMatch(/html/);
      expect(await res.text()).not.toMatch(/<div id=root>/);
    }
  );

  it("still serves the SPA for app routes", async () => {
    const res = await fetch(`${base}/dashboard`);
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/root/);
  });
});

it("keeps every literal client route available on a direct request", () => {
  const app = readFileSync("client/src/App.tsx", "utf8");
  for (const match of app.matchAll(/<Route path="([^"]+)"/g)) {
    const example = match[1].replace(/:[a-zA-Z]+/g, "example");
    expect(documentStatus(example), example).toBe(200);
  }
});

it("recognizes only known document URLs and lists localized public pages in the sitemap", async () => {
  for (const path of [
    "/made-up",
    "/ar/made-up",
    "/firm/made-up",
    "/invoices/x/made-up",
    "/en/%E0%A4%A",
  ]) {
    expect(documentStatus(path), path).toBe(404);
  }
  const sitemap = await fetch(`${base}/sitemap.xml`);
  expect(sitemap.status).toBe(200);
  expect(sitemap.headers.get("content-type")).toMatch(/xml/);
  const xml = await sitemap.text();
  const paths = [...xml.matchAll(/<loc>https:\/\/muhasib\.ai([^<]+)<\/loc>/g)].map(
    (match) => match[1]
  );
  expect(paths).toEqual(expect.arrayContaining(["/en", "/ar", "/en/product/vat", "/ar/resources"]));
  for (const path of paths) {
    expect(path).toMatch(/^\/(en|ar)(\/|$)/);
    expect(documentStatus(path), path).toBe(200);
  }
});
