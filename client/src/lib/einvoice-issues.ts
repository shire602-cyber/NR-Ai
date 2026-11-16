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
