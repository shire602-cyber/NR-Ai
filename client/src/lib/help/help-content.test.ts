import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CUSTOMER_GROUPS,
  MORE_GROUP,
  NRA_GROUP,
  ADMIN_GROUP,
  DASHBOARD_URL,
  destinationsOf,
} from "../../components/layout/nav-config";
import { HELP_CATEGORIES, getArticle, listArticles, listSlugs } from "./articles";
import { helpSlugForPath, mappedSlugs } from "./route-map";
import { searchArticles } from "./search";

const appSource = fs.readFileSync(path.resolve(__dirname, "../../App.tsx"), "utf8");
const appRoutes = new Set([...appSource.matchAll(/path="([^"]+)"/g)].map((m) => m[1]));

const allDestinations = [DASHBOARD_URL, ...[...CUSTOMER_GROUPS, MORE_GROUP, NRA_GROUP, ADMIN_GROUP].flatMap(destinationsOf)];

describe("help articles", () => {
  it("has at least 30 articles", () => {
    expect(listSlugs().length).toBeGreaterThanOrEqual(30);
  });

  it("has the same slugs in English and Arabic", () => {
    const en = listArticles("en").map((a) => a.slug).sort();
    const ar = listArticles("ar").map((a) => a.slug).sort();
    expect(ar).toEqual(en);
  });

  it.each(listSlugs())("%s has complete front matter in both languages", (slug) => {
    for (const locale of ["en", "ar"] as const) {
      const a = getArticle(locale, slug)!;
      expect(a.locale, `${slug} ${locale} exists`).toBe(locale);
      expect(a.title.length, `${slug} ${locale} title`).toBeGreaterThan(2);
      expect(a.summary.length, `${slug} ${locale} summary`).toBeGreaterThan(10);
      expect(HELP_CATEGORIES as readonly string[], `${slug} ${locale} category`).toContain(a.category);
      expect(a.keywords.length, `${slug} ${locale} keywords`).toBeGreaterThan(0);
      expect(a.body.length, `${slug} ${locale} body`).toBeGreaterThan(300);
      for (const rel of a.related) expect(listSlugs(), `${slug} related ${rel}`).toContain(rel);
    }
  });

  it("uses Arabic script in every Arabic article title and body", () => {
    for (const a of listArticles("ar")) {
      expect(a.title, a.slug).toMatch(/[؀-ۿ]/);
      expect(a.body, a.slug).toMatch(/[؀-ۿ]/);
    }
  });

  it("links only to existing help articles and app routes", () => {
    for (const a of [...listArticles("en"), ...listArticles("ar")]) {
      for (const m of a.body.matchAll(/\]\((\/[^)\s]*)\)/g)) {
        const target = m[1];
        if (target.startsWith("/help/")) expect(listSlugs(), `${a.slug}: ${target}`).toContain(target.slice("/help/".length));
        else expect(appRoutes.has(target), `${a.locale}/${a.slug}: ${target}`).toBe(true);
      }
    }
  });
});

describe("contextual help", () => {
  it("maps every menu destination to an existing article", () => {
    const slugs = new Set(listSlugs());
    const unmapped = allDestinations.filter((path) => {
      const slug = helpSlugForPath(path);
      return !slug || !slugs.has(slug);
    });
    expect(unmapped).toEqual([]);
  });

  it("only maps to slugs that exist in both languages", () => {
    for (const slug of mappedSlugs()) {
      expect(getArticle("en", slug)?.locale, slug).toBe("en");
      expect(getArticle("ar", slug)?.locale, slug).toBe("ar");
    }
  });

  it("handles sub-pages, queries and trailing slashes", () => {
    expect(helpSlugForPath("/journal/abc-123")).toBe("journal-entries");
    expect(helpSlugForPath("/reports/run/trial-balance")).toBe("reports");
    expect(helpSlugForPath("/firm/clients/xyz")).toBe("firm-workspace");
    expect(helpSlugForPath("/invoices/?status=draft")).toBe("invoices");
    expect(helpSlugForPath("/nowhere")).toBeNull();
  });
});

describe("help search", () => {
  it("finds VAT articles in Arabic (by the English abbreviation and by the Arabic term)", () => {
    const ar = listArticles("ar");
    expect(searchArticles(ar, "VAT").length).toBeGreaterThanOrEqual(1);
    expect(searchArticles(ar, "ضريبة القيمة المضافة").length).toBeGreaterThanOrEqual(1);
    expect(searchArticles(ar, "VAT")[0].article.slug).toBe("vat-filing");
  });

  it("finds invoices in English and ranks the invoices article first", () => {
    const hits = searchArticles(listArticles("en"), "invoice");
    expect(hits.length).toBeGreaterThan(3);
    expect(hits[0].article.slug).toBe("invoices");
  });

  it("matches Arabic regardless of diacritics and alef forms", () => {
    const hits = searchArticles(listArticles("ar"), "الإيصالات");
    expect(hits.some((h) => h.article.slug === "receipts")).toBe(true);
    expect(searchArticles(listArticles("ar"), "الايصالات").some((h) => h.article.slug === "receipts")).toBe(true);
  });

  it("returns nothing for nonsense and everything for an empty query", () => {
    expect(searchArticles(listArticles("en"), "zzzqqq")).toEqual([]);
    expect(searchArticles(listArticles("en"), "  ").length).toBe(listArticles("en").length);
  });
});
