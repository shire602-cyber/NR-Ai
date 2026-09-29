// Shared scanner for `scripts/check-i18n.mjs` (the strict gate) and
// `scripts/i18n-codemod.mjs` (the migration tool).
//
// It parses a .tsx file with the TypeScript compiler and reports every place
// where an ENGLISH, user-visible string literal is written directly in the
// source instead of going through the translation system (`tr("key")`).
//
// What counts as user-visible (see `classify`):
//   - JSX text                                  <p>Save your work</p>
//   - text-like JSX attributes                  placeholder="Search" title="..." aria-label="..."
//   - text-like object properties               { title: "Saved", description: "..." } (toasts, options, columns)
//   - arguments of toast()/alert()/confirm()/setError(...) and zod message args
//   - natural-language strings in value position (variable initialisers,
//     `return "Not started"`, ternary branches, capitalised label maps)
// What is ignored: className/data-testid/ids/paths/enum-like values, imports,
// types, console/log/Error messages, comparisons, currency/brand/format tokens,
// and anything marked `// i18n-ignore: <reason>`.
//
// Heuristic by design - it errs on the side of NOT flagging (false positives
// break CI for good code); the escape hatch covers the rest.

import ts from "typescript";

// ── vocabulary ───────────────────────────────────────────────────────────────

/** Strings made only of these tokens are not translatable text. */
const NON_TRANSLATABLE = new Set(
  [
    "AED", "USD", "EUR", "GBP", "SAR", "INR", "PKR", "EGP", "KWD", "BHD", "OMR", "QAR",
    "PDF", "CSV", "XLSX", "XLS", "JSON", "XML", "API", "URL", "QR", "ID", "IDs", "UAE", "SIF", "SWIFT",
    "IBAN", "KYC", "OCR", "SMS", "HTML", "ZIP", "PNG", "JPG", "JPEG", "HEIC", "DOCX", "OK", "UTC",
    "Muhasib", "Muhasib.ai", "Muhasib.ai's", "WhatsApp", "Excel", "Google", "Stripe", "Xero", "QuickBooks", "Zoho",
    "Tally", "Wafeq", "Odoo", "Telegram", "Slack", "Zapier", "GitHub", "Microsoft", "Apple", "Gmail", "Outlook",
    "Twilio", "Meta", "Facebook", "Instagram", "LinkedIn", "Twitter", "OpenAI", "Claude", "Anthropic", "Najma",
    "Raeda", "NRA", "Netmara", "Emirates", "Dubai", "Abu", "Dhabi", "Sharjah", "Ajman", "Fujairah", "Ras", "Khaimah",
    "Umm", "Quwain", "Al", "Ain", "Stripe", "Visa", "Mastercard", "Amex", "Cairo", "Noto", "Geist", "N/A", "e.g.",
    "i.e.", "vs", "vs.", "etc", "etc.", "Wio", "Mashreq", "ENBD", "FAB", "ADCB", "RAKBANK", "CBD", "ADIB", "DIB",
  ].map((t) => t.toLowerCase())
);

const VISIBLE_ATTRS = new Set([
  "placeholder", "title", "aria-label", "aria-description", "aria-placeholder", "aria-roledescription", "alt",
  "label", "description", "subtitle", "heading", "tooltip", "helperText", "emptyMessage", "emptyText",
  "actionLabel", "buttonText", "confirmText", "cancelText", "submitLabel", "message", "text", "caption", "hint",
  "header", "legend", "cta", "ctaLabel", "loadingText", "successMessage", "errorMessage", "noResultsText",
  "searchPlaceholder", "emptyTitle", "emptyDescription", "eyebrow", "badgeLabel", "trigger",
]);

const VISIBLE_KEYS = new Set([
  ...VISIBLE_ATTRS,
  "name_en", "required_error", "invalid_type_error", "note", "reason",
  "summary", "detail", "details", "question", "answer", "tagline", "headline", "body", "cta", "unit_label",
  "emptyLabel", "fallback", "tip", "prompt", "tabLabel", "menuLabel", "navLabel", "stepTitle",
]);

