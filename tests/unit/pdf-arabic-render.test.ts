import { describe, it, expect } from "vitest";
import { inflateSync } from "node:zlib";
import { generateInvoicePDF } from "../../server/services/pdf-invoice.service";
import { generateCreditNotePDF } from "../../server/services/pdf-credit-note.service";
import { generateQuotePDF } from "../../server/services/pdf-quote.service";
import { generatePurchaseOrderPDF } from "../../server/services/pdf-purchase-order.service";
import { createPdfDocument } from "../../server/services/pdf-fonts";
import * as F from "../fixtures/pdf-arabic-fixtures";

// --- tiny PDF inspection helpers -------------------------------------------

function contentStreams(buf: Buffer): string[] {
  const text = buf.toString("latin1");
  const out: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf("endstream", start);
    try {
      out.push(inflateSync(buf.subarray(start, end)).toString("latin1"));
    } catch {
      /* not a flate stream (fonts, images) */
    }
  }
  return out.filter((s) => s.includes(" Tf"));
}

/** font resource name (F3) -> BaseFont (DZZZZZ+NotoSansArabic-Bold) */
function fontNames(buf: Buffer): Map<string, string> {
  const text = buf.toString("latin1");
  const map = new Map<string, string>();
  for (const dict of text.matchAll(/\/Font <<([^>]*)>>/g)) {
    for (const ref of dict[1].matchAll(/\/(F\d+) (\d+) 0 R/g)) {
      const obj = new RegExp(`\\n${ref[2]} 0 obj\\n<<[\\s\\S]*?/BaseFont /([^\\s/]+)`).exec(text);
      if (obj) map.set(ref[1], obj[1]);
    }
  }
  return map;
}

/** All glyph codes drawn with the embedded Arabic font (2 bytes each). */
function arabicGlyphCodes(buf: Buffer): string[] {
  const names = fontNames(buf);
  const codes: string[] = [];
  for (const stream of contentStreams(buf)) {
    let current = "";
    for (const line of stream.split("\n")) {
      const tf = /^\/(F\d+) [\d.]+ Tf/.exec(line);
      if (tf) current = tf[1];
      if (!/TJ$|Tj$/.test(line) || !(names.get(current) ?? "").includes("NotoSansArabic")) continue;
      for (const hex of line.matchAll(/<([0-9a-f]+)>/g)) {
        for (let i = 0; i < hex[1].length; i += 4) codes.push(hex[1].slice(i, i + 4));
      }
    }
  }
  return codes;
}

async function pageItems(buf: Buffer) {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  return (content.items as any[])
    .filter((it) => it.str.trim() !== "")
    .map((it) => ({ str: it.str as string, x: it.transform[4] as number, y: it.transform[5] as number, w: it.width as number }));
}

// --- the four documents ------------------------------------------------------

const generators: Array<[string, () => Promise<Buffer>]> = [
  ["tax invoice", () => generateInvoicePDF(F.invoice, F.invoiceLines, F.company)],
  ["credit note", () => generateCreditNotePDF(F.creditNote, F.docLines, F.company, F.invoice)],
  ["quotation", () => generateQuotePDF(F.quote, F.docLines, F.company)],
  ["purchase order", () => generatePurchaseOrderPDF(F.purchaseOrder, F.docLines, F.company)],
];

