/**
 * "Ledger" PDF layout (Fable spec 2.8): the one family every customer document uses — invoice,
 * credit note, quote, purchase order, delivery note, payslip, receipt and customer statement.
 *
 *   ┌ 2 pt accent rule ───────────────────────────────────────────────┐
 *   │ logo / company name, TRN, address          Document title (18)  │
 *   │                                            العنوان (13)          │
 *   ├ 0.5 pt hairline ────────────────────────────────────────────────┤
 *   │ meta row: label (EN over AR, 7 pt) / value (9.5 pt)             │
 *   │ parties: From | Bill to                                         │
 *   │ line table (#F3F5F7 header, hairline rows, numbers end-aligned) │
 *   │                                       totals block, 78 mm wide  │
 *   │                                       ▇ Amount due (accent) ▇   │
 *   ├ hairline ───────────────────────────────────────────────────────┤
 *   │ Generated with Muhasib.ai                          Page x of y  │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * Layout only: callers pass already-computed figures; every amount is printed through the shared
 * money formatter (shared/money.ts via server/utils/money-format.ts), so grouping is always
 * applied ("AED 9,500.00"). Arabic-first documents (company locale `ar`) mirror the grid.
 */
// @ts-expect-error - pdfkit has no type declarations
import PDFDocument from "pdfkit";
import { resolveDocumentAccent } from "../../shared/document-accent";
import { formatFils, tryToFils } from "../../shared/money";
import { formatMoneyAmount } from "../utils/money-format";
import { UAE_VAT_RATE } from "../constants";
import {
  ltr,
  measureHeight,
  measureWidth,
  preparePdfDocument,
  text,
  type PdfDoc,
  type PdfLocale,
} from "./pdf-fonts";

export { ltr };

/**
 * Gap before a second-language line: Arabic glyphs reach below the Latin line box, so a line
 * under Arabic text gets a little more room.
 */
function lineAdjust(above: string): number {
  return /[\u0600-\u06FF]/.test(above) ? 1.5 : -1;
}

/** 1 mm in PDF points. */
export const MM = 72 / 25.4;

export const LEDGER_COLORS = {
  ink: "#111827",
  body: "#1F2937",
  muted: "#6B7280",
  faint: "#9CA3AF",
  hairline: "#D9DEE3",
  rowRule: "#E7EAEE",
  tableHead: "#F3F5F7",
  success: "#15803D",
  white: "#FFFFFF",
} as const;

/** A label in both languages. */
export interface Bi {
  en: string;
  ar: string;
}

export const bi = (en: string, ar: string): Bi => ({ en, ar });

export type PageSize = "A4" | "A5";

const PAGE_SIZES: Record<PageSize, { width: number; height: number; margin: number }> = {
  A4: { width: 595.28, height: 841.89, margin: 18 * MM },
  A5: { width: 419.53, height: 595.28, margin: 14 * MM },
};

/** Space kept free above the bottom margin for the footer. */
const FOOTER_RESERVE = 26;

export interface LedgerOptions {
  locale: PdfLocale;
  accent?: string | null;
  size?: PageSize;
  info: { Title: string; Author?: string; Subject?: string };
}

/** A document under construction plus its grid. */
export class Ledger {
  readonly doc: PdfDoc;
  readonly locale: PdfLocale;
  readonly rtl: boolean;
  readonly accent: string;
  readonly margin: number;
  readonly width: number;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly done: Promise<Buffer>;
  /** Current cursor (top of the next block). */
  y: number;
  /** Optional block redrawn at the top of every continuation page (table header etc.). */
  private continuation: (() => void) | null = null;

