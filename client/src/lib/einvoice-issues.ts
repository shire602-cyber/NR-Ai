/**
 * E-invoice 422 issue list (S1, W4-C follow-up). POST /api/invoices/:id/generate-einvoice answers
 * 422 with either the stored-data fix-it list (`EINVOICE_VALIDATION_FAILED`, `issues`) or the
 * generated document's XSD / schematron / rule findings (`EINVOICE_SCHEMA_INVALID`,
 * `validation`). The invoice list shows every issue instead of a one-line toast.
 */

export interface EInvoiceIssueItem {
  field: string;
  message: string;
  /** Stable server code (e.g. EINVOICE_BUYER_ENDPOINT_MISSING), when the issue has one. */
  code?: string;
  ruleId?: string;
}

type Finding = { id?: string; message?: string; location?: string };
type Layer = { available?: boolean; errors?: Finding[] };

/** Issues from a 422 error body; [] when the body carries none. */
export function einvoiceIssuesFromError(body: unknown): EInvoiceIssueItem[] {
  if (!body || typeof body !== "object") return [];
  const b = body as {
    issues?: Array<{ field?: unknown; message?: unknown; code?: unknown; ruleId?: unknown }>;
    validation?: { xsd?: Layer; schematron?: Layer; rules?: Layer };
  };
  const out: EInvoiceIssueItem[] = [];
  if (Array.isArray(b.issues)) {
    for (const i of b.issues) {
      if (i && typeof i.message === "string") {
        out.push({
          field: typeof i.field === "string" ? i.field : "",
          message: i.message,
          ...(typeof i.code === "string" ? { code: i.code } : {}),
          ...(typeof i.ruleId === "string" ? { ruleId: i.ruleId } : {}),
        });
      }
    }
  }
  const v = b.validation;
  if (v && typeof v === "object") {
    for (const [layer, label] of [
      [v.xsd, "UBL schema"],
      [v.schematron, "PINT AE schematron"],
      [v.rules, "PINT AE rule"],
    ] as const) {
      for (const f of Array.isArray(layer?.errors) ? layer.errors : []) {
        if (!f?.message) continue;
        out.push({
          field: [label, f.id].filter(Boolean).join(" "),
          message: f.message,
          ...(f.id ? { ruleId: f.id } : {}),
        });
      }
    }
    if (out.length === 0 && (v.xsd?.available === false || v.schematron?.available === false)) {
      out.push({
        field: "document.validation",
        message: "",
        code: "EINVOICE_VALIDATION_UNAVAILABLE",
      });
    }
  }
  return out;
}

/**
 * X5 (J1 L3): where an e-invoice issue is fixed, in words the owner knows. `labelKey` names the
 * field (invoices.einvoiceField.*), `whereKey` the screen, and `href` links to it (company
 * fields live on the company profile; invoice and line fields are fixed by editing the invoice).
 * A validator finding ("PINT AE rule ibr-…") keeps its rule label; unknown paths show no raw path.
 */
export interface EInvoiceFieldHint {
  labelKey: string | null;
  whereKey: string | null;
  href: string | null;
  /** Rule / schema findings: the validator's own label (already readable). */
  ruleLabel: string | null;
  /** Localised, actionable fix text for a coded issue (replaces the English message). */
  textKey?: string | null;
}

/** Coded issues the invoice screens explain in the user's language. */
const ISSUE_TEXT_KEYS: Record<string, string> = {
  EINVOICE_BUYER_ENDPOINT_MISSING: "invoices.einvoiceIssue.buyerEndpointMissing",
  EINVOICE_BUYER_ADDRESS_MISSING: "invoices.einvoiceIssue.buyerAddressMissing",
};

export function einvoiceIssueTextKey(code: string | undefined): string | null {
  return code ? (ISSUE_TEXT_KEYS[code] ?? `einvoicing.issue_${code}`) : null;
}

export function einvoiceRuleTextKey(ruleId: string | undefined): string | null {
  const codes: Record<string, string> = {
    "ibr-127-ae": "EINVOICE_DUE_DATE_INVALID",
    "ibr-134-ae": "EINVOICE_SUPPLIER_TRN_REQUIRED",
    "ibr-144-ae": "EINVOICE_BUYER_ADDRESS_MISSING",
    "ibr-150-ae": "EINVOICE_SUPPLIER_LEGAL_ID_REQUIRED",
    "ibr-192-ae": "EINVOICE_PAYMENT_ACCOUNT_REQUIRED",
    "ibr-174-ae": "EINVOICE_REVERSE_CHARGE_GTIN_REQUIRED",
    "ibr-166-ae": "EINVOICE_REVERSE_CHARGE_GOODS_TYPE_REQUIRED",
    "ibr-103-ae": "EINVOICE_REVERSE_CHARGE_TRN_REQUIRED",
    "ibr-055-ae": "EINVOICE_ORIGINAL_INVOICE_REQUIRED",
    "IBR-CO-13": "EINVOICE_SUBTOTAL_MISMATCH",
    "BR-CO-13": "EINVOICE_SUBTOTAL_MISMATCH",
    "IBR-CO-14": "EINVOICE_VAT_TOTAL_MISMATCH",
    "BR-CO-14": "EINVOICE_VAT_TOTAL_MISMATCH",
  };
  return einvoiceIssueTextKey(ruleId ? codes[ruleId] : undefined);
}

