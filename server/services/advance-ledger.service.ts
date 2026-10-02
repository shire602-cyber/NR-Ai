// The advance sub-ledger bookkeeping that the invoice, credit-note and void paths share (Phase 8 D1).
// Kept free of imports from those services so they can call it without a cycle.

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { customerAdvanceApplications, customerAdvances } from "../../shared/schema";

type Tx = typeof db;
const rowsOf = (res: any): any[] => (res?.rows ?? res) as any[];
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ─── availability ───────────────────────────────────────────────────────────

export interface AdvanceBalance {
  net: number;
  applied: number;
  refunded: number;
  /** net - applied - refunded (pending refunds count as taken). */
  available: number;
}

export async function advanceBalance(tx: Tx, advanceId: string): Promise<AdvanceBalance> {
  const [adv] = await tx.select().from(customerAdvances).where(eq(customerAdvances.id, advanceId));
  const res = await tx.execute(sql`
    SELECT
      COALESCE(SUM(net_amount) FILTER (WHERE kind = 'application' AND status = 'active'), 0)::float8 AS applied,
      COALESCE(SUM(net_amount) FILTER (WHERE kind = 'refund' AND status IN ('active', 'pending')), 0)::float8 AS refunded
    FROM customer_advance_applications WHERE advance_id = ${advanceId}`);
  const row = rowsOf(res)[0] ?? {};
  const net = Number(adv?.netAmount ?? 0);
  const applied = r2(Number(row.applied) || 0);
  const refunded = r2(Number(row.refunded) || 0);
  return { net, applied, refunded, available: r2(net - applied - refunded) };
}

/** open | applied | refunded | void, derived from the applications (void stays void). */
export async function refreshAdvanceStatus(tx: Tx, advanceId: string): Promise<string> {
  const [adv] = await tx.select().from(customerAdvances).where(eq(customerAdvances.id, advanceId));
  if (!adv) return "open";
  if (adv.status === "void") return "void";
  const b = await advanceBalance(tx, advanceId);
  let status = "open";
  if (b.available <= 0.004) status = b.refunded > 0 && b.applied === 0 ? "refunded" : "applied";
  if (status !== adv.status) {
    await tx.update(customerAdvances).set({ status, updatedAt: new Date() }).where(eq(customerAdvances.id, advanceId));
  }
  return status;
}

// ─── void / full credit interplay ───────────────────────────────────────────

/** A voided or fully credited final invoice releases its advance: the journal re-credited 2055. */
export async function reverseApplicationsForInvoice(tx: Tx, companyId: string, invoiceId: string): Promise<void> {
  const apps = await tx
    .select()
    .from(customerAdvanceApplications)
    .where(
      and(
        eq(customerAdvanceApplications.companyId, companyId),
        eq(customerAdvanceApplications.invoiceId, invoiceId),
        eq(customerAdvanceApplications.kind, "application"),
        eq(customerAdvanceApplications.status, "active")
      )
    );
  if (apps.length === 0) return;
  await tx
    .update(customerAdvanceApplications)
    .set({ status: "reversed" })
    .where(inArray(customerAdvanceApplications.id, apps.map((a: any) => a.id)));
  for (const advanceId of new Set<string>(apps.map((a: any) => a.advanceId))) await refreshAdvanceStatus(tx, advanceId);
}

/** Voiding a credit note that fully credited the invoice puts the deduction back on the ledger. */
export async function reactivateApplicationsForInvoice(tx: Tx, companyId: string, invoiceId: string): Promise<void> {
  const apps = await tx
    .select()
    .from(customerAdvanceApplications)
    .where(
      and(
        eq(customerAdvanceApplications.companyId, companyId),
        eq(customerAdvanceApplications.invoiceId, invoiceId),
        eq(customerAdvanceApplications.kind, "application"),
        eq(customerAdvanceApplications.status, "reversed")
      )
    );
  if (apps.length === 0) return;
  await tx
    .update(customerAdvanceApplications)
    .set({ status: "active" })
    .where(inArray(customerAdvanceApplications.id, apps.map((a: any) => a.id)));
  for (const advanceId of new Set<string>(apps.map((a: any) => a.advanceId))) await refreshAdvanceStatus(tx, advanceId);
}

/** Refuse to void an advance invoice that still has deductions or refunds against it; mark it void otherwise. */
export async function guardAndVoidAdvance(tx: Tx, companyId: string, invoiceId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const [adv] = await tx
    .select()
    .from(customerAdvances)
    .where(and(eq(customerAdvances.invoiceId, invoiceId), eq(customerAdvances.companyId, companyId)));
  if (!adv) return { ok: true };
  const used = rowsOf(
    await tx.execute(sql`
      SELECT 1 FROM customer_advance_applications
       WHERE advance_id = ${adv.id} AND status IN ('active', 'pending') LIMIT 1`)
  );
  if (used.length > 0) {
    return { ok: false, message: "This advance has been applied to an invoice or refunded. Remove those first." };
  }
  await tx.update(customerAdvances).set({ status: "void", updatedAt: new Date() }).where(eq(customerAdvances.id, adv.id));
  return { ok: true };
}


/** Voiding the credit note that refunded part of an advance gives that part back to the advance. */
export async function reverseRefundForCreditNote(tx: Tx, companyId: string, creditNoteId: string): Promise<void> {
  const apps = await tx
    .select()
    .from(customerAdvanceApplications)
    .where(
      and(
        eq(customerAdvanceApplications.companyId, companyId),
        eq(customerAdvanceApplications.invoiceId, creditNoteId),
        eq(customerAdvanceApplications.kind, "refund"),
        inArray(customerAdvanceApplications.status, ["active", "pending"])
      )
    );
  if (apps.length === 0) return;
  await tx
    .update(customerAdvanceApplications)
    .set({ status: "reversed" })
    .where(inArray(customerAdvanceApplications.id, apps.map((a: any) => a.id)));
  for (const advanceId of new Set<string>(apps.map((a: any) => a.advanceId))) await refreshAdvanceStatus(tx, advanceId);
}