  constructor(opts: LedgerOptions) {
    const size = PAGE_SIZES[opts.size ?? "A4"];
    this.locale = opts.locale;
    this.rtl = opts.locale === "ar";
    this.accent = resolveDocumentAccent(opts.accent);
    this.margin = size.margin;
    this.pageWidth = size.width;
    this.pageHeight = size.height;
    this.width = size.width - 2 * size.margin;
    this.doc = new PDFDocument({
      size: opts.size ?? "A4",
      margin: size.margin,
      bufferPages: true,
      info: { Creator: "Muhasib.ai", ...opts.info },
    }) as PdfDoc;
    preparePdfDocument(this.doc);
    const chunks: Buffer[] = [];
    this.done = new Promise<Buffer>((resolve, reject) => {
      this.doc.on("data", (c: Buffer) => chunks.push(c));
      this.doc.on("end", () => resolve(Buffer.concat(chunks)));
      this.doc.on("error", reject);
    });
    this.y = this.margin;
  }

  /** Lowest y content may reach on a page. */
  get bottom(): number {
    return this.pageHeight - this.margin - FOOTER_RESERVE;
  }

  /** x of a box that starts `offset` points from the logical start edge. */
  x(offset: number, w: number): number {
    return this.rtl ? this.margin + this.width - offset - w : this.margin + offset;
  }

  get start(): "left" | "right" {
    return this.rtl ? "right" : "left";
  }

  get end(): "left" | "right" {
    return this.rtl ? "left" : "right";
  }

  /** [company language, other language]. */
  pair(label: Bi): [string, string] {
    return this.rtl ? [label.ar, label.en] : [label.en, label.ar];
  }

  /**
   * "Primary / Secondary" on one line. Each half is a first-strong isolate so the slash sits
   * between the two phrases in either paragraph direction.
   */
  inline(label: Bi): string {
    const [a, b] = this.pair(label);
    return `\u2068${a}\u2069 / \u2068${b}\u2069`;
  }

  /**
   * Both languages for small print, document language first, each on its own line so a wrapped
   * sentence never mixes directions.
   */
  sentence(label: Bi): string {
    const [a, b] = this.pair(label);
    return `${a}\n${b}`;
  }

  /** Starts a new page when `height` does not fit below the cursor. */
  ensure(height: number): void {
    if (this.y + height <= this.bottom) return;
    this.doc.addPage();
    this.y = this.margin;
    this.continuation?.();
  }

  setContinuation(fn: (() => void) | null): void {
    this.continuation = fn;
  }

  hairline(y: number, color: string = LEDGER_COLORS.hairline, weight = 0.5): void {
    this.doc
      .save()
      .lineWidth(weight)
      .moveTo(this.margin, y)
      .lineTo(this.margin + this.width, y)
      .strokeColor(color)
      .stroke()
      .restore();
  }

  /**
   * Two-line label: company language on top, the other language beneath (EN over AR for an
   * English company). Returns the y below it.
   */
  stacked(
    label: Bi,
    x: number,
    y: number,
    w: number,
    o: {
      size?: number;
      secondarySize?: number;
      color?: string;
      secondaryColor?: string;
      bold?: boolean;
      align?: "left" | "right" | "center";
    } = {}
  ): number {
    const [a, b] = this.pair(label);
    const size = o.size ?? 7;
    const align = o.align ?? this.start;
    let endY = text(this.doc, a, {
      x,
      y,
      width: w,
      size,
      bold: o.bold,
      color: o.color ?? LEDGER_COLORS.muted,
      align,
    }).endY;
    if (b && b !== a) {
      endY = text(this.doc, b, {
        x,
        y: endY + lineAdjust(a),
        width: w,
        size: o.secondarySize ?? size,
        color: o.secondaryColor ?? o.color ?? LEDGER_COLORS.muted,
        align,
      }).endY;
    }
    return endY;
  }

  // ─── Blocks ───────────────────────────────────────────────────────────────

