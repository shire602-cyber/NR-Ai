export interface CustomerEInvoiceOutcome {
  status: string;
  environment?: "sandbox" | "production" | null;
}

export function qualifyEInvoiceOutcome(
  text: string,
  environment: string | null | undefined,
  sandboxLabel: string,
  unknownLabel: string
) {
  if (environment === "production") return text;
  return `${text} · ${environment === "sandbox" ? sandboxLabel : unknownLabel}`;
}

export function customerEInvoiceLabel(outcome: CustomerEInvoiceOutcome, t: Record<string, string>) {
  const subject = t["portal.doc.einvoice"];
  const status =
    outcome.status === "delivered"
      ? t["portal.doc.einvoiceDelivered"]
      : outcome.status === "accepted" || outcome.status === "cleared"
        ? t["portal.doc.einvoiceAccepted"]
        : null;
  return status
    ? qualifyEInvoiceOutcome(
        `${subject} · ${status}`,
        outcome.environment,
        t["portal.doc.einvoiceSandbox"],
        t["portal.doc.einvoiceEnvironmentUnknown"]
      )
    : subject;
}
