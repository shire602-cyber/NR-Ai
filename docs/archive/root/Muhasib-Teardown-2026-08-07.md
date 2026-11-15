# Muhasib.ai — End-to-End Teardown

**Date:** 7 August 2026
**Scope:** full local boot, live API exercise against a real Postgres, code and schema audit, competitive benchmark
**Tester's brief:** "roast it without mercy and in detail"

---

## 0. The verdict, up front

Muhasib is a **219,000-line accounting product with a working general ledger and a broken tax engine**, wrapped in marketing that claims the opposite of what the code does.

The ledger is genuinely good. Double-entry posting is correct, drafts don't touch the GL, invoice numbering is transactional and gap-free, decimal.js is used where it matters, and the multi-tenant isolation held against every attack I threw at it. Someone competent built the core.

Then that core was buried under 113 screens, 614 API routes, 33 "live" reports and nine navigation groups — and the things a UAE accounting product exists to do are the things that break:

- **The VAT Summary report overstates VAT payable by 50%** on any invoice containing a zero-rated line. It reported AED 75 due when the ledger said AED 50. Two VAT engines in the same codebase disagree with each other, and the wrong one is the one on the Reports page.
- **Every box of the VAT 201 return is stored as a 4-byte float.** AED 9,999,999.99 comes back out of the database as AED 10,000,000. This is the number you file with the FTA.
- **Month-end close and period locking are completely broken** — HTTP 500, missing column. Which means the FTA-retention and period-lock story that the rest of the app leans on is decorative.
- **A payment of AED 100,000 against an AED 1,050 invoice was accepted without a warning** and quietly parked AED 99,450 in Deferred Revenue.
- **The app on disk does not start.** `server/services/scheduler.service.ts` is deleted in the working tree. The last commit is literally titled "restore scheduler.service."

And on the public pricing page, a comparison table tells prospects that **Zoho Books has no UAE VAT support** — while Zoho is the only vendor in this comparison that actually files VAT 201 directly into EmaraTax, emirate splits and all.

You said you don't enjoy using it. The reason isn't taste. It's that the product is enormous, and almost none of that size is load-bearing.

---

## 1. How I tested this

| | |
|---|---|
| Environment | Ubuntu 22.04 sandbox, Node 22, PostgreSQL 18.4 (embedded), all 93 migrations applied cleanly |
| App | `tsx server/index.ts`, dev mode, real database, real HTTP |
| What I ran | 3 custom API harnesses (~120 assertions), the project's own 940-test suite, `tsc --noEmit`, `vite build`, `npm audit`, direct SQL inspection |
| What I could **not** test | The rendered UI. Chromium wouldn't launch (missing `libxdamage1`, no root, package mirror blocked). **All UX criticism below is from code and information architecture, not from looking at pixels.** Treat the UI section as weaker evidence than the rest. |

One thing before anything else: to get the app to boot at all I had to restore a deleted file.

```
$ git status --porcelain
 D server/services/scheduler.service.ts

$ git log --oneline -1
31139ece fix(vat): make the Excel workpaper a first-class tab; restore scheduler.service
```

`server/index.ts` imports `initScheduler` from that path unconditionally. Checked out as-is, the app dies on startup with `ERR_MODULE_NOT_FOUND`. The commit that claims to have restored it is the same commit whose working tree deleted it. I restored it into my sandbox copy only — your repo is untouched.

---

## 2. The five findings that would fail an audit

### 2.1 CRITICAL — The VAT Summary report overstates VAT by 50%

I raised one invoice: AED 1,000 standard-rated at 5%, plus AED 500 zero-rated. Correct output VAT: **AED 50**.

The general ledger got it right:

```
1040 Accounts Receivable    Dr 1,550.00
4010 Product Sales                      Cr 1,000.00
4060 Zero-Rated Sales                   Cr   500.00
2020 VAT Payable (Output)               Cr    50.00
```

The VAT 201 generator got it right: `box8TotalVat: 50`.

The **VAT Summary report** — one of your 33 reports advertised as `status: "live"`, whose stated decision question is *"How much VAT is payable or recoverable for this period?"* — returned:

```json
{
  "box1_standardRatedSupplies": 1500,   ← should be 1000
  "box2_zeroRatedSupplies": 0,          ← should be 500
  "box5_outputVat": 75,                 ← should be 50
  "box8_netVatDue": 75                  ← 50% overstatement
}
```

**Root cause** — `server/routes/reports.routes.ts:808-824`:

```ts
const supplyType = line.vatSupplyType ?? "standard_rated";
if (supplyType === "zero_rated")      zeroRatedSupplies += lineTotal;
else if (supplyType === "exempt")     exemptSupplies    += lineTotal;
else                                  standardRatedSupplies += lineTotal;

const outputVat = standardRatedSupplies * UAE_VAT_RATE;
```

The report classifies supplies by `invoice_lines.vatSupplyType`. The invoice creation endpoint **never sets that field** — `invoiceLineInputSchema` accepts only `description`, `quantity`, `unitPrice` and `vatRate`. So every line ever created falls through to the `?? "standard_rated"` default, including 0% lines, and output VAT is then recomputed as `total × 5%` while ignoring the line's actual rate and ignoring the AED 50 sitting in account 2020.

The same block also folds `out_of_scope` into standard-rated Box 1, with a comment cheerfully saying so.

**Why this is the worst bug in the product:** it is not a crash. It is a confident wrong number, on a screen labelled "live", in the exact place a UAE business owner goes to decide what to pay the FTA. A crash gets reported. A plausible wrong number gets filed.

### 2.2 CRITICAL — Every VAT 201 box is a 4-byte float

44 money columns in the schema are Postgres `real` (IEEE-754 single precision, ~7 significant digits). They include **every single box of the VAT return**:

```
vat_returns.box1a_abu_dhabi_amount    real
vat_returns.box1b_dubai_amount        real
vat_returns.box5_total_output_tax     real
vat_returns.box8_total_vat            real
vat_returns.box12_total_due_tax       real
...and 39 more, plus invoices.base_currency_amount
```

Measured on the actual database:

| Value you file | Stored as `real` | Stored as `numeric(15,2)` |
|---|---|---|
| 1,234.56 | 1,234.56 | 1,234.56 |
| 99,999.99 | 99,999.99 | 99,999.99 |
| **1,234,567.89** | **1,234,567.9** | 1,234,567.89 |
| **9,999,999.99** | **10,000,000** | 9,999,999.99 |
| **12,345,678.90** | **12,345,679** | 12,345,678.90 |

Summing 10,000 rows of AED 1,234.56: `real` gives **12,346,655**, `numeric` gives **12,345,600** — **AED 1,055 of drift** on a AED 12m base.

The irony is precise: your journal lines, invoice totals and account balances are all `numeric` — 95 columns of correctly-typed money. The core ledger does it right. It is specifically **the tax return and the AED conversion of foreign-currency invoices** that were given floats.

A business with AED 50m of supplies — exactly the cohort that must appoint an e-invoicing ASP by 30 October 2026 — cannot represent its own Box 1 to the dirham in your schema.

### 2.3 CRITICAL — Month-end close and period locking are dead

```
POST /api/companies/:id/month-end/lock-period
→ 500  column "closing_entry_id" of relation "month_end_close" does not exist
```

The migrations create the column as `closing_journal_entry_id` (`migrations/0014`, again in `0073`). `server/services/month-end.service.ts` reads and writes `closing_entry_id`. The service tries to protect itself with a `CREATE TABLE IF NOT EXISTS` at line 57 that uses the *correct* name — but the table already exists from the migrations, so `IF NOT EXISTS` is a no-op and the column is never created. On any database built from your own migration files, period locking cannot work.

Consequence: `assertPeriodNotLocked()` is called dutifully in the invoice, payment and status-change paths — and it can never fire, because no period can ever be locked. I confirmed it end-to-end: I attempted a lock (500), then posted an invoice into the "locked" period (200 OK).

Every period-integrity guarantee in the product is currently theatre.

**The structural cause is worse than the bug.** There are three competing schema systems in this codebase:

1. `migrations/` — 93 Drizzle SQL files
2. `server/db.ts::ensureCriticalSchema()` — **76 hardcoded `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements** that run on every boot
3. `server/services/month-end.service.ts` — a `CREATE TABLE IF NOT EXISTS` executed at query time

Nobody can tell you what the schema is. That's how `closing_entry_id` happened, and it will happen again.

### 2.4 CRITICAL — Overpayment is accepted silently and misposted

Invoice: AED 1,050. Payment 1: AED 500 → status `partial`, correct. Payment 2: **AED 100,000** →

```
HTTP 201 Created
invoice status: "paid"
```

No warning. No confirmation. No cap. The excess lands here:

```
Balance sheet after:
  1020 Bank Accounts        100,500
  1040 Accounts Receivable        0
  2020 VAT Payable               50
  2050 Deferred Revenue      99,450   ←
