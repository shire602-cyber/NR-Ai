# Design Plan

## 1. Design Summary

Four surgical changes to two files (`shared/schema.ts` and `server/storage.ts`), plus minor caller updates in 4 route/service files:

1. **Numeric migration**: Define a `customType`-based helper function `numericCol(name, precision, scale)` at the top of `schema.ts` that generates PostgreSQL `numeric(p,s)` columns while preserving the TypeScript `number` type via `fromDriver: Number`. Replace all 154 `real()` calls with `numericCol()` calls. This avoids cascading TypeScript type errors that would result from Drizzle's built-in `numeric()` (which infers as `string`).

2. **Unique constraints**: Add a 3rd argument to 10 `pgTable()` calls following the existing `accounts` table pattern (`(table) => ({ name: unique().on(table.col1, table.col2) })`). The 10th constraint — `journalEntries(companyId, entryNumber)` — serves as the DB-level safety net for the race condition fix.

3. **Race condition fix**: Add an optional `tx` parameter to `generateEntryNumber()`. Update the 7 call sites that also create journal entries to wrap number generation + insert in a single transaction, following the pattern already established by receipt creation (storage.ts line 1244).

4. **Receipts date fix**: Change `text("date")` → `timestamp("date")` on `receipts.date`.

## 2. Affected Components

| File | Change Type | Scope |
|------|-------------|-------|
| `shared/schema.ts` | Modified | 154 column type replacements, 10 unique constraints, 1 date type fix, new `customType` import + helper |
| `server/storage.ts` | Modified | `generateEntryNumber` signature + body (accept optional `tx` param) |
| `server/routes/journal.routes.ts` | Modified | 2 call sites — wrap generate+insert in `db.transaction()` |
| `server/routes/invoices.routes.ts` | Modified | 2 call sites — wrap generate+insert in `db.transaction()` |
| `server/routes/credit-notes.routes.ts` | Modified | 1 call site — wrap generate+insert in `db.transaction()` |
| `server/services/depreciation.service.ts` | Modified | 2 call sites — wrap generate+insert in `db.transaction()` |

## 3. Existing Pattern Alignment

### Custom type helper
- Drizzle's `customType()` is an official, documented API (the `.d.ts` even uses `numeric(2,3)` as an example in its docstring). No third-party code.
- The helper is defined inline at the top of `schema.ts`, not in a separate utility file. Follows the codebase's single-file schema convention.

### Unique constraints
- Exactly replicates the `accounts` table pattern (line 131-132):
  ```
  (table) => ({
    companyCodeUnique: unique().on(table.companyId, table.code),
  })
  ```
- `unique` is already imported on line 1.

### Transaction pattern
- Replicates the existing `db.transaction(async (tx: any) => { ... })` pattern used in `createBulkAccounts` (line 830) and receipt creation (line 1244).
- Receipt creation already demonstrates the exact pattern we're standardizing: generate entry number AND insert journal entry inside the same transaction.

### generateEntryNumber optional tx
- The optional `tx` parameter follows a well-known pattern for Drizzle ORM: methods that can participate in an existing transaction accept `tx?: typeof db` and fall back to `db` when called standalone.

## 4. Alternative Approaches Considered

### A. Use `numeric()` directly from drizzle-orm/pg-core
- Drizzle's `PgNumeric` has TypeScript base type `'string'`. All 154 columns would change from `number` to `string` in inferred types (`Invoice`, `JournalLine`, etc.).
- Would cause hundreds of TypeScript errors in route handlers, services, and any code doing arithmetic on these fields.
- **Rejected**: Violates AC-7 (zero build errors) without massive out-of-scope downstream changes.

### B. Use `numeric().$type<number>()` on each column
- `.$type<number>()` overrides the TypeScript type to `number`, but at runtime the PostgreSQL driver returns strings.
- `"100.00" + "5.00"` becomes `"100.005.00"` (string concatenation, not addition). Silent financial data corruption.
- **Rejected**: Creates invisible bugs in a financial application. Unacceptable risk.

