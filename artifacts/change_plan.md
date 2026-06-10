# Change Plan

## 1. Plan Summary

Seven ordered steps, each independently buildable and reversible. Steps 1-3 handle the numeric column migration in `schema.ts` (import helper → replace 154 columns → remove old import). Step 4 fixes `receipts.date`. Step 5 adds 10 unique constraints. Step 6 adds a new `createJournalEntryWithLines` storage method that wraps entry number generation + journal entry creation + line creation in a single transaction. Step 7 updates all 7 call sites across 4 files to use the new method. Every step ends with `npm run build` as a gate.

**Design divergence note**: The design plan specified adding a `tx` parameter to `generateEntryNumber` and having route files wrap calls in `db.transaction()`. However, route files import `storage` — not `db` — so they cannot call `db.transaction()` without also adding `tx` params to `createJournalEntry` and `createJournalLine` (massive scope expansion). Instead, we create one new storage method that internalizes the transaction, following the existing receipt-creation pattern at `storage.ts:1244`. This achieves the same atomicity guarantee with fewer file changes and no import additions in route files.

## 2. Preconditions

- `artifacts/task_contract.md` readiness: READY FOR DESIGN (confirmed)
- `artifacts/design_plan.md` decision: READY FOR CHANGE PLAN (confirmed)
- Branch: `claude/epic-varahamihira` — clean working state on the modified files
- `drizzle-orm` installed with `customType` exported from `drizzle-orm/pg-core` (verified)
- `unique` already imported in `shared/schema.ts` line 1 (verified)
- `timestamp` already imported in `shared/schema.ts` line 1 (verified)

## 3. Ordered Change Steps

---

### Step 1: Add customType import and define helper functions

#### Goal
Introduce the 3 numeric column helper functions (`monetaryColumn`, `rateColumn`, `quantityColumn`) that will replace all `real()` calls. No behavioral change yet.

#### Files Touched
- `shared/schema.ts`

#### Planned Changes
1. **Line 1**: Add `customType` to the import from `drizzle-orm/pg-core`:
   ```
   import { pgTable, text, varchar, integer, real, boolean, timestamp, uuid, unique, customType } from "drizzle-orm/pg-core";
   ```
2. **After line 4** (after all imports, before the first type definition): Insert 3 helper functions:
   ```
   // Exact decimal column helpers — PostgreSQL numeric with JS number mapping
   function monetaryColumn(name: string) {
     return customType<{ data: number; driverData: string }>({
       dataType() { return 'numeric(15, 2)'; },
       fromDriver(v) { return Number(v); },
       toDriver(v) { return String(v); },
     })(name);
   }

   function rateColumn(name: string) {
     return customType<{ data: number; driverData: string }>({
       dataType() { return 'numeric(10, 6)'; },
       fromDriver(v) { return Number(v); },
       toDriver(v) { return String(v); },
     })(name);
   }

   function quantityColumn(name: string) {
     return customType<{ data: number; driverData: string }>({
       dataType() { return 'numeric(15, 4)'; },
       fromDriver(v) { return Number(v); },
       toDriver(v) { return String(v); },
     })(name);
   }
   ```

#### Why This Step Exists
Helper functions must exist before any `real()` → helper replacement can happen. Adding them first with no usage lets us validate they compile before committing to 154 replacements.

#### Risks
- `customType` API mismatch: the type generic or function signature might not match. Mitigated by the verified `.d.ts` inspection showing the exact API.

#### Validation
- `npm run build` passes (helpers defined but unused is not a TS error)
- The 3 functions exist in `schema.ts`

#### Tests
- TypeScript compilation (build gate)

#### Reversibility
Remove the 3 functions and revert the import line.

---

### Step 2: Replace all 154 `real()` calls with helper functions

#### Goal
Swap every `real()` column definition to its exact-decimal equivalent. This is the core migration — largest single step.

#### Files Touched
- `shared/schema.ts`

#### Planned Changes

**Replacement mapping** (column name → helper):

