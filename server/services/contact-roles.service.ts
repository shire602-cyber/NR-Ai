/**
 * WQ5: one contact record for a customer and/or supplier.
 *
 * A contact with the supplier role is linked to a vendors row (`customer_contacts.vendor_id`),
 * because bills, purchase orders and the A/P ageing read vendors. The link is created (or an
 * existing vendor with the same TRN / name is adopted) when the role is switched on, and the
 * shared fields are kept in step on every save. Switching the role off keeps the vendor (bills
 * still point at it).
 *
 * Default accounts follow the line rules: revenue must be an income account, expense an expense
 * or asset account, and neither may be a control account (C1: 1040, 2010, 2020, ...).
 */
import { pool } from "../db";
import { DomainError } from "../errors";
import { assertChosenAccountsNotControl } from "../ledger/control-accounts";
import { createVendor, updateVendor } from "./vendor.service";
import { getBuyerEndpoint, upsertBuyerEndpoint } from "./einvoice/store";
import type { CustomerContact } from "../../shared/schema";
import {
  sellerIdProblem,
  type SellerIdType,
  type TaxRegistration,
} from "../../shared/validators/einvoice-identity";

export interface ContactRoleInput {
  name?: string;
  nameAr?: string | null;
  email?: string | null;
  phone?: string | null;
  trnNumber?: string | null;
  address?: string | null;
  addressStreet?: string | null;
  addressBuilding?: string | null;
  addressDistrict?: string | null;
  emirate?: string | null;
  country?: string | null;
  paymentTerms?: number | null;
  notes?: string | null;
  isCustomer?: boolean;
  isSupplier?: boolean;
  taxRegistrations?: TaxRegistration[];
  defaultRevenueAccountId?: string | null;
  defaultExpenseAccountId?: string | null;
  defaultCostCenterId?: string | null;
}

async function accountType(companyId: string, id: string): Promise<string | null> {
  const r = await pool.query(
    `SELECT type FROM accounts WHERE id = $1 AND company_id = $2 AND COALESCE(is_archived, false) = false`,
    [id, companyId]
  );
  return r.rows[0]?.type ?? null;
}

/** Validate default accounts / cost centre (tenant-scoped; another company's id is a 404). */
export async function assertContactDefaults(
  companyId: string,
  input: ContactRoleInput
): Promise<void> {
  if (input.defaultRevenueAccountId) {
    const type = await accountType(companyId, input.defaultRevenueAccountId);
    if (!type)
      throw new DomainError("ACCOUNT_NOT_FOUND", 404, { field: "defaultRevenueAccountId" });
    if (type !== "income")
      throw new DomainError(
        "REVENUE_ACCOUNT_REQUIRED",
        422,
        { field: "defaultRevenueAccountId" },
        "The default revenue account must be an income account"
      );
  }
  if (input.defaultExpenseAccountId) {
    const type = await accountType(companyId, input.defaultExpenseAccountId);
    if (!type)
      throw new DomainError("ACCOUNT_NOT_FOUND", 404, { field: "defaultExpenseAccountId" });
    if (type !== "expense" && type !== "asset")
      throw new DomainError(
        "EXPENSE_ACCOUNT_REQUIRED",
        422,
        { field: "defaultExpenseAccountId" },
        "The default expense account must be an expense or asset account"
      );
  }
  await assertChosenAccountsNotControl(companyId, [
    { field: "default_revenue_account_id", accountId: input.defaultRevenueAccountId ?? null },
    { field: "default_expense_account_id", accountId: input.defaultExpenseAccountId ?? null },
  ]);
  if (input.defaultCostCenterId) {
    const r = await pool.query(`SELECT 1 FROM cost_centers WHERE id = $1 AND company_id = $2`, [
      input.defaultCostCenterId,
      companyId,
    ]);
    if (!r.rows[0])
      throw new DomainError("COST_CENTER_NOT_FOUND", 404, { field: "defaultCostCenterId" });
  }
}

