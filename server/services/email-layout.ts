/**
 * Customer e-mail layout and number/date formatting.
 *
 * One responsive, table-based shell for every system-generated e-mail (invoice, reminders,
 * receipts, quotes, statements, portal codes, approver links, password reset), in English,
 * Arabic (RTL, `lang="ar"`) or both. It provides:
 *
 * - a hidden preheader, `<title>`, `lang`/`dir` on the root and on each language section;
 * - a fluid 600px card (`max-width`, with an Outlook ghost table) that keeps 16px gutters on a
 *   phone, and a bulletproof button (table cell, 48px tall) with the plain link repeated below;
 * - one footer: company line, "automated message" note with the reply address, "Sent with
 *   Muhasib.ai";
 * - a plain-text alternative built from the same content (`renderEmailText`), so the two parts
 *   never drift apart.
 *
 * Amounts and dates use the app's own formatters (client/src/lib/format-money and
 * format-date): Latin digits, `AED 1,250.00` in English, `1,250.00 د.إ` in Arabic,
 * `16 Nov 2026` / `16 نوفمبر 2026`.
 */
import { marketingBrand as PRODUCT_NAME } from "../../shared/marketing-brand";
import { formatDate as formatAppDate } from "../../client/src/lib/format-date";
import { formatMoneyText } from "../../client/src/lib/format-money";

export type EmailLanguage = "en" | "ar" | "bilingual";

export interface BilingualBlock {
  en: string;
  ar: string;
}

export interface BilingualEmailContent {
  heading: BilingualBlock;
  /** Already-escaped HTML paragraphs per language. */
  paragraphs: { en: string[]; ar: string[] };
  summary?: Array<{ label: BilingualBlock; value: string | BilingualBlock; strong?: boolean }>;
  button?: { url: string; label: BilingualBlock };
  brandName: string;
  /** Company line in the footer (name and address; never a TRN). */
  footer?: string;
  accent?: string;
  /** Inbox preview text; defaults to the first paragraph. */
  preheader?: BilingualBlock;
  /** Where replies go (the company's contact address), shown in the footer note. */
  contactEmail?: string | null;
  /** Small print shown above the footer (e.g. "this link expires in 14 days"). */
  note?: BilingualBlock;
}

const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPE_MAP[c]!);
}

// ─── Formatting (the app's single money/date rules) ─────────────────

/** `AED 1,250.00` / `1,250.00 د.إ` for an amount in major units. */
export function emailMoney(amount: number, currency: string | null | undefined): BilingualBlock {
  const value = Number(amount);
  return {
    en: formatMoneyText(value, currency ?? "AED", "en"),
    ar: formatMoneyText(value, currency ?? "AED", "ar"),
  };
}

/** `16 Nov 2026` / `16 نوفمبر 2026`; an em dash when there is no date. */
export function emailDate(
  value: Date | string | null | undefined,
  language: "en" | "ar" = "en"
): string {
  if (!value) return "—";
  return formatAppDate(value, language) || "—";
}

export function emailDateBlock(value: Date | string | null | undefined): BilingualBlock {
  return { en: emailDate(value, "en"), ar: emailDate(value, "ar") };
}

/** Pick the one-language string, or both for a bilingual message (`EN | AR`). */
export function pickText(block: BilingualBlock, language: EmailLanguage): string {
  if (language === "en") return block.en;
  if (language === "ar") return block.ar;
  return `${block.en} | ${block.ar}`;
}

/**
 * Honour an explicit choice first, then the customer's preference. Send both languages when
 * the preference is unknown, including when the supplier works in Arabic.
 */
export function resolveEmailLanguage(
  explicit?: string | null,
  customerPreferred?: string | null
): EmailLanguage {
  for (const v of [explicit, customerPreferred]) {
    if (v === "en" || v === "ar" || v === "bilingual") return v;
  }
  return "bilingual";
}

/** A name or number inside a sentence of the other direction keeps its own order. */
export function isolateInline(value: string, direction?: "ltr" | "rtl"): string {
  if (direction) {
    return `<span dir="${direction}" style="direction:${direction};unicode-bidi:isolate;">${escapeHtml(value)}</span>`;
  }
  return `<bdi>${escapeHtml(value)}</bdi>`;
}

// ─── HTML ───────────────────────────────────────────────────────────

const FONT = {
  en: "'Geist Sans','Geist','Segoe UI',Arial,sans-serif",
  ar: "'Geist Sans','Geist','Noto Sans Arabic',Tahoma,Arial,sans-serif",
};
const EMERALD = "#0B6A4A";
const INK = "#14241E";
const OFF_WHITE = "#F7F8F4";
const MUTED = "#4D6158";
const BORDER = "#DCE6DF";

