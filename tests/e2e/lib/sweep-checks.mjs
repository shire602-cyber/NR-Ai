/**
 * Page instrumentation and the per-page checks of the broken-path sweep
 * (tests/e2e/broken-path-sweep.mjs). Kept apart so tests/unit/broken-path-sweep-rules.test.ts can
 * pin the pure text rules (raw keys, placeholders, UUIDs) without a browser.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripAllowlisted } from "./latin-text.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALE_DIR = path.join(__dirname, "..", "..", "..", "client", "src", "locales", "en");

/** i18n namespaces (client/src/locales/en/<ns>.json); "ns.someKey" in the UI is a raw key. */
export const NAMESPACES = readdirSync(LOCALE_DIR)
  .filter((file) => file.endsWith(".json"))
  .map((file) => file.replace(/\.json$/, ""));

const RAW_KEY = new RegExp(`(^|[^A-Za-z0-9@/.])(${NAMESPACES.join("|")})\\.[A-Za-z][A-Za-z0-9_]*`);
const PLACEHOLDER = /\{\{?\s*[A-Za-z_][A-Za-z0-9_]*\s*\}?\}/;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const JUNK = /(^|\s)(undefined|NaN|\[object Object\]|Invalid Date|null)(\s|$)/;

/** Problems in one visible text line: raw i18n key, {placeholder}, UUID, undefined/NaN. */
export function textProblems(line) {
  const out = [];
  if (RAW_KEY.test(line)) out.push("raw-key");
  if (PLACEHOLDER.test(line)) out.push("placeholder");
  if (UUID.test(line)) out.push("uuid");
  if (JUNK.test(line)) out.push("junk-value");
  return out;
}

/** English words left in an Arabic-mode line after brand/acronym/number allow-listing. */
export function englishWords(line) {
  return (stripAllowlisted(line).match(/[A-Za-z]{2,}/g) ?? []).map((w) => w.toLowerCase());
}

// Fields that hold machine codes, not text a person typed: `status`, `claimStatus`, `entityType`,
// `method`, `source`, `currency`, `role`, `code` ... (by name), plus snake_case values anywhere
// ("bank_reconciliation"). A typed category ("Computers & Software"), unit ("each") or reference
// ("license pool") is user data.
const USER_DATA_SKIP_KEY =
  /^(status|type|kind|role|currency|method|source|code|state|stage)$|(Status|Type|Kind|Method|Source|State|Stage|Code)$/;
const MACHINE_CODE = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;
const normText = (value) => String(value).replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Add every user-entered string of an API payload to `into` (normalised whole strings, not
 * words). An object that has an Arabic name (`nameAr`) contributes no English `nameEn`/`name`: the
 * screen must show the Arabic one, so the English name is UI-copy-grade text, not data to excuse.
 * A `memo` counts as data only on a manual journal entry: the memos of system postings
 * ("Payment received for Invoice ...") are written by the server and must read in Arabic (F9).
 */
export function collectUserStrings(value, into, depth = 0, skipMemo = false) {
  if (depth > 6 || value == null) return into;
  if (typeof value === "string") {
    const text = normText(value);
    if (
      text.length >= 3 &&
      text.length <= 300 &&
      /[a-z]{2,}/.test(text) &&
      !MACHINE_CODE.test(value.trim())
    )
      into.add(text);
  } else if (Array.isArray(value)) {
    for (const v of value.slice(0, 300)) collectUserStrings(v, into, depth + 1, skipMemo);
  } else if (typeof value === "object") {
    const hasArabicName = typeof value.nameAr === "string" && value.nameAr.trim() !== "";
    // A journal entry written by the system (invoice, bill, payroll, inventory ...), not by hand.
    const systemEntry =
      typeof value.entryNumber === "string" &&
      typeof value.source === "string" &&
      value.source !== "manual";
    for (const [key, v] of Object.entries(value)) {
      if (USER_DATA_SKIP_KEY.test(key)) continue;
      if (hasArabicName && (key === "nameEn" || key === "name")) continue;
      if ((skipMemo || systemEntry) && (key === "memo" || key === "description")) continue;
      collectUserStrings(v, into, depth + 1, skipMemo || systemEntry);
    }
  }
  return into;
}

