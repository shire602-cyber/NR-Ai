/**
 * X6d: company-level e-invoicing readiness checklist (dashboard card and onboarding).
 *
 * It is built from the same PINT AE rule hints `validateForEInvoicing` applies per invoice
 * (supplier identity, buyer address and TRN, reverse-charge item GTIN), run over the company
 * profile, its B2B customer contacts and its products, so the checklist can never disagree with
 * the per-invoice validation. It also reports where the company stands against the mandate
 * timeline and whether anything can actually be transmitted.
 *
 * Honesty rules: the mandate dates are the Ministry of Finance timeline in `scope.ts` (guidance,
 * to be confirmed per entity), and transmission stays OFF until an accredited provider is
 * connected; this checklist never claims a document was sent.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { customerContacts, products, type Company } from "../../../shared/schema";
import { validateForEInvoicing } from "../einvoice.service";
import { getLegalEntity } from "./legal-entities";
import { companyProviderHealth } from "./providers/company-provider";
import { einvoicingScope, EINVOICE_TIMELINE } from "./scope";

export type ReadinessKey =
  | "scope"
  | "supplier_identity"
  | "customer_details"
  | "product_codes"
  | "provider";

export interface ReadinessItem {
  key: ReadinessKey;
  status: "done" | "todo";
  /** Records that still need fixing (0 when done). */
  count: number;
  /** Records checked. */
  total: number;
  /** A few offending names/fields (data, not copy). */
  samples: string[];
  /** The PINT AE rule ids behind this check, for the fix hint. */
  rules: string[];
  fixHref: string;
}

export interface EInvoiceReadiness {
  mandate: {
    scope: string | null;
    band: string | null;
    goLiveDate: string | null;
    appointAspBy: string | null;
    daysToGoLive: number | null;
    mandatory: boolean;
    source: "override" | "band" | "unset";
    timeline: typeof EINVOICE_TIMELINE;
  };
  transmission: {
    /** True only with a real (non-test) provider whose legal entity is active. */
    enabled: boolean;
    provider: string | null;
    environment: string | null;
    reason: "no_provider" | "test_provider" | "legal_entity_not_active" | null;
  };
  items: ReadinessItem[];
  done: number;
  total: number;
}

const SETTINGS = "/settings/einvoicing";
const MAX_SAMPLES = 3;

type CompanyRow = Company & Record<string, unknown>;

/** Supplier identity issues, straight from the per-invoice rules (stub invoice, company fields only). */
function supplierIssues(company: Company) {
  const stub = {
    number: "READINESS",
    date: new Date(),
    customerName: "Readiness check",
    currency: "AED",
    total: 0,
    subtotal: 0,
    vatAmount: 0,
    status: "draft",
  } as unknown as Parameters<typeof validateForEInvoicing>[0];
  return validateForEInvoicing(
    stub,
    [{ description: "x", quantity: 1, unitPrice: 0 }] as never,
    company
  )
    .filter((i) => i.field.startsWith("company."))
    .map((i) => i.field);
}

function contactIssues(
  company: Company,
  contact: {
    name: string;
    trnNumber: string | null;
    address: string | null;
    city: string | null;
    emirate: string | null;
    country: string | null;
  }
): string[] {
  const stub = {
    number: "READINESS",
    date: new Date(),
    customerName: contact.name,
    customerTrn: contact.trnNumber,
    currency: "AED",
    total: 0,
    subtotal: 0,
    vatAmount: 0,
    status: "draft",
  } as unknown as Parameters<typeof validateForEInvoicing>[0];
  const found = validateForEInvoicing(
    stub,
    [{ description: "x", quantity: 1, unitPrice: 0 }] as never,
    company,
    {
      customer: {
        trn: contact.trnNumber,
        address: contact.address,
        city: contact.city,
        emirate: contact.emirate,
        country: contact.country === "UAE" || !contact.country ? "AE" : contact.country,
      },
    }
  )
    .filter((i) => i.field === "customer.address" || i.field === "invoice.customerTrn")
    .map((i) => i.field);
  return [...new Set(found)];
}