  /**
   * Header: accent rule, company block at the start side, stacked bilingual title at the end
   * side, hairline. Long company names wrap inside their own column, never under the title.
   */
  header(h: {
    companyName: string;
    logo?: Buffer | null;
    details: string[];
    title: Bi;
    /** Line under the title (e.g. a period), already bilingual or neutral. */
    subtitle?: string | null;
  }): void {
    const { doc } = this;
    const top = this.margin;
    doc
      .save()
      .rect(this.margin, top - 14, this.width, 2)
      .fill(this.accent)
      .restore();

    const startW = this.width * 0.56;
    const endW = this.width * 0.4;
    const sx = this.x(0, startW);
    let sy = top;
    let drewLogo = false;
    if (h.logo) {
      try {
        doc.image(h.logo, this.rtl ? sx + startW - 28 * MM : sx, sy, {
          fit: [28 * MM, 14 * MM],
          align: this.rtl ? "right" : "left",
        });
        sy += 14 * MM + 6;
        drewLogo = true;
      } catch {
        // An undecodable logo must never break a customer document.
      }
    }
    if (!drewLogo || h.companyName) {
      sy = text(doc, h.companyName, {
        x: sx,
        y: sy,
        width: startW,
        size: drewLogo ? 11 : 14,
        bold: true,
        color: LEDGER_COLORS.ink,
        align: this.start,
      }).endY;
    }
    sy += 2;
    for (const line of h.details.filter(Boolean)) {
      sy = text(doc, line, {
        x: sx,
        y: sy,
        width: startW,
        size: 8,
        color: LEDGER_COLORS.muted,
        align: this.start,
      }).endY;
    }

    const ex = this.x(this.width - endW, endW);
    const [primary, secondary] = this.pair(h.title);
    let ey = text(doc, primary, {
      x: ex,
      y: top - 2,
      width: endW,
      size: 18,
      bold: true,
      color: LEDGER_COLORS.ink,
      align: this.end,
    }).endY;
    // Arabic glyphs reach lower than the Latin line box: give an Arabic title a little more room.
    ey = text(doc, secondary, {
      x: ex,
      y: ey + (/[\u0600-\u06FF]/.test(primary) ? 3 : -2),
      width: endW,
      size: 13,
      color: LEDGER_COLORS.muted,
      align: this.end,
    }).endY;
    if (h.subtitle) {
      ey = text(doc, h.subtitle, {
        x: ex,
        y: ey + 2,
        width: endW,
        size: 8.5,
        color: LEDGER_COLORS.muted,
        align: this.end,
      }).endY;
    }
    this.y = Math.max(sy, ey) + 10;
    this.hairline(this.y);
    this.y += 14;
  }

  /** One row of label/value pairs (no tinted box). Values are drawn left-to-right isolated. */
  meta(fields: Array<{ label: Bi; value: string | null | undefined }>): void {
    const list = fields.filter((f) => f.value !== null && f.value !== undefined && f.value !== "");
    if (!list.length) return;
    const colW = this.width / list.length;
    let maxY = this.y;
    list.forEach((f, i) => {
      const x = this.x(i * colW, colW);
      const w = colW - 10;
      const lx = this.rtl ? x + 10 : x;
      const ly = this.stacked(f.label, lx, this.y, w, { size: 7 });
      const vy = text(this.doc, String(f.value), {
        x: lx,
        y: ly + 2,
        width: w,
        size: 9.5,
        bold: true,
        color: LEDGER_COLORS.ink,
        align: this.start,
      }).endY;
      maxY = Math.max(maxY, vy);
    });
    this.y = maxY + 14;
  }

  /** Two (or one) party columns: accent section label, name, then detail lines. */
  parties(list: Array<{ label: Bi; name: string; lines: Array<string | null | undefined> }>): void {
    const gap = 24;
    const colW = (this.width - gap * (list.length - 1)) / Math.max(1, list.length);
    let maxY = this.y;
    list.forEach((p, i) => {
      const x = this.x(i * (colW + gap), colW);
      let y = this.stacked(p.label, x, this.y, colW, {
        size: 7.5,
        bold: true,
        color: this.accent,
        secondaryColor: LEDGER_COLORS.muted,
        secondarySize: 7,
      });
      y = text(this.doc, p.name, {
        x,
        y: y + 3,
        width: colW,
        size: 10,
        bold: true,
        color: LEDGER_COLORS.ink,
        align: this.start,
      }).endY;
      for (const line of p.lines) {
        if (!line) continue;
        y = text(this.doc, line, {
          x,
          y,
          width: colW,
          size: 9,
          color: LEDGER_COLORS.body,
          align: this.start,
        }).endY;
      }
      maxY = Math.max(maxY, y);
    });
    this.y = maxY + 16;
  }