/** Attributes / keys whose value is never display text. */
const DENY = new Set([
  "className", "class", "id", "key", "ref", "value", "defaultValue", "name", "type", "variant", "size", "href", "to",
  "src", "htmlFor", "for", "path", "role", "style", "dir", "lang", "accept", "autoComplete", "side", "align", "mode",
  "color", "icon", "target", "rel", "method", "as", "asChild", "viewBox", "d", "fill", "stroke", "xmlns", "format",
  "tabIndex", "inputMode", "pattern", "step", "min", "max", "currency", "locale", "code", "slug", "symbol", "unit",
  "kind", "status", "category", "field", "sortBy", "orderBy", "direction", "position", "sortKey", "queryKey", "sheetName", "labelEn", "labelAr", "nameEn", "nameAr", "titleEn", "titleAr", "descriptionEn", "descriptionAr",
  "testId", "endpoint", "url", "route", "page", "filename", "mimeType", "contentType", "trigger_key", "gradient",
  "bg", "border", "text_color", "textColor", "iconName", "storageKey", "cacheKey", "channel", "provider", "scope",
  "action", "event", "tag", "element", "component", "layout", "orientation", "behavior", "loading", "decoding",
  "crossOrigin", "referrerPolicy", "sandbox", "allow", "media", "sizes", "srcSet", "title_key", "labelKey",
  "descriptionKey", "messageKey", "accessor", "accessorKey", "dataKey", "keyField", "valueField", "labelField",
]);

const TOAST_CALLEES = new Set([
  "toast", "toast.success", "toast.error", "toast.info", "toast.warning", "toast.message", "toast.loading",
  "alert", "confirm", "prompt", "window.alert", "window.confirm", "window.prompt",
]);
const SETTER_MESSAGE = /^set(Error|Message|Status|Success|Warning|Info|Notice|Toast|Feedback)\w*$/;
const ZOD_METHODS = new Set([
  "min", "max", "length", "email", "url", "uuid", "regex", "refine", "superRefine", "nonempty", "positive",
  "negative", "nonnegative", "int", "gt", "gte", "lt", "lte", "multipleOf", "startsWith", "endsWith", "includes",
  "string", "number", "boolean", "date", "literal", "enum",
]);

const LOCALE_TEST = /\b(locale|lang|language|isArabic|isAr|isRtl|isRTL|rtl|en|ar|isEn|isEnglish)\b/;
const ARABIC = /[؀-ۿݐ-ݿ]/;
const IGNORE_MARK = /i18n-ignore(?::\s*(\S.*?))?\s*(?:\*\/|\}|$)/;

// ── string predicates ────────────────────────────────────────────────────────

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", bull: "•", ndash: "–",
  mdash: "—", hellip: "…", rarr: "→", larr: "←", copy: "©", reg: "®", trade: "™", laquo: "«", raquo: "»",
  times: "×", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
};

/** Decode the HTML entities React would decode inside JSX text. */
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return ENTITIES[body] ?? m;
  });
}

/** JSX whitespace semantics: lines are trimmed and joined with single spaces. */
export function jsxTextValue(raw) {
  const lines = raw.split(/\r\n|\n|\r/);
  const kept = [];
  lines.forEach((line, i) => {
    let l = line.replace(/\t/g, " ");
    if (i > 0) l = l.replace(/^ +/, "");
    if (i < lines.length - 1) l = l.replace(/ +$/, "");
    if (l !== "") kept.push(l);
  });
  return kept.join(" ");
}

