// Source scan on purpose: public pages (marketing site, pricing, help, trust, legal, auth screens,
// static public assets incl. the sample invoice PDF) must never name our e-invoicing delivery
// providers. Owner rule, EN and AR. Logged-in screens (settings, e-invoicing setup) are excluded
// and may keep the provider choice. When a new delivery provider is integrated, add its Latin and
// Arabic spellings to PROVIDER_PATTERNS.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { collectPdf } from "./pdf-test-helpers";

const ROOT = join(__dirname, "..", "..");
const PDFDocument = createRequire(import.meta.url)("pdfkit");

// Dashes, spaces, dots and zero-width / soft-hyphen characters between word parts.
const SEP = "[\\s\\-\\u2010-\\u2015\\u00ad\\u200b-\\u200d\\u2060._]*";
const PROVIDER_PATTERNS: RegExp[] = [
  new RegExp(`\\ba${SEP}cube\\b`, "i"),
  /complyance/i,
  new RegExp(`\\bbee${SEP}aura\\b`, "i"),
  /\u0643\u064a\u0648\u0628/, // kyub (A-Cube)
  /\u0643\u0648?\u0645\u0628\u0644[\u0627\u0622]?\u064a?[\u0627\u0622]?\u0646[\u0633\u0632]/, // komblayans (Complyance)
  new RegExp(`\\u0628\\u064a${SEP}[\\u0627\\u0623\\u0625\\u0622]?\\u0648\\u0631\\u0627|\\u0628\\u064a\\u0626\\u0648\\u0631\\u0627`), // bee aura
];

// NFKC, then drop Arabic diacritics and tatweel so vowel marks cannot hide a name.
export function namesProvider(text: string): RegExp | undefined {
  const normalized = text.normalize("NFKC").replace(/[\u064b-\u065f\u0670\u0640]/g, "");
  return PROVIDER_PATTERNS.find((re) => re.test(normalized));
}

// The invoice renderer draws Arabic as shaped glyphs and stores the real text in
// /ActualText <FEFF...> marked-content spans (UTF-16BE, visual order). Scan every span in both
// directions, and join fragments only within an uninterrupted PDF text sequence.
export function pdfActualText(pdf: Buffer): string[] {
  const s = pdf.toString("latin1");
  const candidates: string[] = [];
  const rev = (x: string) => [...x].reverse().join("");
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf("endstream", start);
    if (end < 0) break;
    re.lastIndex = end + "endstream".length;
    let body: string;
    try {
      body = inflateSync(pdf.subarray(start, end)).toString("latin1");
    } catch {
      body = s.slice(start, end);
    }
    const parts: string[] = [];
    const flush = () => {
      if (parts.length > 1) {
        const joined = parts.join("");
        const reversed = parts.map(rev);
        candidates.push(joined, rev(joined), reversed.join(""), parts.join(" "), reversed.join(" "));
      }
      parts.length = 0;
    };
    let inText = false;
    // BT/ET delimit text objects. Positioning and next-line operators start a new sequence.
    const tokens =
      /\/ActualText\s*<([0-9A-Fa-f\s]+)>|%[^\r\n]*|\((?:\\[\s\S]|[^\\()])*\)|(?<![^\s<>[\]()])(BT|ET|Tm|Td|TD|T\*|'|")(?=$|[\s<>[\]()])/g;
    for (const [, actualText, operator] of body.matchAll(tokens)) {
      if (operator) {
        flush();
        if (operator === "BT" || operator === "ET") inText = operator === "BT";
      }
      if (!actualText) continue;
      const hex = actualText.replace(/\s/g, "").replace(/^FEFF/i, "");
      let text = "";
      for (let i = 0; i + 4 <= hex.length; i += 4) {
        text += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
      }
      candidates.push(text, rev(text));
      if (inText) parts.push(text);
    }
    flush();
  }
  return candidates;
}

function utf16Hex(text: string): string {
  return "FEFF" + [...text].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("").toUpperCase();
}

function pdfMarkedText(span: string): string {
  return `/Span <</ActualText <${utf16Hex(span)}>>> BDC\n<00> Tj\nEMC`;
}

function pdfTextObject(y: number, ...operations: string[]): string {
  return ["BT", `1 0 0 1 0 ${y} Tm`, "/F1 12 Tf", ...operations, "ET"].join("\n");
}

