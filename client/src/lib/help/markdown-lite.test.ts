import { describe, expect, it } from "vitest";
import { isSafeHref, parseBlocks, parseFrontMatter, parseInline, plainText, slugifyHeading } from "./markdown-lite";
import { normaliseSearch, searchArticles } from "./search";

describe("parseFrontMatter", () => {
  it("reads fields and the body", () => {
    const out = parseFrontMatter("---\ntitle: Hello\nsummary: S\ncategory: sales\nkeywords: a, b ,c\nrelated: x, y\n---\n\n## H\ntext");
    expect(out).toMatchObject({ title: "Hello", summary: "S", category: "sales", keywords: ["a", "b", "c"], related: ["x", "y"] });
    expect(out.body).toBe("## H\ntext");
  });
  it("tolerates a missing block and CRLF", () => {
    expect(parseFrontMatter("just text").body).toBe("just text");
    expect(parseFrontMatter("---\r\ntitle: T\r\n---\r\nbody").title).toBe("T");
  });
});

describe("links are restricted", () => {
  it("allows site paths, https and mailto", () => {
    expect(isSafeHref("/invoices")).toBe(true);
    expect(isSafeHref("https://example.com/a")).toBe(true);
    expect(isSafeHref("mailto:a@b.com")).toBe(true);
  });
  it("blocks scripts, data URLs, protocol-relative and http links", () => {
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html;base64,AAA", "//evil.example", "http://x.test", "vbscript:x", " javascript:alert(1)"]) {
      expect(isSafeHref(bad), bad).toBe(false);
    }
  });
  it("renders an unsafe link as plain text, never as a link", () => {
    const inline = parseInline("[click](javascript:alert(1)) now");
    expect(inline.some((n) => n.t === "link")).toBe(false);
    expect(plainText(inline)).toContain("click");
  });
});

describe("injection", () => {
  it("keeps raw HTML as text and never produces markup", () => {
    const blocks = parseBlocks('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
    expect(blocks.every((b) => b.t === "p")).toBe(true);
    expect(JSON.stringify(blocks)).toContain("<script>");
    // Only plain text nodes: no element/link types were created from the markup.
    for (const b of blocks) if (b.t === "p") expect(b.c.every((n) => n.t === "text")).toBe(true);
  });
  it("keeps code content literal", () => {
    const inline = parseInline("`<b>x</b>` and **bold**");
    expect(inline[0]).toEqual({ t: "code", v: "<b>x</b>" });
    expect(inline.some((n) => n.t === "strong")).toBe(true);
  });
});

describe("parseBlocks", () => {
  it("parses headings, lists, notes and code", () => {
    const md = "## One\n\ntext **b**\n\n- a\n- b\n\n1. x\n2. y\n\n> note\n\n```\ncode\n```\n\n### Sub";
    expect(parseBlocks(md).map((b) => b.t)).toEqual(["h2", "p", "ul", "ol", "quote", "code", "h3"]);
  });
  it("gives headings stable ids, including Arabic", () => {
    expect(slugifyHeading("Set up two-step!")).toBe("set-up-two-step");
    expect(slugifyHeading("إعداد التحقق")).toBe("إعداد-التحقق");
    const [h] = parseBlocks("## Hello World");
    expect(h).toMatchObject({ t: "h2", id: "hello-world" });
  });
});

describe("normaliseSearch", () => {
  it("folds Arabic variants and digits", () => {
    expect(normaliseSearch("الإيصالات")).toBe(normaliseSearch("الايصالات"));
    expect(normaliseSearch("فَاتُورَة")).toBe(normaliseSearch("فاتوره"));
    expect(normaliseSearch("٢٠٢٦")).toBe("2026");
    expect(normaliseSearch("VAT-201!")).toBe("vat 201");
  });
  it("matches by word prefix, not by substring", () => {
    const art = [{ slug: "a", title: "Invoices", summary: "", keywords: [], body: "" }];
    expect(searchArticles(art, "inv")).toHaveLength(1);
    expect(searchArticles(art, "voice")).toHaveLength(0);
  });
});
