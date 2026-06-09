# VAT-201 Import of Goods (Box 6 / Box 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-compute VAT-201 Box 6 (imports) and Box 7 (import adjustments) on autopilot returns from purchases flagged as imports, with the recoverable portion reclaimed via Box 10 (net-neutral for recoverable importers).

**Architecture:** Mirror the existing reverse-charge mechanism in `server/services/vat-autopilot.service.ts`: flagged transactions add VAT to the due side (Box 6/7 instead of Box 3) and the partial-exemption-recoverable portion to Box 10. Imports are excluded from the Box 9 standard-expense pool. A document-level `vat_import_role` plus explicit customs-value override fields are added to `receipts` (Drizzle) and `vendor_bills` (raw SQL).

**Tech Stack:** TypeScript, Express, Drizzle ORM, Postgres (node pg pool for raw queries), Vitest, React (client forms).

**Spec:** `docs/superpowers/specs/2026-06-09-vat-import-of-goods-design.md`

**Working dir:** worktree `~/.config/superpowers/worktrees/NR-Ai/fix-audit-remaining-issues` (branch `fix/audit-remaining-issues`).

---

## File Structure

- `migrations/0062_vat_import_of_goods.sql` — **create**: add import columns to `vendor_bills` + `receipts`, partial indexes.
- `shared/schema.ts` — **modify**: add import columns to the `receipts` pgTable (so Drizzle + `drizzle-kit generate` know them).
- `server/services/vat-autopilot.service.ts` — **modify**: extend `Vat201BoxValues`, `VAT201_BOX_KEYS`, `buildVat201Boxes` (Box 6/7 due + Box 10 recovery), and `calculateVatReturn` (query + aggregate imports, exclude from Box 9).
- `server/routes/vat.routes.ts` — **modify**: remove hardcoded `box6*/box7*` zeros from `buildVatReturnPayload`.
- `server/routes/receipts.routes.ts` — **modify**: accept/validate import fields on create + update.
- `server/routes/bill-pay.routes.ts` — **modify**: accept import fields on vendor-bill create + update.
- `tests/unit/vat-import-of-goods.test.ts` — **create**: box-math + aggregation tests.
- `tests/unit/vat-import-capture.test.ts` — **create**: receipts + vendor-bill capture round-trip tests.
- Client bill + receipt forms — **modify** (Task 8): import-role control + override fields.

---

## Task 1: Migration + schema for import fields

**Files:**
- Create: `migrations/0062_vat_import_of_goods.sql`
- Modify: `shared/schema.ts` (receipts pgTable, after the `reverseCharge` column ~line 773)

- [ ] **Step 1: Write the migration SQL** (mirrors `migrations/0032_reverse_charge_vat.sql`)

Create `migrations/0062_vat_import_of_goods.sql`:

```sql
-- VAT-201 Import of Goods (Box 6 / Box 7)
-- Flagged purchases declare import VAT as DUE (Box 6 imports, Box 7 adjustments)
-- and recover the recoverable portion via Box 10. Excluded from Box 9 standard
-- expenses. Customs import value can exceed the supplier subtotal (customs value
-- + insurance + freight + duty + excise), so explicit AED override fields are
-- provided; they default to subtotal/vat_amount when null.

ALTER TABLE "vendor_bills"
  ADD COLUMN IF NOT EXISTS "vat_import_role" text,
  ADD COLUMN IF NOT EXISTS "import_taxable_amount_aed" numeric(15,2),
  ADD COLUMN IF NOT EXISTS "import_vat_amount_aed" numeric(15,2),
  ADD COLUMN IF NOT EXISTS "customs_declaration_number" text,
  ADD COLUMN IF NOT EXISTS "import_date" timestamp,
  ADD COLUMN IF NOT EXISTS "import_evidence_url" text,
  ADD COLUMN IF NOT EXISTS "import_adjustment_reason" text;

ALTER TABLE "receipts"
  ADD COLUMN IF NOT EXISTS "vat_import_role" text,
  ADD COLUMN IF NOT EXISTS "import_taxable_amount_aed" numeric(15,2),
  ADD COLUMN IF NOT EXISTS "import_vat_amount_aed" numeric(15,2),
  ADD COLUMN IF NOT EXISTS "customs_declaration_number" text,
  ADD COLUMN IF NOT EXISTS "import_date" timestamp,
  ADD COLUMN IF NOT EXISTS "import_evidence_url" text,
  ADD COLUMN IF NOT EXISTS "import_adjustment_reason" text;

CREATE INDEX IF NOT EXISTS "idx_vendor_bills_vat_import_role"
  ON "vendor_bills"("company_id", "vat_import_role")
  WHERE "vat_import_role" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_receipts_vat_import_role"
  ON "receipts"("company_id", "vat_import_role")
  WHERE "vat_import_role" IS NOT NULL;
```

