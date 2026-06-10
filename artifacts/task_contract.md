# Task Contract

## 1. Objective

Eliminate four classes of data-integrity bugs that can silently corrupt financial records in production:

1. **Float-to-decimal migration**: Replace all 154 `real()` (PostgreSQL `float4`) columns with `numeric(precision, scale)` to prevent IEEE 754 rounding errors on monetary values (e.g., `0.1 + 0.2 !== 0.3`).
2. **Unique constraints**: Add 9 missing composite unique constraints on business-critical document numbers and relationship tables to prevent duplicate records.
3. **Race condition fix**: Wrap `generateEntryNumber()` in a serializable transaction to prevent duplicate journal entry numbers under concurrent writes.
4. **Type correction**: Change `receipts.date` from `text("date")` to `timestamp("date")` for proper date operations and indexing.

## 2. Business Context

Muhasib.ai is a UAE accounting SaaS competing with Wafeq and Naqood. Financial data correctness is non-negotiable for:
- **UAE FTA VAT compliance**: VAT return boxes must sum to exact fils (1/100 AED). Float rounding can cause VAT mismatch penalties.
- **Audit trail integrity**: Duplicate journal entry numbers or invoices violate UAE Commercial Companies Law record-keeping requirements.
- **Customer trust**: Rounding errors on invoices, payroll, or bank reconciliation erode confidence in a financial platform.

## 3. In-Scope Behavior

### 3.1 Float-to-Decimal Migration

Replace all 154 `real()` column definitions in `shared/schema.ts` with `numeric()` using these precision rules:

| Column category | Precision | Scale | Rationale |
|----------------|-----------|-------|-----------|
| Monetary amounts (subtotal, total, vatAmount, salary, price, fee, etc.) | 15 | 2 | AED has 2 decimal places; 15 digits covers trillions |
| VAT/tax rates (vatRate, taxRate, confidenceLevel) | 10 | 6 | Rates need 6 decimal places (e.g., 0.050000) |
| Quantities (quantity) | 15 | 4 | Fractional quantities (e.g., 2.5 hours) |
| Exchange rates (rate) | 10 | 6 | FX rates need 6 decimal places |
| Percentages/scores (aiConfidence, matchConfidence, conversionRate, errorRate, changePercent) | 10 | 6 | Scores/percentages with precision |

**Full column inventory by table** (154 columns):

- `journalLines`: debit, credit (2)
- `invoices`: subtotal, vatAmount, total (3)
- `invoiceLines`: quantity, unitPrice, vatRate (3)
- `receipts`: amount, vatAmount (2)
- `inventoryItems`: unitPrice, costPrice, vatRate (3)
- `inventoryTransactions`: unitCost (1)
- `bankTransactions`: aiConfidence (1)
- `walletTransactions`: amount (1)
- `reconciliationSuggestions`: matchConfidence (1)
- `cashFlowPredictions`: predictedInflow, predictedOutflow, predictedBalance, confidenceLevel (4)
- `anomalyDetections`: amount, aiConfidence (2)
- `budgets`: budgetAmount (1)
- `ecommerceTransactions`: amount, platformFees, netAmount (3)
- `kpiMetrics`: value, previousValue, changePercent, benchmark (4)
- `referralPrograms`: referrerRewardValue, refereeRewardValue, totalRewardsEarned (3)
- `referralCodes`: referrerRewardAmount, refereeRewardAmount (2)
- `customFields`: value (1)
- `featureAnalytics`: avgDuration, conversionRate, errorRate (3)
- `plans`: priceMonthly, priceYearly (2)
- `vatReturns`: 46 box fields (box1a through box14) + adjustmentAmount + paymentAmount (48)
- `corporateTaxReturns`: totalRevenue, totalExpenses, totalDeductions, taxableIncome, exemptionThreshold, taxRate, taxPayable (7)
- `complianceCalendarItems`: taxAmount (1)
- `recurringInvoices`: monthlyFee (1)
- `quotes`: subtotal, vatAmount, total, paidAmount (4)
- `quoteLines`: quantity, unitPrice, vatRate, amount (4)
- `creditNotes`: subtotal, vatAmount, total (3)
- `creditNoteLines`: quantity, unitPrice, vatRate (3)
- `purchaseOrders`: subtotal, vatAmount, total (3)
- `purchaseOrderLines`: quantity, unitPrice, vatRate (3)
- `invoiceTemplates`: (none — no real columns)
- `exchangeRates`: rate (1)
- `employees`: basicSalary, housingAllowance, transportAllowance, otherAllowances (4)
- `payrollRuns`: totalBasicSalary, totalAllowances, totalDeductions, totalNetPay (4)
- `payrollEntries`: basicSalary, housingAllowance, transportAllowance, otherAllowances, deductions, netPay (6)
- `fixedAssets`: purchasePrice, residualValue, disposalPrice (3)
- `depreciationSchedules`: depreciationAmount, accumulatedDepreciation, bookValue (3)

