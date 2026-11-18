/**
 * WQ5: the contact form's state and the request body it sends (pure, so tests call it).
 */
import type { SellerIdType, TaxRegistrationType } from "@shared/validators/einvoice-identity";
import type { CustomerContact } from "@shared/schema";

export type ContactRow = CustomerContact & {
  legalIdType?: SellerIdType | null;
  legalId?: string | null;
  legalIdCountry?: string | null;
};

export interface Registration {
  type: TaxRegistrationType;
  number: string;
}

export interface ContactFormState {
  name: string;
  nameAr: string;
  email: string;
  phone: string;
  address: string;
  addressStreet: string;
  addressBuilding: string;
  addressDistrict: string;
  postalCode: string;
  city: string;
  country: string;
  emirate: string;
  paymentTerms: number;
  isCustomer: boolean;
  isSupplier: boolean;
  partyType: "business" | "individual";
  freeZone: boolean;
  legalIdType: SellerIdType | "";
  legalId: string;
  legalIdCountry: string;
  registrations: Registration[];
  defaultRevenueAccountId: string;
  defaultExpenseAccountId: string;
  defaultVatTreatment: string;
  defaultCostCenterId: string;
}

/** Typed registrations, else the legacy single TRN as a VAT registration. */
export function initialRegistrations(contact?: ContactRow | null): Registration[] {
  const typed = (contact?.taxRegistrations ?? []) as Registration[];
  if (typed.length) return typed;
  return contact?.trnNumber ? [{ type: "vat", number: contact.trnNumber }] : [];
}

/** The request body the form sends. */
export function contactBodyFromForm(f: ContactFormState) {
  const registrations = f.registrations
    .map((r) => ({ type: r.type, number: r.number.trim() }))
    .filter((r) => r.number);
  const vat = registrations.find((r) => r.type === "vat");
  const legacyAddress = [f.addressStreet, f.addressBuilding, f.addressDistrict]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
  const blank = (s: string) => (s.trim() ? s.trim() : null);
  return {
    name: f.name,
    nameAr: blank(f.nameAr),
    email: f.email,
    phone: f.phone,
    trnNumber: vat?.number ?? "",
    taxRegistrations: registrations,
    // Legacy single line (PDF, statements) follows the structured address.
    address: legacyAddress || f.address,
    addressStreet: blank(f.addressStreet),
    addressBuilding: blank(f.addressBuilding),
    addressDistrict: blank(f.addressDistrict),
    postalCode: blank(f.postalCode),
    city: f.city,
    country: f.country,
    emirate: f.emirate || null,
    paymentTerms: f.paymentTerms,
    isCustomer: f.isCustomer,
    isSupplier: f.isSupplier,
    partyType: f.partyType,
    freeZone: f.freeZone,
    legalIdType: f.legalIdType || null,
    legalId: blank(f.legalId),
    legalIdCountry: f.legalIdType === "PAS" ? blank(f.legalIdCountry) : null,
    defaultRevenueAccountId: f.isCustomer ? f.defaultRevenueAccountId || null : null,
    defaultExpenseAccountId: f.isSupplier ? f.defaultExpenseAccountId || null : null,
    defaultVatTreatment: f.defaultVatTreatment || null,
    defaultCostCenterId: f.defaultCostCenterId || null,
  };
}
