# Muhasib — Second Teardown

**Date:** 13 August 2026
**Reviewer:** fresh eyes. I did not write the previous reports and I do not care what they claim.
**Method:** clean extract, `npm ci`, real build, real Postgres, real HTTP. I ran it. Then I attacked the modules nobody tested.

---

## 0. The verdict

Six days ago this thing had five criticals. Someone fixed them, wrote four documents about it, and built a scoreboard to admire the progress.

**The scoreboard is the problem.** Look at what it actually says:

| | Baseline | Now | Target |
|---|---:|---:|---:|
| Client routes | 113 | **113** | 20 |
| Nav destinations | 61 | **61** | 12 |
| Largest file | 21,779 | **21,779** | 800 |
| API endpoints | 619 | **612** | 180 |
| LOC | 219,217 | **211,681** | 90,000 |

**Zero. Zero. Zero. Seven. Three percent.**

The plumbing got fixed. The house did not get smaller. `Reports.tsx` is *character-for-character the same 21,779-line file* it was before anyone wrote a document about deleting it. Every one of the 61 navigation destinations is still there. What was actually deleted was 27 files nobody imported — code that was already dead. That is not a deletion programme, that is emptying the bin and calling it a renovation.

And while everyone was admiring the diff, I found this in twenty minutes:

> **You cannot issue a partial credit note. The system silently converts it into a full one and under-declares your VAT to the FTA.**

Let me show you.

---

## 1. CRITICAL — Partial credit notes are silently converted to full credit notes

Live, against the built server:

```
INVOICE       total= 1050   subtotal= 1000   vat= 50
POST /invoices/{id}/credit-note  { lines: [ { unitPrice: 400, vatRate: 5 } ] }
  -> 201 Created
  returned      total= -1050  subtotal= -1000  vat= -50
  EXPECTED      total=   420  subtotal=   400  vat=  20
```

I asked to credit **400**. It credited **1,050** and returned `201 Created`.

**Mechanism** (`server/routes/invoices.routes.ts:1373`): the handler never reads `req.body.lines`. Not once. It hard-codes:

```ts
subtotal:  -original.subtotal,
vatAmount: -original.vatAmount,
total:     -original.total,
...
for (const line of originalLines) { /* negate every original line */ }
```

**Why this is the worst bug currently in the product:**

1. **A partial credit note is not an edge case.** A customer returns two of five items. You give a 10% goodwill discount. You write off part of a disputed invoice. This is Tuesday. The product cannot do it *at all*.
2. **It under-declares VAT.** Credit the full AED 50 when only AED 20 was returned and output VAT is understated by 30. Understating is the direction that gets you penalised — an overpayment is your money back, an underpayment is a fine.
3. **It fails silently with a success code.** No 400, no warning, no "partial credit notes are not supported". It accepts your payload, discards it, and returns 201 with a number that is 2.5× what you asked for.
4. **The irony is total.** The standalone credit-note routes return `410 Gone` telling you: *"Create credit notes from the original invoice so VAT, FX, caps, and journal entries stay unified."* They redirect you to the endpoint that throws your input away.

The UI currently sends `{}`, so today's users only ever get full credit notes — which is why nobody noticed. The moment anyone builds a partial-credit form, or an accountant hits the API, they will quietly file wrong returns.

**This is C1 all over again**: not a crash, a confident wrong number, in the direction of a penalty.

---

## 2. The build was broken when I picked it up

`npm run check` — exit code **2**.

```
server/services/scheduler.service 3.ts(1,26566): error TS1127: Invalid character.
```

Eight cloud-sync conflict copies were sitting in the repo:

```
server/storage 2.ts              server/db 2.ts              (1.6 KB — a truncated stub of a 58 KB file)
server/routes/reports.routes 2.ts    server/services/pdf-invoice.service 2.ts
server/services/scheduler.service 2.ts    server/services/scheduler.service 3.ts   (26 KB of binary garbage)
client/src/hooks/useHealthCheck 2.ts     migrations/meta/_journal 2.json
```

All untracked. All inside `tsconfig`'s include globs. All invisible in a normal editor. `tsc` compiled them and died.

This is what happens when you develop a production accounting system **inside a cloud-synced Desktop folder**. Your source of truth is being edited by a background daemon. A duplicated `_journal 2.json` sitting next to the migration journal is not a filename annoyance — that is the file that decides which migrations run against your customers' books.

I deleted them and added `scripts/check-no-stray-duplicates.mjs` to `npm run check`. Move the repo out of the synced folder.

---

## 3. What I attacked, and what held

Credit where it is due — I tried to break these and could not:

- **Corporate tax is correct.** AED 1,000,000 profit → `taxableAmount: 625000, taxRate: 0.09, taxPayable: 56250`. The 375,000 threshold is properly applied. The naive answer (90,000) would have been an easy bug and it is not there.
- **Multi-currency settlement holds.** USD 1,000 invoiced at 3.6725, settled at 3.60. Trial balance stayed balanced, AR closed to exactly zero, realised FX absorbed correctly.
- **Dashboard, financial statements and the legacy report endpoint all returned 5,000.** Three surfaces, one number.
- **The rate limiter works** — it locked *me* out mid-audit after five rapid signups. Correct behaviour, and I had to wait it out.
- **All 55 integration assertions pass**, including the foreign-currency input-VAT fix that was previously shipped untested. I verified it myself: Box 9 = 3,672.50, Box 9 VAT = 183.63. That one is genuinely closed.

The ledger core continues to be the best thing here.

---

## 4. Smaller things I broke

- **A large invoice 500s.** `quantity: 1e15, unitPrice: 1e15` → **HTTP 500**, no total returned. Numeric overflow escaping as a server error instead of a 422. Nobody will type that, but it means the amount path has no upper bound check, and `numeric(15,2)` has a hard ceiling that is very reachable for a company invoicing in fils.
- **Invoices can be dated in the future.** Date `2099-01-01` → **200 OK**. You can create supplies in a period that has not happened, which lands them in a future VAT return. Backdating got a guard; forward-dating did not.
- **Corporate tax has no Small Business Relief.** The response has no `smallBusinessRelief` field. Revenue ≤ AED 3m can elect 0% — that is *most* UAE SMEs, i.e. exactly the customer being targeted, and the one CT feature the competition also lacks. Still unbuilt.

---

## 5. The test suite is still theatre, just better-dressed

**939 unit tests. 11 of the 83 files still just `readFileSync` your own source and regex it.** They assert that you typed something, not that it works.

**56 integration assertions** — real, valuable, and the only reason I trust anything. But look at what they cover:

Modules with **zero** integration coverage:

```
payroll        inventory      fixed-assets    budgets       expense-claims
purchase-orders  bill-pay     cost-centers    recurring-invoices
corporate-tax  bank-statements  quotes        credit-notes
```

**Credit notes are on that list.** That is precisely why the partial-credit bug survived a full teardown, a rewrite plan, a fix programme and four verification documents. Nobody wrote a test for it, so nobody found it.

This is the same lesson as last time and it did not land: *the bugs are exactly where the tests aren't.* You now have a beautiful harness pointed at the eight things that already work.

---

## 6. The strategic position has not moved

Six days closer to the deadline. Still:

- **No accredited ASP.** The adapter is written — genuinely good, and it means signing is now a config change, not a build. But an unsigned contract transmits zero invoices. <AED 50m filers must appoint by **31 March 2027**. That is the only clock that matters and it has run for six days while the effort went into deleting `carousel.tsx`.
- **No bank feeds.** Still CSV-only. QuickBooks has ADCB, DIB, ENBD, FAB, RAKBANK.
- **No customers.** Zero. Every one of the 61 navigation destinations remains a guess.
- **Arabic is still a facade.** 49 of 111 pages import a translation helper; ~3,400 hardcoded English strings. An Arabic user still gets an Arabic sidebar around an English application. In the market where that is your差异, it is still not done.

The genuine wins: first-paint JS is down **46%** (2.01 MB → 1.13 MB), the float money columns are gone, period locking works, VAT ties to the ledger, and the app no longer claims to have filed things it did not file. Those are real and they matter.

But they are all *defensive*. Nothing shipped in six days makes a UAE business choose you over Zoho at AED 69/month.

---

## 7. What I would do, in this order

1. **Fix the credit note today.** Read `req.body.lines`. If absent, full reversal (current behaviour, keeps the UI working). If present, credit exactly those lines, cap at the remaining uncredited balance, and recompute VAT from the credited lines. Then write the integration test that catches it.
2. **Write integration tests for the thirteen uncovered modules** before writing another feature. You have the harness. Point it at the parts that have never been run.
3. **Move the repo out of iCloud/Dropbox.** Today.
4. **Do the actual deletion.** 113 → 20 routes, 61 → 12 nav items, 21,779 → 400 lines in `Reports.tsx`. The plan is written and correct; six days produced a 3% reduction. Nothing else on this list gets easier until this happens.
5. **Sign the ASP.** It is a phone call and a contract, and it is the only item with an external deadline.
6. **Small Business Relief.** Nobody has it. Your customers all qualify. It is the cheapest genuine differentiator on the board.

---

## The one line

**They fixed the bugs that were pointed at, then wrote four documents and a scoreboard proving it — and never touched the thing every document said was the actual problem.** The app is more correct than it was and exactly as bloated, and the first module I picked that had no test coverage handed me a critical VAT bug in twenty minutes.

Stop measuring. Start deleting.