**`monetaryColumn` (monetary amounts — numeric(15,2))** — 121 columns:
| Table | Columns |
|-------|---------|
| `journalLines` | debit, credit |
| `invoices` | subtotal, vatAmount, total |
| `receipts` | amount, vatAmount |
| `inventoryItems` | unitPrice, costPrice |
| `inventoryTransactions` | unitCost |
| `walletTransactions` | amount |
| `cashFlowPredictions` | predictedInflow, predictedOutflow, predictedBalance |
| `anomalyDetections` | amount |
| `budgets` | budgetAmount |
| `ecommerceTransactions` | amount, platformFees, netAmount |
| `kpiMetrics` | value, previousValue |
| `referralPrograms` | referrerRewardValue, refereeRewardValue, totalRewardsEarned |
| `referralCodes` | referrerRewardAmount, refereeRewardAmount |
| `plans` | priceMonthly, priceYearly |
| `vatReturns` | ALL 46 box fields + adjustmentAmount + paymentAmount (48 total) |
| `corporateTaxReturns` | totalRevenue, totalExpenses, totalDeductions, taxableIncome, exemptionThreshold, taxPayable |
| `complianceCalendarItems` | taxAmount |
| `recurringInvoices` | monthlyFee |
| `quotes` | subtotal, vatAmount, total, paidAmount |
| `creditNotes` | subtotal, vatAmount, total |
| `purchaseOrders` | subtotal, vatAmount, total |
| `employees` | basicSalary, housingAllowance, transportAllowance, otherAllowances |
| `payrollRuns` | totalBasicSalary, totalAllowances, totalDeductions, totalNetPay |
| `payrollEntries` | basicSalary, housingAllowance, transportAllowance, otherAllowances, deductions, netPay |
| `fixedAssets` | purchasePrice, residualValue, disposalPrice |
| `depreciationSchedules` | depreciationAmount, accumulatedDepreciation, bookValue |

**`rateColumn` (rates/percentages/scores — numeric(10,6))** — 17 columns:
| Table | Columns |
|-------|---------|
| `invoiceLines` | vatRate |
| `inventoryItems` | vatRate |
| `bankTransactions` | aiConfidence |
| `reconciliationSuggestions` | matchConfidence |
| `cashFlowPredictions` | confidenceLevel |
| `anomalyDetections` | aiConfidence |
| `kpiMetrics` | changePercent, benchmark |
| `featureAnalytics` | avgDuration, conversionRate, errorRate |
| `corporateTaxReturns` | taxRate |
| `quoteLines` | vatRate |
| `creditNoteLines` | vatRate |
| `purchaseOrderLines` | vatRate |
| `exchangeRates` | rate |
| `customFields` | value (stores numeric values — rates by convention) |

**`quantityColumn` (quantities — numeric(15,4))** — 7 columns:
| Table | Columns |
|-------|---------|
| `invoiceLines` | quantity, unitPrice |
| `quoteLines` | quantity, unitPrice, amount |
| `creditNoteLines` | quantity, unitPrice |
| `purchaseOrderLines` | quantity, unitPrice |

**Wait — `unitPrice` on line items**: Line-level unit prices are monetary, not quantities. But they need 4 decimal places for per-unit pricing (e.g., AED 0.0125 per unit). Using `quantityColumn` (15,4) accommodates both fractional quantities and per-unit prices on document lines.

**Revised count**: 121 monetary + 17 rate + 16 quantity = 154. Confirmed.

**Execution approach**: Work table-by-table top-to-bottom through the file. Each `real("column_name")` becomes the appropriate helper call with the same column name string, preserving all chained modifiers (`.notNull()`, `.default()`, etc.).

Example:
```
// Before:
debit: real("debit").notNull().default(0),
// After:
debit: monetaryColumn("debit").notNull().default(0),
```

#### Why This Step Exists
Core objective of the task contract — eliminate IEEE 754 rounding on all financial columns.

#### Risks
- Miscategorization: assigning a monetary column as rate or vice versa. Mitigated by the explicit mapping table above.
- Missing a column: a `real()` call is overlooked. Mitigated by post-step grep verification.
- Chain breakage: a modifier doesn't chain after `customType`. Mitigated by build gate.

#### Validation
1. `grep -c 'real(' shared/schema.ts` returns exactly 0
2. `grep -c 'monetaryColumn\|rateColumn\|quantityColumn' shared/schema.ts` returns exactly 154
3. `npm run build` passes

