// Text and glyph extraction helpers for the PDF render tests.
import { inflateSync } from "node:zlib";

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
export function arabicGlyphCodes(buf: Buffer): string[] {
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

/** Every text item of every page, joined with single spaces. */
export async function extractPdfText(buf: Buffer): Promise<string> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  const parts: string[] = [];
  for (let p = 1; p <= doc.numPages; p += 1) {
    const content = await (await doc.getPage(p)).getTextContent();
    for (const item of content.items as any[]) if (item.str.trim() !== "") parts.push(item.str);
  }
  return parts.join(" ");
}

export async function pdfPageCount(buf: Buffer): Promise<number> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return (await pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise).numPages;
}
