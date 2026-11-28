# Muhasib — Verification Report

**Date:** 8 August 2026
**Question:** is the implemented work correct and working, end to end, from a clean checkout?

**Answer: yes — verified on a fresh extract of this repo, installed with `npm ci`,
built with `npm run build`, and exercised through the production artifacts
(`dist/migrate.js` + `dist/index.js`).**

> ### ⚠️ Read this first — exact scope of verification
>
> The **989-assertion gauntlet below was run and passed** on the code as it stood
> after the correctness round (criticals, highs, mediums, dead-code removal,
> performance).
>
> A later round added the report-only CSP header, the ASP HTTP adapter, the
> scoreboard, and CI wording. Each was tested **after** its final edit:
>
> | Change | Evidence |
> |---|---|
> | ASP adapter + provider selection | **11/11 unit tests pass** — and they import both modules, proving the wiring resolves |
> | Report-only CSP header | both headers asserted on a live server with correct values |
> | Scoreboard | executed; output cross-checked line-for-line against `wc -l` |
> | CI workflow | YAML parsed; all 4 jobs and their steps confirmed |
>
> **The following carry no test evidence**, because the verification sandbox ran
> out of disk before a final consolidated run:
>
> 1. **C6 — the foreign-currency receipt fix** in `vat.routes.ts` (found later by
>    static review; see the changelog). Arithmetically a no-op for AED data, and
>    a regression test is written and waiting in `flow.test.mjs` — but it has not
>    been executed. **This is the one to re-run first.**
> 2. Dead-code cleanup in `CreditNotes.tsx` (three unreferenced mutations and
>    three unused icon imports; zero remaining references confirmed by search,
>    JSX re-read for balance).
> 3. One extra `styleSrc` line in the **report-only** CSP directives (affects a
>    non-enforcing header only).
> 4. Comment lines and a step **name** change in `ci.yml` (YAML comments cannot
>    alter parsing).
>
> All are low-risk by construction, but "low-risk" is not "verified". **Run the
> five-minute gauntlet at the bottom of this document before shipping**, then
> delete this block.

---

## The gauntlet

| Step | Command | Result |
|---|---|---|
| Install | `npm ci` | ✅ 1011 packages, clean |
| Typecheck + guards | `npm run check` | ✅ `tsc` clean · money-types ✓ · migration-journal ✓ · bundle/route/api-contract ✓ |
| Unit tests | `npm test` | ✅ **939 passed**, 1 skipped (83 files) |
| Build | `npm run build` | ✅ client + `dist/index.js` + `dist/migrate.js` |
| Migrate (clean DB) | `node dist/migrate.js` | ✅ 88 migrations apply from empty |
| Boot | `node dist/index.js` | ✅ `/api/version` → 200, `environment: production` |
| Integration | `npm run test:integration` | ✅ **50/50** (17 fixes + 33 flow) |

**989 assertions green** (939 unit + 50 integration) on the production build.

---

## Scoreboard

| Metric | Baseline | Now | Δ |
|---|---:|---:|---|
| TypeScript LOC | 219,217 | **211,388** | −7,829 |
| Source files | 430 | **403** | −27 |
| Page components | 102 | **96** | −6 |
| Production dependencies | 108 | **95** | −13 |
| First-paint JS (raw) | 2,013,806 B | **1,133,732 B** | **−44%** |
| First-paint JS (gzip) | ~602 KB | **328 KB** | **−46%** |
| CSS (raw) | 254,267 B | **236,350 B** | −18 KB |
| Float money columns | 63 | **0** | ✅ |
| Unjournaled migrations | 8 | **0** | ✅ |
| npm vulnerabilities | 10 (7 high) | **1** | −9 |
| Integration tests | 0 | **50** | ✅ |
| App boots from clean clone | ✗ | **✓** | ✅ |

---

## Every issue, and its disposition

### Criticals — all closed and tested
| | Fix | Proof |
|---|---|---|
| **C5** boot | restored `scheduler.service.ts` | boots from clean clone; CI gate added |
| **C4** overpayment | 422 unless explicit `allowCredit` | AED 100,000 on a 1,050 invoice rejected; exact payment still works |
| **C3** period lock | migration `0087` fixes column + unique constraint; runtime DDL removed | lock succeeds; write into locked month blocked; outside still works |
| **C2** float money | migration `0086` → `numeric`; root cause was an unjournaled migration | AED 9,999,999.99 round-trips exactly |
| **C1** VAT engine | wrong endpoint deleted | single engine; VAT 201 ties to the GL |

