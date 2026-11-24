/**
 * Firm first-screen boot (defect 14): the shared route/namespace/API table, the catalog scope it
 * gives the two landing screens, and the server pieces that serve the firm document
 * (server/vite.ts): language-cookie catalog preloads, the inline session-read starter, and the
 * brotli precompressed assets middleware.
 */
import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FIRM_FIRST_SCREENS,
  FIRM_FIRST_SCREEN_NAMESPACES,
  SHELL_BOOT_API,
  firmFirstScreen,
} from "../../shared/firm-boot";
import { namespacesForPath } from "../../client/src/lib/i18n";
import {
  injectBootFetch,
  injectModulePreloads,
  isFirmPath,
  localeFromCookie,
  precompressedAssets,
  renderFirmDocument,
  routeKey,
} from "../../server/vite";

const HTML =
  '<!doctype html><html><head><meta charset="UTF-8" />' +
  '<meta name="viewport" content="width=device-width" />' +
  '<script src="/theme-init.js"></script></head><body><div id="root"></div></body></html>';

describe("firm first-screen table", () => {
  it("matches the two landing screens, with or without a trailing slash", () => {
    expect(Object.keys(FIRM_FIRST_SCREENS).sort()).toEqual([
      "/firm/clients",
      "/firm/command-center",
    ]);
    expect(firmFirstScreen("/firm/clients")).not.toBeNull();
    expect(firmFirstScreen("/firm/command-center/")).not.toBeNull();
    expect(firmFirstScreen("/firm/clients/abc")).toBeNull();
    expect(firmFirstScreen("/dashboard")).toBeNull();
  });

  it("every read the document starts is an API GET the screen's default query makes", () => {
    for (const screen of Object.values(FIRM_FIRST_SCREENS)) {
      for (const api of [...SHELL_BOOT_API, ...screen.api])
        expect(api).toMatch(/^\/api\/[a-z0-9/-]+$/);
    }
  });
});

describe("catalog scope of the firm routes", () => {
  it("the landing screens boot on the six first-screen catalogs, the rest of /firm on all of them", () => {
    expect(namespacesForPath("/firm/clients")).toEqual([...FIRM_FIRST_SCREEN_NAMESPACES]);
    expect(namespacesForPath("/firm/command-center/")).toEqual([...FIRM_FIRST_SCREEN_NAMESPACES]);
    const rest = namespacesForPath("/firm/staff") ?? [];
    for (const ns of FIRM_FIRST_SCREEN_NAMESPACES) expect(rest).toContain(ns);
    expect(rest.length).toBeGreaterThan(FIRM_FIRST_SCREEN_NAMESPACES.length);
    expect(namespacesForPath("/dashboard")).toBeNull();
  });
});

describe("firm document (server/vite.ts)", () => {
  const firm = {
    html: HTML,
    catalogs: { en: ["firm-assets/catalog-en.js"], ar: ["firm-assets/catalog-ar.js"] },
  };

  it("recognises firm paths only", () => {
    expect(isFirmPath("/firm")).toBe(true);
    expect(isFirmPath("/firm/clients?x=1")).toBe(true);
    expect(isFirmPath("/firm/")).toBe(true);
    expect(isFirmPath("/firmware")).toBe(false);
    expect(isFirmPath("/client-portal/dashboard")).toBe(false);
    expect(routeKey("/firm/clients/?a=b#c")).toBe("/firm/clients");
  });

  it("reads the language cookie strictly", () => {
    expect(localeFromCookie("a=1; muhasib_locale=ar; b=2")).toBe("ar");
    expect(localeFromCookie("muhasib_locale=en")).toBe("en");
    expect(localeFromCookie("muhasib_locale=fr")).toBeNull();
    expect(localeFromCookie("xmuhasib_locale=ar")).toBeNull();
    expect(localeFromCookie(undefined)).toBeNull();
  });

  it("preloads the visitor's catalogs and starts the reads for a signed-in visitor on a landing screen", () => {
    const page = renderFirmDocument({
      firm,
      url: "/firm/clients",
      cookieHeader: "muhasib_locale=ar",
      hasSession: true,
      nonce: "n0nce",
    });
    expect(page).toContain(
      '<link rel="modulepreload" crossorigin href="/firm-assets/catalog-ar.js">'
    );
    expect(page).not.toContain("catalog-en.js");
    expect(page).toContain('<script nonce="n0nce">');
    for (const api of [...SHELL_BOOT_API, ...FIRM_FIRST_SCREENS["/firm/clients"].api]) {
      expect(page).toContain(`"${api}"`);
    }
    // The read starter runs before the blocking theme script, right after the viewport tag.
    expect(page.indexOf("__bootFetch")).toBeLessThan(page.indexOf("/theme-init.js"));
  });

  it("starts no reads without a session cookie and preloads nothing without a language cookie", () => {
    const page = renderFirmDocument({
      firm,
      url: "/firm/command-center",
      cookieHeader: undefined,
      hasSession: false,
      nonce: "x",
    });
    expect(page).toBe(HTML);
  });

  it("serves other firm screens the plain firm document", () => {
    const page = renderFirmDocument({
      firm,
      url: "/firm/staff",
      cookieHeader: "muhasib_locale=en",
      hasSession: true,
      nonce: "x",
    });
    expect(page).toBe(HTML);
  });

  it("injectors leave a document without a head or viewport usable", () => {
    expect(injectModulePreloads("<p>x</p>", ["a.js"])).toBe("<p>x</p>");
    expect(injectBootFetch("<head></head>", ["/api/x"], "n")).toContain('["/api/x"]');
  });
});