/**
 * English words left in an Arabic-mode line once exact user-data strings are removed. A line is
 * excused only where a whole user string (an invoice customer, a vendor, an item) appears in it;
 * a word that merely occurs somewhere in the data does not excuse a UI sentence that uses it
 * ("Review" in a heading, "Payroll" in a status). Mark data you render with translate="no" instead.
 */
export function englishOutsideUserData(line, userStrings) {
  if (!userStrings || userStrings.size === 0) return englishWords(line);
  // Matched case-insensitively, but the rest keeps its case: ALL-CAPS acronyms stay allow-listed.
  let rest = ` ${String(line).replace(/\s+/g, " ").trim()} `;
  const lower = rest.toLowerCase();
  const candidates = [...userStrings]
    .filter((text) => lower.includes(text))
    .sort((a, b) => b.length - a.length);
  for (const text of candidates) {
    // Whole string only: not the middle of a longer Latin word.
    const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    rest = rest.replace(new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "gi"), " ");
  }
  return englishWords(rest);
}

/**
 * Responses that are deliberate gates, not breakage: 401 before sign-in, 402 plan required,
 * 403 role/tier lock, 404 from a "not found yet" probe the page explains, and 409/422 refusals
 * shown as messages. The sweep fails on a 4xx/5xx document, any 5xx API call and any 4xx API call
 * outside this set.
 */
export const GATE_STATUSES = new Set([401, 402, 403]);

/** Installed before any page script: counts DOM mutations and side effects for the click sweep. */
export function instrumentScript() {
  window.__sweep = { mutations: 0, signals: 0, rejections: [] };
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    window.__sweep.rejections.push(String((reason && (reason.stack || reason.message)) || reason));
  });
  const bump = () => {
    window.__sweep.signals += 1;
  };
  window.print = bump;
  // A button that scrolls to a section ("Choose a plan") is observable too.
  document.addEventListener("scroll", bump, { capture: true, passive: true });
  const realOpen = window.open;
  window.open = (...args) => {
    bump();
    window.__sweep.opened = String(args[0] ?? "");
    void realOpen;
    return null;
  };
  try {
    if (navigator.clipboard) {
      navigator.clipboard.writeText = async () => bump();
      navigator.clipboard.write = async () => bump();
    }
  } catch {
    /* read-only clipboard */
  }
  const isTooltip = (node) => {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return !!(el && el.closest && el.closest('[role="tooltip"], [data-radix-tooltip-content]'));
  };
  const start = () => {
    new MutationObserver((records) => {
      for (const record of records) {
        if (isTooltip(record.target)) continue;
        const added = [...record.addedNodes].filter(
          (n) => !isTooltip(n) && !(n.querySelector && n.querySelector('[role="tooltip"]'))
        );
        if (record.type === "childList" && added.length === 0 && record.removedNodes.length === 0)
          continue;
        if (record.type === "childList" && added.length === 0) {
          const removed = [...record.removedNodes].filter(
            (n) =>
              !(n.querySelector && n.querySelector('[role="tooltip"]')) &&
              !(n.getAttribute && n.getAttribute("role") === "tooltip")
          );
          if (removed.length === 0) continue;
        }
        window.__sweep.mutations += 1;
      }
    }).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
      attributeFilter: [
        "aria-expanded",
        "aria-selected",
        "aria-checked",
        "aria-pressed",
        "data-state",
        "open",
        "hidden",
        "value",
        "class",
      ],
    });
  };
  /**
   * Click candidates outside dialogs/menus, in document order, with a re-findable key. Shared by
   * the collect and re-find steps of the click sweep so their indices always agree.
   */
  window.__sweepCandidates = (shellSelector) => {
    const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    const visible = (el) =>
      (typeof el.checkVisibility !== "function" || el.checkVisibility()) &&
      el.getClientRects().length > 0;
    const nodes = document.querySelectorAll(
      'button, [role="button"], [role="tab"], [role="menuitem"], [role="switch"], [role="radio"], [role="checkbox"]:not(input), [role="combobox"]:not(input), summary'
    );
    const out = [];
    const seen = new Map();
    for (const el of nodes) {
      if (!visible(el)) continue;
      if (
        el.closest(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-sonner-toaster], [role="region"][aria-label*="otif"]'
        )
      )
        continue;
      if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;
      if (el.closest("a[href]")) continue;
      // Already-current choices: re-selecting them is correctly a no-op.
      const role = el.getAttribute("role") || el.tagName.toLowerCase();
      if (el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-current") === "page")
        continue;
      if (
        el.getAttribute("data-active") === "true" ||
        el.getAttribute("data-state") === "on" ||
        el.getAttribute("aria-pressed") === "true"
      )
        continue;
      if ((role === "radio" || role === "tab") && el.getAttribute("aria-checked") === "true")
        continue;
      if (el.getAttribute("data-state") === "active" && role === "tab") continue;
      const testid = el.getAttribute("data-testid") || "";
      const name = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60);
      const normTestid = testid.replace(UUID_RE, ":id").replace(/-\d+$/, "-:n");
      const base = normTestid ? `t:${normTestid}` : `${role}:${name}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      out.push({
        el,
        key: n > 0 ? `${base}#${n}` : base,
        base,
        index: n,
        name,
        testid,
        repeated: n > 0 && (!!el.closest("tbody tr, [role=row]") || normTestid !== testid),
        shell: !!el.closest(shellSelector),
      });
    }
    return out;
  };
  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start);
}

