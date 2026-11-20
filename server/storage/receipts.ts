// DatabaseStorage part: Receipts and atomic receipt posting / revision / split.
// Domain classes are chained with `extends` and composed into DatabaseStorage in
// server/storage.ts (R20-09); import `storage` from "./storage", not these classes.

import { receipts, type InsertReceipt, type JournalEntry, type Receipt } from "@shared/schema";
import { db } from "../db";
import { and, desc, eq } from "drizzle-orm";
import { DomainError } from "../errors";
import { legacyLinesToInput } from "../ledger/legacy";
import { postJournal, reverseBySource, withLedgerTx } from "../ledger";
import type {
  PostReceiptAtomicArgs,
  ReviseReceiptAtomicArgs,
  SplitReceiptAtomicArgs,
} from "./types";
import { SalesStorage } from "./sales";

export class ReceiptStorage extends SalesStorage {
  // Receipts
  /** Unscoped lookup — caller MUST authorise via hasCompanyAccess. */
  async getReceiptById(id: string): Promise<Receipt | undefined> {
    const [receipt] = await db.select().from(receipts).where(eq(receipts.id, id));
    return receipt || undefined;
  }

  async getReceipt(id: string, companyId: string): Promise<Receipt | undefined> {
    const [receipt] = await db
      .select()
      .from(receipts)
      .where(and(eq(receipts.id, id), eq(receipts.companyId, companyId)));
    return receipt || undefined;
  }

  async createReceipt(insertReceipt: InsertReceipt): Promise<Receipt> {
    const [receipt] = await db.insert(receipts).values(insertReceipt).returning();
    return receipt;
  }

  async getReceiptsByCompanyId(companyId: string): Promise<Receipt[]> {
    return await db
      .select()
      .from(receipts)
      .where(eq(receipts.companyId, companyId))
      .orderBy(desc(receipts.createdAt));
  }

  async updateReceipt(
    id: string,
    companyId: string,
    data: Partial<InsertReceipt>
  ): Promise<Receipt> {
    const [receipt] = await db
      .update(receipts)
      .set(data)
      .where(and(eq(receipts.id, id), eq(receipts.companyId, companyId)))
      .returning();
    if (!receipt) {
      throw new Error("Receipt not found");
    }
    return receipt;
  }

  /** Update only while the receipt is still unposted (a posted receipt is immutable, R05-01). */
  async updateReceiptIfUnposted(
    id: string,
    companyId: string,
    data: Partial<InsertReceipt>
  ): Promise<Receipt> {
    const [receipt] = await db
      .update(receipts)
      .set(data)
      .where(
        and(eq(receipts.id, id), eq(receipts.companyId, companyId), eq(receipts.posted, false))
      )
      .returning();
    if (receipt) return receipt;
    const existing = await this.getReceipt(id, companyId);
    if (!existing) throw new DomainError("RECEIPT_NOT_FOUND", 404);
    throw new DomainError(
      "RECEIPT_POSTED",
      409,
      { receiptId: id, journalEntryId: existing.journalEntryId },
      "This receipt is posted and cannot be edited. Use POST /api/receipts/:id/revise."
    );
  }

  /**
   * Post a receipt exactly once. The claim is a conditional UPDATE ... WHERE posted = false
   * RETURNING inside the same ledger transaction as the kernel post (server/ledger postJournal),
   * so concurrent posts produce one entry and a failure leaves the receipt unposted (R05-02).
   */
  async postReceiptAtomic(
    args: PostReceiptAtomicArgs
  ): Promise<{ receipt: Receipt; entry: JournalEntry }> {
    return await withLedgerTx(async (tx: typeof db) => {
      const [claimed] = await tx
        .update(receipts)
        .set({
          posted: true,
          accountId: args.accountId,
          paymentAccountId: args.paymentAccountId,
        })
        .where(
          and(
            eq(receipts.id, args.receiptId),
            eq(receipts.companyId, args.companyId),
            eq(receipts.posted, false)
          )
        )
        .returning();
      if (!claimed) {
        const [existing] = await tx
          .select()
          .from(receipts)
          .where(and(eq(receipts.id, args.receiptId), eq(receipts.companyId, args.companyId)));
        if (!existing) throw new DomainError("RECEIPT_NOT_FOUND", 404);
        throw new DomainError(
          "RECEIPT_POSTED",
          409,
          { receiptId: args.receiptId, journalEntryId: existing.journalEntryId },
          "Receipt has already been posted"
        );
      }
      const { entry } = await postJournal(
        {
          companyId: args.companyId,
          date: args.entryDate,
          memo: args.memo,
          memoKey: args.memoKey ?? null,
          memoParams: args.memoParams ?? null,
          status: "posted",
          source: "receipt",
          sourceId: args.receiptId,
          allowFutureDate: true,
          lines: legacyLinesToInput(args.lines),
        },
        { actorId: args.userId, tx }
      );
      const [receipt] = await tx
        .update(receipts)
        .set({ journalEntryId: entry.id })
        .where(eq(receipts.id, args.receiptId))
        .returning();
      return { receipt, entry };
    });
  }

