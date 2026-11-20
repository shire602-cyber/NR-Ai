/**
 * Inventory module entry (W4-B). Registers the cross-module services other modules call through
 * the service registry (they never import this module):
 *
 *   inventory.onGoodsReceived(event, tx?)         purchase-order receipts (W3-B; in the receipt tx)
 *   inventory.onInvoiceIssued(tx, {invoice, lines, userId})
 *   inventory.onInvoiceVoided(tx, {companyId, invoiceId, number, userId})
 *   inventory.onCreditNoteIssued(tx, {original, creditNote, lines, userId})
 *   inventory.onCreditNoteVoided(tx, {companyId, creditNoteId, number, userId})
 *
 * and the daily reorder scan (domain event task.due per product at or below its reorder point).
 */
import { pool } from "../../db";
import { emitDomainEventInTx } from "../../platform/event-outbox";
import { listJobs, registerJob } from "../../platform/job-registry";
import { has, provide } from "../../platform/service-registry";
import {
  onCreditNoteIssued,
  onCreditNoteVoided,
  onGoodsReceived,
  onInvoiceIssued,
  onInvoiceVoided,
} from "./documents";

export * from "./costing";
export * from "./documents";
export * from "./engine";
export * from "./manual";
export * from "./reports";

export async function runReorderScan(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT id, company_id FROM products
      WHERE is_active AND product_type = 'inventory' AND track_inventory
        AND reorder_point IS NOT NULL AND current_stock <= reorder_point`
  );
  const today = new Date().toISOString().slice(0, 10);
  for (const r of rows) {
    await emitDomainEventInTx(null, "task.due", {
      companyId: r.company_id,
      entityId: r.id,
      dueDate: today,
    });
  }
  return rows.length;
}

/** Idempotent: tests rebuild the app many times. */
export function registerInventoryServices(): void {
  if (!has("inventory.onGoodsReceived")) provide("inventory.onGoodsReceived", onGoodsReceived);
  if (!has("inventory.onInvoiceIssued")) provide("inventory.onInvoiceIssued", onInvoiceIssued);
  if (!has("inventory.onInvoiceVoided")) provide("inventory.onInvoiceVoided", onInvoiceVoided);
  if (!has("inventory.onCreditNoteIssued"))
    provide("inventory.onCreditNoteIssued", onCreditNoteIssued);
  if (!has("inventory.onCreditNoteVoided"))
    provide("inventory.onCreditNoteVoided", onCreditNoteVoided);
  if (!listJobs().some((j) => j.name === "inventory.reorderScan")) {
    registerJob({
      name: "inventory.reorderScan",
      cron: "41 4 * * *",
      description: "Raise task.due for stock items at or below their reorder point",
      run: async () => {
        await runReorderScan();
      },
    });
  }
}