/**
 * Keep the plain TRN column (invoices, VAT, the PDF read it) and the typed VAT registration in
 * step. The typed list wins when it names a VAT registration.
 */
export function reconcileTaxRegistrations<T extends ContactRoleInput>(
  input: T,
  existing?: {
    trnNumber: string | null;
    taxRegistrations: Array<{ type: string; number: string }> | null;
  }
): T {
  const out = { ...input };
  if (out.taxRegistrations) {
    const vat = out.taxRegistrations.find((r) => r.type === "vat");
    if (vat) out.trnNumber = vat.number;
    else if (out.trnNumber === undefined && existing?.trnNumber) {
      // The VAT registration was removed from the list: clear the plain column too.
      out.trnNumber = null;
    }
  } else if (out.trnNumber !== undefined) {
    const others = (existing?.taxRegistrations ?? []).filter((r) => r.type !== "vat");
    out.taxRegistrations = [
      ...(out.trnNumber ? [{ type: "vat" as const, number: out.trnNumber }] : []),
      ...(others as TaxRegistration[]),
    ];
  }
  return out;
}

/**
 * The legacy single-line `address` (copied onto invoices, PDFs and statements) follows the
 * structured street / building / district when the caller sends those without `address`.
 */
export function withLegacyAddress<T extends ContactRoleInput>(
  input: T,
  existing?: Partial<
    Pick<ContactRoleInput, "addressStreet" | "addressBuilding" | "addressDistrict">
  >
): T {
  const touched =
    input.addressStreet !== undefined ||
    input.addressBuilding !== undefined ||
    input.addressDistrict !== undefined;
  if (!touched || input.address !== undefined) return input;
  const pick = (k: "addressStreet" | "addressBuilding" | "addressDistrict") =>
    input[k] !== undefined ? input[k] : existing?.[k];
  const line = [pick("addressStreet"), pick("addressBuilding"), pick("addressDistrict")]
    .map((v) => (v ?? "").trim())
    .filter(Boolean)
    .join(", ");
  return { ...input, address: line || null };
}

function vendorPatchFrom(c: ContactRoleInput & { name: string }) {
  const address = [c.addressStreet, c.addressBuilding, c.addressDistrict]
    .filter((v) => v && String(v).trim())
    .join(", ");
  const country = (c.country ?? "").trim().toUpperCase();
  return {
    name: c.name,
    name_ar: c.nameAr ?? null,
    trn: c.trnNumber && /^\d{15}$/.test(c.trnNumber) ? c.trnNumber : null,
    email: c.email ?? null,
    phone: c.phone ?? null,
    address: address || c.address || null,
    emirate: (c.emirate as never) ?? null,
    ...(country === "AE" || country === "UAE" || country === "UNITED ARAB EMIRATES"
      ? { country: "AE" }
      : /^[A-Z]{2}$/.test(country)
        ? { country }
        : {}),
    payment_terms_days: c.paymentTerms ?? undefined,
    default_expense_account_id: c.defaultExpenseAccountId ?? null,
  };
}

/**
 * Ensure a supplier contact has its vendors row. Returns the vendor id to store on the contact
 * (unchanged when the supplier role is off).
 */