  /** A small accent section label (single language pair stacked) followed by space. */
  section(label: Bi): void {
    this.ensure(30);
    this.y =
      this.stacked(label, this.x(0, this.width), this.y, this.width, {
        size: 8,
        bold: true,
        color: this.accent,
        secondaryColor: LEDGER_COLORS.muted,
        secondarySize: 7,
      }) + 6;
  }

  /**
   * Line table. Columns stay inside the margins (widths from weights); headers are stacked
   * bilingual; rows break across pages with the header repeated.
   */
  table(columns: LedgerColumn[], rows: LedgerRow[], o: { size?: number } = {}): void {
    const size = o.size ?? 9;
    const pad = 5;
    const totalWeight = columns.reduce((s, c) => s + (c.weight ?? 1), 0);
    let acc = 0;
    const geo = columns.map((c) => {
      const w = ((c.weight ?? 1) / totalWeight) * this.width;
      const g = { ...c, w, x: this.x(acc, w) };
      acc += w;
      return g;
    });
    const align = (a: LedgerColumn["align"]) =>
      a === "end" ? this.end : a === "center" ? "center" : this.start;

    const headerHeight = Math.max(
      ...geo.map((c) => {
        const [a, b] = this.pair(c.label);
        const w = c.w - 2 * pad;
        return (
          measureHeight(this.doc, a, { size: 7.5, bold: true, width: w }) +
          (b && b !== a ? measureHeight(this.doc, b, { size: 7, width: w }) - 1 : 0)
        );
      })
    );
    const drawHeader = () => {
      const h = headerHeight + 10;
      this.doc.save().rect(this.margin, this.y, this.width, h).fill(LEDGER_COLORS.tableHead);
      this.doc.restore();
      for (const c of geo) {
        this.stacked(c.label, c.x + pad, this.y + 5, c.w - 2 * pad, {
          size: 7.5,
          secondarySize: 7,
          bold: true,
          color: LEDGER_COLORS.body,
          secondaryColor: LEDGER_COLORS.muted,
          align: align(c.align),
        });
      }
      this.y += h;
    };
    this.ensure(headerHeight + 10 + 24);
    drawHeader();
    this.setContinuation(drawHeader);

    for (const row of rows) {
      const cells = geo.map((c) => {
        const raw = row.cells[c.key];
        const cell: LedgerCell =
          raw === null || raw === undefined
            ? { text: "" }
            : typeof raw === "object"
              ? raw
              : { text: String(raw) };
        const cellSize = cell.size ?? size;
        const h = cell.text
          ? measureHeight(this.doc, cell.text, {
              size: cellSize,
              bold: cell.bold ?? row.bold,
              width: c.w - 2 * pad,
            })
          : 0;
        return { c, cell, cellSize, h };
      });
      const rowH = Math.max(22, ...cells.map((x) => x.h + 2 * pad + 1));
      this.ensure(rowH);
      for (const { c, cell, cellSize } of cells) {
        if (!cell.text) continue;
        text(this.doc, cell.text, {
          x: c.x + pad,
          y: this.y + pad + 1,
          width: c.w - 2 * pad,
          size: cellSize,
          bold: cell.bold ?? row.bold,
          color: cell.color ?? LEDGER_COLORS.body,
          align: align(c.align),
        });
      }
      this.y += rowH;
      this.hairline(this.y, LEDGER_COLORS.rowRule);
    }
    this.setContinuation(null);
    this.y += 14;
  }