- [ ] **Step 2: Add columns to the Drizzle `receipts` table**

In `shared/schema.ts`, inside the `receipts` pgTable, immediately after the `reverseCharge` line (`reverseCharge: boolean("reverse_charge")...`), add:

```ts
  // VAT-201 Import of Goods (Box 6/7). Document-level role: when set, the whole
  // receipt is treated as an import / import adjustment and is EXCLUDED from the
  // Box 9 standard-expense pool. Override fields default to amount/vat_amount.
  vatImportRole: text("vat_import_role"), // null | 'import' | 'import_adjustment'
  importTaxableAmountAed: money("import_taxable_amount_aed"),
  importVatAmountAed: money("import_vat_amount_aed"),
  customsDeclarationNumber: text("customs_declaration_number"),
  importDate: timestamp("import_date"),
  importEvidenceUrl: text("import_evidence_url"),
  importAdjustmentReason: text("import_adjustment_reason"),
```

(`text`, `money`, `timestamp` are already imported in this file.)

- [ ] **Step 3: Register the migration in the journal**

Run drizzle-kit generate so the receipts column change is captured and the journal updated, then confirm `0062` is consistent:

Run: `npm run db:generate`
Expected: a new generated migration referencing the receipts columns; `migrations/meta/_journal.json` gains an entry.

