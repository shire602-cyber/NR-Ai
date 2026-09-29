// Pure right-to-left text layout helpers for the PDF services.
//
// pdfkit (via fontkit) already performs Arabic CONTEXTUAL SHAPING and lays a
// single Arabic run out right-to-left, but it does NOT reorder runs inside a
// mixed string ("شركة الخليج LLC 100123456700003" comes out fully reversed).
// So shaping is deliberately NOT done here (doing it twice would corrupt the
// glyphs); this module only decides the visual ORDER and splits a line into
// units that can each be drawn with the right font:
//
//   - "arabic" units: Arabic-script text (drawn with the Noto Sans Arabic
//     font, shaped by fontkit at draw time)
//   - other units: Latin text, digits, spaces and punctuation (drawn with
//     the document's normal font so English output does not change)
//
// The unicode bidirectional algorithm itself comes from `bidi-js` (MIT).

// @ts-ignore - bidi-js ships no type declarations
import bidiFactory from "bidi-js";

const bidi = bidiFactory();

const ARABIC_SCRIPT = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
// Directional marks and embedding controls: they steer the algorithm but must
// not be drawn.
const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩]/;

export type BaseLevel = 0 | 1;

export interface BidiUnit {
  text: string;
  /** Embedding level from the bidi algorithm (odd = right-to-left). */
  level: number;
  /** True when the unit must be drawn with an Arabic-capable font. */
  arabic: boolean;
}

interface InternalUnit extends BidiUnit {
  single: boolean;
}

export function containsArabic(text: unknown): boolean {
  return typeof text === "string" && ARABIC_SCRIPT.test(text);
}

/** The product uses Western digits everywhere; normalise Arabic-Indic digits. */
export function normalizeDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
}

// A "Latin token" is a word made of letters/digits with the punctuation that
// legitimately lives inside amounts, dates, TRNs, e-mails and invoice numbers
// (1,050.00  12/03/2026  INV-0042  a@b.ae  +971). Consecutive tokens separated
// by single spaces ("LLC 100123456700003", "AED 1,050.00") are wrapped in a
// left-to-right isolate so they keep their reading order inside Arabic text.
const LATIN_TOKEN = "[+#@]?[A-Za-z0-9][A-Za-z0-9.,:/#%&+@_'\\-]*";
const LATIN_RUN = new RegExp(`${LATIN_TOKEN}(?: ${LATIN_TOKEN})*`, "g");
const LRI = "\u2066";
const PDI = "\u2069";

function isolateLatinRuns(text: string): string {
  return text.replace(LATIN_RUN, (run) => `${LRI}${run}${PDI}`);
}

/** Paragraph direction from the first strong character (UAX #9 rule P2/P3). */
export function baseLevelOf(text: string): BaseLevel {
  if (!text) return 0;
  const { paragraphs } = bidi.getEmbeddingLevels(text);
  return paragraphs[0]?.level === 1 ? 1 : 0;
}

/**
 * Split a single line into drawable units and return them in VISUAL
 * (left-to-right on the page) order.
 */
export function layoutBidiLine(
  input: string | null | undefined,
  baseLevel?: BaseLevel
): { baseLevel: BaseLevel; units: BidiUnit[] } {
  const text = normalizeDigits(input ?? "");
  if (!text) return { baseLevel: baseLevel ?? 0, units: [] };

  const paragraphLevel: BaseLevel = baseLevel ?? baseLevelOf(text);
  const isolated = isolateLatinRuns(text);
  const { levels } = bidi.getEmbeddingLevels(isolated, paragraphLevel === 1 ? "rtl" : "ltr");

  const logical: InternalUnit[] = [];
  for (let i = 0; i < isolated.length; i += 1) {
    const ch = isolated[i];
    if (BIDI_CONTROLS.test(ch)) continue;
    const level = levels[i] as number;
    const arabic = ARABIC_SCRIPT.test(ch);
    const last = logical[logical.length - 1];
    // Odd-level non-Arabic characters (spaces, punctuation, brackets) are kept
    // as single-character units so the reordering step reverses them
    // correctly and brackets can be mirrored.
    const single = !arabic && level % 2 === 1;
    if (last && !single && !last.single && last.level === level && last.arabic === arabic) {
      last.text += ch;
    } else {
      const mirrored = single ? (bidi.getMirroredCharacter(ch) as string | null) : null;
      logical.push({ text: mirrored ?? ch, level, arabic, single });
    }
  }

  const units = reorderVisually(logical);
  return {
    baseLevel: paragraphLevel,
    units: units.map(({ text: t, level, arabic }) => ({ text: t, level, arabic })),
  };
}

/** UAX #9 rule L2 applied to whole units. */
function reorderVisually<T extends { level: number }>(logical: T[]): T[] {
  if (logical.length === 0) return [];
  const result = [...logical];
  let maxLevel = 0;
  let minOddLevel = Number.POSITIVE_INFINITY;
  for (const unit of result) {
    if (unit.level > maxLevel) maxLevel = unit.level;
    if (unit.level % 2 === 1 && unit.level < minOddLevel) minOddLevel = unit.level;
  }
  for (let level = maxLevel; level >= minOddLevel; level -= 1) {
    let i = 0;
    while (i < result.length) {
      if (result[i].level >= level) {
        let j = i;
        while (j + 1 < result.length && result[j + 1].level >= level) j += 1;
        for (let a = i, b = j; a < b; a += 1, b -= 1) {
          const tmp = result[a];
          result[a] = result[b];
          result[b] = tmp;
        }
        i = j + 1;
      } else {
        i += 1;
      }
    }
  }
  return result;
}

/**
 * The line as it reads from LEFT to RIGHT on the page: units in visual order,
 * Arabic words still in logical letter order (the font's shaping engine
 * reverses the letters inside each word when it draws it). Latin text, digits,
 * TRNs, amounts and dates are returned untouched.
 */
export function prepareRtlText(input: string | null | undefined): string {
  return layoutBidiLine(input).units.map((u) => u.text).join("");
}
