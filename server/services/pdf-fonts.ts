/**
 * Arabic-capable PDF text engine for PDFKit.
 *
 * - Registers Noto Sans (Latin) and Noto Naskh Arabic (Arabic) with a PDFKit document.
 * - Lays text out itself: wraps words, runs the Unicode Bidirectional Algorithm (bidi-js) per
 *   line, orders mixed Arabic/Latin/number runs visually, draws each run with the right font
 *   (per-character fallback) and right-aligns RTL paragraphs.
 * - fontkit shapes Arabic (joining forms, ligatures) when a run is drawn; Arabic runs also get an
 *   `/ActualText` marked-content span so copy/paste and text extraction return the real Unicode
 *   text (Naskh shares dot-less base glyphs between letters, so glyph->Unicode maps are lossy).
 *
 * Reusable by invoice, credit note, quote, purchase order, payslip and statement PDFs:
 *   registerFonts(doc), text(doc, str, opts), isArabic(str)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bidiFactory from "bidi-js";

/** Optional position / layout arguments of pdfkit's `text` (x, y, options or options). */
type PdfTextArgs = [
  xOrOptions?: number | Record<string, unknown>,
  y?: number,
  options?: Record<string, unknown>,
];

/**
 * The slice of a pdfkit document the renderers use. pdfkit ships no type
 * declarations, so this structural type is the typed boundary; drawing calls
 * chain like pdfkit's own API. The `__*` slots are set by preparePdfDocument.
 */
export interface PdfDoc {
  x: number;
  y: number;
  page: {
    width: number;
    height: number;
    margins: { top: number; bottom: number; left: number; right: number };
  };
  bufferedPageRange(): { start: number; count: number };
  switchToPage(index: number): PdfDoc;
  _fontSize?: number;
  _font?: {
    ascender?: number;
    font?: { hasGlyphForCodePoint?: (codePoint: number) => boolean };
  };
  __arabicReady?: boolean;
  __bold?: boolean;
  __rawFont?: PdfDoc["font"];
  __rawWidth?: PdfDoc["widthOfString"];
  __rawText?: PdfDoc["text"];
  registerFont(name: string, src: string): PdfDoc;
  font(name: string, ...rest: unknown[]): PdfDoc;
  fontSize(size: number): PdfDoc;
  text(str: string | number, ...args: PdfTextArgs): PdfDoc;
  widthOfString(str: string, options?: Record<string, unknown>): number;
  heightOfString(str: string, options?: { width?: number }): number;
  addContent(data: string): PdfDoc;
  addPage(options?: Record<string, unknown>): PdfDoc;
  moveTo(x: number, y: number): PdfDoc;
  lineTo(x: number, y: number): PdfDoc;
  path(d: string): PdfDoc;
  rect(x: number, y: number, w: number, h: number): PdfDoc;
  roundedRect(x: number, y: number, w: number, h: number, r?: number): PdfDoc;
  lineWidth(width: number): PdfDoc;
  fillColor(color: string, opacity?: number): PdfDoc;
  fillOpacity(opacity: number): PdfDoc;
  strokeColor(color: string, opacity?: number): PdfDoc;
  fill(color?: string): PdfDoc;
  stroke(color?: string): PdfDoc;
  fillAndStroke(fillColor?: string, strokeColor?: string): PdfDoc;
  lineJoin(style: string): PdfDoc;
  lineCap(style: string): PdfDoc;
  save(): PdfDoc;
  restore(): PdfDoc;
  rotate(angle: number, options?: Record<string, unknown>): PdfDoc;
  image(src: string | Buffer, ...args: Array<number | Record<string, unknown>>): PdfDoc;
  on(event: string, listener: (...args: never[]) => void): PdfDoc;
  end(): void;
}

interface BidiEngine {
  getEmbeddingLevels(
    text: string,
    explicitDirection?: "ltr" | "rtl"
  ): { levels: Uint8Array; paragraphs: Array<{ start: number; end: number; level: number }> };
  getMirroredCharacter(char: string): string | null;
}

const bidi = (bidiFactory as () => BidiEngine)();