export async function computeEInvoiceReadiness(
  company: Company,
  now = new Date()
): Promise<EInvoiceReadiness> {
  const c = company as CompanyRow;
  const scope = einvoicingScope(
    {
      einvoiceScope: c.einvoiceScope as string | null,
      einvoiceTurnoverBand: c.einvoiceTurnoverBand as string | null,
      einvoiceGoLiveDate: c.einvoiceGoLiveDate as string | null,
    },
    now
  );

  // 1. Scope chosen (the mandate date follows from it).
  const scopeChosen = scope.scope !== null && (scope.goLiveDate !== null || scope.scope === "none");

  // 2. Supplier identity.
  const supplier = [...new Set(supplierIssues(company))];

  // 3. B2B customer contacts (those with a TRN are reported to the FTA).
  const contacts = await db
    .select()
    .from(customerContacts)
    .where(and(eq(customerContacts.companyId, company.id), eq(customerContacts.isActive, true)));
  const b2b = contacts.filter((x) => !!x.trnNumber?.trim());
  const badContacts = b2b.filter((x) => contactIssues(company, x).length > 0);

  // 4. Product codes: reverse-charge goods need a GTIN (ibr-174-ae); other goods should carry an item code (SKU or GTIN) so buyers can match lines.
  const prods = await db
    .select()
    .from(products)
    .where(and(eq(products.companyId, company.id), eq(products.isActive, true)));
  const goods = prods.filter((p) => p.productType !== "service");
  const badProducts = goods.filter(
    (p) => (p.rcmGoodsType && !p.gtin) || (!p.sku?.trim() && !p.gtin)
  );

  // 5. Provider: real provider with an active legal entity.
  const health = await companyProviderHealth(company);
  const linked = health.provider
    ? await getLegalEntity(company.id, health.provider.id, health.provider.environment)
    : null;
  const reason = !health.provider
    ? "no_provider"
    : linked?.status === "active"
      ? null
      : "legal_entity_not_active";

  const items: ReadinessItem[] = [
    {
      key: "scope",
      status: scopeChosen ? "done" : "todo",
      count: scopeChosen ? 0 : 1,
      total: 1,
      samples: [],
      rules: [],
      fixHref: SETTINGS,
    },
    {
      key: "supplier_identity",
      status: supplier.length === 0 ? "done" : "todo",
      count: supplier.length,
      total: 5,
      samples: supplier.slice(0, MAX_SAMPLES),
      rules: ["ibr-128-ae", "ibr-132-ae", "ibr-143-ae", "ibr-150-ae"],
      fixHref: SETTINGS,
    },
    {
      key: "customer_details",
      status: badContacts.length === 0 ? "done" : "todo",
      count: badContacts.length,
      total: b2b.length,
      samples: badContacts.slice(0, MAX_SAMPLES).map((x) => x.name),
      rules: ["ibr-144-ae", "ibr-103-ae"],
      fixHref: "/contacts",
    },
    {
      key: "product_codes",
      status: badProducts.length === 0 ? "done" : "todo",
      count: badProducts.length,
      total: goods.length,
      samples: badProducts.slice(0, MAX_SAMPLES).map((p) => p.name),
      rules: ["ibr-174-ae"],
      fixHref: "/inventory",
    },
    {
      key: "provider",
      status: reason === null ? "done" : "todo",
      count: reason === null ? 0 : 1,
      total: 1,
      samples: [],
      rules: [],
      fixHref: SETTINGS,
    },
  ];

  return {
    mandate: {
      scope: scope.scope,
      band: scope.band,
      goLiveDate: scope.goLiveDate,
      appointAspBy: scope.appointAspBy,
      daysToGoLive: scope.daysToGoLive,
      mandatory: scope.mandatory,
      source: scope.source,
      timeline: EINVOICE_TIMELINE,
    },
    transmission: {
      enabled: reason === null,
      provider: health.chosenProvider,
      environment: health.environment,
      reason,
    },
    items,
    done: items.filter((i) => i.status === "done").length,
    total: items.length,
  };
}
