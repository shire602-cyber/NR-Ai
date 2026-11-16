/**
 * Command palette records, query interpretation and recents (R3, CTO 17).
 *
 * Pure helpers so the palette can (a) echo how it read the query, (b) list matching records
 * (invoices, customers, vendors) with a type label, and (c) show recently opened entries in the
 * empty state. Records come from lists the app already loads; nothing here calls the API.
 */

export type PaletteRecordKind = "invoice" | "customer" | "vendor";

export interface PaletteRecord {
  id: string;
  kind: PaletteRecordKind;
  title: string;
  subtitle?: string;
  href: string;
}

export type InterpretedQueryKind = "documentNumber" | "amount" | "trn" | "text";

export interface InterpretedQuery {
  kind: InterpretedQueryKind;
  text: string;
  /** Parsed amount for kind "amount". */
  amount?: number;
}

/** How the palette reads a query: document number, amount, TRN or plain text. */
export function interpretPaletteQuery(raw: string): InterpretedQuery {
  const text = raw.trim();
  if (/^\d{15}$/.test(text)) return { kind: "trn", text };
  const amountMatch = /^(?:aed\s*)?([\d,]+(?:\.\d{1,2})?)$/i.exec(text);
  if (amountMatch && /\d/.test(amountMatch[1]) && !/^0\d/.test(amountMatch[1])) {
    const amount = Number(amountMatch[1].replace(/,/g, ""));
    if (Number.isFinite(amount) && amount > 0) return { kind: "amount", text, amount };
  }
  if (/^[a-z]{2,5}[-/ ]?\d{1,}[\w-]*$/i.test(text) && /\d/.test(text)) {
    return { kind: "documentNumber", text };
  }
  return { kind: "text", text };
}

interface InvoiceRow {
  id: string;
  number?: string | null;
  customerName?: string | null;
  customerTrn?: string | null;
  total?: number | string | null;
  currency?: string | null;
  status?: string | null;
}

interface ContactRow {
  id: string;
  name?: string | null;
  trnNumber?: string | null;
  trn?: string | null;
  email?: string | null;
}

const norm = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

function textMatches(query: string, ...fields: unknown[]): boolean {
  const q = norm(query);
  if (!q) return false;
  const haystack = fields.map(norm).join(" ");
  return q.split(" ").every((term) => haystack.includes(term));
}

function amountMatches(amount: number, value: unknown): boolean {
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n - amount) < 0.005;
}

/** Matching records for a query, invoices first, capped to `limit`. */
export function searchPaletteRecords(
  query: string,
  data: { invoices?: InvoiceRow[]; customers?: ContactRow[]; vendors?: ContactRow[] },
  limit = 8
): PaletteRecord[] {
  const interpreted = interpretPaletteQuery(query);
  if (interpreted.text.length < 2) return [];
  const out: PaletteRecord[] = [];

  for (const inv of data.invoices ?? []) {
    if (!inv?.id) continue;
    const hit =
      interpreted.kind === "amount"
        ? amountMatches(interpreted.amount!, inv.total)
        : interpreted.kind === "trn"
          ? norm(inv.customerTrn) === interpreted.text
          : textMatches(interpreted.text, inv.number, inv.customerName);
    if (hit) {
      out.push({
        id: `invoice-${inv.id}`,
        kind: "invoice",
        title: inv.number || inv.customerName || inv.id,
        subtitle: inv.customerName ?? undefined,
        href: `/invoices?open=${encodeURIComponent(inv.id)}`,
      });
    }
  }

  const contactHit = (c: ContactRow) =>
    interpreted.kind === "trn"
      ? norm(c.trnNumber ?? c.trn) === interpreted.text
      : interpreted.kind === "amount"
        ? false
        : textMatches(interpreted.text, c.name, c.email, c.trnNumber ?? c.trn);

  for (const c of data.customers ?? []) {
    if (c?.id && contactHit(c)) {
      out.push({
        id: `customer-${c.id}`,
        kind: "customer",
        title: c.name || c.id,
        subtitle: (c.trnNumber ?? c.trn) || c.email || undefined,
        href: `/contacts?q=${encodeURIComponent(c.name ?? "")}`,
      });
    }
  }
  for (const v of data.vendors ?? []) {
    if (v?.id && contactHit(v)) {
      out.push({
        id: `vendor-${v.id}`,
        kind: "vendor",
        title: v.name || v.id,
        subtitle: (v.trnNumber ?? v.trn) || v.email || undefined,
        href: "/vendors",
      });
    }
  }
  return out.slice(0, limit);
}

/**
 * cmdk filter for the palette: every query word must appear in the item (no fuzzy letter
 * matching, which surfaced unrelated reports for a customer name). Equal scores keep the
 * rendered order, so the Records group stays first.
 */
export function paletteFilter(value: string, search: string, keywords?: string[]): number {
  const haystack = `${value} ${(keywords ?? []).join(" ")}`.toLowerCase();
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 1;
  return terms.every((term) => haystack.includes(term)) ? 1 : 0;
}

// ─── Recents ────────────────────────────────────────────────────────────────

export interface PaletteRecent {
  id: string;
  label: string;
  href: string;
  kind?: PaletteRecordKind | "page";
}

const RECENTS_KEY = "muhasib-command-recents";
const RECENTS_MAX = 5;

/** Recently opened palette entries (per browser; a convenience, never required state). */
export function readPaletteRecents(): PaletteRecent[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (r): r is PaletteRecent =>
          !!r &&
          typeof r.id === "string" &&
          typeof r.label === "string" &&
          typeof r.href === "string" &&
          r.href.startsWith("/")
      )
      .slice(0, RECENTS_MAX);
  } catch {
    return [];
  }
}

export function pushPaletteRecent(entry: PaletteRecent): PaletteRecent[] {
  const next = [entry, ...readPaletteRecents().filter((r) => r.id !== entry.id)].slice(
    0,
    RECENTS_MAX
  );
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked (private mode): recents are a convenience only.
  }
  return next;
}
