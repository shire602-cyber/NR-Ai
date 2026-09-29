// Shapes returned by the tax-filing API (server/routes/tax-filing.routes.ts) and
// small helpers shared by the filing panel and its dialogs.

export type FilingKind = "vat" | "corporate_tax";

export interface BoxDifference {
  box: string;
  filed: number;
  current: number;
  difference: number;
}

export interface EvidenceItem {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface PaymentItem {
  id: string;
  amount: number;
  paidAt: string;
  accountName: string | null;
  reference: string | null;
}

export interface SettlementView {
  net: number;
  paid: number;
  remaining: number;
  direction: "pay" | "receive" | "none";
  status: "none" | "unpaid" | "partial" | "paid";
}

export interface FilingView {
  filed: boolean;
  filing: null | {
    id: string;
    referenceNumber: string;
    filedAt: string;
    notes: string | null;
    snapshotHash: string;
  };
  evidence: EvidenceItem[];
  payments: PaymentItem[];
  settlement: SettlementView | null;
  driftDetected: boolean;
  driftDifferences: BoxDifference[];
  driftCheck: "ok" | "unavailable" | "not_applicable";
  driftMessage?: string;
  isAmendment: boolean;
  amendsReturnId: string | null;
  amendsReference: string | null;
  amendmentDifferences: BoxDifference[];
  amendedBy: Array<{ id: string; status: string; filed: boolean; referenceNumber: string | null }>;
  /** VAT only. */
  period?: { start: string; end: string; months: string[]; lockedMonths: string[]; locked: boolean };
}

/** Base URL of a return's filing endpoints. */
export const filingBase = (kind: FilingKind, returnId: string): string =>
  kind === "vat" ? `/api/vat-returns/${returnId}` : `/api/corporate-tax/returns/${returnId}`;

/** The read model (snapshot figures, evidence, payments, drift, lock). */
export const filingViewUrl = (kind: FilingKind, returnId: string): string =>
  kind === "vat" ? `/api/vat-returns/${returnId}` : `/api/corporate-tax/returns/${returnId}/filing`;

/** "box12TotalDueTax" -> "Box 12 · Total due tax"; "taxPayable" -> "Tax payable". */
export function boxLabel(key: string): string {
  const m = /^box(\d+)([a-z]?)(.*)$/.exec(key);
  const words = (s: string) =>
    s
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Za-z])(\d)/g, "$1 $2")
      .trim()
      .toLowerCase();
  if (m) {
    const tail = words(m[3]);
    return `Box ${m[1]}${m[2]}${tail ? ` · ${tail.charAt(0).toUpperCase()}${tail.slice(1)}` : ""}`;
  }
  const w = words(key);
  return w.charAt(0).toUpperCase() + w.slice(1);
}

export function statusLabelKey(status: SettlementView["status"]) {
  return (
    { unpaid: "statusUnpaid", partial: "statusPartial", paid: "statusPaid", none: "statusNone" } as const
  )[status];
}
