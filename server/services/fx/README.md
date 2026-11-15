# server/services/fx — exchange rates and unrealised revaluation (W2-E)

## One rate convention

A row in `exchange_rates` (`base_currency = X`, `target_currency = Y`, `rate = r`) means
**1 X = r Y**. Company rates are stored canonically as (foreign, company base): AED per USD is
`(USD, AED, 3.6725)`. A rate entered the other way round (AED → USD 0.2723) is inverted once,
on write, by `canonicalizeCompanyRate`. Lookups derive inverse pairs; no caller should divide
or invert a stored rate itself. Rates carry 6 dp (`shared/money.ts` `RATE_DECIMALS`).

## Tenancy

| `company_id`                  | Meaning                                              | Who can write                   |
| ----------------------------- | ---------------------------------------------------- | ------------------------------- |
| company uuid                  | That company's own rate                              | members of the company          |
| `NULL`                        | System row (FTA-published, platform reference rates) | platform admins only            |
| any, `legacy_unscoped = true` | pre-0094 row with no determinable owner              | nobody; ignored by every lookup |

Lookup order: the company's row, then the system row. Another tenant's rows are never read.

## API

```ts
import { resolve } from "../../platform/service-registry";
import type { FxGetRate, FxConvert } from "../services/fx";

const getRate = resolve<FxGetRate>("fx.getRate");
const r = await getRate(companyId, "USD", "AED", "2026-11-14", { rateType: "spot", maxAgeDays: 7 });
// r = { rate: 3.6725, rateText: "3.672500", source: "manual", date: "2026-11-13",
//       stale: false, ageDays: 1, scope: "company", inverse: false, ... }

const convert = resolve<FxConvert>("fx.convert");
const c = await convert(companyId, 10_000, "EUR", "AED", "2026-11-14"); // 100.00 EUR
// c.convertedFils === 40_000 with an (EUR, AED, 4) rate
```

- Same currency returns rate 1 (`scope: "identity"`).
- A rate older than `maxAgeDays` (default 7) comes back with `stale: true` and a `warning`.
- `rateType` is `spot` (default), `closing` or `average`; a missing closing/average rate falls
  back to spot with a warning unless `fallbackToSpot: false`.
- No rate: `DomainError("NO_EXCHANGE_RATE", 422)`.

The legacy helpers exported from `server/routes/exchange-rates.routes.ts`
(`getLatestRate`, `getLatestRateDetailed`) keep their signatures but read **system rows only**,
so no caller can be poisoned by another tenant's rate.

**Document modules (invoices, bills, payments, receipts, credit notes, POs) must switch to
`fx.getRate` with a `companyId`** so that rates entered on the Exchange Rates page apply to
their documents. Until they do, they only see system rows.

## Writes and validation (R14-12)

`saveRate(companyId | null, userId, input)`: ISO 4217 codes only, base != target, rate > 0
(6 dp, below numeric(15,6) max), date valid and not in the future, and a sanity band: a move of
more than 20% versus the previous rate for the pair is rejected with
`409 RATE_CHANGE_UNCONFIRMED` (details carry the previous rate and change %) until the caller
resends with `confirmLargeMove: true`. A second entry for the same day, source and rate type
replaces the first.

## Unrealised revaluation

- `computeFxExposure(companyId, asOf)` — outstanding balances of **posted** foreign-currency
  documents only: invoices with a posted `invoice` journal minus payments dated on/before
  as-of; vendor bills with a posted `bill` journal minus bill payments; active foreign bank
  accounts with a GL link (balance from posted journal lines tagged with that currency). Drafts,
  voids, credit notes and unposted receipts are excluded. Uses the `closing` rate, falling back
  to `spot`. The FX gains/losses report (`/reports/fx-gains-losses`) uses the same function.
- `runRevaluation(companyId, asOf, userId)` — one balanced entry dated as-of (A/R, A/P and bank
  GL adjustments against `4091 Unrealised FX Gain` / `5141 Unrealised FX Loss`, created when
  missing), `source = 'fx_revaluation'`, `source_id = fx_revaluations.id`, plus its automatic
  reversal dated as-of + 1 day (`fx_revaluation_reversal`). Re-running the same as-of date is a
  no-op. Missing rates block the run (422); stale rates need `acknowledgeStale`.
- `undoRevaluation` posts equal-and-opposite entries for both and marks the run `undone`, after
  which the date can be revalued again.

Known limits: credit notes are not netted against invoice exposure; there is no per-currency
trial balance yet; revaluation posts through `storage.createJournalEntryWithLines` until the
W2-A ledger kernel is available.
