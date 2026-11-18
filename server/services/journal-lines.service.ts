/**
 * WQ3 (9.4 / 9.16): turn the lines of a manual journal (POST /api/companies/:id/journal, draft
 * edits) into kernel lines.
 *
 *   - Currency: a line in a foreign currency with no base amount is converted at the tenant's
 *     own rate through `fx.convert` (the company row first, then the system row; never another
 *     tenant's). A line that already carries its base amount keeps it.
 *   - Contact: a customer (customer_contacts) or supplier (vendors) of THIS company; another
 *     tenant's id is 404-equivalent (422 CONTACT_NOT_FOUND), never revealed.
 *   - VAT treatment: "standard" adds the VAT leg itself (income account -> output VAT 2020,
 *     any other account -> input VAT 1050, same side as the line, at the company's standard
 *     rate). The leg is flagged `systemVat`, so the kernel's control-account gate lets exactly
 *     that leg through and still refuses a VAT line the user picked (B1 / C1).
 *   - CT treatment: must fit the account type (non-deductible on an expense, exempt income on
 *     income); stored on the line for the CT workpaper (server/reporting/ct-line-treatments.ts).
 */
import { pool } from "../db";
import { DomainError } from "../errors";
import { ACCOUNT_CODES } from "../constants";
import { resolve } from "../platform/service-registry";
import type { FxConvert } from "./fx";
import { loadBaseCurrency, type JournalLineAttributes, type PostJournalLineInput } from "../ledger";
import { toFils } from "../../shared/money";
import { STANDARD_VAT_RATES, vatJurisdictionForCountry } from "../../shared/vat-classification";
import {
  ctTreatmentFitsAccount,
  journalLineVatFils,
  type JournalLineCtTreatment,
} from "../../shared/journal-line-treatments";
import type { JournalLineBody } from "../../shared/validators/journal";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AccountInfo {
  id: string;
  code: string;
  type: string;
}

function lineError(code: string, index: number, field: string, message: string): DomainError {
  return new DomainError(
    code,
    422,
    { line: index, fields: { [`lines.${index}.${field}`]: [message] } },
    message
  );
}

function present(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "" && Number(v) !== 0;
}

async function loadAccounts(companyId: string, ids: string[]): Promise<Map<string, AccountInfo>> {
  const valid = [...new Set(ids.filter((id) => UUID_RE.test(id)))];
  if (!valid.length) return new Map();
  const { rows } = await pool.query(
    `SELECT id, code, type FROM accounts WHERE company_id = $1 AND id = ANY($2::uuid[])`,
    [companyId, valid]
  );
  return new Map((rows as AccountInfo[]).map((r) => [String(r.id).toLowerCase(), r]));
}

async function accountIdByCode(companyId: string, code: string): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
    [companyId, code]
  );
  return (rows[0] as { id?: string } | undefined)?.id ?? null;
}

/** Contacts of this company among the lines (customer_contacts / vendors). */
async function assertContactsOwned(companyId: string, lines: JournalLineBody[]): Promise<void> {
  for (const [index, l] of lines.entries()) {
    if (!l.contactId) continue;
    if (!l.contactType) {
      throw lineError("CONTACT_TYPE_REQUIRED", index, "contactType", "Choose a customer or supplier");
    }
    const table = l.contactType === "customer" ? "customer_contacts" : "vendors";
    const ok =
      UUID_RE.test(l.contactId) &&
      (
        await pool.query(`SELECT 1 FROM ${table} WHERE company_id = $1 AND id = $2 LIMIT 1`, [
          companyId,
          l.contactId,
        ])
      ).rows.length > 0;
    if (!ok) {
      throw lineError(
        "CONTACT_NOT_FOUND",
        index,
        "contactId",
        "This contact is not a customer or supplier of this company"
      );
    }
  }
}

async function companyVatRate(companyId: string): Promise<number> {
  const { rows } = await pool.query(`SELECT address_country FROM companies WHERE id = $1`, [
    companyId,
  ]);
  const country = (rows[0] as { address_country?: string | null } | undefined)?.address_country;
  return STANDARD_VAT_RATES[vatJurisdictionForCountry(country)];
}

function ctPct(l: JournalLineBody): string | null {
  if (l.ctTreatment !== "non_deductible") return null;
  if (l.ctDisallowedPct === undefined || l.ctDisallowedPct === null || l.ctDisallowedPct === "")
    return "100";
  return String(l.ctDisallowedPct);
}