**Total: 154 columns**

### 3.2 Unique Constraints

Add these 9 composite unique constraints:

| Table | Columns | Constraint Name |
|-------|---------|----------------|
| `invoices` | (companyId, number) | `invoices_company_number_unique` |
| `quotes` | (companyId, number) | `quotes_company_number_unique` |
| `creditNotes` | (companyId, number) | `credit_notes_company_number_unique` |
| `purchaseOrders` | (companyId, number) | `purchase_orders_company_number_unique` |
| `employees` | (companyId, employeeNumber) | `employees_company_number_unique` |
| `costCenters` | (companyId, code) | `cost_centers_company_code_unique` |
| `fixedAssets` | (companyId, assetCode) | `fixed_assets_company_code_unique` |
| `companyUsers` | (companyId, userId) | `company_users_company_user_unique` |
| `subscriptions` | (companyId) | `subscriptions_company_unique` |

### 3.3 Race Condition Fix

`generateEntryNumber()` in `server/storage.ts` (lines 1073-1090) must be wrapped in a serializable transaction or use PostgreSQL advisory locks to guarantee unique entry numbers under concurrent requests.

Current vulnerable pattern:
```
SELECT count(*) → compute next number → return
```
Two concurrent requests can get the same count and generate the same entry number.

### 3.4 Receipts Date Type Fix

Change `receipts.date` from `text("date")` (line 311 of schema.ts) to `timestamp("date")` to enable proper date comparison, sorting, and indexing.

## 4. Out-of-Scope / Non-Goals

- **Data migration scripts**: This contract covers schema definition changes only. Actual data migration of existing production rows is a deployment concern handled separately.
- **Application code changes for numeric handling**: Routes and services that read/write these columns do not need explicit `Number()` or `parseFloat()` changes — Drizzle ORM handles `numeric` ↔ `string` conversion, and existing `Number()` casts in route handlers are sufficient.
- **Index creation**: Adding indexes for performance is deferred to Phase 4.
- **FK constraint additions**: Missing foreign keys are Phase 2.
- **Transaction wrapping for multi-table writes**: Phase 2 (except `generateEntryNumber` which is in scope).
- **Changing column names or removing columns**.
- **Modifying Zod insert schemas**: Zod schemas are auto-derived from Drizzle table definitions via `createInsertSchema()` and will update automatically.
- **Frontend changes**: No UI changes required — all values pass through JSON as numbers/strings.

## 5. Inputs

- `shared/schema.ts` — source of truth for all 77+ table definitions
- `server/storage.ts` — contains `generateEntryNumber()` implementation
- Drizzle ORM `numeric()` function from `drizzle-orm/pg-core` (confirmed available with `{ precision: number, scale: number }` config)
- Existing `unique` import in schema.ts (already present)

## 6. Outputs

- **Modified `shared/schema.ts`**:
  - New import: `numeric` from `drizzle-orm/pg-core`
  - 154 column definitions changed from `real()` to `numeric()` with appropriate precision/scale
  - 9 new unique constraints added to table definitions
  - `receipts.date` changed from `text("date")` to `timestamp("date")`

- **Modified `server/storage.ts`**:
  - `generateEntryNumber()` wrapped in serializable transaction with retry logic

- **Zero new TypeScript compilation errors**: `npm run build` must pass with 0 errors after changes.

## 7. Constraints