```

Three separate problems:

1. **No guard at all.** A fat-fingered `100000` instead of `1000.00` creates a six-figure phantom liability with a 201 response. Every competitor in this comparison warns or blocks.
2. **Wrong account.** An unapplied customer overpayment is a *customer deposit / advance*. `2050 Deferred Revenue` under IFRS 15 is a contract liability for an unsatisfied performance obligation. Your auditor will ask what performance obligation AED 99,450 relates to, and the answer is "a typo."
3. **No way out.** There is no customer-credit or unapplied-payment concept anywhere in the 614 routes. That money is stranded in a GL account with no subledger link. It cannot be applied to a future invoice, only journalled out by hand.

To its credit the ledger stayed balanced (Dr 101,550 = Cr 101,550). It is balanced and wrong, which is the hardest kind of wrong to find.

### 2.5 CRITICAL — The public pricing page is factually false about a competitor

`client/src/pages/Pricing.tsx:287-304` ships a comparison table to every visitor:

```ts
{ featureKey: "uaeVATBuiltIn",   muhasib: true, wafeq: true,  zoho: false },
{ featureKey: "arabicSupport",   muhasib: true, wafeq: true,  zoho: false },
{ featureKey: "corporateTaxComp",muhasib: true, wafeq: false, zoho: false },
{ featureKey: "eInvoicingComp",  muhasib: true, wafeq: true,  zoho: false },
{ featureKey: "startingPrice",   muhasib: "AED 0", wafeq: "AED 99/mo", zoho: "$15/mo" },
```

Every Zoho cell is wrong, and wrong in the direction that flatters you:

- **`zoho: uaeVATBuiltIn = false`** — Zoho Books produces the complete FTA VAT 201 *including the emirate-by-emirate Box 1a–1g split*, and **files it directly into EmaraTax**, including Voluntary Disclosures. It is the strongest VAT product in this comparison. ([source](https://www.zoho.com/ae/books/help/vat-uae/vat-return-filing.html))
- **`zoho: corporateTaxComp = false`** — Zoho ships a UAE Corporate Tax module on Professional and above. ([source](https://www.zoho.com/ae/books/help/corporate-tax/))
- **`zoho: arabicSupport = false`** — Zoho Books has an Arabic UI. (Partial — no Arabic chart of accounts — but "false" is not the answer.)
- **`zoho: eInvoicingComp = false`, `muhasib: true`** — Zoho is an OpenPeppol AP/SMP member with a UAE entity. **Your e-invoicing submit endpoint returns `"provider": "mock"`.** You are claiming a capability you have literally stubbed, against a competitor who has the real thing.
- **`zoho: "$15/mo"`** — Zoho Books UAE is priced in dirhams: AED 0 / 69 / 129 / 159 / 349 / 799. ([source](https://www.zoho.com/ae/books/pricing/))

This is not a roast point, it's an exposure. A comparative advertising claim that a named competitor lacks statutory tax functionality it demonstrably has is the kind of thing that gets a letter.

**And the same page has a fabricated testimonial** (`MuhasibLanding.tsx:1367-1385`):

> *"Our close went from 11 days to under two. The VAT 201 is drafted before our accountant even looks at it."*
> — **Hassan Mansour, Group CFO · Madar Holdings (Dubai)**

A named individual, a named company, a specific quantified outcome, on a pre-launch product. The section is commented `{/* Insight rail (Big Four trust signal) */}`. Take it down today.

---

## 3. The rest of the damage

**HIGH**

| # | Finding | Evidence |
|---|---|---|
| 1 | **Emirate attribution defaults to Dubai and ignores place of supply.** `COALESCE(emirate, 'dubai')` in `vat-autopilot.service.ts:612`, and the code comment concedes "only the company's emirate is populated." A Sharjah company that skipped the onboarding field files 100% of supplies to Box 1b. A Dubai HQ with an Abu Dhabi branch files it all to Dubai. | `vat-autopilot.service.ts:369-449` |
| 2 | **"Submit to FTA" is a status flag.** `POST /api/vat-returns/:id/submit` returns 200 and sets `status: "submitted"`. Nothing is sent anywhere. A user reasonably believes they have filed. | live test |
| 3 | **E-invoicing is mocked.** `POST /api/invoices/:id/einvoice/submit` → `{"status":"submitted","provider":"mock","providerMessageId":"mock-22a24d4e..."}`. The UBL/PINT AE XML generation is real and looks correct; the transmission is a stub. | live test |
| 4 | **VAT return periods are unvalidated.** I generated a return for **1 Jan 2000 → 1 Jan 2100** (accepted, 201) and another for **1900 → 2999** (accepted, 201). Due date computed as 29 Jan 2100. No check against the company's stagger or the FTA calendar. | live test |
| 5 | **VAT Autopilot shows the wrong quarter.** On 7 August 2026 it returned the period 1 Apr – 30 Jun 2026 with a due date of 28 July 2026 — a deadline five weeks in the past — and reported zero VAT while the books held a live invoice. | live test |
| 6 | **Bank account creation 500s on the documented field name.** `{name, accountNumber, currency}` → 500. The column is `name_en` and is NOT NULL. `{nameEn, ...}` works. A core object, broken on the obvious payload. | live test |
| 7 | **Customer TRN is unvalidated.** `trn: "123"` accepted. UAE TRNs are 15 digits, and the buyer TRN is a mandatory field on a tax invoice above AED 10,000. | live test |
| 8 | **The free tier is trivially bypassed.** Limits (20 invoices, 1 user) are per *company*; a free user can create unlimited companies. Ten companies = 200 free invoices. | live test |

**MEDIUM**

| # | Finding |
|---|---|
| 9 | `POST /api/invoices/:id/post` is a trap. It's documented "Post invoice journal entries," but always returns `400 No draft entries to post` — the real issue path is `PATCH /:id/status → sent`. Any integrator will call the wrong one first. |
| 10 | Standalone credit-note routes are registered and return `410 Gone`. Six dead endpoints still in the surface area. |
| 11 | No general API rate limit. Login is limited correctly (429 after 5 attempts) but 80 rapid authenticated reads produced zero 429s. |
| 12 | CSP includes `'unsafe-inline'` and `'unsafe-eval'` on `script-src`, which removes most of the protection the rest of the (otherwise good) header set provides. |
| 13 | Dev-mode 500s return raw SQL and bound parameters to the client. Production correctly masks this for non-admins — but the dev default is a leak waiting to be deployed with the wrong `NODE_ENV`. |
| 14 | 7 npm advisories in production dependencies (5 high, all `undici`), fixable with `npm audit fix`. |
| 15 | `tsc --noEmit` OOMs on Node's default heap. It passes at `--max-old-space-size=6144`. Your CI is one runner-downgrade away from a red build with no code change. |

---

## 4. What is actually good — and it matters

A teardown that only attacks isn't useful. These are real, and several are better than the incumbents:

- **The general ledger is correct.** Draft invoices do not touch the GL. Issue posts a balanced four-line entry with zero-rated revenue split to its own account (4060) so Box 4 can be tied back. Unbalanced manual journals are rejected. Every trial balance I pulled balanced to the fils.
- **Invoice numbering is done properly.** Allocation and insert share one transaction specifically so a failed insert can't burn a number and create an FTA Article 78 gap. The comment explaining why is better than most production code.
- **Multi-tenant isolation held on every probe** — cross-tenant list, read-by-id, delete, balance sheet and journal post all returned 403/404. No leakage.
- **Security fundamentals are solid.** `alg=none` rejected. `isAdmin: true` in the registration body ignored (forced server-side, with a comment saying why). Login rate limiting works. HSTS, `nosniff`, `frame-ancestors 'none'`, `referrer-policy: no-referrer` all present. Constant-time login via a dummy bcrypt hash to defeat email enumeration. No secrets in the repo.
- **`decimal.js` for invoice totals**, and an explicit refusal to book a foreign-currency invoice without an FX rate (`422 NO_EXCHANGE_RATE`). That's more discipline than QuickBooks shows.
- **FTA five-year retention is enforced in the delete path** — `409 Record cannot be deleted before 2031-08-07`.
- **Amount edits to a posted invoice are blocked** with the correct instruction: void and credit-note it.
- **WPS SIF generation exists** (`wps-sif.service.ts`, SCR/EDR fixed-width records). Among the five competitors you named, **only Zoho — via a separate paid Payroll product — has this.** Wafeq, QuickBooks and FreshBooks have nothing.
- **UBL 2.1 / PINT AE XML generation is real** and validates against a supplier-TRN check. The plumbing to an accredited provider is the missing piece, not the format.

The core is worth keeping. That's the whole point of the rest of this document.

---

## 5. The architecture is the disease; the bugs are symptoms

```
Total TypeScript                219,217 lines across 430 files
  client/src                    137,299
  server                         75,560