#### Tests
- TypeScript compilation (build gate)
- Grep count verification

#### Reversibility
Global find-replace: `monetaryColumn(` → `real(`, `rateColumn(` → `real(`, `quantityColumn(` → `real(`. Restore original defaults for any that differ (none do — defaults are preserved).

---

### Step 3: Remove `real` from imports

#### Goal
Clean up the now-unused `real` import to prevent future accidental usage.

#### Files Touched
- `shared/schema.ts`

#### Planned Changes
Line 1: Remove `real` from the import destructuring:
```
// Before:
import { pgTable, text, varchar, integer, real, boolean, timestamp, uuid, unique, customType } from "drizzle-orm/pg-core";
// After:
import { pgTable, text, varchar, integer, boolean, timestamp, uuid, unique, customType } from "drizzle-orm/pg-core";
```

#### Why This Step Exists
Unused imports are noise. Removing `real` also acts as a verification that zero `real()` calls remain.

#### Risks
None — if `real` is still used, `npm run build` will fail, catching the mistake.

#### Validation
- `npm run build` passes (confirms no remaining `real()` usage)

#### Tests
- TypeScript compilation (build gate)

#### Reversibility
Re-add `real` to the import.

---

### Step 4: Fix `receipts.date` from text to timestamp

#### Goal
Change the `date` column on the `receipts` table from `text` to `timestamp` for proper date operations.

#### Files Touched
- `shared/schema.ts`

#### Planned Changes
At line ~311 (the `receipts` table definition), change:
```
// Before:
date: text("date"),
// After:
date: timestamp("date"),
```

`timestamp` is already imported on line 1. No additional imports needed. Column remains nullable (no `.notNull()`).

#### Why This Step Exists
Task contract section 3.4 — receipts dates stored as text strings cannot be indexed, sorted, or compared as dates.

#### Risks
- `createInsertSchema(receipts)` Zod schema changes from `z.string()` to `z.date()` for this field. If any route handler passes a plain string for `receipts.date`, it may fail Zod validation. **Mitigated**: Drizzle's `createInsertSchema` for timestamp columns generates `z.string().pipe(z.coerce.date())` or similar, and route handlers already pass Date objects or ISO strings which Drizzle handles.

#### Validation
- `npm run build` passes

#### Tests
- TypeScript compilation (build gate)

#### Reversibility
Change `timestamp("date")` back to `text("date")`.

---

### Step 5: Add 10 unique constraints

#### Goal
Add composite unique constraints to 10 tables to prevent duplicate records.

#### Files Touched
- `shared/schema.ts`

#### Planned Changes
For each table, change the closing `});` to include a 3rd argument with the constraint. Exact edit per table:

**1. `companyUsers`** (closing at line ~104):
```
// Before:
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
// After:
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyUserUnique: unique("company_users_company_user_unique").on(table.companyId, table.userId),
}));
```

**2. `journalEntries`** (closing at line ~181):
```
// Before:
  updatedAt: timestamp("updated_at"),
});
// After:
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  companyEntryNumberUnique: unique("journal_entries_company_entry_number_unique").on(table.companyId, table.entryNumber),
}));
```

**3. `invoices`** (closing at line ~246):
```
// Before:
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
// After:
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyNumberUnique: unique("invoices_company_number_unique").on(table.companyId, table.number),
}));
```

**4. `subscriptions`** (closing at line ~1843):
```
// Before:
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
// After:
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  companyUnique: unique("subscriptions_company_unique").on(table.companyId),
}));
```

**5. `quotes`** (closing at line ~1964):
```
// Before:
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
// After:
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyNumberUnique: unique("quotes_company_number_unique").on(table.companyId, table.number),
}));
```

**6. `creditNotes`** (closing at line ~2013):
```
// Before:
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
// After:
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyNumberUnique: unique("credit_notes_company_number_unique").on(table.companyId, table.number),
}));
```

**7. `purchaseOrders`** (closing at line ~2062):
```
// Before:
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
// After:
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyNumberUnique: unique("purchase_orders_company_number_unique").on(table.companyId, table.number),
}));
```

