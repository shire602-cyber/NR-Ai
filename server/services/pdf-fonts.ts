// Shared PDF document factory: every server-side PDF (invoice, credit note,
// quote, purchase order) is created through `createPdfDocument` so Arabic text
// renders correctly everywhere.
//
// pdfkit's built-in Helvetica/Times fonts contain no Arabic glyphs, so Arabic
// strings used to render as blanks. The document created here:
//   - registers Noto Sans Arabic (SIL OFL 1.1, from the @fontsource npm
//     package so the licence is tracked by the lockfile) as an EXTRA font that
//     is only embedded when a page actually uses it;
//   - overrides text()/widthOfString()/heightOfString() so a string that
//     contains Arabic is laid out with the unicode bidi algorithm, wrapped by
//     words, aligned for its reading direction, and drawn unit by unit
//     (Arabic units in Noto Sans Arabic, everything else in the caller's
//     current font). A string with no Arabic goes straight to pdfkit, so
//     English documents are byte-for-byte unaffected.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
// @ts-ignore - pdfkit has no type declarations
import PDFDocument from "pdfkit";
import { containsArabic, layoutBidiLine, baseLevelOf, type BaseLevel } from "./pdf-rtl";

export const ARABIC_FONT_REGULAR = "NotoSansArabic-Regular";
export const ARABIC_FONT_BOLD = "NotoSansArabic-Bold";

const FONT_FILES = {
  [ARABIC_FONT_REGULAR]: "noto-sans-arabic-arabic-400-normal.woff",
  [ARABIC_FONT_BOLD]: "noto-sans-arabic-arabic-700-normal.woff",
} as const;

// Line height multiplier for wrapped Arabic lines (Arabic marks need more room
// than Helvetica's default leading).
const ARABIC_LINE_HEIGHT = 1.4;

const nodeRequire = createRequire(import.meta.url);
const fontCache = new Map<string, Buffer>();

function loadFont(name: keyof typeof FONT_FILES): Buffer {
  const cached = fontCache.get(name);
  if (cached) return cached;
  const file = nodeRequire.resolve(`@fontsource/noto-sans-arabic/files/${FONT_FILES[name]}`);
  const buffer = readFileSync(file);
  fontCache.set(name, buffer);
  return buffer;
}

type TextAlign = "left" | "right" | "center" | "justify";

interface RtlTextOptions {
  width?: number;
  align?: TextAlign;
  lineBreak?: boolean;
  [key: string]: unknown;
}

interface PreparedLine {
  text: string;
}

// pdfkit ships no type declarations; the merged interface lets the subclass use
// its (untyped) members such as `page`, `x`, `y`, `_font`.
interface RtlPdfDocument {
  [member: string]: any;
}

class RtlPdfDocument extends PDFDocument {
  constructor(options?: unknown) {
    super(options);
    this.registerFont(ARABIC_FONT_REGULAR, loadFont(ARABIC_FONT_REGULAR));
    this.registerFont(ARABIC_FONT_BOLD, loadFont(ARABIC_FONT_BOLD));
  }

  text(text: unknown, x?: unknown, y?: unknown, options?: unknown): this {
    const str = text == null ? "" : String(text);
    if (!containsArabic(str)) return super.text(text, x, y, options);
    this.drawArabicText(str, x, y, options);
    return this;
  }

  widthOfString(text: string, options?: unknown): number {
    if (!containsArabic(text)) return super.widthOfString(text, options);
    const fonts = this.fontSet();
    const widest = String(text)
      .split(/\r?\n/)
      .reduce((max, line) => Math.max(max, this.measureLine(line, baseLevelOf(line), fonts)), 0);
    fonts.restore();
    return widest;
  }

  heightOfString(text: string, options?: unknown): number {
    if (!containsArabic(text)) return super.heightOfString(text, options);
    const opts = (options ?? {}) as RtlTextOptions;
    const width = opts.width ?? this.page.width - this.x - this.page.margins.right;
    const fonts = this.fontSet();
    const lines = this.wrapLines(String(text), opts.lineBreak === false ? Infinity : width, fonts);
    fonts.restore();
    return lines.length * this.arabicLineHeight();
  }

  private arabicLineHeight(): number {
    return Math.max(this.currentLineHeight(true), this._fontSize * ARABIC_LINE_HEIGHT);
  }