export const FONT_SANS = "NR-Sans";
export const FONT_SANS_BOLD = "NR-Sans-Bold";
export const FONT_ARABIC = "NR-Naskh";
export const FONT_ARABIC_BOLD = "NR-Naskh-Bold";

const FONT_FILES: Record<string, string> = {
  [FONT_SANS]: "noto-sans-latin-400-normal.woff",
  [FONT_SANS_BOLD]: "noto-sans-latin-700-normal.woff",
  [FONT_ARABIC]: "noto-naskh-arabic-arabic-400-normal.woff",
  [FONT_ARABIC_BOLD]: "noto-naskh-arabic-arabic-700-normal.woff",
};

let fontsDirCache: string | null = null;

function resolveFontsDir(): string {
  if (fontsDirCache) return fontsDirCache;
  const candidates: string[] = [];
  if (process.env.PDF_FONTS_DIR) candidates.push(process.env.PDF_FONTS_DIR);
  candidates.push(path.resolve(process.cwd(), "server/assets/fonts"));
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(path.resolve(here, "../assets/fonts"));
    candidates.push(path.resolve(here, "../server/assets/fonts"));
  } catch {
    // import.meta.url unavailable; cwd-based candidates are enough.
  }
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, FONT_FILES[FONT_SANS]))) {
      fontsDirCache = dir;
      return dir;
    }
  }
  throw new Error(`PDF fonts not found. Looked in: ${candidates.join(", ")}`);
}

/** Registers the Noto Sans + Noto Naskh Arabic families on a PDFKit document. */
export function registerFonts(doc: PdfDoc): void {
  const dir = resolveFontsDir();
  for (const [name, file] of Object.entries(FONT_FILES)) {
    doc.registerFont(name, path.join(dir, file));
  }
}