export async function syncSupplierVendor(
  companyId: string,
  merged: ContactRoleInput & { name: string; isSupplier: boolean; vendorId: string | null }
): Promise<string | null> {
  if (!merged.isSupplier) return merged.vendorId;
  const patch = vendorPatchFrom(merged);
  if (merged.vendorId) {
    try {
      await updateVendor(companyId, merged.vendorId, patch as never);
      return merged.vendorId;
    } catch (err) {
      if (err instanceof DomainError && err.code === "VENDOR_NOT_FOUND") {
        // The vendor was deleted: fall through and create a fresh one.
      } else throw err;
    }
  }
  try {
    const v = await createVendor(companyId, patch as never);
    return v.id;
  } catch (err) {
    // A vendor with this TRN or name already exists: adopt it (one record, no duplicate).
    if (err instanceof DomainError && err.code === "VENDOR_DUPLICATE") {
      const existingId = (err.details as { existingVendorId?: string } | undefined)
        ?.existingVendorId;
      if (existingId) {
        const owner = await pool.query(
          `SELECT id FROM customer_contacts WHERE company_id = $1 AND vendor_id = $2 LIMIT 1`,
          [companyId, existingId]
        );
        if (owner.rows[0]) {
          throw new DomainError(
            "VENDOR_ALREADY_LINKED",
            409,
            { existingVendorId: existingId, contactId: owner.rows[0].id },
            "Another contact is already this supplier"
          );
        }
        return existingId;
      }
    }
    throw err;
  }
}

export interface BuyerLegalInput {
  legalIdType?: string | null;
  legalId?: string | null;
  /** Passport issuing country (BTAE-19): stored as the endpoint's legal authority. */
  legalIdCountry?: string | null;
}

/** Refuse a buyer ID that PINT AE would reject (passport without its issuing country, ...). */
export function assertBuyerLegalId(legal: BuyerLegalInput): void {
  if (!legal.legalIdType || !legal.legalId) return;
  const problem = sellerIdProblem(
    legal.legalIdType as SellerIdType,
    legal.legalId,
    legal.legalIdCountry
  );
  if (problem) {
    throw new DomainError(
      problem,
      422,
      { field: problem === "SELLER_ID_PASSPORT_COUNTRY" ? "legalIdCountry" : "legalId" },
      "Check the ID details."
    );
  }
}

/** Write the buyer legal identifier to einvoice_buyer_endpoints, keeping the other columns. */
export async function syncBuyerLegalId(
  companyId: string,
  contactId: string,
  legal: BuyerLegalInput
): Promise<void> {
  if (
    legal.legalIdType === undefined &&
    legal.legalId === undefined &&
    legal.legalIdCountry === undefined
  )
    return;
  const existing = await getBuyerEndpoint(companyId, contactId);
  const pick = <T>(v: T | undefined, old: T | null | undefined): T | null =>
    v !== undefined ? (v ?? null) : (old ?? null);
  await upsertBuyerEndpoint(companyId, contactId, {
    participantId: existing?.participantId ?? null,
    scheme: existing?.scheme ?? null,
    legalAuthority: pick(legal.legalIdCountry, existing?.legalAuthority),
    legalIdType: pick(legal.legalIdType, existing?.legalIdType),
    legalId: pick(legal.legalId, existing?.legalId),
  });
}

type LegalView = {
  legalIdType: string | null;
  legalId: string | null;
  legalIdCountry: string | null;
};

/** The contact list adds the buyer legal identifier (one query for the company). */
export async function buyerLegalIds(companyId: string): Promise<Map<string, LegalView>> {
  const r = await pool.query(
    `SELECT contact_id, legal_id_type, legal_id, legal_authority
       FROM einvoice_buyer_endpoints WHERE company_id = $1`,
    [companyId]
  );
  return new Map(
    r.rows.map(
      (x: {
        contact_id: string;
        legal_id_type: string | null;
        legal_id: string | null;
        legal_authority: string | null;
      }) => [
        x.contact_id,
        {
          legalIdType: x.legal_id_type,
          legalId: x.legal_id,
          legalIdCountry: x.legal_id_type === "PAS" ? x.legal_authority : null,
        },
      ]
    )
  );
}

export function withLegalId(contact: CustomerContact, map: Map<string, LegalView>) {
  const l = map.get(contact.id);
  return {
    ...contact,
    legalIdType: l?.legalIdType ?? null,
    legalId: l?.legalId ?? null,
    legalIdCountry: l?.legalIdCountry ?? null,
  };
}
