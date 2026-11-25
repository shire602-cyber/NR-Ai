/**
 * WQ3 (9.4): the manual journal grid's pure model. Each line carries a description, a contact,
 * a cost centre, a VAT treatment, a currency and a corporate-tax treatment (9.16).
 *
 * The server is the authority (server/services/journal-lines.service.ts): it converts foreign
 * lines at the tenant rate and adds the VAT leg of a standard-rated line. The grid previews the
 * same arithmetic (integer fils, half away from zero) so the totals the user balances are the
 * ones the ledger will post.
 */
import { journalLineVatFils } from "@shared/journal-line-treatments";
import type {
  JournalLineCtTreatment,
  JournalLineVatTreatment,
} from "@shared/journal-line-treatments";

export interface JournalGridLine {
  accountId: string;
  debit: number | "";
  credit: number | "";
  description: string;
  /** "" | "customer:<id>" | "vendor:<id>" */
  contact: string;
  costCenterId: string;
  vatTreatment: "" | JournalLineVatTreatment;
  /** "" = the company's base currency. */
  currency: string;
  ctTreatment: "" | JournalLineCtTreatment;
  ctDisallowedPct: number | "";
}

export function blankGridLine(): JournalGridLine {
  return {
    accountId: "",
    debit: 0,
    credit: 0,
    description: "",
    contact: "",
    costCenterId: "",
    vatTreatment: "",
    currency: "",
    ctTreatment: "",
    ctDisallowedPct: "",
  };
}

const toFils = (v: unknown) => Math.round((Number(v) || 0) * 100);

export function isForeign(line: Pick<JournalGridLine, "currency">, baseCurrency: string): boolean {
  return !!line.currency && line.currency.toUpperCase() !== baseCurrency.toUpperCase();
}

export interface LinePreview {
  debitFils: number;
  creditFils: number;
  /** VAT leg the server adds (fils, on the same side as the line). */
  vatFils: number;
  vatKind: "input" | "output" | null;
  /** false when a foreign line's rate is not known yet (the server still converts it). */
  known: boolean;
}

export interface PreviewContext {
  baseCurrency: string;
  /** Rate for 1 <currency> in base units, or null while unknown. */
  rateFor: (currency: string) => number | null;
  /** The company's standard VAT rate (0.05 UAE). */
  vatRate: number;
  /** Account type of an account id ("income", "expense", ...). */
  accountType: (accountId: string) => string | undefined;
}

/** The base amounts (and derived VAT leg) one grid line will post. */
export function previewLine(line: JournalGridLine, ctx: PreviewContext): LinePreview {
  let debitFils = toFils(line.debit);
  let creditFils = toFils(line.credit);
  let known = true;
  if (isForeign(line, ctx.baseCurrency)) {
    const rate = ctx.rateFor(line.currency.toUpperCase());
    if (rate === null) {
      known = false;
    } else {
      debitFils = Math.round(debitFils * rate);
      creditFils = Math.round(creditFils * rate);
    }
  }
  let vatFils = 0;
  let vatKind: LinePreview["vatKind"] = null;
  if (line.vatTreatment === "standard" && line.accountId) {
    vatKind = ctx.accountType(line.accountId) === "income" ? "output" : "input";
    vatFils = journalLineVatFils(debitFils || creditFils, ctx.vatRate);
  }
  return { debitFils, creditFils, vatFils, vatKind, known };
}

export interface GridTotals {
  debitFils: number;
  creditFils: number;
  vatFils: number;
  /** Every foreign line has a known rate (else the balance is checked by the server). */
  known: boolean;
}

export function gridTotals(lines: JournalGridLine[], ctx: PreviewContext): GridTotals {
  let debitFils = 0;
  let creditFils = 0;
  let vatFils = 0;
  let known = true;
  for (const l of lines) {
    const p = previewLine(l, ctx);
    known &&= p.known;
    const vatDebit = p.debitFils > 0 ? p.vatFils : 0;
    const vatCredit = p.creditFils > 0 ? p.vatFils : 0;
    debitFils += p.debitFils + vatDebit;
    creditFils += p.creditFils + vatCredit;
    vatFils += p.vatFils;
  }
  return { debitFils, creditFils, vatFils, known };
}