### Highs — all closed and tested
- **H1 emirate** — `DEFAULT 'dubai'` dropped (migration `0088`), `COALESCE` removed; VAT 201 and autopilot now **refuse** with `EMIRATE_NOT_SET` rather than guessing. *Tested both ways.*
- **H2 false "filed"** — submitting without an FTA reference now returns `status: submitted` **plus an explicit `filing.transmittedByMuhasib: false`** and a message stating Muhasib does not file with the FTA. Supplying a reference promotes it to `filed` and records it. Client toast reworded to "Finalised for review — not yet filed". *4 assertions.*
- **H3 mock e-invoicing** — the mock provider now **throws in production** (503 `EINVOICE_PROVIDER_NOT_CONFIGURED`) so a fabricated acceptance can never reach a UAE business.
- **H4 VAT periods** — span/format/future validation; 1900→2999 and future periods rejected.
- **H6 bank 500** — Zod-validated with a `name` alias; 422 not 500.
- **H7 TRN** — malformed contact TRN rejected (422); valid 15-digit accepted.
- **H8 quota** — `maxCompanies` was declared and never read. Now enforced per owning user, using their **highest** tier, exempting admins and firm users, and skipped when billing enforcement is off.

### Mediums
- **D3 rate limit** — the key is `ip:userId`, so the 3000/min read budget was **per user**. Lowered to **600/min** (still 10 req/s).
- **D6 dependencies** — 10 vulnerabilities → 1 (the last needs a breaking major bump).
- **D7 heap** — `tsc` OOM'd on the default heap; pinned in CI.
- **D5 NODE_ENV** — already closed at build time on Railway; no `vercel.json` exists.

### Corrections to my own plan (verified wrong, not done)
Three plan items were **wrong** and doing them would have caused harm:

1. **"Delete the five 410 credit-note routes."** A `410 Gone` with an explanatory message is *correct* deprecation; deleting them yields a less useful `404`. **Kept.** The real defect was four permanently-disabled menu items in the UI — those are now removed.
2. **"`POST /invoices/:id/post` always fails — delete/rename."** It has a working repair path. **Kept**, with a comment documenting that it is a repair endpoint, not the issue path.
3. **"`ClientDashboard.tsx` is orphaned — delete."** `Dashboard.tsx:97` renders it for client users. **Kept.**

Two source-scanning unit tests referenced the deleted dead landing pages and were repointed at the live `MuhasibLanding.tsx` — they were previously guarding a page nobody shipped.

---

## Not done, and why — honestly

| Item | Status |
|---|---|
| **ASP e-invoicing contract** | **Only the signature remains.** The adapter is now written: `server/services/einvoice-provider-http.ts` implements the full submit / poll / webhook flow against the REST shape ASPs use, with 11 unit tests. Going live is `EINVOICE_PROVIDER=http` plus two credentials — **no code change**. Env vars documented in `.env.example`. |
| **EmaraTax direct filing** | Depends on the ASP relationship and FTA access. The honest interim (record the FTA reference, never claim to have filed) is implemented and tested. |
| **CSP `style-src` tightening (D4)** | **Now unblocked, shipped safely.** The tightened split (`style-src-elem` without `'unsafe-inline'`) is served as a second `Content-Security-Policy-Report-Only` header. It blocks nothing; browsers report what *would* have broken to `/api/csp-report`. Verified both headers are emitted with the right values. Runbook to promote it to enforced is in `csp.ts`. |
| **The Great Deletion to 12 screens** | Partially done: all **dead** code removed (−7,829 lines, −27 files, −13 deps). The remaining reduction means deleting *working* features, and you chose "keep both, SME ships first" — so the firm product stays. This is a product decision, not a cleanup. |
| **Full Arabic translation** | Baseline gate shipped (`npm run audit:i18n`: 49/111 pages, ~3,406 strings). Translating them is a Phase-3 effort across the surviving screens, and pointless before the screen count is reduced. |

---

## Reproduce it

```bash
git clone <repo> muhasib-verify && cd muhasib-verify
npm ci
npm run check          # tsc + money-types + migration-journal + existing guards
npm test               # 939 unit tests
npm run build          # client + server + migrate bundle
node dist/migrate.js   # against a clean DATABASE_URL
node dist/index.js &
BASE_URL=http://127.0.0.1:5000 npm run test:integration   # 50 assertions
npm run scoreboard                                        # metrics vs baseline
```

Every command above was executed and passed on a clean extract of this repo on
8 August 2026 — see the scope note at the top for the one round that was not
re-run end to end.

### Verifying the two newly-unblocked items

**CSP report-only** — boot the server and confirm both headers are present:

```bash
curl -sI http://127.0.0.1:5000/api/version | grep -i '^content-security-policy'
# Content-Security-Policy:              ... style-src 'self' 'unsafe-inline' ...   (enforced, permissive)
# Content-Security-Policy-Report-Only:  ... style-src-elem 'self' https://fonts... (tightened, reporting)
```

Then run the app for a week and grep the logs for `CSP violation reported`. Zero
violations on `style-src-elem` means you can promote the tightened directives
into the enforced policy and delete the report-only one.

**ASP adapter** — with no contract yet, production correctly refuses to fabricate:

```bash
# production + no provider configured -> 503, never a fake "submitted"
NODE_ENV=production node -e "import('./dist/index.js')"
```

Once you sign, set `EINVOICE_PROVIDER=http`, `EINVOICE_API_BASE_URL` and
`EINVOICE_API_KEY`. If the provider's status vocabulary differs, extend
`STATUS_MAP` in `einvoice-provider-http.ts` — unknown statuses deliberately map
to `failed`, never `accepted`.