### C. Use `doublePrecision()` instead of `numeric()`
- PostgreSQL `double precision` is 64-bit IEEE 754 — still floating point, still has rounding errors.
- `0.1 + 0.2 === 0.30000000000000004` persists.
- **Rejected**: Doesn't solve the core problem. Financial data requires exact decimal arithmetic.

### D. Serializable isolation for generateEntryNumber (no caller changes)
- Wrap only the COUNT query in a serializable transaction.
- The lock releases when the transaction commits, BEFORE the caller inserts the journal entry. A concurrent request can get the same number in the gap.
- **Rejected**: Only narrows the race window, doesn't close it. The unique constraint (approach chosen) provides the DB-level guarantee, and wrapping callers in transactions eliminates the gap entirely.

### E. Advisory locks (session-level) in generateEntryNumber
- `pg_advisory_lock(hashtext(companyId))` held across the session.
- With connection pooling, unreleased locks on crash would block subsequent requests on the recycled connection.
- **Rejected**: Fragile with pooled connections. Transaction-scoped approach is safer.

## 5. Chosen Design

### 5.1 Custom Numeric Column Helper

Define at the top of `schema.ts`, after imports:

```
const numericCol = customType<{ data: number; driverData: string }>({
  dataType(config) {
    return `numeric(${config.precision}, ${config.scale})`;
  },
  fromDriver(value) {
    return Number(value);
  },
  toDriver(value) {
    return String(value);
  },
});
```

**Note**: `customType` with a `config` generic requires `configRequired: true` in the type parameter. Actual implementation will use the factory pattern where `numericCol` is called as `numericCol(name, { precision, scale })`.

Wait — looking at the `customType` API more carefully:

```typescript
customType<{ data: number; driverData: string; config: { precision: number; scale: number }; configRequired: true }>
```

This produces a function that accepts `(name, { precision, scale })`. But this means every column call becomes:
```
numericCol("subtotal", { precision: 15, scale: 2 })
```

For simplicity, define **three preset helpers** instead, since there are only 3 precision/scale combinations:

```
// At top of schema.ts, after imports:

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

**Replacement mapping:**
- `real("x")` where x is a monetary amount → `monetaryColumn("x")`
- `real("x")` where x is a rate/percentage/score → `rateColumn("x")`
- `real("x")` where x is a quantity → `quantityColumn("x")`

The `real` import is removed from line 1 after all replacements. `customType` is added to the import.

### 5.2 Unique Constraints

For each of the 10 tables, add the 3rd argument to `pgTable()`. Example for `invoices`:

```
// Before:
export const invoices = pgTable("invoices", {
  ...columns...
});

// After:
export const invoices = pgTable("invoices", {
  ...columns...
}, (table) => ({
  companyNumberUnique: unique("invoices_company_number_unique").on(table.companyId, table.number),
}));
```

**Full constraint list (10 total):**

| Table | Constraint Name | Columns |
|-------|----------------|---------|
| `invoices` | `invoices_company_number_unique` | (companyId, number) |
| `quotes` | `quotes_company_number_unique` | (companyId, number) |
| `creditNotes` | `credit_notes_company_number_unique` | (companyId, number) |
| `purchaseOrders` | `purchase_orders_company_number_unique` | (companyId, number) |
| `employees` | `employees_company_number_unique` | (companyId, employeeNumber) |
| `costCenters` | `cost_centers_company_code_unique` | (companyId, code) |
| `fixedAssets` | `fixed_assets_company_code_unique` | (companyId, assetCode) |
| `companyUsers` | `company_users_company_user_unique` | (companyId, userId) |
| `subscriptions` | `subscriptions_company_unique` | (companyId) |
| `journalEntries` | `journal_entries_company_entry_number_unique` | (companyId, entryNumber) |

The 10th constraint on `journalEntries` is the DB-level safety net for the race condition fix.

### 5.3 Race Condition Fix

**Step 1: Update `generateEntryNumber` to accept optional `tx`**

```
// IStorage interface update:
generateEntryNumber(companyId: string, date: Date, tx?: any): Promise<string>;