  /**
   * Totals block, 78 mm wide at the end side inside the margins. `due` is the filled final row
   * (accent, white text).
   */
  totals(
    rows: Array<{ label: Bi; value: string; bold?: boolean; ruleAbove?: boolean }>,
    due?: { label: Bi; value: string; tone?: "accent" | "success" },
    o: { width?: number } = {}
  ): { top: number; bottom: number } {
    const tw = Math.min(o.width ?? 78 * MM, this.width);
    const estimate = rows.length * 24 + (due ? 44 : 0);
    this.ensure(estimate);
    const top = this.y;
    const bx = this.x(this.width - tw, tw);
    const pad = 6;
    /** Primary label with the other language beneath it; value on the primary line. */
    const rowHeight = (label: Bi, size: number) => {
      const [a, b] = this.pair(label);
      return size * 1.35 + (b && b !== a ? (size - 2) * 1.35 - 1 : 0);
    };
    const row = (
      label: Bi,
      value: string,
      opts: { bold?: boolean; color?: string; size?: number; secondaryColor?: string }
    ) => {
      const size = opts.size ?? 9;
      const color = opts.color ?? LEDGER_COLORS.body;
      const [a, b] = this.pair(label);
      const valueW = measureWidth(this.doc, value, { size, bold: opts.bold }) + 2;
      const labelW = tw - 2 * pad - valueW - 8;
      const lx = this.rtl ? bx + tw - pad - labelW : bx + pad;
      const startY = this.y;
      let endY = text(this.doc, a, {
        x: lx,
        y: startY,
        width: labelW,
        size,
        bold: opts.bold,
        color,
        align: this.start,
        singleLine: true,
      }).endY;
      if (b && b !== a) {
        endY = text(this.doc, b, {
          x: lx,
          y: endY + lineAdjust(a),
          width: labelW,
          size: size - 2,
          color: opts.secondaryColor ?? LEDGER_COLORS.muted,
          align: this.start,
          singleLine: true,
        }).endY;
      }
      text(this.doc, value, {
        x: this.rtl ? bx + pad : bx + tw - pad - valueW,
        y: startY,
        width: valueW,
        size,
        bold: opts.bold,
        color,
        align: this.end,
        singleLine: true,
      });
      return endY;
    };
    for (const r of rows) {
      if (r.ruleAbove) {
        this.doc
          .save()
          .lineWidth(0.5)
          .moveTo(bx, this.y - 1)
          .lineTo(bx + tw, this.y - 1)
          .strokeColor(LEDGER_COLORS.hairline)
          .stroke()
          .restore();
        this.y += 5;
      }
      this.y = row(r.label, r.value, { bold: r.bold }) + 5;
    }
    if (due) {
      this.y += 3;
      const fill = due.tone === "success" ? LEDGER_COLORS.success : this.accent;
      // The fill is sized from the label before drawing, so it always contains its text.
      const boxH = rowHeight(due.label, 11) + 14;
      this.doc.save().rect(bx, this.y, tw, boxH).fill(fill).restore();
      const before = this.y;
      this.y += 7;
      row(due.label, due.value, {
        bold: true,
        size: 11,
        color: LEDGER_COLORS.white,
        secondaryColor: LEDGER_COLORS.white,
      });
      this.y = before + boxH;
    }
    const bottom = this.y;
    this.y += 12;
    return { top, bottom };
  }

  /** A paragraph block (notes, terms, bank details) with an optional stacked label. */
  note(label: Bi | null, body: string, o: { width?: number; offset?: number } = {}): void {
    if (!body) return;
    const w = o.width ?? this.width;
    const x = this.x(o.offset ?? 0, w);
    const h = measureHeight(this.doc, body, { size: 8.5, width: w }) + (label ? 22 : 0);
    this.ensure(Math.min(h, 120));
    if (label) {
      this.y =
        this.stacked(label, x, this.y, w, {
          size: 7.5,
          bold: true,
          color: this.accent,
          secondaryColor: LEDGER_COLORS.muted,
          secondarySize: 7,
        }) + 2;
    }
    this.y =
      text(this.doc, body, {
        x,
        y: this.y,
        width: w,
        size: 8.5,
        color: LEDGER_COLORS.body,
        align: this.start,
      }).endY + 10;
  }

  /** Centered small print (legal lines), kept together with the content above it. */
  smallPrint(lines: string[]): void {
    const list = lines.filter(Boolean);
    if (!list.length) return;
    this.ensure(
      list.reduce((h, l) => h + measureHeight(this.doc, l, { size: 7.5, width: this.width }), 6)
    );
    for (const line of list) {
      this.y =
        text(this.doc, line, {
          x: this.margin,
          y: this.y,
          width: this.width,
          size: 7.5,
          color: LEDGER_COLORS.muted,
          align: "center",
        }).endY + 1;
    }
    this.y += 6;
  }