/** Manual journal body lines -> kernel lines (converted, attributed, VAT legs added). */
export async function buildManualJournalLines(
  companyId: string,
  date: string | Date,
  lines: JournalLineBody[]
): Promise<PostJournalLineInput[]> {
  const needsAccounts = lines.some((l) => l.vatTreatment === "standard" || l.ctTreatment);
  const accounts = needsAccounts
    ? await loadAccounts(
        companyId,
        lines.map((l) => l.accountId)
      )
    : new Map<string, AccountInfo>();
  await assertContactsOwned(companyId, lines);

  const base = (await loadBaseCurrency(companyId)).toUpperCase();
  const dateIso = date instanceof Date ? date.toISOString().slice(0, 10) : String(date).slice(0, 10);
  let rate: number | null = null;
  const vatAccountIds = new Map<string, string>();
  const vatAccount = async (code: string): Promise<string> => {
    const cached = vatAccountIds.get(code);
    if (cached) return cached;
    const id = await accountIdByCode(companyId, code);
    if (!id) {
      throw new DomainError(
        "VAT_ACCOUNT_MISSING",
        422,
        { code },
        `Account ${code} is missing from the chart of accounts`
      );
    }
    vatAccountIds.set(code, id);
    return id;
  };

  const out: PostJournalLineInput[] = [];
  for (const [index, l] of lines.entries()) {
    const currency = l.foreignCurrency ? String(l.foreignCurrency).trim().toUpperCase() : null;
    const foreign = currency && currency !== base ? currency : null;
    let debit: PostJournalLineInput["debit"] = l.debit ?? null;
    let credit: PostJournalLineInput["credit"] = l.credit ?? null;
    let debitFils: number | undefined;
    let creditFils: number | undefined;
    let exchangeRate: PostJournalLineInput["exchangeRate"] = l.exchangeRate ?? null;
    if (foreign && !present(l.debit) && !present(l.credit)) {
      const side = present(l.foreignDebit) ? "debit" : present(l.foreignCredit) ? "credit" : null;
      if (side) {
        const raw = side === "debit" ? l.foreignDebit : l.foreignCredit;
        const foreignFils = toFils(raw as string | number);
        let convertedFils: number;
        if (present(l.exchangeRate)) {
          convertedFils = Math.round(foreignFils * Number(l.exchangeRate));
        } else {
          const c = await resolve<FxConvert>("fx.convert")(
            companyId,
            foreignFils,
            foreign,
            base,
            dateIso
          );
          convertedFils = c.convertedFils;
          exchangeRate = c.rateText;
        }
        if (side === "debit") {
          debit = null;
          debitFils = convertedFils;
        } else {
          credit = null;
          creditFils = convertedFils;
        }
      }
    }

    const attributes: JournalLineAttributes = {};
    if (l.contactId) {
      attributes.contactType = l.contactType ?? null;
      attributes.contactId = l.contactId;
    }
    if (l.vatTreatment) attributes.vatTreatment = l.vatTreatment;
    const account = accounts.get(String(l.accountId).toLowerCase());
    if (l.ctTreatment) {
      if (!account) {
        throw lineError("ACCOUNT_NOT_FOUND", index, "accountId", "Choose an account");
      }
      if (!ctTreatmentFitsAccount(l.ctTreatment as JournalLineCtTreatment, account.type)) {
        throw lineError(
          "CT_TREATMENT_ACCOUNT_TYPE",
          index,
          "ctTreatment",
          l.ctTreatment === "exempt_income"
            ? "Exempt income applies to an income account"
            : l.ctTreatment === "non_deductible"
              ? "Non-deductible applies to an expense account"
              : "A corporate-tax treatment applies to an income or expense account"
        );
      }
      attributes.ctTreatment = l.ctTreatment;
      const pct = ctPct(l);
      if (pct) attributes.ctDisallowedPct = pct;
    }

    const line: PostJournalLineInput = {
      accountId: l.accountId,
      debit,
      credit,
      ...(debitFils !== undefined ? { debitFils } : {}),
      ...(creditFils !== undefined ? { creditFils } : {}),
      description: l.description ?? null,
      costCenterId: l.costCenterId ?? null,
      foreignCurrency: l.foreignCurrency ?? null,
      foreignDebit: l.foreignDebit ?? null,
      foreignCredit: l.foreignCredit ?? null,
      exchangeRate,
      ...(Object.keys(attributes).length ? { attributes } : {}),
    };
    out.push(line);

    if (l.vatTreatment === "standard") {
      if (!account) throw lineError("ACCOUNT_NOT_FOUND", index, "accountId", "Choose an account");
      const baseDebit = debitFils ?? (present(debit) ? toFils(debit as string | number) : 0);
      const baseCredit = creditFils ?? (present(credit) ? toFils(credit as string | number) : 0);
      rate ??= await companyVatRate(companyId);
      const output = account.type === "income";
      const vatAccountId = await vatAccount(
        output ? ACCOUNT_CODES.VAT_OUTPUT : ACCOUNT_CODES.VAT_INPUT
      );
      const pctLabel = `${Math.round(rate * 100)}%`;
      const label = `${output ? "Output" : "Input"} VAT ${pctLabel}${
        l.description ? `: ${l.description}` : ""
      }`.slice(0, 500);
      const vatDebit = journalLineVatFils(baseDebit, rate);
      const vatCredit = journalLineVatFils(baseCredit, rate);
      if (vatDebit > 0) {
        out.push({ accountId: vatAccountId, debitFils: vatDebit, description: label, systemVat: true });
      } else if (vatCredit > 0) {
        out.push({
          accountId: vatAccountId,
          creditFils: vatCredit,
          description: label,
          systemVat: true,
        });
      }
    }
  }
  return out;
}

/** The standard VAT rate a manual journal line is charged at (UAE 5%, KSA 15%). */
export { companyVatRate as journalVatRate };