function translatableWords(text) {
  return text
    .split(/[\s/|,;:()[\]{}<>+=*&"“”!?]+/)
    .map((w) => w.replace(/^[.'’\-–—·•_#@]+|[.'’\-–—·•_#@]+$/g, ""))
    .filter((w) => w && !NON_TRANSLATABLE.has(w.toLowerCase()));
}

function isCodeToken(w) {
  return (
    /[@]|:\/\/|^[\w.-]+\.(com|ae|org|net|io|ai|app)$/i.test(w) ||
    /^[A-Z0-9]+([-_/.#][A-Z0-9]+)+$/.test(w) ||
    (/\d/.test(w) && /[A-Za-z]/.test(w) && /[-_/.#]/.test(w))
  );
}

const TRANSLATABLE_ACRONYMS = new Set(["VAT", "TRN", "WPS", "FTA", "AI", "CFO", "CT"]);

/** Any English text: at least one translatable word with 2+ letters. */
export function hasEnglishText(text) {
  const plain = text.replace(/\{\w+\}/g, " ");
  if (plain.trim() === ".ai") return false; // brand suffix: Muhasib<span>.ai</span>
  if (ARABIC.test(plain) && !/[A-Za-z]{3,}/.test(plain)) return false;
  const words = translatableWords(plain).filter((w) => /[A-Za-z]{2,}/.test(w) && !isCodeToken(w));
  if (words.length === 0) return false;
  // ALL-CAPS strings are codes ("INV", "PO", "SKU") unless they are a known
  // translatable acronym (VAT, TRN ...) or a long shouted word ("OVERDUE").
  if (!/[a-z]/.test(plain)) return words.some((w) => TRANSLATABLE_ACRONYMS.has(w) || w.length >= 5);
  return true;
}

/** A natural-language label (sentence/title case), safe to flag in value position. */
export function looksNatural(text) {
  const t = text.trim();
  if (t.length < 3 || t.length > 140) return false;
  // Sentence-like text starts with a capital ("Sales") or a count phrase ("7-day cash need").
  if (!(/^[A-Z]/.test(t) || /^\d+[- ][A-Za-z]{2,}/.test(t)) || !/[a-z]/.test(t)) return false;
  if (/[=_{}<>\\@]|https?:|\.(com|ae|org|net)\b/.test(t)) return false;
  if (/^[A-Z][a-z]+([A-Z][a-z0-9]*)+$/.test(t)) return false; // PascalCase identifier
  if (/^[A-Za-z]+\d+$/.test(t)) return false;
  return translatableWords(t).some((w) => /[A-Za-z]{3,}/.test(w));
}

// ── AST helpers ──────────────────────────────────────────────────────────────

const WRAPPERS = new Set([
  ts.SyntaxKind.ParenthesizedExpression,
  ts.SyntaxKind.AsExpression,
  ts.SyntaxKind.NonNullExpression,
  ts.SyntaxKind.SatisfiesExpression,
  ts.SyntaxKind.TypeAssertionExpression,
]);

function calleeText(call) {
  return call.expression.getText().replace(/\s+/g, "");
}

function rootIdentifier(expr) {
  let e = expr;
  while (true) {
    if (ts.isCallExpression(e)) e = e.expression;
    else if (ts.isPropertyAccessExpression(e)) e = e.expression;
    else if (ts.isNonNullExpression(e) || ts.isParenthesizedExpression(e)) e = e.expression;
    else break;
  }
  return ts.isIdentifier(e) ? e.text : null;
}

function propName(nameNode) {
  if (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode) || ts.isNoSubstitutionTemplateLiteral(nameNode))
    return nameNode.text;
  return null;
}

/** Climb wrappers / conditional branches / logical operands to the syntactic sink. */
function findSink(node) {
  let cur = node;
  let parent = cur.parent;
  while (parent) {
    if (WRAPPERS.has(parent.kind)) {
      // continue
    } else if (ts.isConditionalExpression(parent) && parent.condition !== cur) {
      // continue: a branch
    } else if (
      ts.isBinaryExpression(parent) &&
      ((parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && parent.right === cur) ||
        parent.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      // continue: value of && / ||
    } else {
      break;
    }
    cur = parent;
    parent = cur.parent;
  }
  if (!parent) return null;
  if (ts.isJsxExpression(parent)) {
    const gp = parent.parent;
    if (ts.isJsxAttribute(gp)) return { kind: "jsx-attr", name: gp.name.getText(), holder: parent };
    if (gp && (ts.isJsxElement(gp) || ts.isJsxFragment(gp))) return { kind: "jsx-child", holder: parent };
    return null;
  }
  if (ts.isJsxAttribute(parent)) return { kind: "jsx-attr", name: parent.name.getText(), holder: parent };
  if (ts.isPropertyAssignment(parent) && parent.initializer === cur)
    return { kind: "prop", name: propName(parent.name), holder: parent };
  if (ts.isCallExpression(parent) && parent.arguments.includes(cur)) {
    return { kind: "call-arg", call: parent, index: parent.arguments.indexOf(cur) };
  }
  if (ts.isVariableDeclaration(parent) && parent.initializer === cur) return { kind: "var", holder: parent };
  if (ts.isReturnStatement(parent)) return { kind: "return" };
  if (ts.isArrowFunction(parent) && parent.body === cur) return { kind: "return" };
  if (ts.isArrayLiteralExpression(parent)) return { kind: "array", holder: parent };
  if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.right === cur
  ) {
    // `Component.displayName = "Component"` is developer-facing (devtools), never UI text.
    if (ts.isPropertyAccessExpression(parent.left) && parent.left.name.text === "displayName") return null;
    return { kind: "assign" };
  }
  return null;
}

/** True when `node` sits inside a call chain rooted at the zod namespace `z`. */
export function insideZodCall(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p) && rootIdentifier(p.expression) === "z") return true;
    if (ts.isSourceFile(p)) break;
  }
  return false;
}

function zodMessageArg(sink) {
  if (sink.kind !== "call-arg") return false;
  const callee = sink.call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (!ZOD_METHODS.has(callee.name.text)) return false;
  if (rootIdentifier(callee) !== "z") return false;
  // `.min(1, "msg")`: the message is a non-first argument; z.literal/enum first args are values
  return sink.index >= 1 || ["email", "url", "uuid", "nonempty", "positive", "negative", "int"].includes(callee.name.text);
}

/** Decide whether a string literal at `sink` must be translated. */
function classify(text, sink) {
  if (!sink || !hasEnglishText(text)) return null;
  // a lone lowercase token in an attribute/property/call is an identifier or CSS value
  const lone = !/\s/.test(text.trim()) && !/[A-Z]/.test(text) ;
  if (lone && sink.kind !== "jsx-child" && !(sink.kind === "jsx-attr" && /^(placeholder|title|aria-label|alt|label)$/.test(sink.name) && /^[a-z]+$/.test(text))) return null;
  switch (sink.kind) {
    case "jsx-child":
      return "strong";
    case "jsx-attr":
      if (VISIBLE_ATTRS.has(sink.name)) return "strong";
      if (DENY.has(sink.name) || sink.name.startsWith("data-") || sink.name.startsWith("on")) return null;
      return /\s/.test(text.trim()) && looksNatural(text) ? "natural" : null;
    case "prop":
      if (sink.name == null || DENY.has(sink.name)) return null;
      if (VISIBLE_KEYS.has(sink.name)) return "strong";
      return looksNatural(text) ? "natural" : null;
    case "call-arg": {
      const callee = calleeText(sink.call);
      if (TOAST_CALLEES.has(callee) && sink.index === 0) return "strong";
      const last = callee.split(".").pop() ?? "";
      if (SETTER_MESSAGE.test(last) && sink.index === 0) return "strong";
      if (zodMessageArg(sink)) return looksNatural(text) || /\s/.test(text) ? "strong" : null;
      return null;
    }
    case "var":
    case "return":
    case "assign":
    case "array":
      return looksNatural(text) ? "natural" : null;
    default:
      return null;
  }
}

function stringValue(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/** Turn a template literal into "text {name}" plus the ordered param list. */
function templateParts(node, sourceFile) {
  if (ts.isNoSubstitutionTemplateLiteral(node)) return { text: node.text, params: [] };
  let text = node.head.text;
  const params = [];
  const used = new Set();
  for (const span of node.templateSpans) {
    const name = uniqueName(paramName(span.expression), used);
    params.push({ name, code: span.expression.getText(sourceFile) });
    text += `{${name}}${span.literal.text}`;
  }
  return { text, params };
}

const PASS_THROUGH_METHODS = new Set(["toLowerCase", "toUpperCase", "toString", "toFixed", "trim", "toLocaleString", "join"]);

export function paramName(expr) {
  let e = expr;
  while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e)) e = e.expression;
  let raw = null;
  if (ts.isIdentifier(e)) raw = e.text;
  else if (ts.isPropertyAccessExpression(e)) {
    raw = e.name.text === "length" ? `${paramName(e.expression)}Count` : e.name.text;
  } else if (ts.isCallExpression(e)) {
    const c = e.expression;
    if (ts.isPropertyAccessExpression(c) && PASS_THROUGH_METHODS.has(c.name.text)) raw = paramName(c.expression);
    else raw = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : null;
  } else if (ts.isElementAccessExpression(e) && ts.isStringLiteral(e.argumentExpression)) raw = e.argumentExpression.text;
  else if (ts.isNumericLiteral(e)) raw = "n";
  raw = (raw ?? "value").replace(/[^A-Za-z0-9_]/g, "");
  if (!raw || /^\d/.test(raw)) raw = "value";
  return raw;
}

function uniqueName(name, used) {
  let candidate = name;
  let i = 2;
  while (used.has(candidate)) candidate = `${name}${i++}`;
  used.add(candidate);
  return candidate;
}

/** An expression that can sit inside a sentence as a `{placeholder}`. */
function isSimpleInline(expr) {
  let e = expr;
  while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e)) e = e.expression;
  if (ts.isIdentifier(e) || ts.isNumericLiteral(e)) return true;
  if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) return isSimpleInline(e.expression);
  if (ts.isCallExpression(e)) {
    // formatCurrency(x, "AED", locale), items.length, x.toString() ...
    return !containsJsx(e) && e.getText().length <= 90 && !containsArrowFn(e);
  }
  if (ts.isBinaryExpression(e) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken].includes(e.operatorToken.kind))
    return e.getText().length <= 40 && !containsJsx(e);
  return false;
}

