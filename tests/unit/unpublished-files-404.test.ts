import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { rejectUnpublishedFiles } from "../../server/vite";

// Behaviour test of the middleware in front of a stand-in SPA fallback.
let server: import("node:http").Server;
let base = "";

beforeAll(() => {
  const app = express();
  app.use(rejectUnpublishedFiles);
  app.use("*", (_req, res) => res.status(200).type("html").send("<!doctype html><div id=root>"));
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server?.close());

describe("unpublished crawler files", () => {
  it.each(["/sitemap.xml", "/llms.txt", "/.well-known/security.txt"])(
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
