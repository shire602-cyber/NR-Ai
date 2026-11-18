/**
 * AS1 (A2, A3, A5): turn the model's text into display segments.
 *
 * - Citation markers ("[F3]", "[F6, F7]") never reach the reader: a marker right after an amount
 *   is a citation and is dropped (the figure shows in the figures table and its source chip); a
 *   marker standing alone is replaced by the cited figure's value.
 * - Amounts written in the text ("AED 55,480.5", "31,660.85 د.إ", "درهم 12") become `money`
 *   segments, so the client formats them with the app's money formatter (two decimals, grouping,
 *   "د.إ" after the figure in Arabic, one bidi-isolated unit that never breaks across lines).
 * - Filler closings ("feel free to ask", "consult a qualified professional") are removed.
 */
import type { AssistantFact } from "./assistant-facts";

export type AnswerSegment =
  | { type: "text"; text: string }
  | { type: "money"; value: number; currency: string }
  | { type: "number"; value: number };

const toLatinDigits = (s: string) =>
  s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".") // Arabic decimal separator
    .replace(/٬/g, ","); // Arabic thousands separator

const NUM = String.raw`[-−]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[-−]?\d+(?:\.\d+)?`;
const CUR = String.raw`AED|\bDhs?\.?|د\.إ\.?|درهم(?:اً|ا)?(?: إماراتي)?`;
const MARKERS = String.raw`\[\s*F\d+(?:\s*[,،]\s*F\d+)*\s*\]`;
// A citation group, optionally in parentheses: "[F3]", "([F3])", "[F3, F4]".
const CITE = String.raw`\(\s*${MARKERS}\s*\)|${MARKERS}`;

const TOKEN = new RegExp(
  [
    // 1: currency then number ("AED 1,234.5")
    String.raw`(?:${CUR})\s?(${NUM})`,
    // 2: number then currency ("1,234.50 AED", "1234 د.إ")
    String.raw`(${NUM})\s?(?:${CUR})`,
    // citations
    `(${CITE})`,
  ].join("|"),
  "gu"
);

const FILLER = [
  /[^.!?\n]*\bfeel free to (ask|reach out)[^.!?\n]*[.!?]?/gi,
  /[^.!?\n]*\blet me know if (you|there)[^.!?\n]*[.!?]?/gi,
  /[^.!?\n]*\b(consult|contact|speak (to|with))( with)? (a|an|your) (qualified |professional |certified )*(accountant|professional|tax (advisor|adviser|consultant)|expert)[^.!?\n]*[.!?]?/gi,
  /[^.!?\n]*\bfor personali[sz]ed professional advice[^.!?\n]*[.!?]?/gi,
  /[^.\n؟!]*(لا تتردد في (السؤال|التواصل))[^.\n؟!]*[.؟!]?/g,
  /[^.\n؟!]*(استشار(ة|ه) (محاسب|مستشار|خبير|مختص)|استشر (محاسب|مستشار|خبير|مختص)|ننصح(ك)? بالتواصل مع (محاسب|مستشار|خبير|مختص))[^.\n؟!]*[.؟!]?/g,
];

/** Remove closing filler and stray whitespace. */
export function stripFiller(text: string): string {
  let out = text;
  for (const re of FILLER) out = out.replace(re, "");
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

const parseNum = (raw: string) => Number(raw.replace(/,/g, "").replace("−", "-"));

/** Split an answer into text, money and number segments (see the module comment). */
export function segmentAnswer(
  raw: string,
  facts: ReadonlyArray<Pick<AssistantFact, "id" | "value" | "unit">>
): { segments: AnswerSegment[]; cited: string[]; plain: string } {
  const text = stripFiller(toLatinDigits(raw));
  const byId = new Map(facts.map((f) => [f.id, f]));
  const cited: string[] = [];
  const segments: AnswerSegment[] = [];
  const pushText = (t: string) => {
    if (!t) return;
    const last = segments[segments.length - 1];
    if (last?.type === "text") last.text += t;
    else segments.push({ type: "text", text: t });
  };
  let at = 0;
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    pushText(text.slice(at, start));
    at = start + m[0].length;
    if (m[1] !== undefined || m[2] !== undefined) {
      segments.push({ type: "money", value: parseNum(m[1] ?? m[2]), currency: "AED" });
      continue;
    }
    const ids = Array.from(m[3].matchAll(/F\d+/g)).map((x) => x[0]);
    for (const id of ids) if (!cited.includes(id)) cited.push(id);
    const fact = ids.length === 1 ? byId.get(ids[0]) : undefined;
    // A citation of a figure the sentence already states (or a list of ids): drop it.
    if (!fact || statedInSentence(segments, fact.value)) continue;
    segments.push(
      fact.unit === "AED"
        ? { type: "money", value: fact.value, currency: "AED" }
        : { type: "number", value: fact.value }
    );
  }
  pushText(text.slice(at));
  // Tidy spaces left before punctuation by a dropped citation.
  for (const s of segments) {
    if (s.type === "text")
      s.text = s.text.replace(/\s+([.,;:!?،؛؟)])/g, "$1").replace(/ {2,}/g, " ");
  }
  const plain = segments
    .map((s) =>
      s.type === "text"
        ? s.text
        : s.type === "money"
          ? `AED ${s.value.toFixed(2)}`
          : String(s.value)
    )
    .join("");
  return { segments, cited, plain };
}

/**
 * True when the current sentence (the segments since the last full stop or line break) already
 * states `value`, as an amount segment or as a number in the text ("5 open invoices [F7]").
 */
function statedInSentence(segments: AnswerSegment[], value: number): boolean {
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    if (s.type !== "text") {
      if (Math.abs(s.value - value) < 0.005) return true;
      continue;
    }
    const parts = s.text.split(/[.!?؟\n](?:\s|$)/);
    const tail = parts[parts.length - 1];
    for (const n of tail.matchAll(new RegExp(NUM, "g"))) {
      if (Math.abs(parseNum(n[0]) - value) < 0.005) return true;
    }
    if (parts.length > 1) return false;
  }
  return false;
}