/** Collected in the page after it settles: everything the load rules look at. */
export function pageSnapshot() {
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
  const visible = (el) =>
    !!el &&
    (typeof el.checkVisibility !== "function" || el.checkVisibility()) &&
    el.getClientRects().length > 0;
  const texts = [];
  const exemptTexts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = (node.textContent || "").replace(/\s+/g, " ").trim();
    const parent = node.parentElement;
    if (!value || !parent || SKIP.has(parent.tagName) || !visible(parent)) continue;
    if (parent.closest('[translate="no"], body [lang]:not([lang^="ar"])')) exemptTexts.push(value);
    else texts.push(value);
  }
  const main = document.querySelector("main, [role=main]");
  const native = [];
  for (const el of document.querySelectorAll(
    'input[type="date"], input[type="month"], input[type="datetime-local"], input[type="time"], input[type="week"], select, input[type="file"]'
  )) {
    if (!visible(el)) continue;
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    // Visually hidden controls (sr-only behind a styled FileDrop / picker) are fine.
    if (style.opacity === "0" || box.width < 4 || box.height < 4) continue;
    if ((style.clip && style.clip !== "auto") || (style.clipPath && style.clipPath !== "none"))
      continue;
    if (el.classList.contains("sr-only")) continue;
    if (el.closest("[aria-hidden=true]")) continue;
    native.push(
      `${el.tagName.toLowerCase()}[${el.getAttribute("type") || ""}]#${el.id || el.getAttribute("data-testid") || el.getAttribute("name") || ""}`
    );
  }
  const links = [...document.querySelectorAll("a[href]")]
    .map((a) => a.getAttribute("href"))
    .filter((href) => href && href.startsWith("/") && !href.startsWith("//"));
  const docWidth = document.documentElement.scrollWidth;
  const viewWidth = document.documentElement.clientWidth;
  return {
    path: location.pathname + location.search,
    dir: document.documentElement.dir,
    lang: document.documentElement.lang,
    notFound: !!document.querySelector(
      '[data-testid="page-not-found"], [data-testid="public-404"]'
    ),
    errorBoundary: [...document.querySelectorAll('[data-testid^="error-boundary"]')].map((e) =>
      e.getAttribute("data-testid")
    ),
    mainText: (main ? main.innerText : document.body.innerText || "").trim().length,
    hasMain: !!main,
    dialog: !!document.querySelector('[role="dialog"], [role="alertdialog"]'),
    overflowX: docWidth > viewWidth + 1 ? docWidth - viewWidth : 0,
    native,
    texts,
    exemptTexts,
    links,
    rejections: (window.__sweep && window.__sweep.rejections.splice(0)) || [],
  };
}
