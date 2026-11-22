// DatabaseStorage part: Chart of accounts, journal entries and journal lines (legacy adapter over server/ledger).
// Domain classes are chained with `extends` and composed into DatabaseStorage in
// server/storage.ts (R20-09); import `storage` from "./storage", not these classes.

import {
  accounts,
  journalEntries,
  journalLines,
  type Account,
  type InsertAccount,
  type InsertJournalEntry,
  type InsertJournalLine,
  type JournalEntry,
  type JournalLine,
} from "@shared/schema";
import { db, type AppDatabase } from "../db";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import { createJournalEntryCompat } from "../ledger/legacy";
import { previewEntryNumber } from "../ledger/numbering";
import { ReportDeliveryStorage } from "./report-delivery";

export class LedgerStorage extends ReportDeliveryStorage {
  // Accounts
  async getAccount(id: string, companyId: string): Promise<Account | undefined> {
    const [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.companyId, companyId)));
    return account || undefined;
  }

  async getAccountsByCompanyId(companyId: string): Promise<Account[]> {
    return await db.select().from(accounts).where(eq(accounts.companyId, companyId));
  }

  async createAccount(insertAccount: InsertAccount): Promise<Account> {
    const [account] = await db.insert(accounts).values(insertAccount).returning();
    return account;
  }

  async updateAccount(id: string, companyId: string, data: Partial<Account>): Promise<Account> {
    const [account] = await db
      .update(accounts)
      .set(data)
      .where(and(eq(accounts.id, id), eq(accounts.companyId, companyId)))
      .returning();
    if (!account) {
      throw new Error("Account not found");
    }
    return account;
  }

  async deleteAccount(id: string, companyId: string): Promise<void> {
    await db.delete(accounts).where(and(eq(accounts.id, id), eq(accounts.companyId, companyId)));
  }

  async archiveAccountForCompany(id: string, companyId: string): Promise<Account> {
    const [account] = await db
      .update(accounts)
      .set({ isArchived: true, isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(accounts.id, id),
          eq(accounts.companyId, companyId),
          eq(accounts.isSystemAccount, false)
        )
      )
      .returning();
    if (!account) {
      throw new Error("Account not found or is a system account");
    }
    return account;
  }

  async archiveAccount(id: string): Promise<Account> {
    const [account] = await db
      .update(accounts)
      .set({ isArchived: true, isActive: false, updatedAt: new Date() })
      .where(and(eq(accounts.id, id), eq(accounts.isSystemAccount, false)))
      .returning();
    if (!account) {
      throw new Error("Account not found or is a system account");
    }
    return account;
  }

  async getAccountByCode(companyId: string, code: string): Promise<Account | undefined> {
    const [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.companyId, companyId), eq(accounts.code, code)));
    return account || undefined;
  }

  async getVatAccounts(companyId: string): Promise<Account[]> {
    return await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.companyId, companyId), eq(accounts.isVatAccount, true)));
  }

  async createBulkAccounts(
    accountsData: InsertAccount[],
    exec?: Pick<AppDatabase, "insert">
  ): Promise<Account[]> {
    if (accountsData.length === 0) return [];

    const expectedCount = accountsData.length;
    const insertAccounts = async (executor: Pick<AppDatabase, "insert">) => {
      const inserted = await executor
        .insert(accounts)
        .values(accountsData)
        .onConflictDoNothing()
        .returning();

      if (inserted.length < expectedCount) {
        throw new Error(
          `PARTIAL_INSERT: Only ${inserted.length}/${expectedCount} accounts were created. Some accounts already exist.`
        );
      }

      return inserted;
    };

    return exec ? insertAccounts(exec) : db.transaction(insertAccounts);
  }

  async companyHasAccounts(
    companyId: string,
    exec: Pick<AppDatabase, "select"> = db
  ): Promise<boolean> {
    const existingAccounts = await exec
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.companyId, companyId))
      .limit(1);
    return existingAccounts.length > 0;
  }

  async accountHasTransactions(accountId: string): Promise<boolean> {
    const lines = await db
      .select()
      .from(journalLines)
      .where(eq(journalLines.accountId, accountId))
      .limit(1);
    return lines.length > 0;
  }

  async getAccountsWithBalances(companyId: string, dateRange?: { start: Date; end: Date }) {
    const accountsList = await db.select().from(accounts).where(eq(accounts.companyId, companyId));

    const results = await Promise.all(
      accountsList.map(async (account) => {
        let lines = await db
          .select({
            debit: journalLines.debit,
            credit: journalLines.credit,
            date: journalEntries.date,
            status: journalEntries.status,
          })
          .from(journalLines)
          .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
          .where(eq(journalLines.accountId, account.id));

        if (dateRange) {
          lines = lines.filter((line) => {
            const lineDate = new Date(line.date);
            return lineDate >= dateRange.start && lineDate <= dateRange.end;
          });
        }

        const postedLines = lines.filter((l) => l.status === "posted");

        const debitTotal = postedLines.reduce((sum, l) => sum + (l.debit || 0), 0);
        const creditTotal = postedLines.reduce((sum, l) => sum + (l.credit || 0), 0);

        let balance = 0;
        if (["asset", "expense"].includes(account.type)) {
          balance = debitTotal - creditTotal;
        } else {
          balance = creditTotal - debitTotal;
        }

        return {
          account,
          balance,
          debitTotal,
          creditTotal,
        };
      })
    );

    return results;
  }

  async getAccountLedger(
    accountId: string,
    options?: {
      dateStart?: Date;
      dateEnd?: Date;
      search?: string;
      limit?: number;
      offset?: number;
    }
  ) {
    // Existence check; tenant scoping is the caller's responsibility (the
    // accounts.routes ledger handler resolves the account against the user's
    // companies before invoking this).
    const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    if (!account) {
      throw new Error("Account not found");
    }

    const allLines = await db
      .select({
        lineId: journalLines.id,
        debit: journalLines.debit,
        credit: journalLines.credit,
        lineDescription: journalLines.description,
        lineKey: journalLines.lineKey,
        lineParams: journalLines.lineParams,
        entryId: journalEntries.id,
        entryNumber: journalEntries.entryNumber,
        date: journalEntries.date,
        memo: journalEntries.memo,
        memoKey: journalEntries.memoKey,
        memoParams: journalEntries.memoParams,
        source: journalEntries.source,
        status: journalEntries.status,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
      .where(eq(journalLines.accountId, accountId));

    const postedLines = allLines.filter((l) => l.status === "posted");
    postedLines.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let openingBalance = 0;
    if (options?.dateStart) {
      const priorLines = postedLines.filter((l) => new Date(l.date) < options.dateStart!);
      const priorDebit = priorLines.reduce((sum, l) => sum + (l.debit || 0), 0);
      const priorCredit = priorLines.reduce((sum, l) => sum + (l.credit || 0), 0);

      if (["asset", "expense"].includes(account.type)) {
        openingBalance = priorDebit - priorCredit;
      } else {
        openingBalance = priorCredit - priorDebit;
      }
    }

    let filteredLines = postedLines;
    if (options?.dateStart) {
      filteredLines = filteredLines.filter((l) => new Date(l.date) >= options.dateStart!);
    }
    if (options?.dateEnd) {
      filteredLines = filteredLines.filter((l) => new Date(l.date) <= options.dateEnd!);
    }

    if (options?.search) {
      const searchLower = options.search.toLowerCase();
      filteredLines = filteredLines.filter(
        (l) =>
          l.entryNumber?.toLowerCase().includes(searchLower) ||
          l.memo?.toLowerCase().includes(searchLower) ||
          l.lineDescription?.toLowerCase().includes(searchLower)
      );
    }

    let runningBalance = openingBalance;
    let totalDebit = 0;
    let totalCredit = 0;

    const allEntries = filteredLines.map((line) => {
      const debit = line.debit || 0;
      const credit = line.credit || 0;

      totalDebit += debit;
      totalCredit += credit;

      if (["asset", "expense"].includes(account.type)) {
        runningBalance += debit - credit;
      } else {
        runningBalance += credit - debit;
      }

      return {
        id: line.lineId,
        date: line.date,
        entryNumber: line.entryNumber,
        description: line.lineDescription || line.memo || "",
        // The stored key of the line's own description (null when the row shows the entry memo).
        lineKey: line.lineDescription ? line.lineKey : null,
        lineParams: line.lineDescription ? line.lineParams : null,
        debit,
        credit,
        runningBalance,
        journalEntryId: line.entryId,
        journalLineId: line.lineId,
        memo: line.memo,
        memoKey: line.memoKey,
        memoParams: line.memoParams,
        source: line.source,
        status: line.status,
      };
    });

    const totalCount = allEntries.length;
    const paginatedEntries = options?.limit
      ? allEntries.slice(options.offset || 0, (options.offset || 0) + options.limit)
      : allEntries;

    const closingBalance =
      openingBalance +
      (["asset", "expense"].includes(account.type)
        ? totalDebit - totalCredit
        : totalCredit - totalDebit);

    return {
      entries: paginatedEntries,
      allEntries,
      account,
      openingBalance,
      totalDebit,
      totalCredit,
      closingBalance,
      totalCount,
    };
  }

  // Journal Entries
  /** Unscoped lookup — caller MUST authorise via hasCompanyAccess. */
  async getJournalEntryById(id: string): Promise<JournalEntry | undefined> {
    const [entry] = await db.select().from(journalEntries).where(eq(journalEntries.id, id));
    return entry || undefined;
  }

  async getJournalEntry(id: string, companyId: string): Promise<JournalEntry | undefined> {
    const [entry] = await db
      .select()
      .from(journalEntries)
      .where(and(eq(journalEntries.id, id), eq(journalEntries.companyId, companyId)));
    return entry || undefined;
  }

  async getJournalEntriesByCompanyId(
    companyId: string,
    opts?: { limit?: number; offset?: number; before?: { date: Date; id: string } }
  ): Promise<JournalEntry[]> {
    // S3: optional pagination. Default (no opts) returns all rows — the many
    // internal callers (financial statements, reports, CT) rely on the full set;
    // the list endpoint passes {limit, offset} or a keyset cursor `before`
    // (date desc, id desc) to cap the payload.
    const where = opts?.before
      ? and(
          eq(journalEntries.companyId, companyId),
          or(
            lt(journalEntries.date, opts.before.date),
            and(eq(journalEntries.date, opts.before.date), lt(journalEntries.id, opts.before.id))
          )
        )
      : eq(journalEntries.companyId, companyId);
    let q = db
      .select()
      .from(journalEntries)
      .where(where)
      .orderBy(desc(journalEntries.date), desc(journalEntries.id))
      .$dynamic();
    if (opts?.limit != null) q = q.limit(opts.limit);
    if (opts?.offset != null) q = q.offset(opts.offset);
    return await q;
  }

  async getPostedJournalEntriesWithLines(
    companyId: string
  ): Promise<Array<{ entry: JournalEntry; lines: JournalLine[] }>> {
    // Single JOIN replaces an N+1 (one query per entry to fetch lines).
    const rows = await db
      .select({
        entry: journalEntries,
        line: journalLines,
      })
      .from(journalEntries)
      .leftJoin(journalLines, eq(journalLines.entryId, journalEntries.id))
      .where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.status, "posted")));

    const byId = new Map<string, { entry: JournalEntry; lines: JournalLine[] }>();
    for (const row of rows) {
      const entryId = row.entry.id;
      let bucket = byId.get(entryId);
      if (!bucket) {
        bucket = { entry: row.entry, lines: [] };
        byId.set(entryId, bucket);
      }
      if (row.line) bucket.lines.push(row.line);
    }
    return Array.from(byId.values());
  }

  async createJournalEntry(
    insertEntry: InsertJournalEntry & { postedAt?: Date | null; updatedAt?: Date | null },
    lines: Array<Omit<InsertJournalLine, "entryId">>
  ): Promise<JournalEntry> {
    // W2-A: thin wrapper over the ledger kernel (server/ledger). Exact fils
    // balance, account/cost-centre/period guards and in-transaction numbering
    // (pg_advisory_xact_lock) for every existing caller. Any caller-supplied
    // entryNumber is ignored; the number is allocated at insert time.
    return createJournalEntryCompat(insertEntry, lines);
  }

  async generateEntryNumber(companyId: string, date: Date): Promise<string> {
    // R14-06: lock-free preview only. The old session-level advisory lock
    // (lock and unlock could run on different pooled connections) leaked and
    // blocked every later posting for that company/day. The real number is
    // allocated inside the posting transaction by server/ledger/numbering.ts.
    return previewEntryNumber(db, companyId, date);
  }

  // Journal Lines
  async getJournalLinesByEntryId(entryId: string): Promise<JournalLine[]> {
    return await db.select().from(journalLines).where(eq(journalLines.entryId, entryId));
  }

  async getJournalLinesByEntryIds(entryIds: string[]): Promise<JournalLine[]> {
    if (entryIds.length === 0) return [];
    return await db.select().from(journalLines).where(inArray(journalLines.entryId, entryIds));
  }

  /**
   * Creates a journal entry plus balanced lines in one call: generates the
   * entry number atomically, then delegates to createJournalEntry (which
   * validates balance and wraps everything in a transaction). Used by
   * document flows (credit notes, etc.) that post entries as a side effect.
   */
  async createJournalEntryWithLines(
    companyId: string,
    date: Date,
    entryData: Partial<InsertJournalEntry> & { createdBy: string; postedBy?: string | null },
    lines: Array<Omit<InsertJournalLine, "entryId">>
  ): Promise<{ entry: JournalEntry }> {
    const entryNumber = await this.generateEntryNumber(companyId, date);
    const isPosting = (entryData.status ?? "posted") === "posted";
    const entry = await this.createJournalEntry(
      {
        ...entryData,
        companyId,
        date,
        entryNumber,
        status: isPosting ? "posted" : "draft",
        source: entryData.source || "manual",
        sourceId: entryData.sourceId || null,
        createdBy: entryData.createdBy,
        postedBy: isPosting ? (entryData.postedBy ?? entryData.createdBy) : null,
        postedAt: isPosting ? new Date() : null,
      } as InsertJournalEntry & { postedAt?: Date | null },
      lines
    );
    return { entry };
  }
}
