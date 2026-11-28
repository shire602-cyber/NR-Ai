# server/services/consolidation — management consolidation (W5-C)

Company groups and a server-side **management** consolidation (not statutory). Corporate tax
stays per entity; tax group relief is not modelled. Every output carries
`basis: "management_consolidation"` and a bilingual label.

## Model (migration 0107)

| Table                       | Meaning                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `company_groups`            | name, parent company, reporting currency (defaults to the parent's base currency)                |
| `company_group_members`     | company, ownership (fraction 0–1), method `full` \| `none`, effective dates. Parent auto-added.  |
| `intercompany_account_maps` | `receivable_payable` (asset/liability) or `revenue_expense` (income/expense) account pairs       |
| `elimination_journals`      | group-level journals: `manual`, or `rule` copies written by a recorded run. Never entity ledgers |
| `elimination_lines`         | member company + account, debit/credit in integer minor units of the reporting currency          |
| `consolidation_runs`        | audit trail: the full statements JSON (entities, rates, eliminations) of a recorded run          |

## Engine (`engine.ts`)

Per consolidated member (method `full`, effective dates overlapping the period) it reads the
reporting kernel (`accountTotals`, `ledgerLines`, `profitAndLoss`, `balanceSheet`: posted only,
closing / year-end entries excluded) and translates into the reporting currency with
`fx.getRate` scoped to the **parent company**:

- assets and liabilities: `closing` rate on `to` (spot fallback, warned);
- income and expenses: `average` rate on `to`;
- capital (non-retained equity): historical — each posted line at the spot rate of its date;
- retained earnings brought forward: closing rate of the prior fiscal year end (approximation of
  the historical rate, disclosed in `translation.method`); current-year earnings at average;
- CTA = translated net assets − translated equity, shown in equity.

NCI = (1 − ownership) × translated net assets / profit, carved out of total equity and profit.

Eliminations: each map matches `min(sideA, sideB)` of the translated natural balances (balances
at `to`, transactions in `[from, to]`) and reduces both; `unmatchedDifference = A − B` stays in
the figures and is reported in `eliminations[]` and `warnings[]`. Manual journals dated ≤ `to`
apply to balance-sheet lines; their P&L lines go to the P&L (dated in the period), to current-year
earnings (dated in the fiscal year) or to retained earnings b/f (earlier). The consolidated
balance sheet balances by construction; any difference is returned, never hidden.

A missing rate is `422 CONSOLIDATION_RATE_MISSING`.

## Access

View (statements, export, runs): access to **every** member (`storage.hasCompanyAccess`),
otherwise `403 GROUP_MEMBER_ACCESS_DENIED`; no access to the parent is `404`. Manage: view +
`settings.company` on the parent; adding a member also needs `settings.company` on that company.

## API (contract fixed)

`GET /api/company-groups/:groupId/consolidated-statements?from=&to=` →
`{ entities[], eliminations[], translation{ rates, cta }, consolidated{ profitAndLoss, balanceSheet }, nci, generatedAt, ... }`;
`.../consolidated-statements/export?format=xlsx|csv`; `POST .../consolidation-runs`; group,
member, map and elimination CRUD in `server/routes/consolidation.routes.ts`.