  /**
   * Footer on every page (hairline, "Generated with Muhasib.ai", "Page x of y"), then ends the
   * document. `beforeEnd` runs after the footer pass (the draft watermark goes there so nothing
   * is drawn over it).
   */
  finish(beforeEnd?: (doc: PdfDoc) => void): Promise<Buffer> {
    const { doc } = this;
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0;
      const fy = this.pageHeight - this.margin - 12;
      this.hairline(fy);
      const page = `${this.locale === "ar" ? `صفحة ${i + 1} من ${range.count}` : `Page ${i + 1} of ${range.count}`}`;
      const generated =
        this.locale === "ar" ? "أُنشئ باستخدام Muhasib.ai" : "Generated with Muhasib.ai";
      text(doc, generated, {
        x: this.margin,
        y: fy + 5,
        width: this.width,
        size: 7,
        color: LEDGER_COLORS.muted,
        align: this.start,
        singleLine: true,
      });
      text(doc, page, {
        x: this.margin,
        y: fy + 5,
        width: this.width,
        size: 7,
        color: LEDGER_COLORS.muted,
        align: this.end,
        singleLine: true,
      });
    }
    beforeEnd?.(doc);
    doc.end();
    return this.done;
  }
}

export interface LedgerCell {
  text: string;
  size?: number;
  bold?: boolean;
  color?: string;
}

export interface LedgerColumn {
  key: string;
  label: Bi;
  weight?: number;
  align?: "start" | "end" | "center";
}

export interface LedgerRow {
  cells: Record<string, string | LedgerCell | null | undefined>;
  bold?: boolean;
}

// ─── Formatting (one formatter for every document) ───────────────────────────

/** "AED 9,500.00": the app's money format (grouping always, 2 decimals, half-up to the fil). */
export function money(amount: number | string | null | undefined, currency = "AED"): string {
  return formatMoneyAmount(amount, currency);
}

/** "9,500.00" without a currency code, for table cells under a currency column. */
export function amount(value: number | string | null | undefined): string {
  const fils = tryToFils(value ?? 0, { rounding: "halfUp" }) ?? 0;
  return formatFils(fils, { currency: "" });
}

const MONTHS_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MONTHS_AR = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

/** "17 Nov 2026" (the app's date format); "—" when absent. ISO date strings are read as dates. */
export function date(value: Date | string | null | undefined): string {
  if (!value) return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return `${d} ${MONTHS_EN[m - 1].slice(0, 3)} ${y}`;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-AE", { year: "numeric", month: "short", day: "numeric" });
}

/** "September 2026" / "سبتمبر 2026". */
export function monthYear(month: number, year: number): Bi {
  return { en: `${MONTHS_EN[month - 1]} ${year}`, ar: `${MONTHS_AR[month - 1]} ${year}` };
}

/** Supply types that carry no output VAT whatever rate the line holds (FDL 8/2017 Arts. 45-46). */
const ZERO_VAT_SUPPLY_TYPES = new Set(["zero_rated", "exempt", "out_of_scope"]);

/**
 * VAT rate a document line prints and computes with. A zero-rated, exempt or out-of-scope line
 * is 0% even when its stored `vatRate` is missing or still holds the 5% default; any other line
 * uses its own rate, falling back to the UAE standard 5% when none is stored.
 */