### 7.1 Technical Constraints
- **Drizzle ORM**: Must use Drizzle's `numeric(name, { precision, scale })` syntax — NOT raw SQL
- **PostgreSQL**: Target is PostgreSQL (via Neon/Railway). `numeric` is a native PG type with exact arithmetic.
- **Drizzle Push**: Schema changes are applied via `npm run db:push` (Drizzle Kit). No manual SQL migration files.
- **TypeScript strict mode**: All changes must compile under the project's TypeScript config.
- **Drizzle `numeric` returns strings**: In JavaScript, `numeric` columns are returned as strings by the PG driver. Existing `Number()` casts in route handlers handle this. No additional conversion code needed.

### 7.2 Style Constraints
- Follow existing naming convention: `camelCase` for JS property names, `snake_case` for DB column names
- Unique constraint names follow pattern: `{table}_{descriptive}_unique`
- No new files created for this phase

### 7.3 Rollout Constraints
- All changes in a single commit on the existing branch `claude/epic-varahamihira`
- `drizzle-orm/pg-core` `numeric` import added alongside existing imports on line 1

## 8. Invariants

1. **Column count invariant**: After migration, the total number of table columns must remain identical — no columns added or removed.
2. **Default value invariant**: All existing `.default()` values must be preserved (e.g., `default(0)`, `default(0.05)`, `default(375000)`).
3. **Nullability invariant**: All existing `.notNull()` constraints must be preserved.
4. **Foreign key invariant**: All existing `.references()` must remain unchanged.
5. **Cascade invariant**: All existing `onDelete: "cascade"` must remain unchanged.
6. **Insert schema invariant**: All `createInsertSchema()` calls must continue to compile and produce valid Zod schemas.
7. **Type export invariant**: All `$inferSelect` and `$inferInsert` type exports must remain valid.
8. **Unique constraint on `accounts(companyId, code)`** named `companyCodeUnique` must remain unchanged.
9. **Entry number format invariant**: `JE-YYYYMMDD-NNN` format must be preserved.

## 9. Edge Cases

### 9.1 Numeric Precision
- Values exceeding `numeric(15,2)` capacity (> 9,999,999,999,999.99) — PostgreSQL will reject the insert. Acceptable behavior for an accounting app (no valid transaction exceeds 10 trillion AED).
- Negative values — `numeric` handles negatives correctly. No special handling needed.
- Zero values — `numeric(15,2)` stores `0.00` correctly. Default values of `0` will be stored as `0.00`.

### 9.2 Unique Constraints
- **Existing duplicate data**: If production DB already has duplicate (companyId, number) pairs, `db:push` will fail. This is a deployment concern — duplicates must be resolved before applying the constraint. The task contract only covers the schema definition.
- **NULL values in unique columns**: PostgreSQL treats NULLs as distinct in unique constraints. `employees.employeeNumber` or `fixedAssets.assetCode` could be NULL — two rows with NULL are allowed. Acceptable behavior.
- **`subscriptions.companyId` single-column unique**: This prevents a company from having multiple active subscriptions. Correct business rule.

### 9.3 Race Condition
- **Serializable transaction retry**: PostgreSQL serializable transactions can throw `40001` (serialization failure). The implementation must catch and retry.
- **Advisory lock scope**: If using advisory locks, the lock key must be scoped to `companyId` to avoid cross-company blocking.
- **Concurrent requests across different companies**: Must NOT block each other.

### 9.4 Receipts Date Migration
- **Existing text dates in DB**: Existing rows have dates as text strings (e.g., "2024-01-15"). Drizzle `db:push` with `ALTER COLUMN ... TYPE timestamp USING date::timestamp` would handle conversion, but Drizzle Kit may or may not auto-generate the `USING` clause. Deployment may need manual intervention.
- **NULL dates**: `receipts.date` is nullable in current schema. Must remain nullable after type change.

## 10. Risks

1. **Drizzle Kit `db:push` behavior with type changes**: Changing `real` → `numeric` on 154 columns may cause Drizzle Kit to drop and recreate columns instead of `ALTER COLUMN TYPE`. This would lose data in production. **Mitigation**: Test `db:push` on a staging database first; if destructive, use manual `ALTER TABLE` SQL.

