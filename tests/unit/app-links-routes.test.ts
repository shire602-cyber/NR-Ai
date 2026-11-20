// Broken-path sweep regression: every in-app link the server stores (notification actionUrl,
// reminder links) must open a client route, not the 404 page. The sweep found `/invoices/<id>`,
// `/banking`, `/compliance` and `/settings` in notifications. Source inspection is deliberate:
// the links are string literals spread over many notification builders that only run on
// scheduled events, so reading them from source is the only way to check all of them at once;
// the redirect routes for links already stored in the database are pinned the same way, because
// the router is declarative JSX (see launch-routes-all.test.ts).
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { billHref, invoiceHref, receiptHref } from "../../shared/app-links";

const appRoutes = [
  ...readFileSync("client/src/App.tsx", "utf8").matchAll(/<Route path="([^"]+)"/g),
  ...readFileSync("client/src/PublicApp.tsx", "utf8").matchAll(/<Route path="([^"]+)"/g),
].map((m) => m[1]);

// Routes that only redirect (legacy URLs): a NEW stored link must name the real page.
const redirectOnly = new Set(
  [
    ...readFileSync("client/src/App.tsx", "utf8").matchAll(
      /<Route path="([^"]+)">\s*(?:\{\(params\) => )?<RedirectTo/g
    ),
  ].map((m) => m[1])
);

function matchesRoute(href: string, { allowRedirects = true } = {}): boolean {
  const pathname = href.split(/[?#]/)[0];
  return appRoutes.some((route) => {
    if (!allowRedirects && redirectOnly.has(route)) return false;
    const re = new RegExp(`^${route.replace(/:[A-Za-z]+/g, "[^/]+")}$`);
    return re.test(pathname);
  });
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("stored in-app links resolve to client routes", () => {
  it("every literal actionUrl in server/ is a client route", () => {
    const bad: string[] = [];
    for (const file of walk("server")) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(
        /actionUrl:\s*(?:[^,\n]*\?\s*)?["`](\/[^"`$]*)(\$\{[^}]*\}[^"`]*)?["`]/g
      )) {
        const href = m[1] + (m[2] ? "x" : "");
        if (href.startsWith("/api/")) continue;
        if (!matchesRoute(href, { allowRedirects: false }))
          bad.push(`${file}: ${m[1]}${m[2] ?? ""}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("action_url literals in raw SQL inserts are client routes too", () => {
    // The AI drafts notice wrote '/journal-entries?status=draft' (no such page) in raw SQL.
    const bad: string[] = [];
    for (const file of walk("server")) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("action_url")) continue;
      for (const m of src.matchAll(/'(\/[a-z][a-z0-9\-/]*(?:\?[^']*)?)'/g)) {
        if (!matchesRoute(m[1], { allowRedirects: false })) bad.push(`${file}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("invoice links open the invoice view", () => {
    expect(invoiceHref("abc")).toBe("/invoices?open=abc");
    expect(matchesRoute(invoiceHref("abc"), { allowRedirects: false })).toBe(true);
    expect(redirectOnly.has("/banking")).toBe(true);
    expect(redirectOnly.has("/journal-entries")).toBe(true);
    expect(matchesRoute("/journal?status=draft", { allowRedirects: false })).toBe(true);
  });

  it("bill and receipt links open the specific record", () => {
    expect(billHref("b1")).toBe("/bill-pay/b1/edit");
    expect(receiptHref("r1")).toBe("/receipts?open=r1");
    for (const href of [billHref("b1"), receiptHref("r1")])
      expect(matchesRoute(href, { allowRedirects: false }), href).toBe(true);
  });

  it("links already stored before the fix still land on a page (redirect routes)", () => {
    for (const legacy of [
      "/invoices/3f2b8c1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
      "/banking",
      "/compliance",
      "/settings",
      "/journal-entries?status=draft",
    ]) {
      expect(matchesRoute(legacy), legacy).toBe(true);
    }
  });
});