const ARABIC_RE =
  /[\u0600-\u06FF\u0750-\u077F\u0870-\u089F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const ARABIC_RE_G = new RegExp(ARABIC_RE.source, "g");

/** True when the string contains at least one Arabic-script character. */
export function isArabic(str: string | null | undefined): boolean {
  return !!str && ARABIC_RE.test(str);
}

/** Share of letters that are Arabic (0..1); used to choose paragraph direction. */
export function arabicRatio(str: string): number {
  const arabic = (str.match(ARABIC_RE_G) ?? []).length;
  const latin = (str.match(/[A-Za-z]/g) ?? []).length;
  return arabic + latin === 0 ? 0 : arabic / (arabic + latin);
}

function isArabicIndicDigit(ch: string): boolean {
  return /[٠-٩۰-۹]/.test(ch);
}

export interface PdfTextOptions {
  x?: number;
  y?: number;
  width?: number;
  /** "start"/"end" follow the paragraph direction; left/right/center are absolute. */
  align?: "left" | "right" | "center" | "start" | "end";
  bold?: boolean;
  size?: number;
  color?: string;
  /** Force paragraph direction. Default: auto (first strong character). */
  rtl?: boolean;
  /** Draw on one line without wrapping (default false). */
  singleLine?: boolean;
  /** Extra leading between lines, in points. */
  lineGap?: number;
}

export interface PdfTextResult {
  /** Total height consumed, in points. */
  height: number;
  /** Y coordinate just below the last line. */
  endY: number;
  lines: number;
}

type FontClass = "sans" | "ar";

interface Run {
  text: string;
  level: number;
  cls: FontClass;
  digits: boolean;
}

function fontName(cls: FontClass, bold: boolean): string {
  if (cls === "ar") return bold ? FONT_ARABIC_BOLD : FONT_ARABIC;
  return bold ? FONT_SANS_BOLD : FONT_SANS;
}

const glyphSupportCache = new Map<string, boolean>();

function fontHasGlyph(doc: PdfDoc, name: string, codePoint: number): boolean {
  const key = `${name}:${codePoint}`;
  const cached = glyphSupportCache.get(key);
  if (cached !== undefined) return cached;
  setFont(doc, name);
  const result = !!doc._font?.font?.hasGlyphForCodePoint?.(codePoint);
  glyphSupportCache.set(key, result);
  return result;
}

function classify(ch: string, previous: FontClass, doc: PdfDoc): FontClass {
  if (isArabic(ch) || isArabicIndicDigit(ch)) return "ar";
  const cp = ch.codePointAt(0) ?? 0;
  // Whitespace stays with its neighbour so Arabic phrases remain one run (extra word spacing added).
  if (/\s/.test(ch)) return previous;
  if (fontHasGlyph(doc, FONT_SANS, cp)) return "sans";
  if (fontHasGlyph(doc, FONT_ARABIC, cp)) return "ar";
  return "sans";
}

function directionFor(str: string, rtl: boolean | undefined): "ltr" | "rtl" {
  if (rtl !== undefined) return rtl ? "rtl" : "ltr";
  // First strong character decides, like the Unicode default (UAX #9 rules P2/P3).
  for (const ch of str) {
    if (isArabic(ch)) return "rtl";
    if (/[A-Za-z]/.test(ch)) return "ltr";
  }
  return "ltr";
}

/** Split one visual line (logical order) into same-level, same-font runs in visual order. */
function buildRuns(doc: PdfDoc, line: string, dir: "ltr" | "rtl"): Run[] {
  if (!line) return [];
  const { levels } = bidi.getEmbeddingLevels(line, dir);
  const chars = Array.from(line);
  // bidi-js indexes by UTF-16 code unit; build per-char level using code unit offsets.
  const runs: Run[] = [];
  let offset = 0;
  let prevClass: FontClass = "sans";
  for (const ch of chars) {
    const level = levels[offset] ?? (dir === "rtl" ? 1 : 0);
    const cls = classify(ch, prevClass, doc);
    prevClass = cls;
    const digit = isArabicIndicDigit(ch);
    const last = runs[runs.length - 1];
    if (last && last.level === level && last.cls === cls && last.digits === digit) {
      last.text += ch;
    } else {
      runs.push({ text: ch, level, cls, digits: digit });
    }
    offset += ch.length;
  }
  // Edge whitespace of Arabic runs becomes its own Sans run: fontkit drops/narrows it otherwise.
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (run.cls !== "ar" || run.digits) continue;
    const trimmed = run.text.trim();
    if (!trimmed || trimmed === run.text) continue;
    const lead = run.text.slice(0, run.text.indexOf(trimmed));
    const trail = run.text.slice(lead.length + trimmed.length);
    const parts: Run[] = [];
    if (lead) parts.push({ text: lead, level: run.level, cls: "sans", digits: false });
    parts.push({ ...run, text: trimmed });
    if (trail) parts.push({ text: trail, level: run.level, cls: "sans", digits: false });
    runs.splice(i, 1, ...parts);
    i += parts.length - 1;
  }
  // UAX #9 rule L2: reverse contiguous runs from the highest level down to the lowest odd level.
  const lvls = runs.map((r) => r.level);
  const maxLevel = Math.max(...lvls);
  const minOdd = Math.min(...lvls.filter((l) => l % 2 === 1), Infinity);
  for (let l = maxLevel; l >= minOdd && Number.isFinite(minOdd); l--) {
    let i = 0;
    while (i < runs.length) {
      if (runs[i].level >= l) {
        let j = i;
        while (j + 1 < runs.length && runs[j + 1].level >= l) j++;
        const slice = runs.slice(i, j + 1).reverse();
        runs.splice(i, slice.length, ...slice);
        i = j + 1;
      } else {
        i++;
      }
    }
  }
  return runs;
}

function mirror(textRun: string): string {
  let out = "";
  for (const ch of textRun) out += bidi.getMirroredCharacter(ch) ?? ch;
  return out;
}

/** Naskh's own space glyph is only 0.22em wide, so Arabic words are placed with this gap. */
const ARABIC_WORD_GAP = 0.3;

/** Words of an Arabic run in logical order; PDFKit's wordSpacing path breaks RTL order. */
function splitWords(textRun: string): string[] {
  return textRun.split(/\s+/).filter((w) => w.length > 0);
}