// Implementation:
async generateEntryNumber(companyId: string, date: Date, tx?: any): Promise<string> {
  const executor = tx || db;
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `JE-${dateStr}`;
  const [result] = await executor
    .select({ count: sql<number>`count(*)` })
    .from(journalEntries)
    .where(and(
      eq(journalEntries.companyId, companyId),
      sql`${journalEntries.entryNumber} LIKE ${prefix + '%'}`
    ));
  const nextNumber = (Number(result?.count) || 0) + 1;
  return `${prefix}-${String(nextNumber).padStart(3, '0')}`;
}
```

**Step 2: Update callers to wrap in transactions**

Each caller that generates an entry number AND creates a journal entry wraps both operations in a single `db.transaction()`. The `tx` is passed to `generateEntryNumber` so the COUNT query runs within the same transaction as the INSERT.

The unique constraint on `journalEntries(companyId, entryNumber)` provides the final guarantee: if a duplicate somehow slips through, PostgreSQL rejects the INSERT. Callers should catch unique violation errors and retry with a fresh number (up to 3 attempts).

**Call sites to update (7):**
1. `journal.routes.ts:83` — journal entry creation
2. `journal.routes.ts:301` — journal entry reversal
3. `invoices.routes.ts:172` — invoice posting
4. `invoices.routes.ts:391` — invoice voiding
5. `credit-notes.routes.ts:162` — credit note issuing
6. `depreciation.service.ts:111` — depreciation entry posting
7. `depreciation.service.ts:210` — disposal entry posting

**Note:** The receipt creation at `storage.ts:1244` already has this pattern inline. It can be refactored to call the updated `generateEntryNumber(companyId, date, tx)` for consistency, but this is optional.

### 5.4 Receipts Date Type Fix

Change line 311 of `schema.ts`:
```
// Before:
date: text("date"),
// After:
date: timestamp("date"),
```

`timestamp` is already imported on line 1. No additional imports needed.

## 6. Data Flow / Control Flow Impact

### Numeric columns
- **Write path**: JS `number` → `toDriver` → PG `numeric(p,s)` string → stored as exact decimal
- **Read path**: PG `numeric(p,s)` → driver returns string → `fromDriver` → JS `number`
- **JSON serialization**: No change — `number` serializes as JSON number
- **Arithmetic**: No change — values remain JS `number` type

### Entry number generation
- **Before**: `generateEntryNumber` → return number → caller inserts journal entry (separate queries, race window)
- **After**: caller opens `db.transaction()` → `generateEntryNumber(companyId, date, tx)` → caller inserts journal entry with `tx` → transaction commits atomically
- **Fallback**: Unique constraint on `(companyId, entryNumber)` rejects any duplicate that slips through

### Unique constraints
- **Write path**: INSERT/UPDATE queries now validated by PG unique constraints. Violations return error code `23505`.
- **Read path**: No change.

## 7. Invariants Preserved

| # | Invariant | How Protected |
|---|-----------|---------------|
| 1 | Column count unchanged | `numericCol` replaces `real` 1:1, no columns added/removed |
| 2 | Default values preserved | `.default(0)`, `.default(0.05)`, `.default(375000)` etc. chain after `numericCol()` identically to `real()` |
| 3 | Nullability preserved | `.notNull()` chains preserved on every column |
| 4 | Foreign keys preserved | `.references()` chains are NOT on `real()` columns, so unaffected |
| 5 | Cascade behavior preserved | Cascade configs are on relationship columns, not numeric columns |
| 6 | Insert schemas compile | `customType` produces a valid column builder; `createInsertSchema()` works with any `PgColumn` subclass |
| 7 | Type exports valid | `$inferSelect` infers `number` (from `customType<{ data: number }>`), same as before with `real()` |
| 8 | accounts unique constraint | Untouched — already uses the 3rd argument pattern |
| 9 | Entry number format | `JE-YYYYMMDD-NNN` format code unchanged, only execution context changes |

## 8. Failure Modes

### Unique constraint violation on INSERT
- **Trigger**: Attempt to insert duplicate (companyId, number) pair
- **Behavior**: PostgreSQL throws error code `23505` (unique_violation)
- **Recovery**: Application catches and returns HTTP 409 Conflict with descriptive message
- **For entry numbers**: Retry up to 3 times with fresh `generateEntryNumber` call

### Transaction serialization failure
- **Trigger**: Concurrent transactions on same journal entries
- **Behavior**: PostgreSQL throws error code `40001` (serialization_failure) — but we use default READ COMMITTED isolation, so this won't occur. The unique constraint is the safety mechanism instead.
- **Recovery**: N/A — unique constraint handles conflicts

### Numeric overflow
- **Trigger**: Value exceeds `numeric(15,2)` range (> 9,999,999,999,999.99)
- **Behavior**: PostgreSQL throws `22003` (numeric_value_out_of_range)
- **Recovery**: Application returns HTTP 400 with validation error. Acceptable for a financial app.

### Number() conversion edge cases
- **Trigger**: PG returns `null`, empty string, or non-numeric string from `numeric` column
- **Behavior**: `Number(null)` → `0`, `Number("")` → `0`, `Number("abc")` → `NaN`
- **Recovery**: NULL columns return `null` from Drizzle before `fromDriver` is called, so `fromDriver` only sees valid numeric strings. No risk.

### db:push with existing duplicate data
- **Trigger**: Production database has duplicate (companyId, number) rows
- **Behavior**: `db:push` fails to create the unique constraint
- **Recovery**: Deployment concern — run dedup queries before applying schema. NOT handled by this design.

## 9. Security Considerations

- **No new auth surfaces**: No new endpoints, no new public routes.
- **No secrets involved**: Schema changes and transaction wrapping don't handle credentials.
- **SQL injection**: All queries use Drizzle's parameterized `sql` template literals. No raw string concatenation.
- **Advisory locks not used**: Avoided session-level locks that could create denial-of-service via lock exhaustion.
- **Unique constraints ADD security**: Prevent data duplication attacks where a malicious user could create duplicate document numbers to cause accounting confusion.

## 10. Performance Considerations

### Numeric vs Real
- **Storage**: `numeric(15,2)` uses variable-width storage (typically 8-12 bytes) vs. `real` fixed 4 bytes. Marginal increase — negligible for row counts under 1M.
- **Arithmetic**: PostgreSQL `numeric` arithmetic is ~2-5x slower than `float4`. But arithmetic happens on individual rows during INSERT/UPDATE, not bulk scans. Negligible for a SaaS app.
- **Index size**: Slightly larger for numeric columns if indexed. No indexes exist on these columns currently (indexing is Phase 4).

### Transaction wrapping
- **Latency**: Wrapping entry number generation + journal insert in a transaction adds ~1-2ms for the transaction overhead. Negligible.
- **Locking**: Within the transaction, the INSERT acquires a row-level lock on the `journalEntries` table. This is standard and releases on commit. No table-level locking.

### Unique constraints
- **Write overhead**: Each INSERT/UPDATE checks the unique index. With a B-tree index, this is O(log n) — sub-millisecond for typical table sizes.
- **Read benefit**: Unique constraints create implicit indexes that speed up lookups by (companyId, number). Net positive.

## 11. Test Strategy

### Verification tests (post-implementation)
Given the minimal test infrastructure (2 existing test files, no integration tests), verification is primarily via:

1. **TypeScript compilation** (`npm run build`): Confirms all 154 column replacements maintain type compatibility and all Zod schemas compile.

2. **Grep verification**: `grep -c "real(" shared/schema.ts` returns 0. `grep -c "numericCol\|monetaryColumn\|rateColumn\|quantityColumn" shared/schema.ts` returns 154.

3. **Schema push dry-run**: `npx drizzle-kit push --dry-run` to verify generated SQL uses `numeric(p,s)` types and includes all unique constraints.

### Recommended tests (if test infrastructure exists)
- **Unit**: `generateEntryNumber` with mock `tx` returns correct format
- **Integration**: Two concurrent `generateEntryNumber` calls for same company+date produce different numbers
- **Schema**: Each unique constraint rejects duplicate inserts (test via Drizzle insert + catch `23505`)

### Manual verification
- Create a journal entry → verify entry number generated
- Create two invoices with same number for same company → verify second is rejected
- Check that monetary values round correctly (insert `100.10 + 200.20` → verify stored as `300.30`, not `300.30000000000004`)

## 12. Rollout / Migration / Rollback

### Rollout steps
1. **Pre-deployment**: Run dedup queries on production DB to resolve any existing duplicates in the 10 constraint tables.
2. **Deploy**: Push code changes. Run `npm run db:push` to apply schema changes.
3. **Verify**: Check that `db:push` output shows `ALTER COLUMN ... TYPE numeric(...)` (not DROP+CREATE). If destructive, abort and use manual `ALTER TABLE` SQL instead.

### Migration concern: real → numeric
- Drizzle Kit `db:push` should generate: `ALTER TABLE x ALTER COLUMN y TYPE numeric(15,2) USING y::numeric(15,2)`
- The `USING` clause handles the cast from `real` to `numeric`.
- If Drizzle Kit doesn't generate `USING`, the cast is implicit (float4 → numeric is a standard PG implicit cast). Should work.

### Migration concern: text → timestamp (receipts.date)
- Existing text values like "2024-01-15" need: `ALTER COLUMN date TYPE timestamp USING date::timestamp`
- If Drizzle Kit doesn't add `USING`, run manually: `ALTER TABLE receipts ALTER COLUMN date TYPE timestamp USING date::timestamp;`

### Rollback
- **Schema rollback**: Change `numericCol` back to `real`, remove unique constraints, revert `generateEntryNumber`. Run `db:push` again.
- **Data rollback**: `numeric` → `real` conversion is lossless (numeric values fit in float4 for typical financial amounts). No data loss on rollback.
- **Transaction rollback**: Removing the `tx` parameter is backwards compatible — callers just stop passing it.

### Deployment risk: zero-downtime
- Adding unique constraints requires a brief `ACCESS EXCLUSIVE` lock on each table (for index creation). For tables with < 100K rows, this takes < 1 second. No downtime expected.
- Column type changes (`ALTER COLUMN TYPE`) also take a brief lock. Same expectation.

## 13. File Touch Forecast

| File | Action | Lines Changed (est.) |
|------|--------|---------------------|
| `shared/schema.ts` | Edit | ~170 (154 column swaps + 10 constraints + 1 date fix + helper functions + import changes) |
| `server/storage.ts` | Edit | ~5 (add `tx` param to `generateEntryNumber`, use `executor` variable) |
| `server/routes/journal.routes.ts` | Edit | ~30 (wrap 2 code blocks in `db.transaction()`) |
| `server/routes/invoices.routes.ts` | Edit | ~30 (wrap 2 code blocks in `db.transaction()`) |
| `server/routes/credit-notes.routes.ts` | Edit | ~15 (wrap 1 code block in `db.transaction()`) |
| `server/services/depreciation.service.ts` | Edit | ~20 (wrap 2 code blocks in `db.transaction()`) |

**Intentionally NOT touched:**
- `server/storage.ts` line 1244 (receipt creation) — already uses the correct transaction pattern. Optional cleanup to call `generateEntryNumber(companyId, date, tx)` instead of inline logic, but not required.
- Frontend files — no changes needed; TypeScript types remain `number`.
- Zod schemas — auto-derived from Drizzle tables, update automatically.
- Test files — no existing tests to modify.

**Total files modified: 6**
**New files: 0**

## 14. Design Decision

**READY FOR CHANGE PLAN**
