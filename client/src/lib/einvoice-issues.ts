/**
 * E-invoice 422 issue list (S1, W4-C follow-up). POST /api/invoices/:id/generate-einvoice answers
 * 422 with either the stored-data fix-it list (`EINVOICE_VALIDATION_FAILED`, `issues`) or the
 * generated document's XSD / schematron / rule findings (`EINVOICE_SCHEMA_INVALID`,
 * `validation`). The invoice list shows every issue instead of a one-line toast.
 */

export interface EInvoiceIssueItem {
  field: string;
  message: string;
}

type Finding = { id?: string; message?: string; location?: string };
type Layer = { errors?: Finding[] };

/** Issues from a 422 error body; [] when the body carries none. */
export function einvoiceIssuesFromError(body: unknown): EInvoiceIssueItem[] {
  if (!body || typeof body !== "object") return [];
  const b = body as {
    issues?: Array<{ field?: unknown; message?: unknown }>;
    validation?: { xsd?: Layer; schematron?: Layer; rules?: Layer };
  };
  const out: EInvoiceIssueItem[] = [];
  if (Array.isArray(b.issues)) {
    for (const i of b.issues) {
      if (i && typeof i.message === "string") {
        out.push({ field: typeof i.field === "string" ? i.field : "", message: i.message });
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
      for (const f of layer?.errors ?? []) {
        if (!f?.message) continue;
        out.push({ field: [label, f.id].filter(Boolean).join(" "), message: f.message });
      }
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
  if (/^(UBL schema|PINT AE)/.test(field)) return { ...none, ruleLabel: field };
  const [scope, rest = ""] = field.split(".", 2);
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
      labelKey: "invoices.einvoiceField.customerAddress",
      whereKey: "invoices.einvoiceWhere.customer",
      href: "/contacts",
      ruleLabel: null,
    };
  }
  if (scope === "invoice") {
    return {
      labelKey: INVOICE_FIELDS[rest] ? `invoices.einvoiceField.${INVOICE_FIELDS[rest]}` : null,
      whereKey: "invoices.einvoiceWhere.invoice",
      href: null,
      ruleLabel: null,
    };
  }
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
