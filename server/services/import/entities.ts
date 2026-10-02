/**
 * What each importable entity looks like: its fields, how a raw row becomes a
 * validated one, how duplicates are recognised, and how a validated row is
 * written. Nothing here posts to the ledger; the opening position goes through
 * opening-balance.service (see jobs.ts).
 */
import { db, pool } from "../../db";
import { accounts, customerContacts, products } from "../../../shared/schema";
import {
  type CellValue,
  type DateFormat,
  type NumberFormat,
  type RawRow,
  cellText,
  parseBoolean,
  parseDate,
  parseNumber,
  round2,
} from "./parse";
import type { ImportEntity } from "./presets";

// ───────────────────────── Options and fields ─────────────────────────

export interface ImportOptions {
  dateFormat: DateFormat;
  numberFormat: NumberFormat;
  /** First day on the new books; the opening position is dated the day before. */
  goLiveDate?: string;
  /** Currency for documents that carry none. */
  currency: string;
  /** Contacts file without a type column: customers or vendors. */
  defaultContactType: "customer" | "vendor" | "both";
  /** Trial balance: roll income and expense accounts into retained earnings. */
  foldProfitAndLoss: boolean;
}

export interface FieldDef {
  key: string;
  required?: boolean;
  description: string;
}

const f = (key: string, description: string, required = false): FieldDef => ({ key, description, required });

export const ENTITY_FIELDS: Record<ImportEntity, FieldDef[]> = {
  contacts: [
    f("name", "Contact name", true), f("type", "customer, vendor or both"), f("email", "Email"), f("phone", "Phone"),
    f("trn", "UAE tax registration number (15 digits)"), f("address", "Address"), f("city", "City"), f("country", "Country"),
    f("contactPerson", "Contact person"), f("paymentTermsDays", "Payment terms in days"), f("notes", "Notes"),
  ],
  items: [
    f("name", "Item name", true), f("sku", "SKU or item code"), f("description", "Description"), f("unitPrice", "Selling price"),
    f("costPrice", "Purchase cost"), f("vatRate", "VAT rate: 0 or 5%"), f("unit", "Unit of measure"), f("isActive", "Active"),
  ],
  accounts: [f("code", "Account code", true), f("name", "Account name", true), f("type", "Account type", true), f("description", "Description")],
  opening_tb: [
    f("accountCode", "Account code (or the name below)"), f("accountName", "Account name"), f("debit", "Debit"), f("credit", "Credit"),
    f("balance", "Signed balance instead of debit/credit (debit positive)"),
  ],
  open_invoices: [
    f("number", "Invoice number", true), f("customer", "Customer", true), f("date", "Invoice date", true), f("dueDate", "Due date"),
    f("amount", "Outstanding amount", true), f("currency", "Currency"), f("exchangeRate", "Exchange rate to AED"),
  ],
  open_bills: [
    f("number", "Bill number", true), f("vendor", "Vendor", true), f("date", "Bill date", true), f("dueDate", "Due date"),
    f("amount", "Outstanding amount", true), f("currency", "Currency"), f("exchangeRate", "Exchange rate to AED"),
  ],
};

export const OPENING_ENTITIES: ReadonlySet<ImportEntity> = new Set(["opening_tb", "open_invoices", "open_bills"]);

// ───────────────────────── Row results ─────────────────────────

export interface RowIssue {
  field?: string;
  code: string;
  message: string;
}
export type RowAction = "create" | "skip_duplicate" | "error";
export interface RowResult {
  normalized: Record<string, unknown> | null;
  errors: RowIssue[];
  action: RowAction;
}

/** What the company already holds, to recognise duplicates. */
export interface ExistingIndex {
  keys: Set<string>;
  accountsByCode: Map<string, { id: string; code: string; nameEn: string; type: string }>;
  accountsByName: Map<string, { id: string; code: string; nameEn: string; type: string }>;
  invoiceNumbers: Set<string>;
  billNumbers: Set<string>;
}

export interface RowContext {
  options: ImportOptions;
  existing: ExistingIndex;
  /** Keys already taken by earlier rows of the same file. */
  seen: Set<string>;
}