describe("precompressedAssets", () => {
  let dir: string;
  let server: http.Server;
  let base: string;
  const source = "export const answer = 42; ".repeat(200);

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "precompressed-"));
    fs.writeFileSync(path.join(dir, "a.js"), source);
    fs.writeFileSync(path.join(dir, "a.js.br"), zlib.brotliCompressSync(source));
    fs.writeFileSync(path.join(dir, "b.js"), "console.log(1);");
    fs.writeFileSync(path.join(dir, "c.css"), "body{}");
    fs.writeFileSync(path.join(dir, "c.css.br"), zlib.brotliCompressSync("body{}"));
    fs.writeFileSync(path.join(dir, "d.png"), "png");
    fs.writeFileSync(path.join(dir, "d.png.br"), "should never be served");
    const app = express();
    app.use("/assets", precompressedAssets(dir));
    app.use((_req, res) => res.status(404).send("fell through"));
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // `fetch` would decode the body for us; a raw request shows exactly what is sent.
  function raw(urlPath: string, acceptEncoding: string) {
    return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>(
      (resolve, reject) => {
        http
          .get(base + urlPath, { headers: { "accept-encoding": acceptEncoding } }, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () =>
              resolve({
                status: res.statusCode ?? 0,
                headers: res.headers,
                body: Buffer.concat(chunks),
              })
            );
          })
          .on("error", reject);
      }
    );
  }

  it("serves the brotli file with the original type to a browser that accepts brotli", async () => {
    const res = await raw("/assets/a.js", "gzip, deflate, br");
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("br");
    expect(res.headers["content-type"]).toMatch(/javascript/);
    expect(res.headers.vary).toMatch(/Accept-Encoding/i);
    expect(res.headers["cache-control"]).toContain("immutable");
    expect(zlib.brotliDecompressSync(res.body).toString()).toBe(source);
    const css = await raw("/assets/c.css", "br");
    expect(css.headers["content-type"]).toMatch(/text\/css/);
  });

  it("falls through for gzip-only clients, files without a .br twin and other file types", async () => {
    expect((await raw("/assets/a.js", "gzip")).body.toString()).toBe("fell through");
    expect((await raw("/assets/b.js", "br")).body.toString()).toBe("fell through");
    expect((await raw("/assets/d.png", "br")).body.toString()).toBe("fell through");
  });

  it("never reads outside the assets folder", async () => {
    fs.writeFileSync(path.join(dir, "..", "outside.js"), "x");
    fs.writeFileSync(path.join(dir, "..", "outside.js.br"), zlib.brotliCompressSync("x"));
    try {
      const res = await raw("/assets/..%2foutside.js", "br");
      expect(res.body.toString()).toBe("fell through");
    } finally {
      fs.rmSync(path.join(dir, "..", "outside.js"), { force: true });
      fs.rmSync(path.join(dir, "..", "outside.js.br"), { force: true });
    }
  });
});