function pdfWithContent(streams: string[]): Buffer {
  return Buffer.concat([
    Buffer.from("%PDF-1.4\n", "latin1"),
    ...streams.flatMap((content, index) => {
      const compressed = deflateSync(Buffer.from(content, "latin1"));
      return [
        Buffer.from(`${index + 1} 0 obj <</Filter /FlateDecode /Length ${compressed.length}>>\nstream\n`, "latin1"),
        compressed,
        Buffer.from("\nendstream\nendobj\n", "latin1"),
      ];
    }),
    Buffer.from("%%EOF", "latin1"),
  ]);
}

async function pdfJsTextLines(pdf: Buffer): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true });
  try {
    const doc = await loadingTask.promise;
    const lines: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      const parts: string[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        if (item.str) parts.push(item.str);
        if (item.hasEOL) {
          if (parts.length) lines.push(parts.join(" "));
          parts.length = 0;
        }
      }
      if (parts.length) lines.push(parts.join(" "));
    }
    return lines;
  } finally {
    await loadingTask.destroy();
  }
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const SIGNED_IN_ONLY_CATALOGS = new Set(["einvoicing.json", "adminConsole.json"]);

const PUBLIC_PAGES = [
  "Pricing", "Services", "DemoWorkspace", "HelpCenter", "TrustSecurity", "MigrationGuides",
  "PrivacyPolicy", "TermsOfService", "CookiePolicy", "Login", "Register", "ForgotPassword",
  "ResetPassword", "PublicNotFound",
];

const all = [
  ...walk(join(ROOT, "client/src/components/marketing")),
  // Deny by default: every EN/AR catalog is scanned (public pages render shared keys such as
  // components.legalPoweredBy), except catalogs used only on logged-in e-invoicing setup and admin
  // screens, which may name the provider the company chose.
  ...["en", "ar"].flatMap((l) =>
    readdirSync(join(ROOT, "client/src/locales", l))
      .filter((f) => f.endsWith(".json") && !SIGNED_IN_ONLY_CATALOGS.has(f))
      .map((f) => join(ROOT, "client/src/locales", l, f))
  ),
  ...PUBLIC_PAGES.map((p) => join(ROOT, "client/src/pages", `${p}.tsx`)).filter(existsSync),
  ...walk(join(ROOT, "client/src/pages/legal")),
  ...walk(join(ROOT, "client/public")),
  join(ROOT, "client/index.html"),
  join(ROOT, "client/src/PublicApp.tsx"),
];
const files = all.filter((f) => /\.(tsx?|jsx?|json|css|html|txt|xml|md|webmanifest)$/.test(f));
const pdfs = all.filter((f) => f.endsWith(".pdf"));
const rel = (f: string) => f.slice(ROOT.length + 1).replace(/\\/g, "/");

