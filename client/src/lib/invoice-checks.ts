/**
 * WQ1 (7.3b, 7.22, 15.12): the live Checks tab of the invoice editor. Pure rules over the form
 * (what the server would refuse on issue, and what the FTA expects on a tax invoice), plus the
 * e-invoice validator's findings for a saved invoice (GET /api/invoices/:id/einvoice/validate).
 *
 * A check with severity "error" blocks Finalise; a "warning" is shown but does not block.
 * `field` is the react-hook-form path the check links to (focus on click); `href` is a screen
 * where the fix lives (company profile, contacts) when it is not on this form.
 */
import { einvoiceFieldHint, type EInvoiceIssueItem } from "./einvoice-issues";

export type InvoiceCheckSeverity = "error" | "warning";

export interface InvoiceCheck {
  id: string;
  severity: InvoiceCheckSeverity;
  /** Catalog key of the message. */
  messageKey: string;
  /** Values for {placeholders} in the message. */
  values?: Record<string, string | number>;
  /** Raw message (e-invoice validator findings come with their own text). */
  message?: string;
  /** Form field to focus, e.g. "customerName" or "lines.0.unitPrice". */
  field?: string;
  /** Screen where the fix lives, when not on this form. */
  href?: string;
}

export interface InvoiceCheckLine {
  description?: string;
  quantity?: number | string;
  unitPrice?: number | string;
  vatSupplyType?: string;
}

export interface InvoiceCheckInput {
  customerName?: string;
  customerTrn?: string;
  placeOfSupplyEmirate?: string;
  /** The company's emirate: the server's place of supply when the invoice names none. */
  fallbackEmirate?: string | null;
  date?: Date | null;
  dueDate?: Date | null;
  lines: InvoiceCheckLine[];
  /** The company has a TRN (may charge VAT). */
  vatRegistered: boolean;
  /** E-invoicing is active for the company (B2B / B2G scope). */
  einvoiceActive: boolean;
}

const TRN_RE = /^\d{15}$/;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** The generic issue rules: customer, lines, TRN / VAT, place of supply, dates. */
export function invoiceFormChecks(input: InvoiceCheckInput): InvoiceCheck[] {
  const out: InvoiceCheck[] = [];
  if (!(input.customerName ?? "").trim()) {
    out.push({
      id: "customer",
      severity: "error",
      messageKey: "invoices.checks.customerMissing",
      field: "customerName",
    });
  }
  const trn = (input.customerTrn ?? "").trim();
  if (trn && !TRN_RE.test(trn)) {
    out.push({
      id: "customer-trn",
      severity: "error",
      messageKey: "invoices.checks.customerTrnInvalid",
      field: "customerTrn",
    });
  }
  if (input.einvoiceActive && !trn) {
    out.push({
      id: "customer-trn-einvoice",
      severity: "warning",
      messageKey: "invoices.checks.customerTrnEinvoice",
      field: "customerTrn",
    });
  }
  const lines = input.lines ?? [];
  if (lines.length === 0) {
    out.push({ id: "lines", severity: "error", messageKey: "invoices.checks.noLines" });
  }
  lines.forEach((line, i) => {
    const n = i + 1;
    if (!(line.description ?? "").trim()) {
      out.push({
        id: `line-${i}-description`,
        severity: "error",
        messageKey: "invoices.checks.lineDescription",
        values: { n },
        field: `lines.${i}.description`,
      });
    }
    if (!(Number(line.quantity) > 0)) {
      out.push({
        id: `line-${i}-quantity`,
        severity: "error",
        messageKey: "invoices.checks.lineQuantity",
        values: { n },
        field: `lines.${i}.quantity`,
      });
    }
    if (!(Number(line.unitPrice) > 0)) {
      out.push({
        id: `line-${i}-price`,
        severity: "error",
        messageKey: "invoices.checks.linePrice",
        values: { n },
        field: `lines.${i}.unitPrice`,
      });
    }
  });
  const chargesVat = lines.some((l) => (l.vatSupplyType ?? "standard_rated") === "standard_rated");
  if (chargesVat && !input.vatRegistered) {
    out.push({
      id: "company-trn",
      severity: "error",
      messageKey: "invoices.checks.companyTrnMissing",
      href: "/company-profile",
    });
  }
  if (chargesVat && input.vatRegistered && !input.placeOfSupplyEmirate && !input.fallbackEmirate) {
    out.push({
      id: "place-of-supply",
      severity: "error",
      messageKey: "invoices.checks.placeOfSupply",
      field: "placeOfSupplyEmirate",
    });
  }
  if (input.date && input.dueDate && dayOf(input.dueDate) < dayOf(input.date)) {
    out.push({
      id: "due-date",
      severity: "error",
      messageKey: "invoices.checks.dueBeforeDate",
      field: "dueDate",
    });
  }
  return out;
}

/** E-invoice validator findings as checks (errors while e-invoicing is active). */
export function einvoiceChecks(issues: EInvoiceIssueItem[], active: boolean): InvoiceCheck[] {
  return issues.map((issue, i) => {
    const hint = einvoiceFieldHint(issue.field);
    const field = /^lines\[(\d+)\]\.(description|quantity|unitPrice)$/.exec(issue.field);
    const invoiceField = /^invoice\.(customerName|customerTrn|dueDate|date)$/.exec(issue.field);
    return {
      id: `einvoice-${i}`,
      severity: active ? ("error" as const) : ("warning" as const),
      messageKey: hint.labelKey ?? "invoices.checks.einvoiceRule",
      values: hint.ruleLabel ? { rule: hint.ruleLabel } : undefined,
      message: issue.message,
      field: field ? `lines.${field[1]}.${field[2]}` : invoiceField ? invoiceField[1] : undefined,
      href: hint.href ?? undefined,
    };
  });
}

export function blockingCount(checks: InvoiceCheck[]): number {
  return checks.filter((c) => c.severity === "error").length;
}