export interface JournalLinePayload {
  accountId: string;
  debit?: number;
  credit?: number;
  description?: string | null;
  contactType?: "customer" | "vendor" | null;
  contactId?: string | null;
  costCenterId?: string | null;
  vatTreatment?: JournalLineVatTreatment | null;
  foreignCurrency?: string | null;
  foreignDebit?: number;
  foreignCredit?: number;
  ctTreatment?: JournalLineCtTreatment | null;
  ctDisallowedPct?: number | null;
}

/** One grid line -> the body line of POST /api/companies/:id/journal (strict on the server). */
export function toPayloadLine(line: JournalGridLine, baseCurrency: string): JournalLinePayload {
  const out: JournalLinePayload = { accountId: line.accountId };
  const debit = Number(line.debit) || 0;
  const credit = Number(line.credit) || 0;
  if (isForeign(line, baseCurrency)) {
    out.foreignCurrency = line.currency.toUpperCase();
    if (debit > 0) out.foreignDebit = debit;
    if (credit > 0) out.foreignCredit = credit;
  } else {
    out.debit = debit;
    out.credit = credit;
  }
  if (line.description.trim()) out.description = line.description.trim();
  if (line.contact) {
    const [type, id] = line.contact.split(":");
    if ((type === "customer" || type === "vendor") && id) {
      out.contactType = type;
      out.contactId = id;
    }
  }
  if (line.costCenterId) out.costCenterId = line.costCenterId;
  if (line.vatTreatment) out.vatTreatment = line.vatTreatment;
  if (line.ctTreatment) {
    out.ctTreatment = line.ctTreatment;
    if (line.ctTreatment === "non_deductible" && line.ctDisallowedPct !== "") {
      out.ctDisallowedPct = Number(line.ctDisallowedPct);
    }
  }
  return out;
}

export interface StoredJournalLine {
  accountId: string;
  debit?: number | string | null;
  credit?: number | string | null;
  description?: string | null;
  contactType?: string | null;
  contactId?: string | null;
  costCenterId?: string | null;
  vatTreatment?: string | null;
  systemVat?: boolean | null;
  foreignCurrency?: string | null;
  foreignDebit?: number | string | null;
  foreignCredit?: number | string | null;
  ctTreatment?: string | null;
  ctDisallowedPct?: number | string | null;
}

/**
 * A stored draft line -> a grid line for editing. The VAT legs the server derived
 * (`systemVat`) are not user lines: they are dropped and re-derived on save.
 */
export function fromStoredLines(
  lines: StoredJournalLine[],
  baseCurrency: string
): JournalGridLine[] {
  return lines
    .filter((l) => l.systemVat !== true)
    .map((l) => {
      const foreign =
        !!l.foreignCurrency && l.foreignCurrency.toUpperCase() !== baseCurrency.toUpperCase();
      return {
        accountId: l.accountId,
        debit: Number(foreign ? l.foreignDebit : l.debit) || 0,
        credit: Number(foreign ? l.foreignCredit : l.credit) || 0,
        description: l.description ?? "",
        contact: l.contactType && l.contactId ? `${l.contactType}:${l.contactId}` : "",
        costCenterId: l.costCenterId ?? "",
        vatTreatment: (l.vatTreatment ?? "") as JournalGridLine["vatTreatment"],
        currency: foreign ? String(l.foreignCurrency).toUpperCase() : "",
        ctTreatment: (l.ctTreatment ?? "") as JournalGridLine["ctTreatment"],
        ctDisallowedPct:
          l.ctDisallowedPct === null || l.ctDisallowedPct === undefined
            ? ""
            : Number(l.ctDisallowedPct),
      };
    });
}

/** True when the line has any detail beyond account and amounts (opens its details row). */
export function hasDetails(line: JournalGridLine): boolean {
  return !!(
    line.contact ||
    line.costCenterId ||
    line.vatTreatment ||
    line.currency ||
    line.ctTreatment
  );
}
