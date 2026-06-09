# VAT-201 Import of Goods (Box 6 / Box 7) — Design Spec

**Date:** 2026-06-09
**Status:** Approved (directionally) with corrections incorporated
**Branch:** `fix/audit-remaining-issues` (worktree off `codex/audit-remediation-production`)
**Author context:** Closes the deferred audit item — Box 6/7 import boxes were hardcoded `0` in `server/routes/vat.routes.ts`. The manual VAT workpaper (`server/services/firm-vat-workspace.service.ts`) already supports `import` / `import_adjustment` categories; this brings the **autopilot** path to parity, driven by flagged transactions.

## 1. Goal

Auto-compute Box 6 (imports) and Box 7 (import adjustments) on autopilot VAT-201 returns from purchases the user flags as imports, so that:
- import VAT is declared as **due** in Box 6 / Box 7, and
- the **recoverable** portion (after partial-exemption) is reclaimed in **Box 10**,
- a fully-recoverable importer nets to **zero** in Box 14, and a partial-exemption importer pays only the **non-recoverable** portion.

The computed Box 6 is an **expected / reconciliation** figure to support the VAT workpaper and reconcile against FTA's customs-prepopulated Box 6 — it does **not** claim to replace FTA's official pre-populated value.

## 2. FTA model (corrected) — the box mechanics

UAE VAT-201 recovers VAT declared under **Boxes 3, 6, and 7 via Box 10** when recoverable. Box 9 ("Standard rated expenses") stays *normal supplier-charged standard expenses only*.

| Box | Role | Source in this feature |
|---|---|---|
| Box 6 | Imports — VAT **due** (customs-driven; FTA pre-populates the official figure) | transactions flagged `import` (our *expected* value) |
| Box 7 | Adjustments to Box 6 — for **incomplete/incorrect** customs pre-population; **signed (±)**, requires justification | transactions flagged `import_adjustment` (+ reason) |
| Box 8 | Total due tax | += Box 6 VAT + Box 7 VAT |
| Box 9 | Standard rated expenses (recoverable) | **unchanged — imports excluded** |
| Box 10 | Reverse-charge **and import** recoverable input tax | += recoverable portion of Box 6 + Box 7 VAT (partial-exemption applied) |
| Box 11 / 13 | Total / recoverable input tax | includes the Box 10 import recovery |
| Box 14 | Net payable | Box 12 − Box 13 → non-recoverable import VAT only |

**Reverse-charge is the exact template** already in `buildVat201Boxes` (due → Box 3, recovery → Box 10). Imports mirror it with due → Box 6/7 instead of Box 3.

## 3. Data model

Document-level role for MVP (see §7). Add to **`receipts`** (Drizzle `shared/schema.ts` + generated migration) **and `vendor_bills`** (hand-written SQL in the same migration, the way `migrations/0032_reverse_charge_vat.sql` added `reverse_charge`). New migration: `0062_vat_import_of_goods.sql`.

New columns on both tables:

| Column | Type | Notes |
|---|---|---|
| `vat_import_role` | `text` | `null` \| `'import'` \| `'import_adjustment'` |
| `import_taxable_amount_aed` | `numeric(15,2)` | override; **defaults to** subtotal/amount when null |
| `import_vat_amount_aed` | `numeric(15,2)` | override; **defaults to** vat_amount when null; **may be negative** for `import_adjustment` |
| `customs_declaration_number` | `text` | customs/import declaration reference (audit/workpaper) |
| `import_date` | `timestamp` | date of import / customs clearance |
| `import_evidence_url` | `text` | optional link to import declaration / evidence |
| `import_adjustment_reason` | `text` | **required when** `vat_import_role = 'import_adjustment'` |