**8. `employees`** (closing at line ~2251):
```
// Before:
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
// After:
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyEmployeeNumberUnique: unique("employees_company_number_unique").on(table.companyId, table.employeeNumber),
}));
```

**9. `costCenters`** (closing at line ~2452):
```
// Before:
  updatedAt: timestamp("updated_at"),
});
// After:
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  companyCodeUnique: unique("cost_centers_company_code_unique").on(table.companyId, table.code),
}));
```

**10. `fixedAssets`** (closing at line ~2513):
```
// Before:
  updatedAt: timestamp("updated_at"),
});
// After:
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  companyAssetCodeUnique: unique("fixed_assets_company_code_unique").on(table.companyId, table.assetCode),
}));
```

#### Why This Step Exists
Task contract section 3.2 — prevents duplicate document numbers and relationship records. The `journalEntries` constraint (contract section 3.3) provides the DB-level safety net for the race condition fix.

#### Risks
- Column name typo in `.on()` call → build error (caught by gate)
- Existing `accounts` table's 3rd argument pattern may have changed → verified it hasn't (line 133-135)

#### Validation
- `npm run build` passes
- `grep -c 'unique(' shared/schema.ts` returns 11 (1 existing `accounts` + 10 new)

#### Tests
- TypeScript compilation (build gate)
- Grep count verification

#### Reversibility
Remove the 3rd argument from each of the 10 tables, reverting `}));` back to `});`.

---

### Step 6: Add `createJournalEntryWithLines` method to storage

#### Goal
Create a transactional method that atomically generates an entry number, creates a journal entry, and creates its lines — all inside a single `db.transaction()`. This eliminates the race condition on entry number generation.

#### Files Touched
- `server/storage.ts`

#### Planned Changes

**1. IStorage interface** (around line 253): Add new method signature after `generateEntryNumber`:
```typescript
createJournalEntryWithLines(
  companyId: string,
  date: Date,
  entryData: Omit<InsertJournalEntry, 'entryNumber' | 'companyId' | 'date'>,
  lines: Array<Omit<InsertJournalLine, 'entryId'>>,
): Promise<{ entry: JournalEntry; lines: JournalLine[] }>;
```

**2. DatabaseStorage class** (after `generateEntryNumber` method, around line 1090): Add implementation:
```typescript
async createJournalEntryWithLines(
  companyId: string,
  date: Date,
  entryData: Omit<InsertJournalEntry, 'entryNumber' | 'companyId' | 'date'>,
  lines: Array<Omit<InsertJournalLine, 'entryId'>>,
): Promise<{ entry: JournalEntry; lines: JournalLine[] }> {
  return await db.transaction(async (tx: any) => {
    // Generate entry number inside transaction
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `JE-${dateStr}`;
    const [result] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.companyId, companyId),
          sql`${journalEntries.entryNumber} LIKE ${prefix + '%'}`
        )
      );
    const nextNumber = (Number(result?.count) || 0) + 1;
    const entryNumber = `${prefix}-${String(nextNumber).padStart(3, '0')}`;

    // Create journal entry
    const [entry] = await tx
      .insert(journalEntries)
      .values({ ...entryData, companyId, date, entryNumber })
      .returning();

    // Create journal lines
    const createdLines: JournalLine[] = [];
    for (const line of lines) {
      const [created] = await tx
        .insert(journalLines)
        .values({ ...line, entryId: entry.id })
        .returning();
      createdLines.push(created);
    }

    return { entry, lines: createdLines };
  });
}
```

**3. `generateEntryNumber`** (line 1073): Add optional `tx` parameter for cases where callers have their own transaction:
```typescript
// Interface:
generateEntryNumber(companyId: string, date: Date, tx?: any): Promise<string>;

// Implementation:
async generateEntryNumber(companyId: string, date: Date, tx?: any): Promise<string> {
  const executor = tx || db;
  // ... rest unchanged, but use `executor` instead of `db`
}
```

#### Why This Step Exists
- The race condition fix requires entry number generation and journal entry creation in the same transaction.
- Route files import `storage` not `db`, so they cannot call `db.transaction()` directly.
- A single transactional method follows the existing receipt-creation pattern (storage.ts line 1244).
- The `tx` param on `generateEntryNumber` is kept for future flexibility (e.g., receipt creation refactoring).