function runWidth(doc: PdfDoc, run: Run, size: number, bold: boolean): number {
  setFont(doc, fontName(run.cls, bold)).fontSize(size);
  const value = run.level % 2 === 1 ? mirror(run.text) : run.text;
  if (run.cls !== "ar" || run.digits || !/\s/.test(value.trim())) return rawWidth(doc, value);
  const words = splitWords(value);
  return (
    words.reduce((sum, w) => sum + rawWidth(doc, w), 0) +
    (words.length - 1) * size * ARABIC_WORD_GAP
  );
}

function lineWidth(doc: PdfDoc, line: string, dir: "ltr" | "rtl", size: number, bold: boolean) {
  const runs = buildRuns(doc, line, dir);
  return runs.reduce((sum, run) => sum + runWidth(doc, run, size, bold), 0);
}

function toUtf16Hex(str: string): string {
  let hex = "FEFF";
  for (let i = 0; i < str.length; i++) hex += str.charCodeAt(i).toString(16).padStart(4, "0");
  return hex.toUpperCase();
}

function drawRun(
  doc: PdfDoc,
  run: Run,
  x: number,
  y: number,
  size: number,
  bold: boolean,
  baselineRefAscent: number
): number {
  const name = fontName(run.cls, bold);
  setFont(doc, name).fontSize(size);
  const ascent = (doc._font?.ascender ?? 0) * (size / 1000);
  const runY = y + (baselineRefAscent - ascent);
  const rtlRun = run.level % 2 === 1;
  const drawable = rtlRun ? mirror(run.text) : run.text;
  const width = runWidth(doc, run, size, bold);
  if (!drawable.trim()) return width;

  if (run.digits && !rtlRun) {
    // Arabic-Indic digits are drawn left-to-right: fontkit would reverse a whole Arabic run.
    let cx = x;
    for (const ch of drawable) {
      rawText(doc, ch, cx, runY, { lineBreak: false });
      cx += rawWidth(doc, ch);
    }
    return width;
  }

  const needsActualText = isArabic(run.text) || run.digits;
  if (needsActualText) {
    // Extractors such as poppler treat marked-content text as visual order and apply their own
    // bidi pass, so RTL runs carry their characters reversed; LTR runs stay as written.
    const actual = rtlRun ? Array.from(run.text).reverse().join("") : run.text;
    doc.addContent(`/Span <</ActualText <${toUtf16Hex(actual)}>>> BDC`);
  }
  const multiWord = run.cls === "ar" && /\s/.test(drawable.trim());
  if (multiWord) {
    // fontkit reverses glyphs inside each word; word order is reversed here (RTL, visual order).
    const gap = size * ARABIC_WORD_GAP;
    const visualWords = splitWords(drawable).reverse();
    let wx = x;
    for (const word of visualWords) {
      rawText(doc, word, wx, runY, { lineBreak: false });
      wx += rawWidth(doc, word) + gap;
    }
  } else {
    rawText(doc, drawable, x, runY, { lineBreak: false });
  }
  if (needsActualText) doc.addContent("EMC");
  return width;
}