Rationale for explicit override fields (correction #3): FTA import value can include **customs value + insurance + freight + customs duty + excise tax**, so it can differ from the supplier subtotal. The supplier bill's `subtotal`/`vat_amount` are only *defaults*; the user must be able to override with the true customs-declared taxable/VAT.

A partial index on `(company_id, vat_import_role)` (where `vat_import_role is not null`) on each table for the period query.

## 4. Computation (`server/services/vat-autopilot.service.ts`)

Mirror the reverse-charge aggregation:

1. **Query** import-flagged posted receipts and non-void vendor_bills for the period, selecting `vat_import_role`, the override amounts, and falling back to `COALESCE(import_taxable_amount_aed, subtotal/amount)` and `COALESCE(import_vat_amount_aed, vat_amount)` (FX-converted to AED like the existing receipt path).
2. **Split by role** → `importsAmount/importsVat` (role `import`) and `importAdjAmount/importAdjVat` (role `import_adjustment`, may be negative).
3. **Exclude** these transactions from the normal expense pool (`totalExpenses` / `inputVatGross`) so they never hit Box 9 (correction #4) — identical to how `reverse_charge` rows are excluded.
4. **Due side:** `box6ImportsAmount/Vat = imports`, `box7ImportsAdjAmount/Vat = import adjustments`. Add both to `box8TotalAmount/Vat`.
5. **Recovery side:** `importsRecoverableVat = applyPartialExemption(importsVat + importAdjVat, exemptSupplyRatio).recoverable`. Fold into **Box 10** (`box10ReverseChargeVat += importsRecoverableVat`, `box10ReverseChargeAmount += importsAmount + importAdjAmount`) → flows into Box 11 / Box 13. Amounts use full value, VAT uses the recoverable portion — exactly as reverse-charge does today.
6. Extend the `Vat201BoxValues` type, the box object in `buildVat201Boxes`, and `VAT201_BOX_KEYS` with `box6ImportsAmount/Vat` and `box7ImportsAdjAmount/Vat`.

Net result: `box14 += (importsVat + importAdjVat) − importsRecoverableVat` → **0 if fully recoverable**, else the non-recoverable slice.

## 5. Capture (routes)

- **Receipts** (`server/routes/receipts.routes.ts`, Drizzle): accept the new fields on create/update; validate `import_adjustment_reason` present when role is `import_adjustment`; allow negative override VAT only for `import_adjustment`. (The recently-added `stripImmutableFields` continues to protect identity/tenant fields.)
- **Vendor bills** (`server/routes/bill-pay.routes.ts`, raw SQL): same fields on the bill create/update INSERT/UPDATE, mirroring how `reverse_charge` is captured there.

## 6. Persistence (`server/routes/vat.routes.ts`)

Remove the hardcoded `box6ImportsAmount: 0 … box7ImportsAdjVat: 0` from `buildVatReturnPayload` so the computed values flow through the `...vat201` spread. Keep `box2TouristRefund*` hardcoded 0 (out of scope).

## 7. Document-level vs line-level (correction #5)

**MVP = document-level.** A whole receipt / vendor bill is flagged `import` or `import_adjustment`. Rationale: a customs import declaration typically corresponds to a whole shipment/bill; receipts are single-purpose; line-level role + per-line customs overrides multiply schema and UI complexity.

**UI requirement:** the import control must clearly state the **entire** receipt/bill is treated as an import (or import adjustment), and surface the override fields (taxable, VAT, customs ref, date) so the user can enter true customs values. A bill that genuinely mixes imported and domestic lines should be split into two documents. **Line-level role is a documented future enhancement**, not in this MVP.

## 8. UI

Mirror the existing `reverse_charge` control in the bill and receipt forms (client). Add:
- an import-role selector (None / Import of goods / Import adjustment),
- when an import role is selected: override inputs for import taxable (AED), import VAT (AED), customs declaration number, import date, evidence URL,
- when `import_adjustment`: a required justification field, and the amounts accept negatives.
Exact client components identified during planning (find the current reverse-charge control to mirror).

## 9. Testing (TDD) — must explicitly cover (correction #6)

Pure box-math (`buildVat201Boxes` / `calculateVatReturn`) and capture round-trip:
1. `import` → Box 6 due **+ Box 10 recovery** (not Box 9).
2. Fully-recoverable import **nets to zero** in Box 14.
3. Partial-exemption importer → **non-recoverable VAT remains payable** in Box 14.
4. `import_adjustment` → **Box 7** due + Box 10 recovery.
5. **Negative** Box 7 adjustment reduces due and recovery correctly.
6. Imports are **excluded from Box 9** (standard expenses unchanged).
7. **Reverse-charge stays isolated** — no double-count with imports.
8. **Custom import value override** (importTaxableAmountAed / importVatAmountAed) differs from subtotal/vat_amount and the override is used.
9. **Capture round-trip** for both receipts and vendor bills (fields persist and reload).
Plus: `import_adjustment` without justification is rejected; existing 532 tests stay green.

## 10. Out of scope / deferred

- Box 2 tourist refund (no data source / separate POS-refund scheme).
- Line-level import role (document-level for MVP).
- Changing the manual VAT workpaper (already supports `import` / `import_adjustment`).
- Overriding FTA's official pre-populated Box 6 — we compute the *expected* value for reconciliation only.

## 11. Acceptance criteria

- Flagging a receipt or vendor bill as `import` produces Box 6 due + Box 10 recovery on the generated autopilot return; fully-recoverable nets to zero; partial-exemption pays the non-recoverable portion.
- `import_adjustment` (incl. negative) produces Box 7 + Box 10 recovery, requires justification.
- Imports never appear in Box 9; reverse-charge unaffected.
- Import taxable/VAT overrides (customs value) are respected over supplier subtotal.
- Customs declaration ref / import date / evidence persist for the workpaper.
- `npm run check`, full test suite (incl. the 9 new cases above), `npm run build`, `npm audit`, `check:migrations` all pass.