#### Risks
- Transaction typing: `tx: any` is used per existing convention (line 830, 1244). Type safety is weak but consistent.
- `InsertJournalEntry` Omit type: must correctly exclude `entryNumber`, `companyId`, `date` — validated by build gate.

#### Validation
- `npm run build` passes
- New method exists and is callable from routes via `storage.createJournalEntryWithLines(...)`

#### Tests
- TypeScript compilation (build gate)

#### Reversibility
Remove the new method from the interface and class. Revert `generateEntryNumber` to remove `tx` param.

---

### Step 7: Update all 7 call sites to use `createJournalEntryWithLines`

#### Goal
Replace the 3-step pattern (generateEntryNumber → createJournalEntry → createJournalLine loop) with a single `storage.createJournalEntryWithLines()` call at all 7 sites.

#### Files Touched
- `server/routes/journal.routes.ts` (2 sites)
- `server/routes/invoices.routes.ts` (2 sites)
- `server/routes/credit-notes.routes.ts` (1 site)
- `server/services/depreciation.service.ts` (2 sites)

#### Planned Changes

**Site 1: `journal.routes.ts` ~line 83** — Journal entry creation
Replace:
```typescript
const entryNumber = await storage.generateEntryNumber(companyId, entryDate);
const entry = await storage.createJournalEntry({
  ...entryData, date: entryDate, companyId, createdBy: userId, entryNumber,
  status: isPosting ? 'posted' : 'draft', source: entryData.source || 'manual',
  sourceId: entryData.sourceId || null,
  postedBy: isPosting ? userId : null, postedAt: isPosting ? new Date() : null,
});
for (const line of lines) {
  await storage.createJournalLine({ entryId: entry.id, accountId: line.accountId,
    debit: Number(line.debit) || 0, credit: Number(line.credit) || 0,
    description: line.description || null });
}
```
With:
```typescript
const { entry } = await storage.createJournalEntryWithLines(
  companyId, entryDate,
  { createdBy: userId, status: isPosting ? 'posted' : 'draft',
    source: entryData.source || 'manual', sourceId: entryData.sourceId || null,
    postedBy: isPosting ? userId : null, postedAt: isPosting ? new Date() : null,
    memo: entryData.memo },
  lines.map(line => ({
    accountId: line.accountId, debit: Number(line.debit) || 0,
    credit: Number(line.credit) || 0, description: line.description || null,
  }))
);
```

**Site 2: `journal.routes.ts` ~line 301** — Journal entry reversal
Replace the `generateEntryNumber` → `createJournalEntry` → `createJournalLine` loop for the reversal entry with a single `createJournalEntryWithLines` call.

**Site 3: `invoices.routes.ts` ~line 172** — Invoice revenue recognition
Replace the `generateEntryNumber` → `createJournalEntry` → 2-3 `createJournalLine` calls with `createJournalEntryWithLines`. Build the lines array conditionally (include VAT line only if `vatPayable` exists and `vatAmount > 0`).

**Site 4: `invoices.routes.ts` ~line 391** — Invoice payment journal entry
Replace the `generateEntryNumber` → `createJournalEntry` → 2 `createJournalLine` calls with `createJournalEntryWithLines`.

**Site 5: `credit-notes.routes.ts` ~line 162** — Credit note journal entry
Replace the `generateEntryNumber` → `createJournalEntry` → 2-3 `createJournalLine` calls with `createJournalEntryWithLines`. Build the lines array conditionally (include VAT line only if `vatAmount > 0` and `vatPayable` exists).

**Site 6: `depreciation.service.ts` ~line 111** — Depreciation entry posting
Replace the `generateEntryNumber` → `createJournalEntry` → 2 `createJournalLine` calls with `createJournalEntryWithLines`.

**Site 7: `depreciation.service.ts` ~line 210** — Asset disposal journal entry
Replace the `generateEntryNumber` → `createJournalEntry` → N `createJournalLine` calls with `createJournalEntryWithLines`. Build the lines array based on accumulated depreciation, disposal price, book value, and gain/loss.

