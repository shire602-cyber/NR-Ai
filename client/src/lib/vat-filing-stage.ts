import { isVatFilingRecorded } from "@shared/vat-filing-status";

/**
 * E2 (J3-r2): one reading of where a VAT return is in its filing life, used by the Returns list,
 * the hero card and its checklist. The server's return status (draft / ready / submitted /
 * filed / amended) and the settlement entry (which alone sets `paymentStatus`) are the inputs;
 * nothing here is a second state machine.
 */
export type VatFilingStage =
  | "draft"
  | "ready"
  | "submitted"
  | "filed"
  | "paid"
  | "refunded"
  | "amended";

export interface VatReturnStageInput {
  status: string;
  ftaReferenceNumber?: string | null;
  paymentStatus?: string | null;
  box14PayableTax?: number | string | null;
}

export function vatFilingStage(r: VatReturnStageInput): VatFilingStage {
  const net = Number(r.box14PayableTax ?? 0) || 0;
  if (r.status === "amended") return "amended";
  if (isVatFilingRecorded(r.status, r.ftaReferenceNumber)) {
    if (r.paymentStatus === "paid") return net < 0 ? "refunded" : "paid";
    return "filed";
  }
  if (["submitted", "filed", "paid", "accepted"].includes(r.status)) return "submitted";
  if (r.status === "ready") return "ready";
  return "draft";
}

export type VatNextAction = "review" | "recordFiling" | "recordPayment" | "recordRefund" | "none";

/** The one next step a user takes on the return (the action the hero offers first). */
export function vatNextAction(r: VatReturnStageInput): VatNextAction {
  const stage = vatFilingStage(r);
  const net = Number(r.box14PayableTax ?? 0) || 0;
  switch (stage) {
    case "draft":
      return "review";
    case "ready":
    case "submitted":
      return "recordFiling";
    case "filed":
      return net > 0 ? "recordPayment" : net < 0 ? "recordRefund" : "none";
    default:
      return "none";
  }
}

export interface VatChecklist {
  calculated: boolean;
  ready: boolean;
  filed: boolean;
  settled: boolean;
  /** A nil return has nothing to pay or receive. */
  nothingToSettle: boolean;
}

/** The filing checklist: true states only. */
export function vatChecklist(r: VatReturnStageInput | null | undefined): VatChecklist {
  if (!r)
    return {
      calculated: false,
      ready: false,
      filed: false,
      settled: false,
      nothingToSettle: false,
    };
  const stage = vatFilingStage(r);
  const net = Number(r.box14PayableTax ?? 0) || 0;
  const filed = isVatFilingRecorded(r.status, r.ftaReferenceNumber);
  return {
    calculated: true,
    ready: stage !== "draft",
    filed,
    settled: stage === "paid" || stage === "refunded" || (filed && net === 0),
    nothingToSettle: net === 0,
  };
}

/** The day after the period's last day (the earliest filing / payment date), YYYY-MM-DD. */
export function dayAfter(isoDate: string): string {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