If `db:generate` produces a *separate* numbered file for the receipts columns, keep BOTH (the generated one for receipts; the hand-written `0062` adds the `vendor_bills` columns + indexes which Drizzle doesn't manage). If it renumbers, ensure the hand-written vendor_bills SQL still applies. Then:

Run: `npm run check:migrations`
Expected: `check-migrations-no-secrets: OK`

- [ ] **Step 4: Typecheck**

Run: `npm run check`
Expected: PASS (tsc clean; the new schema fields are typed).

- [ ] **Step 5: Commit**

```bash
git add migrations/ shared/schema.ts
git commit -m "feat(vat): add import-of-goods columns to receipts + vendor_bills"
```

---

## Task 2: Box 6/7 due + Box 10 recovery in `buildVat201Boxes`

**Files:**
- Modify: `server/services/vat-autopilot.service.ts` (`Vat201BoxValues` ~85-104, `VAT201_BOX_KEYS` ~519-537, `buildVat201Boxes` ~373-470)
- Test: `tests/unit/vat-import-of-goods.test.ts` (create)

- [ ] **Step 1: Write the failing box-math tests**

Create `tests/unit/vat-import-of-goods.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildVat201Boxes } from '../../server/services/vat-autopilot.service';

// Zero baseline of the non-import components buildVat201Boxes expects.
const ZERO = {
  standardRatedAmount: 0, standardRatedVat: 0,
  zeroRatedAmount: 0, exemptAmount: 0,
  reverseChargeAmount: 0, reverseChargeVat: 0, reverseChargeVatRecoverable: 0,
  totalExpenses: 0, inputVatRecoverable: 0,
  importsAmount: 0, importsVat: 0,
  importAdjAmount: 0, importAdjVat: 0,
  importsVatRecoverable: 0,
};

describe('buildVat201Boxes — imports', () => {
  it('books an import to Box 6 due AND Box 10 recovery (not Box 9)', () => {
    const b = buildVat201Boxes(
      { ...ZERO, importsAmount: 1000, importsVat: 50, importsVatRecoverable: 50 },
      'dubai',
    );
    expect(b.box6ImportsAmount).toBe(1000);
    expect(b.box6ImportsVat).toBe(50);
    expect(b.box9ExpensesVat).toBe(0); // imports never touch Box 9
    expect(b.box10ReverseChargeVat).toBe(50); // recovery via Box 10
    expect(b.box8TotalVat).toBe(50); // due side
    expect(b.box13RecoverableTax).toBe(50); // recoverable side
  });

  it('fully-recoverable import nets to zero in Box 14', () => {
    const b = buildVat201Boxes(
      { ...ZERO, importsAmount: 1000, importsVat: 50, importsVatRecoverable: 50 },
      'dubai',
    );
    expect(b.box14PayableTax).toBe(0);
  });

  it('partial-exemption import leaves the non-recoverable VAT payable', () => {
    // 50 due, only 30 recoverable -> 20 payable
    const b = buildVat201Boxes(
      { ...ZERO, importsAmount: 1000, importsVat: 50, importsVatRecoverable: 30 },
      'dubai',
    );
    expect(b.box12TotalDueTax).toBe(50);
    expect(b.box13RecoverableTax).toBe(30);
    expect(b.box14PayableTax).toBe(20);
  });

  it('books an import adjustment to Box 7 + Box 10 recovery', () => {
    const b = buildVat201Boxes(
      { ...ZERO, importAdjAmount: 200, importAdjVat: 10, importsVatRecoverable: 10 },
      'dubai',
    );
    expect(b.box7ImportsAdjAmount).toBe(200);
    expect(b.box7ImportsAdjVat).toBe(10);
    expect(b.box10ReverseChargeVat).toBe(10);
    expect(b.box14PayableTax).toBe(0);
  });

  it('supports a negative Box 7 adjustment (downward correction)', () => {
    const b = buildVat201Boxes(
      { ...ZERO, importAdjAmount: -200, importAdjVat: -10, importsVatRecoverable: -10 },
      'dubai',
    );
    expect(b.box7ImportsAdjVat).toBe(-10);
    expect(b.box8TotalVat).toBe(-10);
    expect(b.box13RecoverableTax).toBe(-10);
    expect(b.box14PayableTax).toBe(0);
  });

  it('keeps reverse-charge isolated from imports (no double count)', () => {
    const b = buildVat201Boxes(
      {
        ...ZERO,
        reverseChargeAmount: 500, reverseChargeVat: 25, reverseChargeVatRecoverable: 25,
        importsAmount: 1000, importsVat: 50, importsVatRecoverable: 50,
      },
      'dubai',
    );
    expect(b.box3ReverseChargeVat).toBe(25);
    expect(b.box6ImportsVat).toBe(50);
    expect(b.box8TotalVat).toBe(75); // 25 RC + 50 import
    expect(b.box10ReverseChargeVat).toBe(75); // 25 RC + 50 import recovery
    expect(b.box14PayableTax).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/vat-import-of-goods.test.ts`
Expected: FAIL — `box6ImportsAmount`/`box7ImportsAdjAmount` are `undefined` and the `imports*` component fields are unknown to `buildVat201Boxes`.

- [ ] **Step 3: Extend `Vat201BoxValues`**

In `server/services/vat-autopilot.service.ts`, in the `Vat201BoxValues` interface, after the `box5ExemptAmount: number;` line add:

```ts
  box6ImportsAmount: number; box6ImportsVat: number;
  box7ImportsAdjAmount: number; box7ImportsAdjVat: number;
```

- [ ] **Step 4: Extend `VAT201_BOX_KEYS`**

In the `VAT201_BOX_KEYS` array, after `'box5ExemptAmount',` add:

```ts
  'box6ImportsAmount', 'box6ImportsVat',
  'box7ImportsAdjAmount', 'box7ImportsAdjVat',
```

- [ ] **Step 5: Extend `buildVat201Boxes` signature + body**

In `buildVat201Boxes`, add these fields to the `components` parameter type (after `inputVatRecoverable: number;`):

```ts
    importsAmount: number;
    importsVat: number;
    importAdjAmount: number;
    importAdjVat: number;
    importsVatRecoverable: number;
```

In the `boxes` object initializer, after `box5ExemptAmount: round2(components.exemptAmount),` add:

```ts
    box6ImportsAmount: round2(components.importsAmount),
    box6ImportsVat: round2(components.importsVat),
    box7ImportsAdjAmount: round2(components.importAdjAmount),
    box7ImportsAdjVat: round2(components.importAdjVat),
```

Change the Box 10 initializers to fold in import recovery:

```ts
    box10ReverseChargeAmount: round2(components.reverseChargeAmount + components.importsAmount + components.importAdjAmount),
    box10ReverseChargeVat: round2(components.reverseChargeVatRecoverable + components.importsVatRecoverable),
```

Replace the totals block (currently lines ~462-468) with:

```ts
  // Box 8 totals output side; Box 11 totals input side; Boxes 12-14 net it out.
  // Imports/adjustments are DUE in Box 6/7 and recovered (recoverable portion)
  // via Box 10 — never via Box 9.
  boxes.box8TotalAmount = round2(stdAmt + components.zeroRatedAmount + components.exemptAmount + components.reverseChargeAmount + components.importsAmount + components.importAdjAmount);
  boxes.box8TotalVat = round2(stdVat + components.reverseChargeVat + components.importsVat + components.importAdjVat);
  boxes.box11TotalAmount = round2(components.totalExpenses + components.reverseChargeAmount + components.importsAmount + components.importAdjAmount);
  boxes.box11TotalVat = round2(components.inputVatRecoverable + components.reverseChargeVatRecoverable + components.importsVatRecoverable);
  boxes.box12TotalDueTax = boxes.box8TotalVat;
  boxes.box13RecoverableTax = boxes.box11TotalVat;
  boxes.box14PayableTax = round2(boxes.box12TotalDueTax - boxes.box13RecoverableTax);
  return boxes;
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/vat-import-of-goods.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Run the existing VAT suite (no regressions)**

Run: `npx vitest run tests/unit/vat-autopilot.test.ts`
Expected: PASS (all existing cases; any test that constructs `buildVat201Boxes` components directly may need the new zero fields — if a test fails for a missing `imports*` field, that's a test that calls `buildVat201Boxes` directly; update its component literal to include the five new zero fields).

- [ ] **Step 8: Commit**

```bash
git add server/services/vat-autopilot.service.ts tests/unit/vat-import-of-goods.test.ts
git commit -m "feat(vat): Box 6/7 imports due + Box 10 recovery in buildVat201Boxes"
```

---

## Task 3: Aggregate flagged imports in `calculateVatReturn`

**Files:**
- Modify: `server/services/vat-autopilot.service.ts` (receipt query ~671-707; bill query ~714-730; partial-exemption ~735-739; `buildVat201Boxes` call ~787-801)
- Test: `tests/unit/vat-import-of-goods.test.ts` (add aggregation cases — but these need a DB; keep them as box-math via a small exported helper, see Step 1)

- [ ] **Step 1: Extract a pure aggregation helper (for testability without a DB)**

In `server/services/vat-autopilot.service.ts`, add an exported pure helper that classifies one purchase row. Place it near `buildVat201Boxes`:

```ts
export type ImportAccumulator = {
  importsAmount: number; importsVat: number;
  importAdjAmount: number; importAdjVat: number;
};

/**
 * Resolve the import taxable/VAT for a flagged purchase. Customs import value can
 * exceed the supplier subtotal, so explicit AED overrides win; otherwise fall
 * back to the document's own taxable/VAT (already AED-converted by the caller).
 */
export function accumulateImportRow(
  acc: ImportAccumulator,
  row: {
    vatImportRole: string | null;
    fallbackAmountAed: number;
    fallbackVatAed: number;
    importTaxableAmountAed: number | null;
    importVatAmountAed: number | null;
  },
): void {
  if (row.vatImportRole !== 'import' && row.vatImportRole !== 'import_adjustment') return;
  const amount = row.importTaxableAmountAed ?? row.fallbackAmountAed;
  const vat = row.importVatAmountAed ?? row.fallbackVatAed;
  if (row.vatImportRole === 'import') {
    acc.importsAmount = round2(acc.importsAmount + amount);
    acc.importsVat = round2(acc.importsVat + vat);
  } else {
    acc.importAdjAmount = round2(acc.importAdjAmount + amount);
    acc.importAdjVat = round2(acc.importAdjVat + vat);
  }
}
```

Add to `tests/unit/vat-import-of-goods.test.ts`:

```ts
import { accumulateImportRow, type ImportAccumulator } from '../../server/services/vat-autopilot.service';

describe('accumulateImportRow', () => {
  const fresh = (): ImportAccumulator => ({ importsAmount: 0, importsVat: 0, importAdjAmount: 0, importAdjVat: 0 });

  it('ignores rows that are not flagged as imports', () => {
    const acc = fresh();
    accumulateImportRow(acc, { vatImportRole: null, fallbackAmountAed: 100, fallbackVatAed: 5, importTaxableAmountAed: null, importVatAmountAed: null });
    expect(acc).toEqual(fresh());
  });

  it('uses the customs override when present (differs from subtotal)', () => {
    const acc = fresh();
    // supplier subtotal 1000/50, but customs value (incl. freight+duty) is 1200/60
    accumulateImportRow(acc, { vatImportRole: 'import', fallbackAmountAed: 1000, fallbackVatAed: 50, importTaxableAmountAed: 1200, importVatAmountAed: 60 });
    expect(acc.importsAmount).toBe(1200);
    expect(acc.importsVat).toBe(60);
  });

  it('falls back to document subtotal/vat when no override', () => {
    const acc = fresh();
    accumulateImportRow(acc, { vatImportRole: 'import', fallbackAmountAed: 1000, fallbackVatAed: 50, importTaxableAmountAed: null, importVatAmountAed: null });
    expect(acc.importsAmount).toBe(1000);
    expect(acc.importsVat).toBe(50);
  });

  it('routes import_adjustment (incl. negative) to the adjustment buckets', () => {
    const acc = fresh();
    accumulateImportRow(acc, { vatImportRole: 'import_adjustment', fallbackAmountAed: -200, fallbackVatAed: -10, importTaxableAmountAed: null, importVatAmountAed: null });
    expect(acc.importAdjAmount).toBe(-200);
    expect(acc.importAdjVat).toBe(-10);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/vat-import-of-goods.test.ts`
Expected: FAIL — `accumulateImportRow` not exported yet.

- [ ] **Step 3: Add the helper (code in Step 1) and re-run**

Run: `npx vitest run tests/unit/vat-import-of-goods.test.ts`
Expected: PASS (10 tests total).

- [ ] **Step 4: Wire the helper into the receipt query loop**

In `calculateVatReturn`, change the receipt SELECT (currently ~672-683) to also select the import columns:

```ts
  const receiptRes = await pool.query(
    `SELECT id,
            COALESCE(amount, 0)::numeric AS amount,
            COALESCE(vat_amount, 0)::numeric AS vat_amount,
            reverse_charge,
            vat_import_role,
            import_taxable_amount_aed,
            import_vat_amount_aed,
            currency,
            COALESCE(exchange_rate, 1)::numeric AS exchange_rate
     FROM receipts
     WHERE company_id = $1
       AND posted = true
       AND COALESCE(date, created_at) >= $2
       AND COALESCE(date, created_at) <= $3`,
    [companyId, resolvedPeriod.start, resolvedPeriod.end],
  );
```

Declare an accumulator before the loop:

```ts
  const importAcc: ImportAccumulator = { importsAmount: 0, importsVat: 0, importAdjAmount: 0, importAdjVat: 0 };
```

Inside the receipt loop, change the classification so imports are handled FIRST and excluded from the expense pool:

```ts
    const aedAmount = currency === 'AED' ? amount : convertToAed(amount, rate);
    const aedVat = currency === 'AED' ? vat : convertToAed(vat, rate);
    const importRole = (row.vat_import_role as string | null) ?? null;
    if (importRole === 'import' || importRole === 'import_adjustment') {
      accumulateImportRow(importAcc, {
        vatImportRole: importRole,
        fallbackAmountAed: aedAmount,
        fallbackVatAed: aedVat,
        importTaxableAmountAed: row.import_taxable_amount_aed == null ? null : Number(row.import_taxable_amount_aed),
        importVatAmountAed: row.import_vat_amount_aed == null ? null : Number(row.import_vat_amount_aed),
      });
    } else if (row.reverse_charge) {
      receiptReverseChargeAmount += aedAmount;
      receiptReverseChargeVat += aedVat;
    } else {
      totalExpenses += aedAmount;
      inputVatGross += aedVat;
    }
```

- [ ] **Step 5: Add a vendor_bills import query**

After the reverse-charge bill query block (after ~730), add an analogous import-bill query (wrapped in the same `42P01` try/catch). Imports use the override columns with subtotal/vat_amount fallback, and are summed by role in SQL:

```ts
  try {
    const importBillRes = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN vat_import_role = 'import'
           THEN COALESCE(import_taxable_amount_aed, subtotal) ELSE 0 END), 0) AS import_amount,
         COALESCE(SUM(CASE WHEN vat_import_role = 'import'
           THEN COALESCE(import_vat_amount_aed, vat_amount) ELSE 0 END), 0) AS import_vat,
         COALESCE(SUM(CASE WHEN vat_import_role = 'import_adjustment'
           THEN COALESCE(import_taxable_amount_aed, subtotal) ELSE 0 END), 0) AS adj_amount,
         COALESCE(SUM(CASE WHEN vat_import_role = 'import_adjustment'
           THEN COALESCE(import_vat_amount_aed, vat_amount) ELSE 0 END), 0) AS adj_vat
       FROM vendor_bills
       WHERE company_id = $1
         AND vat_import_role IN ('import', 'import_adjustment')
         AND bill_date >= $2 AND bill_date <= $3
         AND status NOT IN ('void','cancelled','draft')`,
      [companyId, resolvedPeriod.start, resolvedPeriod.end],
    );
    const r = importBillRes.rows[0] || {};
    importAcc.importsAmount = round2(importAcc.importsAmount + Number(r.import_amount || 0));
    importAcc.importsVat = round2(importAcc.importsVat + Number(r.import_vat || 0));
    importAcc.importAdjAmount = round2(importAcc.importAdjAmount + Number(r.adj_amount || 0));
    importAcc.importAdjVat = round2(importAcc.importAdjVat + Number(r.adj_vat || 0));
  } catch (err) {
    if ((err as { code?: string })?.code !== '42P01') throw err;
  }
```

(Note: vendor_bills in this codebase do not feed Box 9 today, so excluding imports from Box 9 needs no change on the bill side — they only feed the import buckets here.)

- [ ] **Step 6: Apply partial-exemption to import VAT and pass components**

After the existing `reverseChargePartial` line (~736) add:

```ts
  const importVatTotal = round2(importAcc.importsVat + importAcc.importAdjVat);
  const importPartial = applyPartialExemption(importVatTotal, company.exemptSupplyRatio);
```

In the `buildVat201Boxes({...})` call (~788-799), add the five import component fields:

```ts
      importsAmount: round2(importAcc.importsAmount),
      importsVat: round2(importAcc.importsVat),
      importAdjAmount: round2(importAcc.importAdjAmount),
      importAdjVat: round2(importAcc.importAdjVat),
      importsVatRecoverable: importPartial.recoverable,
```

Also fold the import figures into the `boxes` breakdown totals so reconciliation/`totalOutputVat`/`totalInputVat` stay correct. Change (lines ~738-739):

```ts
  const totalOutputVat = round2(sales.standardRatedVat + reverseChargeVat + importVatTotal);
  const totalInputVat = round2(partialExemption.recoverable + reverseChargePartial.recoverable + importPartial.recoverable);
```

- [ ] **Step 7: Typecheck + full VAT suite**

Run: `npm run check && npx vitest run tests/unit/vat-import-of-goods.test.ts tests/unit/vat-autopilot.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/services/vat-autopilot.service.ts tests/unit/vat-import-of-goods.test.ts
git commit -m "feat(vat): aggregate flagged imports into Box 6/7 + Box 10 in calculateVatReturn"
```

---

## Task 4: Un-hardcode Box 6/7 in the persisted payload

**Files:**
- Modify: `server/routes/vat.routes.ts` (`buildVatReturnPayload` ~16-58)

- [ ] **Step 1: Remove the hardcoded import zeros**

In `buildVatReturnPayload`, delete these four lines so the computed values from `...vat201` flow through (keep `box2TouristRefund*` zeros — out of scope):

```ts
    box6ImportsAmount: 0,
    box6ImportsVat: 0,
    box7ImportsAdjAmount: 0,
    box7ImportsAdjVat: 0,
```

- [ ] **Step 2: Typecheck**

Run: `npm run check`
Expected: PASS (the `...vat201` spread now supplies box6/box7; `InsertVatReturn` already has these columns).

- [ ] **Step 3: Commit**

```bash
git add server/routes/vat.routes.ts
git commit -m "feat(vat): persist computed Box 6/7 instead of hardcoded zeros"
```

---

## Task 5: Capture import fields on receipts

**Files:**
- Modify: `server/routes/receipts.routes.ts` (create handler + update handler)
- Test: `tests/unit/vat-import-capture.test.ts` (create)

- [ ] **Step 1: Write the failing capture test (receipts)**

Create `tests/unit/vat-import-capture.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildReceiptImportFields, ImportValidationError } from '../../server/routes/receipts.routes';

describe('buildReceiptImportFields', () => {
  it('returns nulls when no import role is set', () => {
    expect(buildReceiptImportFields({})).toEqual({
      vatImportRole: null, importTaxableAmountAed: null, importVatAmountAed: null,
      customsDeclarationNumber: null, importDate: null, importEvidenceUrl: null, importAdjustmentReason: null,
    });
  });

  it('captures an import with customs override fields', () => {
    const out = buildReceiptImportFields({
      vatImportRole: 'import', importTaxableAmountAed: 1200, importVatAmountAed: 60,
      customsDeclarationNumber: 'CUS-123', importEvidenceUrl: 'https://x/dec.pdf',
    });
    expect(out.vatImportRole).toBe('import');
    expect(out.importTaxableAmountAed).toBe(1200);
    expect(out.importVatAmountAed).toBe(60);
    expect(out.customsDeclarationNumber).toBe('CUS-123');
  });

  it('rejects import_adjustment without a justification', () => {
    expect(() => buildReceiptImportFields({ vatImportRole: 'import_adjustment' }))
      .toThrow(ImportValidationError);
  });

  it('rejects an unknown role', () => {
    expect(() => buildReceiptImportFields({ vatImportRole: 'bogus' }))
      .toThrow(ImportValidationError);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/vat-import-capture.test.ts`
Expected: FAIL — `buildReceiptImportFields`/`ImportValidationError` not exported.

- [ ] **Step 3: Add the helper + error to `receipts.routes.ts`**

At the top of `server/routes/receipts.routes.ts` (after imports), add:

```ts
export class ImportValidationError extends Error {}

export interface ReceiptImportFields {
  vatImportRole: string | null;
  importTaxableAmountAed: number | null;
  importVatAmountAed: number | null;
  customsDeclarationNumber: string | null;
  importDate: Date | null;
  importEvidenceUrl: string | null;
  importAdjustmentReason: string | null;
}

const IMPORT_ROLES = new Set(['import', 'import_adjustment']);

export function buildReceiptImportFields(body: Record<string, any>): ReceiptImportFields {
  const role = body.vatImportRole ?? null;
  if (role === null || role === undefined) {
    return {
      vatImportRole: null, importTaxableAmountAed: null, importVatAmountAed: null,
      customsDeclarationNumber: null, importDate: null, importEvidenceUrl: null, importAdjustmentReason: null,
    };
  }
  if (!IMPORT_ROLES.has(role)) {
    throw new ImportValidationError(`Invalid vatImportRole: ${role}`);
  }
  if (role === 'import_adjustment' && !String(body.importAdjustmentReason ?? '').trim()) {
    throw new ImportValidationError('import_adjustment requires importAdjustmentReason');
  }
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
  return {
    vatImportRole: role,
    importTaxableAmountAed: num(body.importTaxableAmountAed),
    importVatAmountAed: num(body.importVatAmountAed),
    customsDeclarationNumber: body.customsDeclarationNumber ?? null,
    importDate: body.importDate ? new Date(body.importDate) : null,
    importEvidenceUrl: body.importEvidenceUrl ?? null,
    importAdjustmentReason: body.importAdjustmentReason ?? null,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/vat-import-capture.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into the receipt create + update handlers**

In the receipt **create** handler, where the receipt insert object is built, merge the import fields (wrap in try/catch to return 400 on `ImportValidationError`):

```ts
    let importFields;
    try {
      importFields = buildReceiptImportFields(req.body);
    } catch (e) {
      if (e instanceof ImportValidationError) return res.status(400).json({ message: e.message });
      throw e;
    }
    // ...spread importFields into the storage.createReceipt({...}) payload
```

In the **update** handler (the `PUT /api/receipts/:id` path already added in the audit fixes), after computing `patch = stripImmutableFields(...)`, merge the import fields the same way:

```ts
    let importFields;
    try {
      importFields = buildReceiptImportFields(req.body);
    } catch (e) {
      if (e instanceof ImportValidationError) return res.status(400).json({ message: e.message });
      throw e;
    }
    const patchWithImport = { ...patch, ...importFields };
    // pass patchWithImport to storage.updateReceipt instead of patch
```

(`createReceipt`/`updateReceipt` already persist arbitrary receipt columns via Drizzle; the new schema fields from Task 1 make these type-safe.)

- [ ] **Step 6: Typecheck + tests**

Run: `npm run check && npx vitest run tests/unit/vat-import-capture.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/routes/receipts.routes.ts tests/unit/vat-import-capture.test.ts
git commit -m "feat(vat): capture import-of-goods fields on receipts"
```

---

## Task 6: Capture import fields on vendor bills

**Files:**
- Modify: `server/routes/bill-pay.routes.ts` (create INSERT ~239-264; update handler)
- Test: `tests/unit/vat-import-capture.test.ts` (add a bill-field builder + tests)

- [ ] **Step 1: Write the failing test for the bill import-field builder**

Add to `tests/unit/vat-import-capture.test.ts`:

```ts
import { buildBillImportFields } from '../../server/routes/bill-pay.routes';

describe('buildBillImportFields', () => {
  it('defaults override amounts to null and role to null', () => {
    const f = buildBillImportFields({});
    expect(f.vatImportRole).toBeNull();
    expect(f.importTaxableAmountAed).toBeNull();
  });

  it('captures import_adjustment with reason', () => {
    const f = buildBillImportFields({ vatImportRole: 'import_adjustment', importAdjustmentReason: 'customs correction', importVatAmountAed: -10 });
    expect(f.vatImportRole).toBe('import_adjustment');
    expect(f.importVatAmountAed).toBe(-10);
    expect(f.importAdjustmentReason).toBe('customs correction');
  });

  it('rejects import_adjustment without reason', () => {
    expect(() => buildBillImportFields({ vatImportRole: 'import_adjustment' })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/vat-import-capture.test.ts`
Expected: FAIL — `buildBillImportFields` not exported.

- [ ] **Step 3: Add `buildBillImportFields` to `bill-pay.routes.ts`**

It reuses the same validation. Add near the top of `server/routes/bill-pay.routes.ts`:

```ts
import { buildReceiptImportFields, type ReceiptImportFields } from './receipts.routes';

export function buildBillImportFields(body: Record<string, any>): ReceiptImportFields {
  return buildReceiptImportFields(body);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/vat-import-capture.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into the bill create INSERT**

In the vendor-bill create handler, before the INSERT, build and validate:

```ts
    let imp;
    try {
      imp = buildBillImportFields(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
```

Extend the INSERT column list + values to include the seven import columns:

```ts
    const billResult = await pool.query(
      `INSERT INTO vendor_bills (
        company_id, vendor_name, vendor_trn, bill_number, bill_date, due_date,
        currency, subtotal, vat_amount, total_amount, amount_paid, status,
        category, notes, attachment_url, reverse_charge,
        vat_import_role, import_taxable_amount_aed, import_vat_amount_aed,
        customs_declaration_number, import_date, import_evidence_url, import_adjustment_reason
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
      RETURNING *`,
      [
        companyId, vendor_name, vendor_trn || null, bill_number || null, bill_date,
        due_date || null, currency || 'AED', subtotal.toFixed(2), vatAmount.toFixed(2),
        totalAmount.toFixed(2), '0.00', 'pending', category || null, notes || null,
        attachment_url || null, billReverseCharge,
        imp.vatImportRole,
        imp.importTaxableAmountAed == null ? null : imp.importTaxableAmountAed.toFixed(2),
        imp.importVatAmountAed == null ? null : imp.importVatAmountAed.toFixed(2),
        imp.customsDeclarationNumber, imp.importDate, imp.importEvidenceUrl, imp.importAdjustmentReason,
      ]
    );
```

If the bill **update** handler exists and allows editing VAT classification, apply the same `buildBillImportFields` + column updates there. (If there is no update handler, skip — note it in the commit message.)

- [ ] **Step 6: Typecheck + tests**

Run: `npm run check && npx vitest run tests/unit/vat-import-capture.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/routes/bill-pay.routes.ts tests/unit/vat-import-capture.test.ts
git commit -m "feat(vat): capture import-of-goods fields on vendor bills"
```

---

## Task 7: Full backend verification gate

- [ ] **Step 1: Run the whole gate**

Run: `npm run check && npm test && npm run build && npm audit --audit-level=moderate && npm run check:migrations`
Expected: tsc + contracts pass; all tests pass (532 prior + new import tests); build succeeds; 0 vulnerabilities; migrations OK.

- [ ] **Step 2: EOL hygiene for any CRLF-origin file touched**

For each file modified above that had CRLF endings in HEAD (check with `git show HEAD:<file> | grep -c $'\r$'`), run the per-line EOL restore so the diff stays whitespace-clean (pattern from the audit-fix branch). `vat-autopilot.service.ts`, `vat.routes.ts`, `receipts.routes.ts` are pure LF; check `bill-pay.routes.ts` and `shared/schema.ts`.

Run: `git diff --stat --ignore-all-space` and compare to `git diff --stat` — they should match. If a file shows churn, restore EOLs.

- [ ] **Step 3: Commit any cleanup**

```bash
git add -A && git commit -m "chore(vat): EOL hygiene + verification for import feature" --allow-empty
```

---

## Task 8: Client capture UI (bill + receipt forms)

**Files:**
- Modify: the vendor-bill create form and the receipt create/edit form (locate with `grep -rn "reverse_charge\|reverseCharge\|vendor_bills\|createReceipt\|bill_number" client/src` and find the form that POSTs to the bill/receipt create endpoints).

- [ ] **Step 1: Locate the forms**

Run: `grep -rln "bill_number\|/api/bill-pay\|vendor" client/src/pages client/src/components` and `grep -rln "receipts\|merchant" client/src/pages client/src/components`
Identify the bill-create form and the receipt-create/edit form.

- [ ] **Step 2: Add an import-role control + override fields to each form**

Add to each form's state and request body these fields (names match the API): `vatImportRole` (select: None / `import` / `import_adjustment`), and when a role is selected, show inputs for `importTaxableAmountAed`, `importVatAmountAed`, `customsDeclarationNumber`, `importDate`, `importEvidenceUrl`; when `import_adjustment`, show a required `importAdjustmentReason` and allow negative amounts. Label the control clearly: "This entire receipt/bill is an import of goods (Box 6) / import adjustment (Box 7)" — document-level treatment (per spec §7).

Mirror the styling/pattern of an existing select+conditional-fields block in the same form. Include placeholder/help text: "Import value may exceed the supplier subtotal — enter the customs-declared taxable amount and VAT."

- [ ] **Step 3: Manual verification**

Run the app (`npm run dev` per project conventions), create a vendor bill flagged `import` with a customs override, generate a VAT return for the period, and confirm Box 6 + Box 10 populate and Box 14 nets to zero for a fully-recoverable company.

- [ ] **Step 4: Commit**

```bash
git add client/src
git commit -m "feat(vat): import-of-goods capture UI on bill + receipt forms"
```

---

## Self-Review Notes (spec coverage)

- Box 10 recovery (not Box 9) — Task 2 (box10 fold) + Task 3 (partial-exemption). ✓
- Box 6 = expected/reconciliation; Box 7 signed + justification — Task 5/6 (reason required; negatives allowed) + Task 2 (negative box7 test). ✓
- Customs override fields (value ≠ subtotal) — Task 1 (columns) + Task 3 (`accumulateImportRow` override) + capture tests. ✓
- Imports excluded from Box 9 — Task 3 (receipt classification import-first; bills never feed Box 9). ✓
- Document-level + clear UI — Task 8. ✓
- All 9 required test cases — Tasks 2, 3, 5, 6 (Box 6+Box 10, net-zero, partial-exemption, Box 7, negative Box 7, excluded-from-Box-9 implicit in box-math + classification, RC isolation, override differs, capture round-trip). ✓
- Tourist refund Box 2 — explicitly out of scope. ✓