  /** Resolve the Arabic font matching the current (regular/bold) font. */
  private fontSet() {
    const baseFont = this._font;
    const isBold = /bold/i.test(String(baseFont?.name ?? ""));
    this.font(isBold ? ARABIC_FONT_BOLD : ARABIC_FONT_REGULAR);
    const arabicFont = this._font;
    this._font = baseFont;
    return {
      base: baseFont,
      arabic: arabicFont,
      restore: () => {
        this._font = baseFont;
      },
    };
  }

  private measureLine(
    line: string,
    baseLevel: BaseLevel,
    fonts: ReturnType<RtlPdfDocument["fontSet"]>
  ): number {
    const size = this._fontSize;
    return layoutBidiLine(line, baseLevel).units.reduce(
      (sum, unit) => sum + (unit.arabic ? fonts.arabic : fonts.base).widthOfString(unit.text, size),
      0
    );
  }

  /** Greedy word wrap of every paragraph in `text` to `width` points. */
  private wrapLines(
    text: string,
    width: number,
    fonts: ReturnType<RtlPdfDocument["fontSet"]>
  ): Array<PreparedLine & { baseLevel: BaseLevel }> {
    const lines: Array<PreparedLine & { baseLevel: BaseLevel }> = [];
    for (const paragraph of text.split(/\r?\n/)) {
      const baseLevel = baseLevelOf(paragraph);
      const words = paragraph.split(" ");
      let current = "";
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (
          !current ||
          width === Infinity ||
          this.measureLine(candidate, baseLevel, fonts) <= width
        ) {
          current = candidate;
        } else {
          lines.push({ text: current, baseLevel });
          current = word;
        }
      }
      lines.push({ text: current, baseLevel });
    }
    return lines;
  }

  private drawArabicText(str: string, x?: unknown, y?: unknown, options?: unknown): void {
    let opts = options as RtlTextOptions | undefined;
    let px = x;
    let py = y;
    if (px !== null && typeof px === "object") {
      opts = px as RtlTextOptions;
      px = null;
      py = null;
    } else if (py !== null && typeof py === "object") {
      opts = py as RtlTextOptions;
      py = null;
    }
    if (typeof px === "number") this.x = px;
    if (typeof py === "number") this.y = py;

    const startX: number = this.x;
    const startY: number = this.y;
    const size: number = this._fontSize;
    const width = opts?.width ?? this.page.width - startX - this.page.margins.right;
    const fonts = this.fontSet();
    const lines = this.wrapLines(str, opts?.lineBreak === false ? Infinity : width, fonts);
    const lineHeight = this.arabicLineHeight();
    const baseAscent = (fonts.base.ascender / 1000) * size;

    let top = startY;
    for (const line of lines) {
      const { units } = layoutBidiLine(line.text, line.baseLevel);
      const measured = units.map((unit) => {
        const font = unit.arabic ? fonts.arabic : fonts.base;
        return { unit, font, width: font.widthOfString(unit.text, size) };
      });
      const lineWidth = measured.reduce((sum, m) => sum + m.width, 0);

      // A right-to-left paragraph with no explicit alignment is right-aligned
      // in its box; callers can force `align: "left"` to keep an anchored label.
      let align: TextAlign = opts?.align ?? (line.baseLevel === 1 ? "right" : "left");
      if (opts?.width == null && opts?.align == null) align = "left";
      let cursor = startX;
      if (align === "right") cursor = startX + width - lineWidth;
      else if (align === "center") cursor = startX + (width - lineWidth) / 2;

      for (const { unit, font, width: unitWidth } of measured) {
        if (unit.text.trim() !== "") {
          const unitAscent = (font.ascender / 1000) * size;
          this._font = font;
          super.text(unit.text, cursor, top + baseAscent - unitAscent, { lineBreak: false });
        }
        cursor += unitWidth;
      }
      top += lineHeight;
    }

    fonts.restore();
    this.x = startX;
    this.y = top;
  }
}

/**
 * Create a pdfkit document that renders Arabic correctly. Drop-in replacement
 * for `new PDFDocument(options)`.
 */
export function createPdfDocument(options?: unknown): any {
  return new RtlPdfDocument(options);
}