describe.each(generators)("Arabic rendering in the %s PDF", (_name, generate) => {
  it("embeds Noto Sans Arabic and draws Arabic text with real glyphs (no .notdef)", async () => {
    const buf = await generate();
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");

    // (a) the Arabic font is in the PDF font dictionary
    expect(buf.toString("latin1")).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSansArabic-(Regular|Bold)/);

    // (b) glyphs were drawn with it, and none of them is glyph 0 (.notdef)
    const codes = arabicGlyphCodes(buf);
    expect(codes.length).toBeGreaterThan(20);
    expect(codes).not.toContain("0000");

    // (c) sane size: only the used glyphs are embedded, not whole fonts
    expect(buf.length).toBeGreaterThan(5_000);
    expect(buf.length).toBeLessThan(150_000);
  });

  it("places the Arabic document label in the right half of the header", async () => {
    // pdfjs reports unreliable glyph WIDTHS for shaped Arabic, so assert on the
    // start x only: a right-aligned label starts well right of the page centre
    // and never beyond the right margin.
    const items = await pageItems(await generate());
    const headerArabic = items.filter(
      (it) => it.y > 760 && it.y < 800 && /[^\x20-\x7E]|[\u0001-\u001f]/.test(it.str) && it.x > 300
    );
    expect(headerArabic.length).toBeGreaterThan(0);
    for (const it of headerArabic) expect(it.x).toBeLessThan(595.28 - 50);
  });
});

describe("English-only documents", () => {
  it("do not embed the Arabic font at all", async () => {
    const buf = await generateInvoicePDF(
      { ...F.invoice, customerName: "Elite Contracting Est.", customerAddress: "Abu Dhabi" },
      [{ ...F.invoiceLines[1] }],
      { ...F.company, name: "Gulf Trading LLC", businessAddress: "Dubai", companyType: "client" }
    );
    expect(buf.toString("latin1")).not.toContain("NotoSansArabic");
  });
});

describe("mixed Arabic + Latin + digits on one line", () => {
  it("draws the Latin run and TRN LEFT of the Arabic words, right-aligned as a block", async () => {
    const doc = createPdfDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
    doc.font("Helvetica").fontSize(14).text("شركة الخليج LLC 100123456700003", 50, 100, {
      width: 400,
      align: "right",
    });
    doc.end();
    const buf = await done;

    const items = await pageItems(buf);
    const latin = items.filter((it) => /^[\x20-\x7E]+$/.test(it.str));
    const arabic = items.filter((it) => !/^[\x20-\x7E]+$/.test(it.str));
    const joined = latin.map((it) => it.str).join(" ");
    expect(joined).toContain("LLC");
    expect(joined).toContain("100123456700003");
    // Latin text keeps its own left-to-right order: LLC before the TRN
    expect(joined.indexOf("LLC")).toBeLessThan(joined.indexOf("100123456700003"));
    // Arabic words are to the right of the Latin run
    const latinRight = Math.max(...latin.map((it) => it.x + it.w));
    const arabicLeft = Math.min(...arabic.map((it) => it.x));
    expect(arabicLeft).toBeGreaterThanOrEqual(latinRight - 1);
    // the block is right-aligned to x = 450: it starts at 450 - its own width
    const measure = createPdfDocument({ size: "A4", margin: 50 });
    measure.font("Helvetica").fontSize(14);
    const expectedLeft = 450 - measure.widthOfString("شركة الخليج LLC 100123456700003");
    expect(Math.min(...items.map((it) => it.x))).toBeGreaterThan(expectedLeft - 2);
    expect(Math.min(...items.map((it) => it.x))).toBeLessThan(expectedLeft + 2);
  });

  it("wraps a long Arabic name inside its width without overflowing", async () => {
    const doc = createPdfDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
    doc.font("Helvetica").fontSize(11);
    const width = 150;
    const height = doc.heightOfString(F.ARABIC_CUSTOMER, { width });
    expect(height).toBeGreaterThan(doc.currentLineHeight(true) * 1.5); // wrapped to 2+ lines
    doc.text(F.ARABIC_CUSTOMER, 50, 100, { width });
    doc.end();
    const items = await pageItems(await done);
    for (const it of items) {
      expect(it.x).toBeGreaterThanOrEqual(49);
      expect(it.x).toBeLessThanOrEqual(50 + width);
    }
    // more than one baseline => it really wrapped
    expect(new Set(items.map((it) => Math.round(it.y))).size).toBeGreaterThan(1);
  });
});