  /**
   * Revise a posted receipt: reverse its journal entries (server/ledger reverseBySource) and post
   * the corrected one in a single ledger transaction. The receipt row is locked so two revisions
   * cannot interleave.
   */
  async reviseReceiptAtomic(
    args: ReviseReceiptAtomicArgs
  ): Promise<{ receipt: Receipt; entry: JournalEntry; reversal: JournalEntry }> {
    return await withLedgerTx(async (tx: typeof db) => {
      const [locked] = await tx
        .select()
        .from(receipts)
        .where(and(eq(receipts.id, args.receiptId), eq(receipts.companyId, args.companyId)))
        .for("update");
      if (!locked) throw new DomainError("RECEIPT_NOT_FOUND", 404);
      if (!locked.posted || !locked.journalEntryId) {
        throw new DomainError(
          "RECEIPT_NOT_POSTED",
          409,
          { receiptId: args.receiptId },
          "Only a posted receipt can be revised. Edit unposted receipts with PUT."
        );
      }
      const ctx = { actorId: args.userId, tx, companyId: args.companyId };
      const reversed = await reverseBySource(
        args.companyId,
        "receipt",
        args.receiptId,
        { date: args.reversalDate ?? null, reason: args.reason ?? "Receipt revised" },
        ctx
      );
      const reversal =
        reversed.find((r) => r.original.id === locked.journalEntryId)?.reversal ??
        reversed[0]?.reversal;
      if (!reversal) throw new DomainError("RECEIPT_JOURNAL_MISSING", 409);

      const [updated] = await tx
        .update(receipts)
        .set(args.patch)
        .where(eq(receipts.id, args.receiptId))
        .returning();
      const { entry } = await postJournal(
        {
          companyId: args.companyId,
          date: args.entryDate,
          memo: args.memo,
          memoKey: args.memoKey ?? null,
          memoParams: args.memoParams ?? null,
          status: "posted",
          source: "receipt",
          sourceId: args.receiptId,
          allowFutureDate: true,
          lines: legacyLinesToInput(args.buildLines(updated)),
        },
        ctx
      );
      const [receipt] = await tx
        .update(receipts)
        .set({ journalEntryId: entry.id })
        .where(eq(receipts.id, args.receiptId))
        .returning();
      return { receipt, entry, reversal };
    });
  }

  /** Split an unposted multi-receipt upload into separate receipts (the source row is replaced). */
  async splitReceiptAtomic(args: SplitReceiptAtomicArgs): Promise<Receipt[]> {
    return await db.transaction(async (tx: typeof db) => {
      const [source] = await tx
        .select()
        .from(receipts)
        .where(and(eq(receipts.id, args.receiptId), eq(receipts.companyId, args.companyId)))
        .for("update");
      if (!source) throw new DomainError("RECEIPT_NOT_FOUND", 404);
      if (source.posted) {
        throw new DomainError("RECEIPT_POSTED", 409, undefined, "A posted receipt cannot be split");
      }
      const { id: _id, createdAt: _createdAt, ...inherited } = source;
      const created: Receipt[] = [];
      for (const part of args.parts) {
        const [row] = await tx
          .insert(receipts)
          .values({
            ...inherited,
            lines: null,
            journalEntryId: null,
            posted: false,
            autoPosted: false,
            // Parts share the stored image; content hash is cleared so duplicate detection
            // does not treat the parts as one upload.
            contentSha256: null,
            ...part,
          })
          .returning();
        created.push(row);
      }
      await tx.delete(receipts).where(eq(receipts.id, args.receiptId));
      return created;
    });
  }

  async deleteReceipt(id: string, companyId: string): Promise<void> {
    await db.delete(receipts).where(and(eq(receipts.id, id), eq(receipts.companyId, companyId)));
  }
}