const err = (code: string, message: string, field?: string): RowIssue => ({ code, message, field });
const pick = (raw: RawRow, mapping: Record<string, string>, field: string): CellValue | undefined => {
  const column = mapping[field];
  return column === undefined ? undefined : raw[column];
};
const text = (raw: RawRow, mapping: Record<string, string>, field: string, max = 255): { value: string; tooLong: boolean } => {
  const v = cellText(pick(raw, mapping, field));
  return { value: v.slice(0, max), tooLong: v.length > max };
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function finish(normalized: Record<string, unknown>, errors: RowIssue[], dupKey: string | null, ctx: RowContext): RowResult {
  if (errors.length) return { normalized: null, errors, action: "error" };
  if (dupKey) {
    if (ctx.existing.keys.has(dupKey) || ctx.seen.has(dupKey)) return { normalized, errors: [], action: "skip_duplicate" };
    ctx.seen.add(dupKey);
  }
  return { normalized, errors: [], action: "create" };
}

// ───────────────────────── contacts ─────────────────────────

export function contactTypeFrom(label: string, fallback: ImportOptions["defaultContactType"]): "customer" | "vendor" | "both" | null {
  const s = label.trim().toLowerCase();
  if (!s) return fallback;
  if (/both/.test(s)) return "both";
  if (/vend|suppl/.test(s)) return "vendor";
  if (/cust|client/.test(s)) return "customer";
  return null;
}

export function termsToDays(label: string): number | null {
  const s = label.trim().toLowerCase();
  if (!s) return null;
  if (/receipt|immediate|cash|cod/.test(s)) return 0;
  const m = /(\d{1,3})/.exec(s);
  return m ? Number(m[1]) : null;
}

function normalizeContact(raw: RawRow, mapping: Record<string, string>, ctx: RowContext): RowResult {
  const errors: RowIssue[] = [];
  const name = text(raw, mapping, "name");
  if (!name.value) errors.push(err("NAME_REQUIRED", "Name is required", "name"));
  if (name.tooLong) errors.push(err("NAME_TOO_LONG", "Name is longer than 255 characters", "name"));
  const typeLabel = cellText(pick(raw, mapping, "type"));
  const type = contactTypeFrom(typeLabel, ctx.options.defaultContactType);
  if (!type) errors.push(err("TYPE_INVALID", `"${typeLabel}" is not customer, vendor or both`, "type"));
  const email = cellText(pick(raw, mapping, "email")).toLowerCase();
  if (email && !EMAIL.test(email)) errors.push(err("EMAIL_INVALID", `"${email}" is not a valid email`, "email"));
  const trnRaw = cellText(pick(raw, mapping, "trn")).replace(/[\s-]/g, "");
  if (trnRaw && !/^\d{15}$/.test(trnRaw)) errors.push(err("TRN_INVALID", "A UAE TRN is exactly 15 digits", "trn"));
  const termsLabel = cellText(pick(raw, mapping, "paymentTermsDays"));
  const terms = termsToDays(termsLabel);
  if (termsLabel && terms === null) errors.push(err("TERMS_INVALID", `Could not read the payment terms "${termsLabel}"`, "paymentTermsDays"));
  const normalized = {
    name: name.value,
    type: type ?? "customer",
    email: email || null,
    phone: text(raw, mapping, "phone", 40).value || null,
    trn: trnRaw || null,
    address: text(raw, mapping, "address", 500).value || null,
    city: text(raw, mapping, "city", 100).value || null,
    country: text(raw, mapping, "country", 100).value || null,
    contactPerson: text(raw, mapping, "contactPerson").value || null,
    paymentTermsDays: terms,
    notes: text(raw, mapping, "notes", 2000).value || null,
  };
  const key = trnRaw ? `trn:${trnRaw}` : `name:${name.value.toLowerCase()}|${email}`;
  return finish(normalized, errors, name.value ? key : null, ctx);
}

// ───────────────────────── items ─────────────────────────

function vatRateFrom(v: CellValue | undefined, numberFormat: NumberFormat): number | null | "invalid" {
  const s = cellText(v).replace("%", "");
  if (!s) return null;
  const n = parseNumber(s, numberFormat);
  if (n === null) return "invalid";
  if (n === 0) return 0;
  if (n === 5 || n === 0.05) return 0.05;
  return "invalid";
}

function normalizeItem(raw: RawRow, mapping: Record<string, string>, ctx: RowContext): RowResult {
  const errors: RowIssue[] = [];
  const name = text(raw, mapping, "name");
  if (!name.value) errors.push(err("NAME_REQUIRED", "Name is required", "name"));
  const money = (field: string): number | null => {
    const s = cellText(pick(raw, mapping, field));
    if (!s) return null;
    const n = parseNumber(pick(raw, mapping, field), ctx.options.numberFormat);
    if (n === null || n < 0 || n > 9_000_000_000_000) {
      errors.push(err("AMOUNT_INVALID", `"${s}" is not a valid amount`, field));
      return null;
    }
    return round2(n);
  };
  const unitPrice = money("unitPrice");
  const costPrice = money("costPrice");
  const vat = vatRateFrom(pick(raw, mapping, "vatRate"), ctx.options.numberFormat);
  if (vat === "invalid") errors.push(err("VAT_INVALID", "VAT rate must be 0% or 5%", "vatRate"));
  const active = parseBoolean(pick(raw, mapping, "isActive"));
  const sku = text(raw, mapping, "sku", 64).value;
  const normalized = {
    name: name.value,
    sku: sku || null,
    description: text(raw, mapping, "description", 2000).value || null,
    unitPrice: unitPrice ?? 0,
    costPrice,
    vatRate: vat === "invalid" || vat === null ? 0.05 : vat,
    unit: text(raw, mapping, "unit", 32).value || "pcs",
    isActive: active ?? true,
  };
  const key = sku ? `sku:${sku.toLowerCase()}` : `name:${name.value.toLowerCase()}`;
  return finish(normalized, errors, name.value ? key : null, ctx);
}

// ───────────────────────── accounts ─────────────────────────

export function accountTypeFrom(label: string): { type: "asset" | "liability" | "equity" | "income" | "expense"; subType: string | null } | null {
  const s = label.trim().toLowerCase();
  if (!s) return null;
  if (/depreciation/.test(s)) return { type: "expense", subType: null };
  if (/fixed asset|non.?current asset|long.?term asset|property|plant|equipment/.test(s)) return { type: "asset", subType: "fixed_asset" };
  if (/bank|cash|petty|receivable|current asset|other asset|inventory|stock|prepa|deposit|^asset/.test(s)) return { type: "asset", subType: "current_asset" };
  if (/non.?current liabilit|long.?term liabilit|loan|mortgage|noncurrent liabilit/.test(s)) return { type: "liability", subType: "long_term_liability" };
  if (/payable|credit card|current liabilit|liabilit|tax payable|accrued|unearned/.test(s)) return { type: "liability", subType: "current_liability" };
  if (/equity|retained|capital|owner|share|drawing|dividend/.test(s)) return { type: "equity", subType: null };
  if (/revenue|income|sales/.test(s)) return { type: "income", subType: null };
  if (/cost of goods|cost of sales|direct cost|cogs|expense|overhead/.test(s)) return { type: "expense", subType: null };
  return null;
}

function normalizeAccount(raw: RawRow, mapping: Record<string, string>, ctx: RowContext): RowResult {
  const errors: RowIssue[] = [];
  const code = text(raw, mapping, "code", 40).value;
  if (!code) errors.push(err("CODE_REQUIRED", "Account code is required", "code"));
  else if (!/^[A-Za-z0-9._-]{1,20}$/.test(code)) errors.push(err("CODE_INVALID", "Account codes use letters, digits, dot, dash or underscore (20 max)", "code"));
  const name = text(raw, mapping, "name");
  if (!name.value) errors.push(err("NAME_REQUIRED", "Account name is required", "name"));
  const typeLabel = cellText(pick(raw, mapping, "type"));
  const type = accountTypeFrom(typeLabel);
  if (!type) errors.push(err("TYPE_UNRECOGNISED", typeLabel ? `Account type "${typeLabel}" is not recognised` : "Account type is required", "type"));
  const normalized = {
    code,
    name: name.value,
    type: type?.type ?? null,
    subType: type?.subType ?? null,
    description: text(raw, mapping, "description", 500).value || null,
  };
  return finish(normalized, errors, code ? `code:${code.toLowerCase()}` : null, ctx);
}

// ───────────────────────── opening trial balance ─────────────────────────

function normalizeTbRow(raw: RawRow, mapping: Record<string, string>, ctx: RowContext): RowResult {
  const errors: RowIssue[] = [];
  const code = text(raw, mapping, "accountCode", 40).value;
  const name = text(raw, mapping, "accountName").value;
  let account = code ? ctx.existing.accountsByCode.get(code) : undefined;
  if (!account && name) account = ctx.existing.accountsByName.get(name.toLowerCase());
  if (!code && !name) errors.push(err("ACCOUNT_REQUIRED", "Each row needs an account code or name", "accountCode"));
  else if (!account) errors.push(err("ACCOUNT_UNKNOWN", `No account "${code || name}" in your chart. Import the chart of accounts first, or fix the name.`, "accountCode"));

  const amount = (field: string): number => {
    const s = cellText(pick(raw, mapping, field));
    if (!s) return 0;
    const n = parseNumber(pick(raw, mapping, field), ctx.options.numberFormat);
    if (n === null) {
      errors.push(err("AMOUNT_INVALID", `"${s}" is not a valid amount`, field));
      return 0;
    }
    return n;
  };
  let debit = 0;
  let credit = 0;
  if (mapping.balance && !mapping.debit && !mapping.credit) {
    const b = amount("balance");
    if (b >= 0) debit = b;
    else credit = -b;
  } else {
    debit = amount("debit");
    credit = amount("credit");
    // Some exports carry negative figures instead of using the other column.
    if (debit < 0) {
      credit += -debit;
      debit = 0;
    }
    if (credit < 0) {
      debit += -credit;
      credit = 0;
    }
  }
  debit = round2(debit);
  credit = round2(credit);
  if (debit > 0 && credit > 0) {
    const net = round2(debit - credit);
    debit = net > 0 ? net : 0;
    credit = net < 0 ? -net : 0;
  }
  if (errors.length) return { normalized: null, errors, action: "error" };
  const isPl = !!account && (account.type === "income" || account.type === "expense");
  const normalized = {
    accountId: account!.id,
    accountCode: account!.code,
    accountName: account!.nameEn,
    accountType: account!.type,
    debit,
    credit,
    foldedIntoRetainedEarnings: isPl && ctx.options.foldProfitAndLoss,
  };
  if (debit === 0 && credit === 0) return { normalized: { ...normalized, note: "zero balance" }, errors: [], action: "skip_duplicate" };
  if (isPl && !ctx.options.foldProfitAndLoss) {
    return { normalized: null, errors: [err("ACCOUNT_NOT_BALANCE_SHEET", `${account!.code} ${account!.nameEn} is an ${account!.type} account. Turn on "roll profit and loss into retained earnings" or remove the row.`, "accountCode")], action: "error" };
  }
  const key = `tb:${account!.code}`;
  if (ctx.seen.has(key)) return { normalized: null, errors: [err("ACCOUNT_DUPLICATE", `Account ${account!.code} appears more than once`, "accountCode")], action: "error" };
  ctx.seen.add(key);
  return { normalized, errors: [], action: "create" };
}

// ───────────────────────── open invoices / bills ─────────────────────────

function normalizeOpenDocument(kind: "invoice" | "bill") {
  const partyField = kind === "invoice" ? "customer" : "vendor";
  return (raw: RawRow, mapping: Record<string, string>, ctx: RowContext): RowResult => {
    const errors: RowIssue[] = [];
    const number = text(raw, mapping, "number", 64).value;
    if (!number) errors.push(err("NUMBER_REQUIRED", `${kind === "invoice" ? "Invoice" : "Bill"} number is required`, "number"));
    const party = text(raw, mapping, partyField).value;
    if (!party) errors.push(err("PARTY_REQUIRED", `${kind === "invoice" ? "Customer" : "Vendor"} is required`, partyField));
    const date = parseDate(pick(raw, mapping, "date"), ctx.options.dateFormat);
    if (!date) errors.push(err("DATE_INVALID", `"${cellText(pick(raw, mapping, "date"))}" is not a date in the format ${ctx.options.dateFormat}`, "date"));
    const dueRaw = pick(raw, mapping, "dueDate");
    const dueDate = cellText(dueRaw) ? parseDate(dueRaw, ctx.options.dateFormat) : null;
    if (cellText(dueRaw) && !dueDate) errors.push(err("DATE_INVALID", `"${cellText(dueRaw)}" is not a date in the format ${ctx.options.dateFormat}`, "dueDate"));
    const amountRaw = pick(raw, mapping, "amount");
    const amount = parseNumber(amountRaw, ctx.options.numberFormat);
    if (amount === null || amount <= 0 || amount > 9_000_000_000_000) errors.push(err("AMOUNT_INVALID", `"${cellText(amountRaw)}" is not an amount greater than zero`, "amount"));
    const currency = (text(raw, mapping, "currency", 3).value || ctx.options.currency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) errors.push(err("CURRENCY_INVALID", "Currency must be a 3-letter code", "currency"));
    let exchangeRate = 1;
    if (currency !== "AED") {
      const rate = parseNumber(pick(raw, mapping, "exchangeRate"), ctx.options.numberFormat);
      if (rate === null || rate <= 0) errors.push(err("RATE_REQUIRED", `A ${currency} document needs an exchange rate to AED`, "exchangeRate"));
      else exchangeRate = rate;
    }
    const existing = kind === "invoice" ? ctx.existing.invoiceNumbers : ctx.existing.billNumbers;
    if (number && kind === "invoice" && existing.has(number)) errors.push(err("NUMBER_EXISTS", `Invoice number ${number} already exists in this company`, "number"));
    const key = `${kind}:${number}`;
    if (number && ctx.seen.has(key)) errors.push(err("NUMBER_DUPLICATE", `Number ${number} appears more than once in the file`, "number"));
    if (errors.length) return { normalized: null, errors, action: "error" };
    ctx.seen.add(key);
    return {
      normalized: { number, party, date, dueDate, amount: round2(amount!), currency, exchangeRate },
      errors: [],
      action: "create",
    };
  };
}

// ───────────────────────── Dispatch ─────────────────────────

export function normalizeRow(entity: ImportEntity, raw: RawRow, mapping: Record<string, string>, ctx: RowContext): RowResult {
  switch (entity) {
    case "contacts":
      return normalizeContact(raw, mapping, ctx);
    case "items":
      return normalizeItem(raw, mapping, ctx);
    case "accounts":
      return normalizeAccount(raw, mapping, ctx);
    case "opening_tb":
      return normalizeTbRow(raw, mapping, ctx);
    case "open_invoices":
      return normalizeOpenDocument("invoice")(raw, mapping, ctx);
    case "open_bills":
      return normalizeOpenDocument("bill")(raw, mapping, ctx);
  }
}

export async function loadExisting(entity: ImportEntity, companyId: string): Promise<ExistingIndex> {
  const idx: ExistingIndex = { keys: new Set(), accountsByCode: new Map(), accountsByName: new Map(), invoiceNumbers: new Set(), billNumbers: new Set() };
  if (entity === "contacts") {
    const { rows } = await pool.query(`SELECT name, email, trn_number FROM customer_contacts WHERE company_id = $1`, [companyId]);
    for (const r of rows) idx.keys.add(r.trn_number ? `trn:${r.trn_number}` : `name:${String(r.name).toLowerCase()}|${String(r.email ?? "").toLowerCase()}`);
  } else if (entity === "items") {
    const { rows } = await pool.query(`SELECT name, sku FROM products WHERE company_id = $1`, [companyId]);
    for (const r of rows) idx.keys.add(r.sku ? `sku:${String(r.sku).toLowerCase()}` : `name:${String(r.name).toLowerCase()}`);
  } else if (entity === "accounts") {
    const { rows } = await pool.query(`SELECT code FROM accounts WHERE company_id = $1`, [companyId]);
    for (const r of rows) idx.keys.add(`code:${String(r.code).toLowerCase()}`);
  } else if (entity === "opening_tb") {
    const { rows } = await pool.query(`SELECT id, code, name_en, type FROM accounts WHERE company_id = $1 AND COALESCE(is_archived, false) = false`, [companyId]);
    for (const r of rows) {
      const a = { id: r.id, code: r.code, nameEn: r.name_en, type: r.type };
      idx.accountsByCode.set(r.code, a);
      if (!idx.accountsByName.has(String(r.name_en).toLowerCase())) idx.accountsByName.set(String(r.name_en).toLowerCase(), a);
    }
  } else if (entity === "open_invoices") {
    const { rows } = await pool.query(`SELECT number FROM invoices WHERE company_id = $1`, [companyId]);
    for (const r of rows) idx.invoiceNumbers.add(r.number);
  }
  return idx;
}

// ───────────────────────── Commit (contacts, items, accounts) ─────────────────────────

export interface CommitRow {
  id: string;
  normalized: Record<string, any>;
}

/** Insert one chunk of validated rows; returns row id -> created entity id. Runs inside the caller's transaction. */
export async function insertChunk(entity: ImportEntity, companyId: string, rows: CommitRow[], tx: typeof db): Promise<Map<string, string>> {
  const created = new Map<string, string>();
  if (entity === "contacts") {
    for (const r of rows) {
      const n = r.normalized;
      const [row] = await tx
        .insert(customerContacts)
        .values({
          companyId,
          name: n.name,
          contactType: n.type,
          email: n.email,
          phone: n.phone,
          trnNumber: n.trn,
          address: n.address,
          city: n.city,
          country: n.country ?? "UAE",
          contactPerson: n.contactPerson,
          paymentTerms: n.paymentTermsDays ?? 30,
          notes: n.notes,
        } as any)
        .returning({ id: customerContacts.id });
      created.set(r.id, row.id);
    }
  } else if (entity === "items") {
    for (const r of rows) {
      const n = r.normalized;
      const [row] = await tx
        .insert(products)
        .values({
          companyId,
          name: n.name,
          sku: n.sku,
          description: n.description,
          unitPrice: n.unitPrice,
          costPrice: n.costPrice ?? 0,
          averageCost: n.costPrice && n.costPrice > 0 ? n.costPrice : 0,
          vatRate: n.vatRate,
          unit: n.unit,
          isActive: n.isActive,
        } as any)
        .returning({ id: products.id });
      created.set(r.id, row.id);
    }
  } else if (entity === "accounts") {
    for (const r of rows) {
      const n = r.normalized;
      const [row] = await tx
        .insert(accounts)
        .values({
          companyId,
          code: n.code,
          nameEn: n.name,
          description: n.description,
          type: n.type,
          subType: n.subType,
          isVatAccount: false,
          vatType: null,
          isSystemAccount: false,
          isActive: true,
          isArchived: false,
        } as any)
        .returning({ id: accounts.id });
      created.set(r.id, row.id);
    }
  }
  return created;
}

/** A row that became a duplicate between the dry run and the commit (someone created it meanwhile). */
export async function isNowDuplicate(entity: ImportEntity, companyId: string, n: Record<string, any>): Promise<boolean> {
  let found: { rows: unknown[] } | null = null;
  if (entity === "contacts") {
    found = n.trn
      ? await pool.query(`SELECT 1 FROM customer_contacts WHERE company_id = $1 AND trn_number = $2 LIMIT 1`, [companyId, n.trn])
      : await pool.query(`SELECT 1 FROM customer_contacts WHERE company_id = $1 AND lower(name) = $2 AND lower(coalesce(email, '')) = $3 LIMIT 1`, [
          companyId,
          String(n.name).toLowerCase(),
          String(n.email ?? "").toLowerCase(),
        ]);
  } else if (entity === "items") {
    found = n.sku
      ? await pool.query(`SELECT 1 FROM products WHERE company_id = $1 AND lower(sku) = $2 LIMIT 1`, [companyId, String(n.sku).toLowerCase()])
      : await pool.query(`SELECT 1 FROM products WHERE company_id = $1 AND sku IS NULL AND lower(name) = $2 LIMIT 1`, [companyId, String(n.name).toLowerCase()]);
  } else if (entity === "accounts") {
    found = await pool.query(`SELECT 1 FROM accounts WHERE company_id = $1 AND lower(code) = $2 LIMIT 1`, [companyId, String(n.code).toLowerCase()]);
  }
  return !!found && found.rows.length > 0;
}
