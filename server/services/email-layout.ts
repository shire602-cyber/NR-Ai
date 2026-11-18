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
import { DOCUMENT_ACCENT_DEFAULT } from "../../shared/document-accent";
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
 * The language to write in: an explicit choice wins, then the customer's own language, then an
 * Arabic company's language (its customers are written to in Arabic), else both (a UAE
 * customer's preference is unknown until the firm records it).
 */
export function resolveEmailLanguage(
  explicit?: string | null,
  customerPreferred?: string | null,
  companyLocale?: string | null
): EmailLanguage {
  for (const v of [explicit, customerPreferred]) {
    if (v === "en" || v === "ar" || v === "bilingual") return v;
  }
  return companyLocale === "ar" ? "ar" : "bilingual";
}

/** A name or number inside a sentence of the other direction keeps its own order. */
export function isolateInline(value: string): string {
  return `<bdi>${escapeHtml(value)}</bdi>`;
}

// ─── HTML ───────────────────────────────────────────────────────────

const FONT = "Arial,'Noto Naskh Arabic','Segoe UI',Tahoma,sans-serif";

function valueOf(v: string | BilingualBlock, lang: "en" | "ar"): string {
  return typeof v === "string" ? v : v[lang];
}

function section(dir: "ltr" | "rtl", lang: "en" | "ar", c: BilingualEmailContent): string {
  const align = dir === "rtl" ? "right" : "left";
  const opposite = dir === "rtl" ? "left" : "right";
  const paragraphs = c.paragraphs[lang]
    .map(
      (p) =>
        `<p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 14px;text-align:${align};">${p}</p>`
    )
    .join("");
  const summary = c.summary?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;margin:6px 0 20px;">${c.summary
        .map(
          (row) =>
            `<tr><td style="padding:9px 14px;color:#6B7280;font-size:13px;text-align:${align};">${escapeHtml(
              row.label[lang]
            )}</td><td dir="${dir}" style="padding:9px 14px;color:#111827;font-size:14px;text-align:${opposite};${
              row.strong ? "font-weight:bold;" : ""
            }">${escapeHtml(valueOf(row.value, lang))}</td></tr>`
        )
        .join("")}</table>`
    : "";
  const accent = c.accent ?? DOCUMENT_ACCENT_DEFAULT;
  const button = c.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" align="center" class="em-btn" style="margin:22px auto;"><tr><td align="center" bgcolor="${escapeHtml(
        accent
      )}" style="border-radius:8px;"><a href="${escapeHtml(
        c.button.url
      )}" style="display:inline-block;min-height:20px;background:${escapeHtml(
        accent
      )};color:#ffffff;text-decoration:none;font-size:16px;font-weight:bold;line-height:20px;padding:14px 32px;border-radius:8px;font-family:${FONT};">${escapeHtml(
        c.button.label[lang]
      )}</a></td></tr></table><p style="margin:0 0 14px;text-align:center;color:#6B7280;font-size:12px;line-height:1.6;word-break:break-all;"><a href="${escapeHtml(
        c.button.url
      )}" style="color:#6B7280;">${escapeHtml(c.button.url)}</a></p>`
    : "";
  const heading = c.heading[lang]
    ? `<h2 style="margin:0 0 14px;color:#111827;font-size:20px;line-height:1.35;text-align:${align};">${escapeHtml(c.heading[lang])}</h2>`
    : "";
  const note = c.note
    ? `<p style="color:#6B7280;font-size:12px;line-height:1.6;margin:0 0 6px;text-align:${align};">${escapeHtml(c.note[lang])}</p>`
    : "";
  return `<div dir="${dir}" lang="${lang}" style="text-align:${align};">${heading}${paragraphs}${summary}${button}${note}</div>`;
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
  en: "Sent with Muhasib.ai",
  ar: "أُرسلت عبر Muhasib.ai",
};

function footerLines(c: BilingualEmailContent, lang: "en" | "ar"): string[] {
  const lines = [`${FOOTER_AUTOMATED[lang]} ${c.brandName}.`];
  if (c.contactEmail) lines.push(`${FOOTER_REPLY[lang]} ${c.contactEmail}.`);
  if (c.brandName !== "Muhasib.ai") lines.push(FOOTER_SENT_WITH[lang]);
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
    parts.push('<hr style="border:none;border-top:1px solid #E5E7EB;margin:26px 0;">');
  if (language !== "en") parts.push(section("rtl", "ar", c));
  const rootLang = language === "ar" ? "ar" : "en";
  const rootDir = language === "ar" ? "rtl" : "ltr";
  const accent = c.accent ?? DOCUMENT_ACCENT_DEFAULT;
  const footerBlocks = (
    language === "bilingual" ? (["en", "ar"] as const) : ([rootLang] as const)
  ).map(
    (lang) =>
      `<p dir="${lang === "ar" ? "rtl" : "ltr"}" lang="${lang}" style="color:#6B7280;font-size:12px;line-height:1.6;margin:0 0 6px;text-align:center;">${footerLines(
        c,
        lang
      )
        .map(escapeHtml)
        .join(" ")}</p>`
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
<body style="margin:0;padding:0;background:#F3F4F6;font-family:${FONT};-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#F3F4F6;opacity:0;">${pre}${"&#8199;&#847; ".repeat(20)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;">
    <tr><td align="center" style="padding:24px 12px;">
      <!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;">
        <tr><td class="em-pad" dir="${rootDir}" style="background:${escapeHtml(accent)};padding:22px 32px;text-align:${rootDir === "rtl" ? "right" : "left"};">
          <span style="color:#ffffff;font-size:20px;font-weight:bold;line-height:1.3;">${escapeHtml(c.brandName)}</span>
        </td></tr>
        <tr><td class="em-pad" style="padding:28px 32px;">${parts.join("\n")}</td></tr>
        <tr><td class="em-pad" style="background:#F9FAFB;padding:18px 32px;border-top:1px solid #E5E7EB;">
          ${c.footer ? `<p style="color:#6B7280;font-size:12px;line-height:1.6;margin:0 0 6px;text-align:center;">${escapeHtml(c.footer)}</p>` : ""}
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