function containsJsx(node) {
  let found = false;
  const walk = (n) => {
    if (found) return;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) found = true;
    else ts.forEachChild(n, walk);
  };
  walk(node);
  return found;
}

function containsArrowFn(node) {
  let found = false;
  const walk = (n) => {
    if (found) return;
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) found = true;
    else ts.forEachChild(n, walk);
  };
  walk(node);
  return found;
}

/** `{n === 1 ? "" : "s"}`: English-only pluralisation by suffix (needs tr.plural). */
export function isPluralHack(expr) {
  let e = expr;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (!ts.isConditionalExpression(e)) return false;
  const a = stringValue(e.whenTrue);
  const b = stringValue(e.whenFalse);
  if (a === null || b === null) return false;
  const suffix = /^(s|es|ies|y)$/;
  return (a === "" && suffix.test(b)) || (b === "" && suffix.test(a));
}

/**
 * Does a `locale`-style ternary pick the ARABIC text when the UI is Arabic? Some pairs are
 * inverted on purpose (a language-switch label names the OTHER language) - converting those to
 * `tr()` would flip them. Returns true only when the polarity is clearly the normal one.
 */
export function legacyPolarityOk(legacyItem, sourceFile) {
  const cond = legacyItem.node.condition.getText(sourceFile).replace(/\s+/g, " ");
  const neg = /!==\s*["']ar["']|===?\s*["']en["']|!\s*(isArabic|isAr|isRtl|isRTL|rtl)\b|\b(isEn|isEnglish)\b|^\(?en\)?$/.test(cond);
  const pos = /===?\s*["']ar["']|!==\s*["']en["']|\b(isArabic|isAr|isRtl|isRTL|rtl)\b|^\(?ar\)?$/.test(cond);
  if (neg === pos) return false;
  const arabicIsTrueBranch = ARABIC.test(legacyItem.whenTrue.getText(sourceFile));
  return pos ? arabicIsTrueBranch : !arabicIsTrueBranch;
}

const SKIP_TEXT_TAGS = new Set(["code", "pre", "kbd", "samp", "style", "script"]);

// ── main scan ────────────────────────────────────────────────────────────────

/**
 * @returns {{ items: object[], legacy: object[], badIgnores: number[] }}
 *  items:  literals that must be translated (kind: "run" | "string" | "template")
 *  legacy: `locale === "ar" ? "…" : "…"` ternaries (bilingual but not the target pattern)
 *  badIgnores: lines with an `i18n-ignore` marker that has no reason
 */
export function scanSource(text, fileName = "file.tsx") {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines = text.split("\n");
  const ignoredLines = new Set();
  const badIgnores = [];
  // block form: `// i18n-ignore-start: reason` ... `// i18n-ignore-end`
  let blockFrom = -1;
  lines.forEach((line, i) => {
    if (/i18n-ignore-start(?::\s*\S)/.test(line)) blockFrom = i;
    else if (/i18n-ignore-start/.test(line)) badIgnores.push(i + 1);
    else if (/i18n-ignore-end/.test(line) && blockFrom >= 0) {
      for (let l = blockFrom; l <= i; l += 1) ignoredLines.add(l);
      blockFrom = -1;
    }
  });
  lines.forEach((line, i) => {
    if (line.includes("i18n-ignore-start") || line.includes("i18n-ignore-end")) return;
    const m = IGNORE_MARK.exec(line);
    if (!m || !line.includes("i18n-ignore")) return;
    if (m[1]) {
      ignoredLines.add(i);
      ignoredLines.add(i + 1); // marker on the line above
    } else badIgnores.push(i + 1);
  });

  // String values that are COMPARED against (=== "High", case "Paid":, includes("x")) or appear
  // in a string-literal union type are enum-like: translating them would break the logic.
  const enumLike = new Set();
  (function collectEnums(n) {
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(n.operatorToken.kind)) {
      for (const side of [n.left, n.right]) if (ts.isStringLiteral(side) || ts.isNoSubstitutionTemplateLiteral(side)) enumLike.add(side.text);
    } else if (ts.isCaseClause(n) && (ts.isStringLiteral(n.expression) || ts.isNoSubstitutionTemplateLiteral(n.expression))) {
      enumLike.add(n.expression.text);
    } else if (ts.isLiteralTypeNode(n) && ts.isStringLiteral(n.literal)) {
      enumLike.add(n.literal.text);
    } else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ["includes", "has", "indexOf"].includes(n.expression.name.text)) {
      for (const arg of n.arguments) if (ts.isStringLiteral(arg)) enumLike.add(arg.text);
    }
    ts.forEachChild(n, collectEnums);
  })(sourceFile);

  const items = [];
  const legacy = [];
  const consumed = new Set(); // nodes already handled as part of a bigger item

  const lineOf = (pos) => sourceFile.getLineAndCharacterOfPosition(pos).line;
  const isIgnored = (node) => {
    const start = lineOf(node.getStart(sourceFile));
    const end = lineOf(node.end);
    for (let l = start; l <= end; l += 1) if (ignoredLines.has(l)) return true;
    return false;
  };

  const legacyBranch = (n) => stringValue(n) ?? (ts.isTemplateExpression(n) ? templateParts(n, sourceFile).text : null);

  function visitJsxChildren(node) {
    const children = node.children;
    const manualParent = children.some((c) => ts.isJsxExpression(c) && c.expression && isPluralHack(c.expression));
    let run = null;
    const flush = () => {
      if (run && run.hasText) {
        const value = run.parts.map((p) => p.text).join("").replace(/ +/g, " ").trim();
        if (hasEnglishText(value) && !isIgnored({ getStart: () => run.start, end: run.end })) {
          items.push({
            kind: manualParent ? "manual" : "run",
            start: run.start,
            end: run.end,
            line: lineOf(run.start) + 1,
            text: value,
            params: run.params,
            leadingSpace: run.leadingSpace,
            trailingSpace: run.trailingSpace,
            context: "jsx-text",
          });
        }
        run.nodes.forEach((n) => consumed.add(n));
      }
      run = null;
    };
    children.forEach((child, idx) => {
      if (ts.isJsxText(child)) {
        const raw = text.slice(child.pos, child.end);
        if (run === null) {
          if (raw.trim() === "") return; // whitespace between elements
          run = { start: child.getStart(sourceFile), end: child.end, parts: [], params: [], nodes: [], hasText: false, used: new Set() };
        }
        const value = decodeEntities(jsxTextValue(raw));
        const meaningfulLead = /^[ \t]+\S/.test(raw) && !/\n/.test(raw.split(/\S/)[0]) && idx > 0;
        const meaningfulTail = /\S[ \t]+$/.test(raw) && idx < children.length - 1;
        if (run.parts.length === 0 && meaningfulLead) run.leadingSpace = true;
        // spaces adjacent to a placeholder are significant: keep one when raw has it
        let piece = value;
        if (run.parts.length > 0 && /^\s/.test(raw) && !/^\s*\n/.test(raw) && !piece.startsWith(" ")) piece = ` ${piece}`;
        if (/\s$/.test(raw) && !/\n\s*$/.test(raw) && !piece.endsWith(" ") && idx < children.length - 1) piece = `${piece} `;
        if (raw.trim() !== "") run.hasText = run.hasText || /[A-Za-z]/.test(piece);
        run.parts.push({ text: piece });
        run.nodes.push(child);
        run.end = child.end;
        run.trailingSpace = meaningfulTail;
      } else if (
        ts.isJsxExpression(child) &&
        child.expression &&
        run &&
        stringValue(child.expression) !== null &&
        stringValue(child.expression).trim() === "" &&
        stringValue(child.expression) !== ""
      ) {
        // {" "} keeps a significant space inside the sentence
        run.parts.push({ text: " " });
        run.nodes.push(child);
        run.end = child.end;
        run.trailingSpace = false;
      } else if (ts.isJsxExpression(child) && child.expression && run && isSimpleInline(child.expression) && !stringValue(child.expression)) {
        const name = uniqueName(paramName(child.expression), run.used);
        run.parts.push({ text: `{${name}}` });
        run.params.push({ name, code: child.expression.getText(sourceFile) });
        run.nodes.push(child);
        run.end = child.end;
        run.trailingSpace = false;
      } else if (
        ts.isJsxExpression(child) &&
        child.expression &&
        !run &&
        isSimpleInline(child.expression) &&
        !stringValue(child.expression) &&
        children[idx + 1] &&
        ts.isJsxText(children[idx + 1]) &&
        /\S/.test(text.slice(children[idx + 1].pos, children[idx + 1].end)) &&
        !/^\s*\n/.test(text.slice(children[idx + 1].pos, children[idx + 1].end))
      ) {
        // "{count} invoices selected": placeholder first, text follows on the same line
        run = { start: child.getStart(sourceFile), end: child.end, parts: [], params: [], nodes: [child], hasText: false, used: new Set() };
        const name = uniqueName(paramName(child.expression), run.used);
        run.parts.push({ text: `{${name}}` });
        run.params.push({ name, code: child.expression.getText(sourceFile) });
      } else {
        flush();
      }
    });
    flush();
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeNode(node)) return;
    if (ts.isCallExpression(node) && /^console\./.test(calleeText(node))) return;

    if ((ts.isJsxElement(node) || ts.isJsxFragment(node))) {
      const tag = ts.isJsxElement(node) ? node.openingElement.tagName.getText(sourceFile) : "";
      if (!SKIP_TEXT_TAGS.has(tag)) visitJsxChildren(node);
    }

    if (ts.isConditionalExpression(node) && LOCALE_TEST.test(node.condition.getText(sourceFile))) {
      const a = legacyBranch(ts.isParenthesizedExpression(node.whenTrue) ? node.whenTrue.expression : node.whenTrue);
      const b = legacyBranch(ts.isParenthesizedExpression(node.whenFalse) ? node.whenFalse.expression : node.whenFalse);
      if (a != null && b != null && ARABIC.test(a) !== ARABIC.test(b)) {
        const enText = ARABIC.test(a) ? b : a;
        const arText = ARABIC.test(a) ? a : b;
        if (!isIgnored(node)) {
          legacy.push({
            kind: "legacy",
            start: node.getStart(sourceFile),
            end: node.end,
            line: lineOf(node.getStart(sourceFile)) + 1,
            text: enText,
            ar: arText,
            node,
            whenTrue: node.whenTrue,
            whenFalse: node.whenFalse,
          });
        }
        consumed.add(node.whenTrue);
        consumed.add(node.whenFalse);
        return; // do not descend: both branches are already bilingual
      }
    }

    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) &&
      !consumed.has(node)
    ) {
      const manualTemplate =
        ts.isTemplateExpression(node) && node.templateSpans.some((sp) => isPluralHack(sp.expression));
      const parts = ts.isTemplateExpression(node)
        ? templateParts(node, sourceFile)
        : { text: node.parent && ts.isJsxAttribute(node.parent) ? decodeEntities(node.text) : node.text, params: [] };
      // a literal used as an attribute initialiser or JSX child string
      const sink = findSink(node);
      let verdict = classify(parts.text, sink);
      if (verdict === "natural" && enumLike.has(parts.text)) verdict = null;
      if (verdict && !isIgnored(node)) {
        items.push({
          kind: manualTemplate ? "manual" : ts.isTemplateExpression(node) ? "template" : "string",
          start: node.getStart(sourceFile),
          end: node.end,
          line: lineOf(node.getStart(sourceFile)) + 1,
          text: parts.text,
          params: parts.params,
          context: sink.kind === "jsx-attr" ? `attr:${sink.name}` : sink.kind === "prop" ? `prop:${sink.name}` : sink.kind === "call-arg" ? `call:${calleeText(sink.call)}` : sink.kind,
          sink: sink.kind,
          verdict,
          zod: (sink.kind === "call-arg" && zodMessageArg(sink)) || (sink.kind === "prop" && insideZodCall(node)),
          node,
        });
        if (ts.isTemplateExpression(node)) return; // spans are part of this item
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { items, legacy, badIgnores, sourceFile };
}