2. **String vs Number in application code**: `numeric` columns return strings from PostgreSQL. Most route handlers already wrap values in `Number()`. Any handler that doesn't may return `"123.45"` instead of `123.45` in JSON. **Mitigation**: Drizzle ORM actually handles numeric → number conversion. Existing `Number()` casts provide defense-in-depth.

3. **Serializable transaction overhead**: Adding a transaction to `generateEntryNumber` adds ~2-5ms latency per journal entry creation. **Mitigation**: Negligible for a SaaS app. Advisory locks would be even lighter.

4. **Unique constraint violations on existing data**: If any duplicates exist in production, `db:push` will fail. **Mitigation**: Run dedup queries before applying constraints. Out of scope for this contract but noted as deployment risk.

## 11. Acceptance Criteria

1. **AC-1**: All 154 `real()` calls in `shared/schema.ts` are replaced with `numeric()` calls with explicit `{ precision, scale }` configuration.
2. **AC-2**: No `real()` calls remain in `shared/schema.ts` (verified by grep).
3. **AC-3**: Monetary columns use `numeric(15, 2)`, rate/percentage/score columns use `numeric(10, 6)`, quantity columns use `numeric(15, 4)`.
4. **AC-4**: All 9 unique constraints are defined in the table definitions using Drizzle's `unique()` function.
5. **AC-5**: `generateEntryNumber()` is wrapped in a serializable transaction or uses advisory locks, with retry logic for serialization failures.
6. **AC-6**: `receipts.date` is defined as `timestamp("date")` instead of `text("date")`.
7. **AC-7**: `npm run build` (TypeScript compilation) passes with 0 errors.
8. **AC-8**: All existing `.default()`, `.notNull()`, `.references()`, and cascade behaviors are preserved on every modified column.
9. **AC-9**: The `numeric` import is added to the import statement on line 1 of `shared/schema.ts`.
10. **AC-10**: No new files are created.
11. **AC-11**: All insert schemas (`createInsertSchema`) continue to produce valid Zod schemas (verified by successful `npm run build`).
12. **AC-12**: `generateEntryNumber()` concurrent calls for the same company+date produce unique, sequential entry numbers (no duplicates).

## 12. Observability Requirements

- **Console log on retry**: If `generateEntryNumber` retries due to serialization failure, log: `[JournalEntry] Serialization retry for company: {companyId}`
- **No other logging changes**: The type migration and unique constraints are transparent to application logging.

## 13. Open Questions

None. All requirements are fully specified.

## 14. Codebase Context Snapshot

### Affected Modules and Files
| File | Changes |
|------|---------|
| `shared/schema.ts` (~2540 lines) | 154 column type changes, 9 unique constraints, 1 date type fix, 1 new import |
| `server/storage.ts` (~3650 lines) | 1 method rewrite (generateEntryNumber, lines 1073-1090) |

### Existing Patterns in Affected Areas
- Column definitions follow `propertyName: type("db_column_name").modifiers()` pattern
- Unique constraints use `(t) => [unique("name").on(t.col1, t.col2)]` in 3rd argument of `pgTable()`
- Only one existing composite unique: `accounts` table has `companyCodeUnique` on `(companyId, code)`
- `unique` is already imported from `drizzle-orm/pg-core`
- `numeric` is NOT currently imported but IS available from `drizzle-orm/pg-core`

### Pre-existing Tech Debt / Fragile Areas
- `generateEntryNumber` is called from multiple route handlers including bulk operations — race condition risk is real, not theoretical
- Some tables have deeply nested relationships (invoices → invoiceLines, quotes → quoteLines) but cascade deletes handle this
- VAT return table has 48 monetary columns — highest density of `real()` columns in a single table

### Current Test Coverage Baseline
- 2 test files exist: `tests/unit/env.test.ts`, `tests/unit/middleware.test.ts`
- No integration tests
- No schema-level tests
- No test framework config (jest/vitest) found at project root

### Relevant Dependency State
- `drizzle-orm`: installed (version in node_modules, provides `numeric` function)
- `drizzle-kit`: installed (provides `db:push` command)
- `@neondatabase/serverless`: installed (PostgreSQL driver)
- No migration files — project uses `db:push` exclusively

## 15. Contract Version

**v1** — 2026-04-04

## 16. Readiness Decision

**READY FOR DESIGN**