describe("public site names no e-invoicing provider", () => {
  it("covers marketing, pricing, help, trust, legal and public assets", () => {
    const r = all.map(rel);
    for (const f of [
      "client/src/pages/Pricing.tsx",
      "client/src/pages/HelpCenter.tsx",
      "client/src/pages/TrustSecurity.tsx",
      "client/src/pages/legal/legalAr.tsx",
      "client/src/pages/PublicNotFound.tsx",
      "client/public/samples/muhasib-sample-invoice.pdf",
      "client/index.html",
    ]) {
      expect(r).toContain(f);
    }
    expect(r.some((f) => f.startsWith("client/src/locales/ar/marketing"))).toBe(true);
    expect(files.length).toBeGreaterThan(20);
  });

  it("scans all six shared public catalogs", () => {
    const scanned = files.map(rel);
    for (const locale of ["en", "ar"]) {
      for (const catalog of ["components", "pageLabels", "pages"]) {
        expect(scanned).toContain(`client/src/locales/${locale}/${catalog}.json`);
      }
    }
  });

  it.each([
    "A-Cube", "ACube", "A Cube", "A\u2011Cube", "A\u200bCube", "Complyance", "COMPLYANCE",
    "Bee Aura", "BeeAura", "bee-aura",
    "\u0623\u0643\u064a\u0648\u0628", // akyub
    "\u0625\u064a \u0643\u064a\u0648\u0628", // ii kyub
    "\u0622\u064a \u0643\u064a\u064f\u0648\u0628", // aay kyub with damma
    "\u0643\u064a\u0640\u0648\u0628", // kyub with tatweel
    "\u0643\u0648\u0645\u0628\u0644\u0627\u064a\u0646\u0633", // komblayns
    "\u0643\u0648\u0645\u0628\u0644\u064a\u0627\u0646\u0633", // kombliyans
    "\u0628\u064a \u0623\u0648\u0631\u0627", // bi awra
    "\u0628\u064a-\u0623\u0648\u0631\u0627", // bi-awra
  ])("guard catches %s", (name) => {
    expect(namesProvider(`Works with ${name} for e-invoicing`)).toBeDefined();
  });

  it("does not flag neutral copy", () => {
    expect(namesProvider("Delivered through an accredited service provider. Compliance built in.")).toBeUndefined();
    expect(
      namesProvider("\u0648\u062a\u062a\u0645 \u0639\u0628\u0631 \u0645\u0632\u0648\u0651\u062f \u062e\u062f\u0645\u0629 \u0645\u0639\u062a\u0645\u062f")
    ).toBeUndefined();
  });

  it.each(files.map((f) => [rel(f), f]))("%s", (_n, f) => {
    const hit = namesProvider(readFileSync(f, "utf8"));
    expect(hit, `provider name matched ${hit}`).toBeUndefined();
  });

  it("reads Arabic provider names hidden in PDF ActualText spans (both directions)", () => {
    const name = "\u0643\u0648\u0645\u0628\u0644\u0627\u064a\u0646\u0633";
    for (const shown of [name, [...name].reverse().join("")]) {
      const singleSpan = pdfWithContent([pdfTextObject(700, pdfMarkedText(shown))]);
      const splitSpans = pdfWithContent([
        pdfTextObject(700, pdfMarkedText(shown.slice(0, 3)), pdfMarkedText(shown.slice(3))),
      ]);
      expect(pdfActualText(singleSpan).some(namesProvider)).toBe(true);
      expect(pdfActualText(splitSpans).some(namesProvider)).toBe(true);
    }
  });

  it.each([
    ["\u0643\u064a", "\u0648\u0628"],
    ["A", "Cube"],
  ])("keeps PDF ActualText fragments %s and %s in separate streams", (first, second) => {
    const texts = pdfActualText(
      pdfWithContent([pdfTextObject(700, pdfMarkedText(first)), pdfTextObject(700, pdfMarkedText(second))]),
    );
    expect(texts).toEqual(expect.arrayContaining([first, second]));
    expect(texts.some(namesProvider)).toBe(false);
  });

  it("keeps PDF ActualText on different lines separate within the same stream", () => {
    const first = pdfMarkedText("A");
    const second = pdfMarkedText("Cube");
    for (const content of [
      [pdfTextObject(700, first), pdfTextObject(680, second)].join("\n"),
      pdfTextObject(700, first, "0 -20 Td", second),
    ]) {
      const texts = pdfActualText(pdfWithContent([content]));
      expect(texts).toEqual(expect.arrayContaining(["A", "Cube"]));
      expect(texts.some(namesProvider)).toBe(false);
    }
  });

  it.each([
    ["on the same line", false, 55, 40, true],
    ["on different lines", false, 40, 80, false],
    ["on different pages", true, 40, 40, false],
  ] as const)("checks PDF.js fragments %s", async (_description, newPage, x, y, matches) => {
    const doc = new PDFDocument();
    const pdf = collectPdf(doc);
    // The font change makes PDF.js return separate text items even on the same line.
    doc.text("A", 40, 40, { lineBreak: false });
    if (newPage) doc.addPage();
    doc.font("Helvetica-Bold").text("Cube", x, y, { lineBreak: false });
    doc.end();

    const lines = await pdfJsTextLines(await pdf);
    if (!matches) expect(lines).toEqual(["A", "Cube"]);
    expect(lines.some(namesProvider)).toBe(matches);
  }, 60_000);

  it.each(pdfs.map((f) => [rel(f), f]))("pdf text %s", async (_n, f) => {
    const pdf = readFileSync(f);
    const lines = await pdfJsTextLines(pdf);
    expect(lines.reduce((length, line) => length + line.length, 0)).toBeGreaterThan(100);
    const arabic = pdfActualText(pdf);
    expect(arabic.some((candidate) => /[\u0600-\u06ff]/.test(candidate))).toBe(true);
    const hit = [...lines, ...arabic].map(namesProvider).find(Boolean);
    expect(hit, `provider name matched ${hit}`).toBeUndefined();
  }, 60_000);
});