function wrapParagraph(
  doc: PdfDoc,
  paragraph: string,
  dir: "ltr" | "rtl",
  size: number,
  bold: boolean,
  maxWidth: number | undefined
): string[] {
  if (maxWidth === undefined || maxWidth <= 0) return [paragraph];
  const words = paragraph.split(/(\s+)/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current + word;
    if (!current || lineWidth(doc, candidate.trimEnd(), dir, size, bold) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (/^\s+$/.test(word)) continue;
    lines.push(current.trimEnd());
    current = word;
  }
  if (current) lines.push(current.trimEnd());

  // Hard-break words that are wider than the box (e.g. long IBANs).
  const out: string[] = [];
  for (const line of lines) {
    if (lineWidth(doc, line, dir, size, bold) <= maxWidth || line.length < 2) {
      out.push(line);
      continue;
    }
    let chunk = "";
    for (const ch of Array.from(line)) {
      if (chunk && lineWidth(doc, chunk + ch, dir, size, bold) > maxWidth) {
        out.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    if (chunk) out.push(chunk);
  }
  return out.length ? out : [""];
}

/**
 * Draw `str` at (x, y). Handles Arabic shaping, bidi ordering, wrapping and alignment.
 * Falls back to the document cursor when x/y are omitted.
 */
export function text(
  doc: PdfDoc,
  str: string | number | null | undefined,
  opts: PdfTextOptions = {}
): PdfTextResult {
  const value = str === null || str === undefined ? "" : String(str);
  const size = opts.size ?? doc._fontSize ?? 10;
  const bold = !!opts.bold;
  const x = opts.x ?? doc.x;
  const y = opts.y ?? doc.y;
  if (opts.color) doc.fillColor(opts.color);

  setFont(doc, fontName("sans", bold)).fontSize(size);
  const sansAscent = (doc._font?.ascender ?? 0) * (size / 1000);
  const lineHeight = size * 1.35 + (opts.lineGap ?? 0);

  let cursorY = y;
  let lineCount = 0;
  const paragraphs = value.split(/\r?\n/);
  for (const paragraph of paragraphs) {
    const dir = directionFor(paragraph, opts.rtl);
    const lines = opts.singleLine
      ? [paragraph]
      : wrapParagraph(doc, paragraph, dir, size, bold, opts.width);
    for (const line of lines) {
      const runs = buildRuns(doc, line, dir);
      const total = runs.reduce((sum, run) => sum + runWidth(doc, run, size, bold), 0);
      let startX = x;
      if (opts.width !== undefined) {
        const align = resolveAlign(opts.align, dir);
        if (align === "right") startX = x + opts.width - total;
        else if (align === "center") startX = x + (opts.width - total) / 2;
      }
      let cx = startX;
      for (const run of runs) {
        cx += drawRun(doc, run, cx, cursorY, size, bold, sansAscent);
      }
      cursorY += lineHeight;
      lineCount++;
    }
  }
  doc.x = x;
  doc.y = cursorY;
  return { height: cursorY - y, endY: cursorY, lines: lineCount };
}

function resolveAlign(
  align: PdfTextOptions["align"],
  dir: "ltr" | "rtl"
): "left" | "right" | "center" {
  if (align === "center") return "center";
  if (align === "left" || align === "right") return align;
  const atEnd = align === "end";
  if (dir === "rtl") return atEnd ? "left" : "right";
  return atEnd ? "right" : "left";
}

/** Height `str` would occupy in a box of `width` (no drawing). */
export function measureHeight(
  doc: PdfDoc,
  str: string | number | null | undefined,
  opts: Pick<PdfTextOptions, "width" | "size" | "bold" | "rtl" | "lineGap"> = {}
): number {
  const value = str === null || str === undefined ? "" : String(str);
  const size = opts.size ?? doc._fontSize ?? 10;
  const lineHeight = size * 1.35 + (opts.lineGap ?? 0);
  let count = 0;
  for (const paragraph of value.split(/\r?\n/)) {
    const dir = directionFor(paragraph, opts.rtl);
    count += wrapParagraph(doc, paragraph, dir, size, !!opts.bold, opts.width).length;
  }
  return count * lineHeight;
}

/** Width of `str` on a single line. */
export function measureWidth(
  doc: PdfDoc,
  str: string | number | null | undefined,
  opts: Pick<PdfTextOptions, "size" | "bold" | "rtl"> = {}
): number {
  const value = str === null || str === undefined ? "" : String(str);
  const size = opts.size ?? doc._fontSize ?? 10;
  return lineWidth(doc, value, directionFor(value, opts.rtl), size, !!opts.bold);
}

function setFont(doc: PdfDoc, name: string): PdfDoc {
  const raw = doc.__rawFont ?? doc.font;
  raw.call(doc, name);
  return doc;
}

function rawWidth(doc: PdfDoc, str: string): number {
  return (doc.__rawWidth ?? doc.widthOfString).call(doc, str) as number;
}

function rawText(
  doc: PdfDoc,
  str: string,
  x: number,
  y: number,
  opts: Record<string, unknown>
): void {
  // PDFKit's text pipeline calls this.widthOfString internally; keep it un-patched meanwhile.
  const patched = doc.widthOfString;
  if (doc.__rawWidth) doc.widthOfString = doc.__rawWidth;
  try {
    (doc.__rawText ?? doc.text).call(doc, str, x, y, opts);
  } finally {
    doc.widthOfString = patched;
  }
}

export type PdfLocale = "en" | "ar";

/** Document locale for a company (R14-21): `ar` gives Arabic-first labels and RTL layout. */
export function pdfLocale(company: { locale?: string | null } | null | undefined): PdfLocale {
  return company?.locale === "ar" ? "ar" : "en";
}

/** Bilingual label; the company's own language comes first. */
export function bilingual(locale: PdfLocale, en: string, ar: string): string {
  return locale === "ar" ? `${ar} / ${en}` : `${en} / ${ar}`;
}

/**
 * Registers the fonts and makes the PDFKit instance Arabic-aware: `doc.text`, `widthOfString`
 * and `heightOfString` are routed through `text()` (bidi + shaping + fallback), and the built-in
 * Helvetica/Times names resolve to Noto Sans so existing layout code keeps working unchanged.
 */
export function preparePdfDocument(doc: PdfDoc): PdfDoc {
  if (doc.__arabicReady) return doc;
  registerFonts(doc);
  const rawFont = doc.font;
  doc.__rawFont = rawFont;
  doc.__rawWidth = doc.widthOfString;
  doc.__rawText = doc.text;
  doc.__bold = false;
  doc.font = function (name: string, ...rest: unknown[]) {
    if (typeof name === "string" && !name.startsWith("NR-")) {
      doc.__bold = /bold/i.test(name);
      rawFont.call(doc, doc.__bold ? FONT_SANS_BOLD : FONT_SANS, ...rest);
      return doc;
    }
    rawFont.call(doc, name, ...rest);
    return doc;
  };
  doc.font("Helvetica");
  doc.text = function (
    str: string | number,
    xOrOpts?: number | Record<string, unknown>,
    yArg?: number,
    optsArg?: Record<string, unknown>
  ) {
    const opts: Record<string, unknown> =
      typeof xOrOpts === "object" && xOrOpts !== null ? xOrOpts : (optsArg ?? {});
    const x = typeof xOrOpts === "number" ? xOrOpts : (opts.x as number | undefined);
    const y = typeof xOrOpts === "number" ? yArg : (opts.y as number | undefined);
    const align = opts.align as string | undefined;
    text(doc, str, {
      x,
      y,
      width: opts.width as number | undefined,
      align: align === "justify" ? "start" : (align as PdfTextOptions["align"]),
      rtl: opts.rtl as boolean | undefined,
      singleLine: opts.lineBreak === false,
      bold: doc.__bold,
      size: doc._fontSize,
    });
    return doc;
  };
  doc.widthOfString = (str: string) =>
    measureWidth(doc, str, { size: doc._fontSize, bold: doc.__bold });
  doc.heightOfString = (str: string, o?: { width?: number }) =>
    measureHeight(doc, str, { size: doc._fontSize, bold: doc.__bold, width: o?.width });
  doc.__arabicReady = true;
  return doc;
}

/** True when a document status means "not yet issued" (watermarked, never a tax document). */
export function isDraftStatus(status: string | null | undefined): boolean {
  return (status ?? "").trim().toLowerCase() === "draft";
}

/**
 * X6d: stamps a diagonal "DRAFT / مسودة" watermark on every page of a buffered document so a
 * draft cannot be sent as a tax invoice. The document must be created with `bufferPages: true`;
 * call this immediately before `doc.end()`. It is drawn last so header bars cannot hide it.
 */
export function stampDraftWatermark(doc: PdfDoc): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const { width, height } = doc.page;
    doc.save();
    doc.rotate(-35, { origin: [width / 2, height / 2] });
    doc.fillOpacity(0.16);
    const stamp = (str: string, y: number, size: number) =>
      text(doc, str, {
        x: 0,
        y,
        width,
        size,
        bold: true,
        color: "#DC2626",
        align: "center",
        singleLine: true,
      });
    stamp("DRAFT", height / 2 - 95, 120);
    stamp("مسودة", height / 2 + 25, 72);
    doc.restore();
  }
}