function valueOf(v: string | BilingualBlock, lang: "en" | "ar"): string {
  return typeof v === "string" ? v : v[lang];
}

function section(dir: "ltr" | "rtl", lang: "en" | "ar", c: BilingualEmailContent): string {
  const align = dir === "rtl" ? "right" : "left";
  const opposite = dir === "rtl" ? "left" : "right";
  const face = `font-family:${FONT[lang]};`;
  const paragraphs = c.paragraphs[lang]
    .map(
      (p) =>
        `<p dir="${dir}" style="${face}color:${INK};font-size:15px;line-height:1.75;margin:0 0 14px;text-align:${align};">${p}</p>`
    )
    .join("");
  const summary = c.summary?.length
    ? `<table role="presentation" dir="${dir}" width="100%" cellpadding="0" cellspacing="0" bgcolor="${OFF_WHITE}" style="background:${OFF_WHITE};border:1px solid ${BORDER};border-radius:8px;margin:6px 0 20px;">${c.summary
        .map(
          (row) =>
            `<tr><td dir="${dir}" align="${align}" style="${face}padding:9px 14px;color:${MUTED};font-size:13px;line-height:1.6;">${escapeHtml(
              row.label[lang]
            )}</td><td dir="${dir}" align="${opposite}" style="${face}padding:9px 14px;color:${INK};font-size:14px;line-height:1.6;${
              row.strong ? "font-weight:bold;" : ""
            }">${typeof row.value === "string" ? isolateInline(row.value, "ltr") : escapeHtml(row.value[lang])}</td></tr>`
        )
        .join("")}</table>`
    : "";
  const button = c.button
    ? `<table role="presentation" dir="${dir}" cellpadding="0" cellspacing="0" align="center" class="em-btn" style="margin:22px auto;"><tr><td align="center" bgcolor="${EMERALD}" style="border-radius:8px;mso-padding-alt:14px 32px;"><a href="${escapeHtml(
        c.button.url
      )}" style="${face}display:inline-block;background:${EMERALD};color:#ffffff;text-decoration:none;font-size:16px;font-weight:bold;line-height:22px;padding:14px 32px;border-radius:8px;mso-padding-alt:0;">${escapeHtml(
        c.button.label[lang]
      )}</a></td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;"><tr><td dir="ltr" align="center" style="padding:0 0 14px;font-family:${FONT.en};color:${MUTED};font-size:12px;line-height:1.6;word-break:break-all;overflow-wrap:anywhere;"><a dir="ltr" href="${escapeHtml(
        c.button.url
      )}" style="color:${MUTED};">${escapeHtml(c.button.url)}</a></td></tr></table>`
    : "";
  const heading = c.heading[lang]
    ? `<h2 dir="${dir}" style="${face}margin:0 0 14px;color:${escapeHtml(c.accent ?? INK)};font-size:22px;line-height:1.45;text-align:${align};">${escapeHtml(c.heading[lang])}</h2>`
    : "";
  const note = c.note
    ? `<p dir="${dir}" style="${face}color:${MUTED};font-size:13px;line-height:1.7;margin:0 0 6px;text-align:${align};">${escapeHtml(c.note[lang])}</p>`
    : "";
  return `<div dir="${dir}" lang="${lang}" style="direction:${dir};text-align:${align};${face}">${heading}${paragraphs}${summary}${button}${note}</div>`;
}

const FOOTER_AUTOMATED: BilingualBlock = {
  en: "This is an automated message from",
  ar: "هذه رسالة آلية من",
};
const FOOTER_REPLY: BilingualBlock = {
  en: "Questions? Write to",
  ar: "للاستفسار يرجى مراسلة",
};
const FOOTER_SENT_WITH: BilingualBlock = {
  en: "Sent with",
  ar: "أُرسلت عبر",
};

/** Footer sentences; `html` isolates the company name and the reply address so a Latin name
 * inside an Arabic sentence (or the reverse) keeps its own order and full stops. */
function footerLines(c: BilingualEmailContent, lang: "en" | "ar", html = false): string[] {
  const wrap = (v: string) => (html ? isolateInline(v) : v);
  const lines = [`${FOOTER_AUTOMATED[lang]} ${wrap(c.brandName)}.`];
  if (c.contactEmail) lines.push(`${FOOTER_REPLY[lang]} ${wrap(c.contactEmail)}.`);
  if (c.brandName !== PRODUCT_NAME) lines.push(`${FOOTER_SENT_WITH[lang]} ${wrap(PRODUCT_NAME)}`);
  return lines;
}