export function lineVatRate(line: {
  vatRate?: number | null;
  vatSupplyType?: string | null;
}): number {
  const supply = (line.vatSupplyType ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (ZERO_VAT_SUPPLY_TYPES.has(supply)) return 0;
  return line.vatRate ?? UAE_VAT_RATE;
}

/** The line's VAT as a whole percentage for the VAT % column ("5", "0"). */
export function lineVatPercent(line: {
  vatRate?: number | null;
  vatSupplyType?: string | null;
}): string {
  return (lineVatRate(line) * 100).toFixed(0);
}

/** Plain quantity: integers as is, fractions to at most 4 places. */
export function quantity(q: number): string {
  return Number.isInteger(q) ? String(q) : String(Number(q.toFixed(4)));
}

/** Header detail lines for a company: TRN, address, then phone · email (Latin values isolated). */
export function companyDetails(
  ledger: Ledger,
  c: {
    trn?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
  }
): string[] {
  const contact = [c.phone, c.email]
    .filter(Boolean)
    .map((v) => ltr(v))
    .join("  ·  ");
  return [trnLine(ledger, c.trn) ?? "", c.address ?? "", contact].filter(Boolean);
}

/** "TRN ⁦100…⁩" / "الرقم الضريبي ⁦100…⁩" (document language) for a header or party block. */
export function trnLine(ledger: Ledger, trn: string | null | undefined): string | null {
  return trn ? `${ledger.rtl ? "الرقم الضريبي" : "TRN"} ${ltr(trn)}` : null;
}

/** A commercial document with the simple line model (credit note, quotation, purchase order). */
export interface SimpleDocument {
  locale: PdfLocale;
  accent?: string | null;
  info: { Title: string; Author: string };
  company: {
    name: string;
    legalName?: string | null;
    trn?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
  };
  logo?: Buffer | null;
  title: Bi;
  meta: Array<{ label: Bi; value: string | null | undefined }>;
  /** The other party (customer or vendor). */
  party: { label: Bi; name: string; trn?: string | null; address?: string | null };
  currency: string;
  lines: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    vatPercent: string;
    amount: number;
  }>;
  totals: { subtotal: number; vat: number; total: number; totalLabel: Bi };
  notes?: Array<{ label: Bi; text: string | null | undefined }>;
  /** Small print lines, each printed in both languages (document language first). */
  footer: Array<Bi | null>;
  /** Called with the document just before it ends (draft watermark). */
  beforeEnd?: (doc: PdfDoc) => void;
}

export function renderSimpleDocument(d: SimpleDocument): Promise<Buffer> {
  const ledger = new Ledger({ locale: d.locale, accent: d.accent, info: d.info });
  const c = d.company;
  ledger.header({
    companyName: c.name,
    logo: d.logo,
    details: companyDetails(ledger, c),
    title: d.title,
  });
  ledger.meta([...d.meta, { label: bi("Currency", "العملة"), value: d.currency }]);
  ledger.parties([
    {
      label: bi("From", "من"),
      name: c.legalName || c.name,
      lines: [trnLine(ledger, c.trn), c.address],
    },
    {
      label: d.party.label,
      name: d.party.name,
      lines: [trnLine(ledger, d.party.trn), d.party.address],
    },
  ]);
  ledger.table(
    [
      { key: "desc", label: bi("Description", "الوصف"), weight: 4 },
      { key: "qty", label: bi("Qty", "الكمية"), weight: 0.8, align: "end" },
      { key: "price", label: bi("Unit price", "سعر الوحدة"), weight: 1.5, align: "end" },
      { key: "vat", label: bi("VAT", "الضريبة"), weight: 0.8, align: "end" },
      { key: "amount", label: bi("Amount", "المبلغ"), weight: 1.6, align: "end" },
    ],
    d.lines.map((l) => ({
      cells: {
        desc: l.description,
        qty: quantity(l.quantity),
        price: amount(l.unitPrice),
        vat: `${l.vatPercent}%`,
        amount: amount(l.amount),
      },
    }))
  );
  ledger.totals(
    [
      { label: bi("Subtotal", "المجموع"), value: money(d.totals.subtotal, d.currency) },
      { label: bi("VAT", "الضريبة"), value: money(d.totals.vat, d.currency) },
    ],
    { label: d.totals.totalLabel, value: money(d.totals.total, d.currency) }
  );
  for (const n of d.notes ?? []) if (n.text) ledger.note(n.label, n.text);
  ledger.smallPrint(d.footer.map((f) => (f ? ledger.sentence(f) : "")));
  return ledger.finish(d.beforeEnd);
}
