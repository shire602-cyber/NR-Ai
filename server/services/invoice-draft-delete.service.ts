/**
 * X5 (J1 L4): removing a draft invoice without breaking FTA gap-free numbering.
 *
 * A draft gets its number when it is saved (R18-06). A draft that was never issued is not a tax
 * invoice, so the five-year retention rule does not apply to it, but its number is part of the
 * gap-free sequence:
 *   - when it is still the last number allocated in its sequence (nothing was numbered after
 *     it) and no journal entry refers to it, the draft is deleted and the sequence steps back,
 *     so the next document reuses the number and no gap appears;
 *   - otherwise deleting it would leave a hole, so the draft is cancelled instead (status
 *     "cancelled" through the invoice state machine): the number stays on file as cancelled.
 * Issued invoices are never deleted (void or credit them).
 */
import { pool } from "../db";
import { DomainError } from "../errors";
import { voidInvoice } from "./invoice-posting.service";

const NUMBER_RE = /^(INV|DN|CN)-(\d{4})-(\d+)$/;
const DOC_TYPE: Record<string, string> = { INV: "invoice", DN: "debit_note", CN: "credit_note" };

export type DraftRemoval = { outcome: "deleted" } | { outcome: "cancelled" };

export async function removeDraftInvoice(args: {
  invoiceId: string;
  companyId: string;
  userId: string;
}): Promise<DraftRemoval> {
  const client = await pool.connect();
  let deleted = false;
  try {
    await client.query("BEGIN");
    const inv = (
      await client.query(
        `SELECT id, number, status FROM invoices WHERE id = $1 AND company_id = $2 FOR UPDATE`,
        [args.invoiceId, args.companyId]
      )
    ).rows[0] as { id: string; number: string | null; status: string } | undefined;
    if (!inv) throw new DomainError("INVOICE_NOT_FOUND", 404, undefined, "Invoice not found");
    if (inv.status !== "draft") {
      throw new DomainError(
        "INVOICE_HAS_POSTED_JE",
        422,
        undefined,
        "An issued invoice cannot be deleted. Void it or issue a credit note instead."
      );
    }
    const m = NUMBER_RE.exec(String(inv.number ?? ""));
    const journals = await client.query(
      `SELECT 1 FROM journal_entries WHERE company_id = $1 AND source_id = $2 LIMIT 1`,
      [args.companyId, inv.id]
    );
    if (m && journals.rowCount === 0) {
      const seq = (
        await client.query(
          `SELECT last_value FROM invoice_number_sequences
            WHERE company_id = $1 AND doc_type = $2 AND year = $3 FOR UPDATE`,
          [args.companyId, DOC_TYPE[m[1]], Number(m[2])]
        )
      ).rows[0] as { last_value: string | number } | undefined;
      if (seq && Number(seq.last_value) === Number(m[3])) {
        await client.query("SAVEPOINT draft_delete");
        try {
          await client.query(`DELETE FROM invoices WHERE id = $1 AND status = 'draft'`, [inv.id]);
          await client.query(
            `UPDATE invoice_number_sequences SET last_value = last_value - 1, updated_at = now()
              WHERE company_id = $1 AND doc_type = $2 AND year = $3`,
            [args.companyId, DOC_TYPE[m[1]], Number(m[2])]
          );
          deleted = true;
        } catch (err) {
          // Another record still refers to the draft (23503): keep it and cancel it instead.
          if ((err as { code?: string }).code !== "23503") throw err;
          await client.query("ROLLBACK TO SAVEPOINT draft_delete");
        }
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  if (deleted) return { outcome: "deleted" };
  await voidInvoice(
    args.invoiceId,
    args.companyId,
    args.userId,
    "cancelled",
    "Draft removed: its number is kept as cancelled so the sequence has no gap"
  );
  return { outcome: "cancelled" };
}