const COMPANY_FIELDS: Record<string, string> = {
  addressCity: "city",
  addressStreet: "street",
  emirate: "emirate",
  name: "companyName",
  tradeLicenceNo: "tradeLicence",
  trnVatNumber: "trn",
};
const INVOICE_FIELDS: Record<string, string> = {
  currency: "currency",
  customerName: "customerName",
  customerTrn: "customerTrn",
  date: "invoiceDate",
  dueDate: "dueDate",
  number: "invoiceNumber",
  originalInvoiceId: "originalInvoice",
  subtotal: "amounts",
  total: "amounts",
  vatAmount: "amounts",
};
const LINE_FIELDS: Record<string, string> = {
  description: "lineDescription",
  gtin: "lineGtin",
  quantity: "lineQuantity",
  rcmGoodsType: "lineRcmGoods",
  unitPrice: "linePrice",
};

export function einvoiceFieldHint(field: string): EInvoiceFieldHint {
  const none = { labelKey: null, whereKey: null, href: null, ruleLabel: null };
  if (!field) return none;
  if (/^(UBL schema|PINT AE)/.test(field)) {
    // E1 (J1-r2): buyer-identity and buyer-address rules are fixed on the customer's contact,
    // and so is the buyer's electronic address (PINT-EndpointID).
    if (/\bibr-(080|144)|\bPINT-EndpointID/i.test(field)) {
      return {
        ...none,
        ruleLabel: field,
        whereKey: "invoices.einvoiceWhere.customer",
        href: "/contacts",
      };
    }
    return { ...none, ruleLabel: field };
  }
  const [scope, rest = ""] = field.split(".", 2);
  if (
    scope === "company" &&
    (rest === "einvoiceTin" || rest === "einvoicePayeeIban" || rest === "sellerIdCountry")
  ) {
    const key =
      rest === "einvoiceTin"
        ? "supplierTin"
        : rest === "einvoicePayeeIban"
          ? "payeeIban"
          : "passportCountry";
    return {
      ...none,
      labelKey: `einvoicing.field_${key}`,
      whereKey: "einvoicing.setUpLink",
      href: "/settings/einvoicing",
    };
  }
  if (scope === "company" && COMPANY_FIELDS[rest]) {
    return {
      labelKey: `invoices.einvoiceField.${COMPANY_FIELDS[rest]}`,
      whereKey: "invoices.einvoiceWhere.companyProfile",
      href: "/company-profile",
      ruleLabel: null,
    };
  }
  if (scope === "customer") {
    return {
      labelKey:
        rest === "endpointId"
          ? "invoices.einvoiceField.customerEndpoint"
          : rest === "legalIdCountry"
            ? "einvoicing.field_passportCountry"
            : "invoices.einvoiceField.customerAddress",
      whereKey: "invoices.einvoiceWhere.customer",
      href: "/contacts",
      ruleLabel: null,
    };
  }
  if (scope === "invoice") {
    const labelKey = ["exchangeRate", "supplyDate"].includes(rest)
      ? `einvoicing.field_${rest}`
      : INVOICE_FIELDS[rest]
        ? `invoices.einvoiceField.${INVOICE_FIELDS[rest]}`
        : null;
    return {
      labelKey,
      whereKey: "invoices.einvoiceWhere.invoice",
      href: null,
      ruleLabel: null,
    };
  }
  if (scope === "document") return { ...none, labelKey: "einvoicing.field_document" };
  const line = /^lines(?:\[(\d+)\])?(?:\.(\w+))?$/.exec(field);
  if (line) {
    const key = line[2] ? LINE_FIELDS[line[2]] : null;
    return {
      labelKey: key ? `invoices.einvoiceField.${key}` : "invoices.einvoiceField.lines",
      whereKey: "invoices.einvoiceWhere.invoice",
      href: null,
      ruleLabel: null,
    };
  }
  return none;
}