API routes                          614
Client routes                       113
Page components                     102
Sidebar destinations                 61  across 9 groups
Reports.tsx                      21,779 lines   ← one file
reportCatalog.ts                  6,650 lines
Migration files                      93
+ ALTER TABLE statements in db.ts    76
```

**`Reports.tsx` is 21,779 lines.** That is not a component, it's a district. It builds to a 461 KB JavaScript chunk — the largest non-vendor asset in the app.

**Two megabytes of JavaScript before first paint.** `index.html` `modulepreload`s 15 chunks totalling **2,013,794 raw bytes (597 KB gzipped)** plus a **254 KB stylesheet**. Included in that eager preload: `vendor-pdf` (437 KB) and `vendor-pdfjs` (442 KB) — **879 KB of PDF libraries a first-time visitor to the marketing landing page will never touch.**

**Nine navigation groups, 61 destinations.** QuickBooks Online — serving the same SMB — shows about a dozen. You have `/receipts` *and* `/receipt-autopilot`; `/reports` *and* `/advanced-reports` *and* `/analytics` *and* `/advanced-analytics` *and* `/financial-statements`; `/ai-chat` *and* `/ai-cfo* *and* `/smart-assistant` *and* `/ai-features` *and* `/ai-inbox*. Five AI entry points, and with no `OPENAI_API_KEY` every one of them returns 503.

This is the answer to "I don't enjoy using it." It isn't the colour scheme. **The product has no opinion about what you should do next.** Every screen is equally weighted, so every session starts with a navigation decision instead of a task. Wafeq and FreshBooks are enjoyable precisely because they refuse to do most of this.

### The bilingual claim doesn't survive contact

- `i18n.ts`: **382 English keys, 382 Arabic keys.** Complete parity. Good.
- **1,004 distinct hardcoded English strings sitting raw in JSX** across `client/src/pages/`.
- **44 of 102 page components import `useTranslation` at all.**

From `Invoices.tsx` alone, hardcoded and untranslatable: *"Payment Method", "Deposit Account", "Line Items", "Bank Transfer", "Select Payment Account", "Next Run Date", "Invoice Customization", "Show Business Address"*.

An Arabic-speaking user gets an Arabic sidebar and an English invoice form. In a market where Arabic is the differentiator against QuickBooks and FreshBooks, shipping a translated chrome around an English application is worse than shipping English — it promises and then withdraws.

---

## 6. The test suite is theatre

```
Test Files  82 passed | 1 skipped (83)
Tests      939 passed | 1 skipped (940)
Duration   5.80s
```

940 green tests in under six seconds. That number is only achievable because almost nothing is actually exercised:

- **1** integration test exists (`tests/integration/`), and it's gated behind `RUN_DB_INTEGRATION=1` so it does not run by default.
- The five E2E crawlers in `tests/e2e/` are `.mjs` scripts outside the suite, requiring a running server and a `BASE_URL` — none run in `npm test`.
- **11 of 82 unit test files use `readFileSync` to regex over your own source code.** They assert that you wrote a string, not that the code does anything. `report-discovery.test.ts` imports 30+ symbols and reads the source file back.

So: 940 passing tests, and the product cannot lock a period, accepts a 95× overpayment, misstates VAT by 50%, 500s on bank account creation, and does not boot from a clean checkout. **Every one of those was found by the first hour of actually calling the API.**

You do not have a testing problem. You have a *no-integration-test* problem, and 940 green checkmarks are actively concealing it.

---

## 7. Head to head

### 7.1 The thing that reframes the whole comparison

There are **two separate UAE regimes** and almost everyone conflates them:

| | FTA Tax Accounting Software Register (TASR) | MoF eInvoicing Accredited Service Provider (ASP) |
|---|---|---|
| Regulator | Federal Tax Authority | **Ministry of Finance** |
| Basis | 2017 administrative guide | **Ministerial Decision 64/2025**, amended by **Ministerial Resolution 56/2026** |
| Nature | Voluntary self-declaration, AED 10,000 | **Compulsory gatekeeper** — you may not supply e-invoicing services in the UAE without it |
| Bar | A form | OpenPeppol certification, **≥2 years operating history**, UAE incorporation, ISO 27001 + 22301, UAE data residency, AED 12.5m of insurance |

**Mandate timetable as of today:**

| Cohort | Must appoint ASP by | Live |
|---|---|---|
| Voluntary pilot | — | **1 Jul 2026 (open now)** |
| Revenue ≥ AED 50m | **30 Oct 2026** | 1 Jan 2027 |
| Revenue < AED 50m | 31 Mar 2027 | 1 Jul 2027 |

Penalties (Cabinet Decision 106/2025): AED 5,000/month for no ASP, AED 100 per untransmitted invoice.

**Of the 42 MoF pre-approved ASPs, exactly two are mainstream accounting vendors: SAP and Tally.** Not Zoho. Not Xero. Not QuickBooks. Not Odoo. Not Wafeq. Not mazeed. Not you.

That is simultaneously the biggest threat and the only real opening in this document. **Nobody you're competing against has solved this either.** The 2-year-operating-history rule locks you out of direct accreditation — but MR 56/2026 Art. 5(bis) permits that experience to sit with an outsourced third party, which makes **white-labelling through an accredited UAE ASP the only viable route, and it is available to you right now.**

### 7.2 Scorecard

Muhasib scored on what I could make it do today, not what it intends to do.

| | **Muhasib** | **Wafeq** | **mazeed** | **QuickBooks Online** | **Zoho Books** | **FreshBooks** |
|---|---|---|---|---|---|---|
| MoF-accredited ASP | ❌ (mock provider) | ❌ | ❌ | ❌ (Intuit stated Apr 2026: no roadmap) | ❌ | ❌ |
| OpenPeppol member | ❌ | ✅ AP+SMP | ❌ | ❌ | ✅ AP+SMP, UAE entity | ❌ |
| PINT AE XML generation | ✅ **real** | partial | claims BIS 3.0 | ❌ | ❌ (ClearTax: "sits at Corner 1") | ❌ |
| FTA TASR listed | ❌ | ✅ expires this month | ❌ | ❌ | ✅ to Nov 2026 | ❌ |
| VAT 201 form | ✅ full 201 incl. Box 1a–1g | generic VAT report | VAT summary | summary only | ✅ full 201 | ❌ **UK only** |
| Emirate Box 1 split | ⚠️ **modelled but defaults to Dubai and ignores place of supply** | ❌ **absent — no emirate field at all** | ⚠️ likely | ❌ | ✅ **correct, via contact place-of-supply** | ❌ impossible |
| Direct EmaraTax filing | ❌ **status flag only** | ❌ | ❌ (advisors file) | ❌ | ✅ **connect, verify, submit, VD** | ❌ |
| VAT figures internally consistent | ❌ **two engines, 75 vs 50** | ✅ | ✅ | ✅ | ✅ | n/a |
| Corporate Tax | ⚠️ workpaper export only | taxable income only | tracking + humans file | ❌ none | ✅ module (Professional+) | ❌ |
| Arabic + RTL | ⚠️ **382 keys / 1,004 hardcoded strings** | ✅ strong, Arabic-default | ✅ full | ❌ **none** | ⚠️ UI yes, **no Arabic CoA** | ❌ none |
| UAE bank feeds | ❌ **none — CSV only** | Wio only | ❌ CSV only | ✅ **ADCB, DIB, ENBD, FAB, RAKBANK** | Yodlee + Wio | ❌ no UAE |
| WPS SIF payroll | ✅ **generator present** | ❌ | ❌ (Bayzat partner) | ❌ | ✅ (separate paid product) | ❌ |
| Period lock / month-end | ❌ **500, broken** | ✅ | ✅ | ✅ | ✅ | ✅ |
| Money stored as decimal | ⚠️ **ledger yes, VAT return no** | ✅ | ✅ | ✅ | ✅ | ✅ |
| Overpayment guard | ❌ **none** | ✅ | ✅ | ✅ | ✅ | ✅ |
| Fixed assets | ✅ present | straight-line, not bill-linked | ❌ | Advanced only | ✅ SL+DB auto-post | ❌ |
| Inventory | ✅ present | Premium | Advance, 1–2 warehouses | Plus+ | Professional+ | ❌ |
| Budgeting | ✅ present | ❌ | ❌ | ✅ | ✅ Premium+ | ❌ |
| Price entry point | AED 0 / 49 / 149 / 299 | AED 69 / 99 / 249, **unlimited users** | **Free / 99 / 170**, unlimited users | ~$38–275, per-user | AED 0 / 69 / 129 / 159 / 349 / 799 | $23 / 43 / 70 + $11/user |
| Customers | **0** | ~18,000 claimed (**~90% Saudi**) | 4,000+ self-reported | not disclosed | **>1m; UAE +77% CAGR, UAE data centres since Jan 2026** | 30m lifetime, **no UAE presence** |

### 7.3 What that table actually says

**Zoho Books is not your peer, it is your ceiling.** Full VAT 201 with correct emirate attribution, direct EmaraTax submission including Voluntary Disclosures, a CT module, WPS payroll, UAE data centres, over a million customers and 77% UAE customer growth — at AED 69/month, undercutting your AED 149 Professional tier. Your pricing page claims Zoho has none of this. Every prospect who has actually used Zoho will notice, and you will lose them in that second.

**Wafeq is the one you can beat, and the mechanism is the emirate split.** Wafeq has no emirate concept anywhere in its data model — one mention of "emirate" across 1,013 help articles, no field on contacts or branches. Its custom tax rates *"cannot be included in VAT reports at all"*, which makes reverse-charge and Designated Zone treatment unworkable. Its TASR entry expires this month. Its 18,000-customer claim rests on 4 incentivised Capterra reviews and 0 on G2, and ~90% of its volume is Saudi. **You have the emirate boxes modelled and Wafeq doesn't — that is a real wedge, and it is currently sabotaged by defaulting to Dubai and by a VAT report that disagrees with your own ledger.**

**QuickBooks is beatable on localisation and nothing else.** No Arabic. No RTL. No corporate tax. Intuit stated on the record in December 2025 and again in April 2026 that UAE e-invoicing is unsupported with no roadmap. Its UAE VAT marketing page is **recycled Malaysian GST content**; its FAQ still references Windows XP and Internet Explorer; zero UAE testimonials. But it has the best UAE bank feed coverage in the market (ADCB, DIB, ENBD, FAB, RAKBANK) and that alone keeps accountants on it.

**mazeed is your closest structural analogue** — Dubai, founded 2018 (formerly McLedger), 4,000+ businesses, full Arabic, AED 170/month unlimited users, and channel distribution through Dubai SME, Sharjah, Hub71, Meydan and e& that you cannot match. It is software *plus* an outsourced accounting service in one app. Its weakness is that its own e-invoicing page still says "Phase 1 — Q2 2026" against the real 30 Oct 2026 dates — stale compliance content from a compliance vendor. It has no live bank feeds either.

**FreshBooks is not a competitor in the UAE.** No VAT 201 (UK/HMRC only), no Arabic, no AED storefront, doesn't even label invoices "Tax Invoice" for the UAE. Remove it from your comparisons; naming it makes you look like you're padding the list.

**The one you left out is the one that should worry you: Tally.** Accredited ASP #35, fully accredited 27 July 2026, native PINT AE XML, emirate field in party ledger masters, direct EmaraTax filing, full Arabic and bilingual invoices — and it **bundles unlimited e-invoices into the annual subscription while everyone else will meter per document**. ~AED 2,340 perpetual, ~AED 4,200 five-year TCO, 65,000+ UAE businesses. When the mandate lands, Tally is the safe answer, and "safe" is what a compliance purchase optimises for.

**And the bank-feed problem is structural, not a backlog item.** CBUAE Open Finance (Circular 7/2023, in force 10 July 2025) **bans screen-scraping** and routes everything through one licensed central API Hub with **usage fees**. Bank data in the UAE is a cost of goods sold, not a free PSD2-style API. Only 7 of 267 UAE banks are reachable through any aggregator; Plaid has zero UAE coverage; DIFC and ADGM are excluded entirely. "We'll add bank feeds later" is a licensing and P&L decision, not a sprint.

---

## 8. What I would actually do

**Stop-the-bleeding — this week**

1. **Delete the Zoho comparison table and the Hassan Mansour testimonial.** Today. Both are legal exposure, and the Zoho row is factually indefensible.
2. **Take the VAT Summary report offline** or repoint it at `vat-autopilot.service.ts`. Two VAT engines returning different numbers is the single most dangerous thing shipping. Never let a tax figure be computed twice by different code.
3. **Commit `scheduler.service.ts`.** The product does not start from a clean checkout.
4. **Reject payments exceeding the invoice balance**, or require an explicit "record as customer credit" confirmation. Never silently post to Deferred Revenue.
5. **Fix `closing_entry_id`** and add an integration test that locks a period and asserts a subsequent post is rejected.

**Structural — this quarter**

6. **Migrate all 44 `real` money columns to `numeric(15,2)`.** Start with `vat_returns.*` and `invoices.base_currency_amount`. Add a CI check that fails on any new `real`/`double precision` column whose name matches a money pattern.
7. **Kill the shadow schema systems.** Delete `ensureCriticalSchema()`'s 76 ALTERs and the runtime `CREATE TABLE`. One migration path. This is the root cause of #5 and of the next three bugs you haven't found yet.
8. **Write 20 integration tests** that drive real HTTP against a real database: signup → invoice → issue → payment → credit note → VAT return → period lock → report. Ban new regex-over-source tests. Your 940 green tests found none of the criticals in this document; twenty honest ones would have found all of them.
9. **Make the emirate a required onboarding field** and attach place-of-supply to the customer contact, not the company. Then Box 1 becomes a genuine differentiator against Wafeq instead of a Dubai-shaped guess.
10. **Sign a white-label agreement with an accredited ASP** under MR 56/2026 Art. 5(bis). You cannot accredit directly — the 2-year rule blocks you — and the ≥AED 50m cohort must appoint by **30 October 2026**. Your XML is already correct; you need the pipe, and this is the highest-value business development action available to you.

**The hard one**

11. **Delete half the product.** Not refactor — delete. Nine nav groups, five AI entry points, five reporting surfaces, 113 routes and a 21,779-line file are why you don't enjoy using it. Pick the five screens a UAE SME owner actually opens — Invoices, Receipts, Bank, VAT, Reports — make those unimprovable, and hide or remove the rest until someone asks. Wafeq beat better-funded competitors by being small. Your ledger is good enough to win on; the surface area around it is what's losing.

---

## 9. Closing

The uncomfortable summary: **you have built the hard part and shipped the easy part badly.** Double-entry bookkeeping, tenant isolation, transactional invoice numbering, FTA retention, UBL generation — those are the things most teams get wrong, and yours are right. Float columns in a tax return, a report that disagrees with the ledger, a missing database column, an unguarded payment amount, and a false claim about a competitor — those are all fixable in a fortnight by someone who already knows how to write the hard part.

What isn't fixable in a fortnight is the size. 219,000 lines and 61 nav destinations for a product with zero customers means every one of those 61 screens was built on a guess. The market you're entering has a hard compliance deadline in 84 days for large filers, one credible incumbent that has actually cleared it, and a leader in Zoho who does your headline feature better and cheaper than you do.

You have one genuine wedge — correct emirate-level VAT 201 attribution, which Wafeq structurally cannot do and QuickBooks has never tried — plus WPS SIF generation that three of your five named competitors lack entirely. Both are currently buried under features nobody asked for and undermined by a report that returns the wrong number.

Fix the five criticals. Delete half the app. Sign the ASP deal. That's the whole plan.

---

### Sources for the competitive section

- UAE MoF eInvoicing programme & pre-approved ASP list — https://mof.gov.ae/en/about-us/initiatives/einvoicing/pre-approved-einvoicing-service-providers/
- Ministerial Decision 64/2025 (ASP accreditation) — https://mof.gov.ae/wp-content/uploads/2025/03/Ministerial_Decision_Eligibility_and_Accreditation_procedure_for_SPs_EN.pdf
- Ministerial Resolution 56/2026 (amending MD 64/2025) — https://mof.gov.ae/wp-content/uploads/2026/05/Ministerial-Resolution-No.-56-of-2026-Amending-Certain-Provisions-of-Ministerial-Resolution-No.-64-of-2025-En-20260510.pdf
- Ministerial Resolution 66/2026 (revised mandate dates) — https://mof.gov.ae/wp-content/uploads/2026/05/Ministerial-Resolution-No.-66-of-2026-Amending-Certain-Provisions-of-Ministerial-Resolution-No.-244-of-2025-Regarding-the-Implementation-of-the-Electronic-Invoicing-System-En-20260514.pdf
- Cabinet Decision 106/2025 (e-invoicing penalties) — https://mof.gov.ae/wp-content/uploads/2025/12/Cabinet-Decision-Violations-and-Penalties-eInvoicing-final-version-en-8.12.25.pdf
- FTA accredited tax accounting software vendors — https://tax.gov.ae/en/tax.support/tax.accounting.software.vendors/accredited.tax.accounting.software.vendors.aspx
- FTA Requirements Document for Tax Accounting Software — https://tax.gov.ae/DataFolder/Files/Pdf/requirement-document-for-tax-accounting-software.pdf
- Zoho Books UAE — VAT return filing — https://www.zoho.com/ae/books/help/vat-uae/vat-return-filing.html
- Zoho Books UAE — Corporate Tax — https://www.zoho.com/ae/books/help/corporate-tax/
- Zoho Books UAE pricing — https://www.zoho.com/ae/books/pricing/
- ClearTax on Zoho's Peppol position — https://www.cleartax.com/ae/uae-e-invoicing-zoho-integration
- Wafeq pricing — https://www.wafeq.com/en-ae
- Wafeq Corporate Tax guide — https://help.wafeq.com/hc/en-ae/articles/19934722200860-Corporate-Tax-in-Wafeq-A-Practical-Guide
- mazeed pricing — https://mazeed.com/pricing/
- mazeed tax — https://mazeed.com/tax/
- QuickBooks UAE VAT — https://quickbooks.intuit.com/ae/vat-tracking/
- QuickBooks pricing — https://www.capterra.com/p/190778/QuickBooks-Online/pricing/
- Tally full ASP accreditation — https://www.zawya.com/en/press-release/tally-solutions-becomes-a-fully-accredited-service-provider-by-the-uae-ministry-of-finance-410443
- Avalara on the 2026 mandate — https://www.avalara.com/blog/en/europe/2026/03/uae-e-invoicing-mandate-2026-readiness-asp-pint-ae.html