function preheaderOf(c: BilingualEmailContent, language: EmailLanguage): string {
  const raw = c.preheader
    ? pickText(c.preheader, language === "bilingual" ? "en" : language)
    : htmlToText(c.paragraphs[language === "ar" ? "ar" : "en"][0] ?? "");
  return raw.slice(0, 140);
}

/** English, Arabic (RTL) or both, in one accessible, responsive HTML email. */
export function renderBilingualEmail(c: BilingualEmailContent, language: EmailLanguage): string {
  const parts: string[] = [];
  if (language !== "ar") parts.push(section("ltr", "en", c));
  if (language === "bilingual")
    parts.push(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:26px 0;"><div style="border-top:1px solid ${BORDER};line-height:1px;font-size:1px;">&nbsp;</div></td></tr></table>`
    );
  if (language !== "en") parts.push(section("rtl", "ar", c));
  const rootLang = language === "ar" ? "ar" : "en";
  const rootDir = language === "ar" ? "rtl" : "ltr";
  const footerBlocks = (
    language === "bilingual" ? (["en", "ar"] as const) : ([rootLang] as const)
  ).map(
    (lang) =>
      `<p dir="${lang === "ar" ? "rtl" : "ltr"}" lang="${lang}" style="font-family:${FONT[lang]};color:${MUTED};font-size:12px;line-height:1.7;margin:0 0 6px;text-align:center;">${footerLines(c, lang, true).join(" ")}</p>`
  );
  const title = c.heading[rootLang] || c.brandName;
  const pre = escapeHtml(preheaderOf(c, language));
  return `<!DOCTYPE html>
<html lang="${rootLang}" dir="${rootDir}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<title>${escapeHtml(title)}</title>
<style>
@media only screen and (max-width:620px){
  .em-pad{padding:22px 16px !important}
  .em-btn,.em-btn td{width:100% !important}
  .em-btn a{display:block !important;box-sizing:border-box;width:100% !important;text-align:center !important}
}
</style>
</head>
<body style="margin:0;padding:0;background:${OFF_WHITE};font-family:${FONT[rootLang]};-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${OFF_WHITE};opacity:0;">${pre}${"&#8199;&#847; ".repeat(20)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${OFF_WHITE}" style="background:${OFF_WHITE};">
    <tr><td align="center" style="padding:24px 12px;">
      <!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;">
        <tr><td class="em-pad" dir="${rootDir}" bgcolor="${EMERALD}" align="${rootDir === "rtl" ? "right" : "left"}" style="background:${EMERALD};padding:22px 32px;">
          <span style="font-family:${FONT[rootLang]};color:#ffffff;font-size:20px;font-weight:bold;line-height:1.5;">${isolateInline(c.brandName)}</span>
        </td></tr>
        <tr><td class="em-pad" style="padding:28px 32px;">${parts.join("\n")}</td></tr>
        <tr><td class="em-pad" style="background:${OFF_WHITE};padding:18px 32px;border-top:1px solid ${BORDER};">
          ${c.footer ? `<p style="font-family:${FONT[rootLang]};color:${MUTED};font-size:12px;line-height:1.7;margin:0 0 6px;text-align:center;">${isolateInline(c.footer)}</p>` : ""}
          ${footerBlocks.join("\n")}
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body></html>`;
}

// ─── Plain text ─────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/** Escaped inline HTML (our paragraphs) back to readable text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h\d)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function textSection(lang: "en" | "ar", c: BilingualEmailContent): string {
  const out: string[] = [];
  if (c.heading[lang]) out.push(c.heading[lang], "");
  for (const p of c.paragraphs[lang]) out.push(htmlToText(p), "");
  if (c.summary?.length) {
    for (const row of c.summary) out.push(`${row.label[lang]}: ${valueOf(row.value, lang)}`);
    out.push("");
  }
  if (c.button) out.push(`${c.button.label[lang]}: ${c.button.url}`, "");
  if (c.note) out.push(c.note[lang], "");
  return out.join("\n").trim();
}

/** Plain-text alternative of the same content, same language choice. */
export function renderEmailText(c: BilingualEmailContent, language: EmailLanguage): string {
  const blocks: string[] = [];
  if (language !== "ar") blocks.push(textSection("en", c));
  if (language !== "en") blocks.push(textSection("ar", c));
  const foot: string[] = [];
  if (c.footer) foot.push(c.footer);
  for (const lang of language === "bilingual" ? (["en", "ar"] as const) : [language]) {
    foot.push(footerLines(c, lang).join(" "));
  }
  return `${blocks.join("\n\n---\n\n")}\n\n--\n${foot.join("\n")}\n`;
}