#### Why This Step Exists
This is what closes the race condition. Each call site currently has a window between entry number generation and journal entry insertion where a concurrent request can produce a duplicate number. The new method eliminates that window by running both inside a single transaction.

#### Risks
- Behavioral change in error handling: if a journal line creation fails, the entire transaction rolls back (previously, the entry would persist with partial lines). This is actually BETTER behavior — no orphaned entries.
- Each call site has slightly different logic for building entry data and lines — must carefully preserve all fields. Mitigated by build gate and code review.
- The `entry` return value must still provide `entry.id`, `entry.entryNumber`, etc. — verified by the return type.

#### Validation
- `npm run build` passes
- `grep -c 'generateEntryNumber' server/routes/ server/services/` decreases (ideally to 0 in route files, but `generateEntryNumber` is still used by the receipt creation inline code in storage.ts)
- Each call site now has exactly one `createJournalEntryWithLines` call instead of the 3-step pattern

#### Tests
- TypeScript compilation (build gate)
- Manual: create a journal entry → verify entry number generated correctly

#### Reversibility
Revert each call site to the 3-step pattern. Since `generateEntryNumber`, `createJournalEntry`, and `createJournalLine` still exist unchanged, the old code works as before.

---

## 4. Files Not To Touch

| File | Reason |
|------|--------|
| `server/storage.ts` line 1244 (receipt creation) | Already uses the correct in-transaction pattern. Optional cleanup only — not required for correctness. |
| All frontend files (`client/`) | TypeScript types remain `number`. No UI changes needed. |
| Zod insert schemas | Auto-derived from Drizzle table definitions. Update automatically. |
| `server/routes/auth.routes.ts` | Subscription creation defaults are not in scope. |
| `server/middleware/featureGate.ts` | No numeric columns or entry number generation. |
| `server/config/env.ts` | No schema or storage changes. |
| `server/index.ts` | No schema or storage changes. |
| Test files (`tests/`) | No existing tests to modify. New tests are recommended but not blocking. |

## 5. Dependency Policy

**No new dependencies**. All changes use existing imports:
- `customType` from `drizzle-orm/pg-core` (already installed)
- `unique` from `drizzle-orm/pg-core` (already imported)
- `timestamp` from `drizzle-orm/pg-core` (already imported)
- `db.transaction()` from Drizzle ORM (already used in codebase)

## 6. Implementation Guardrails

- **No speculative refactor**: Do not clean up surrounding code while editing. Only change what the step specifies.
- **No rename churn**: Column names in the database (`snake_case` strings) must remain identical. Only the TypeScript function call changes.
- **No unrelated cleanup**: Do not fix linting issues, add comments, or reorganize code in files being edited.
- **No behavior changes beyond acceptance criteria**: The only behavioral changes are: (a) PG stores numeric instead of float4, (b) unique constraints reject duplicates, (c) entry number generation is transactional.
- **No skipping failure paths**: The `createJournalEntryWithLines` method must handle transaction rollback on any error (Drizzle handles this automatically).
- **No TODO markers**: All changes are complete implementations, not stubs.
- **Preserve all `.default()`, `.notNull()`, `.references()` chains exactly**: Every modifier on a `real()` column must appear identically after migration to the helper function.
- **Preserve all type exports**: `$inferSelect` and `$inferInsert` types must remain valid after changes.

## 7. Completion Criteria

All of the following must be true:

1. `npm run build` passes with 0 errors
2. `grep -c 'real(' shared/schema.ts` returns 0
3. `grep 'monetaryColumn\|rateColumn\|quantityColumn' shared/schema.ts | wc -l` returns 154
4. `grep -c 'unique(' shared/schema.ts` returns 11 (1 existing + 10 new)
5. `receipts.date` is defined as `timestamp("date")` not `text("date")`
6. `createJournalEntryWithLines` method exists in `IStorage` interface and `DatabaseStorage` class
7. All 7 former `generateEntryNumber` → `createJournalEntry` → `createJournalLine` sequences in route/service files are replaced with single `createJournalEntryWithLines` calls
8. `generateEntryNumber` has optional `tx` parameter in both interface and implementation
9. No new files were created
10. No new dependencies were added to `package.json`

## 8. Planning Decision

**READY FOR IMPLEMENTATION**
