# Phase 8 sign-off — D4 reports/compliance/insight and D5 platform/security/experience (VP Platform, 2026-10-02)

Judged as the buyer: an SME owner in Dubai and their accountant, in English and Arabic, desktop and 375 px.
Bar: `2026-10-02-phase8-bar-platform.md`. Designs: `phase8-design-D4.md`, `phase8-design-D5.md`.
Environment: fresh `muhasib_p8_vpb` on :5092 (124 migrations), company "Al Noor Trading LLC" seeded through the API
with 3 invoices (one 45 days overdue, one partly paid, one paid), a credit note, an approved and part-paid bill, a
pending bill, 2FA enrolled, two API keys, one export, one Zoho import. Suites run on this server:
`phase8-d4` 307/307, `phase8-platform` 445/445, `mobile-audit` 55/55 (en+ar), a11y ratchet pass, i18n gate pass.
Cost first: cheapest correct route, no paid services, batch your work, consult before spending.

## Ledger effect of the seed (read from `trial-balance` and `/dashboard/stats`)

| Account | Balance | Ties to |
|---|---|---|
| 1040 Receivables | Dr 2,340.00 | dashboard `outstanding` 2,340 = 840 overdue (1,050 − 210 credit note) + 1,500 current (2,100 − 600) |
| 2010 Payables | Cr 1,100.00 | dashboard `payablesOutstanding` 1,100 (2,100 approved − 1,000 paid; pending 525 bill left out) |
| 4010 Revenue | Cr 3,300.00 | 1,000 + 2,000 + 500 − 200 credit note |
| 2020 Output VAT / 1050 Input VAT | Cr 165.00 / Dr 100.00 | VAT due next 75 = Q3 output 175 − input 100, due 28 Oct |
| 1020 Bank | Dr 125.00 | 525 + 600 received − 1,000 paid |
| Trial balance | 4,565.00 = 4,565.00 | balanced |

## D4 walkthrough

| Stream | What I did and saw | Verdict | Gap |
|---|---|---|---|
| Catalog and run route | `/api/reports/catalog`: 67 live, 0 planned, every entry has `href`, `params`, `drillTarget`, `formats` json/csv/xlsx/pdf, schedulable. Ran all 67 as JSON (200) and 30 as Arabic PDF (200) until the 30/min limiter | meets | 31st+ PDF in a minute → 429 (defect 7) |
| Params and comparison | P&L Sep `compare=priorPeriod`: `amount`, `__cmp`, `__delta`, `__pct` columns; Revenue 2,500 vs 1,000, delta 1,500, 150%. Receivables Detail as-of picker with presets. Unknown key → 400 | meets | — |
| Drill-down | Receivables Detail rows link to the invoice (`/invoices?highlight=…`); GL lines to the journal entry | meets | — |
| Arabic PDF | Receivables Detail `lang=ar` rendered and inspected as an image: shaped Arabic title and headers, mirrored RTL columns, Western digits, Arabic month names, totals row, "صفحة 1 / 1" | meets | — |
| CSV / XLSX | CSV with BOM, CRLF, Arabic headers when `lang=ar`; XLSX offered in the Download menu with "produced on the server" note | meets | — |
| Schedules | Dialog: format, language, cadence, Dubai hour, as-of preset, members-only recipients. API create → `run-now` → run `skipped EMAIL_NOT_CONFIGURED`, rows 2, 12,648 bytes; non-member recipient → 422 | meets | Email silent until the owner sets a provider (known) |
| Dashboard KPIs | Period selector (This month / Fiscal YTD), five AR and AP buckets, overdue, VAT due next card with due date, footnote on what is period vs as-at. Numbers tie to the ledger (table above). Revenue −200 this month because the credit note is October: honest by `KPI_DEFINITIONS.md` | meets | "Margin 0.0%" on a negative-revenue month (defect 4); "25/25 ready" and "56 synced reports" beside a 67-report catalog (defect 3) |
| Firm consolidation | `consolidated-statements` with one entity: entity, elimination, consolidated columns. Intercompany mismatch path covered by suite F1-F2 (`UNMATCHED_INTERCOMPANY`); I had no firm to drive it in the browser | partly (not browser-verified) | None found |
| Audit trail | UNION over `activity_logs` and `audit_logs` (`management.ts:232-244`); today's 21 rows show API writes, key creation, export, import, bill approve/payment, credit note | meets | `2fa.enable`/`2fa.login` rows have no `company_id`, so sign-in events never appear in a company's trail (defect 6) |

## D5 walkthrough

| Stream | What I did and saw | Verdict | Gap |
|---|---|---|---|
| 2FA enrol | Security page: manual key, QR, code field. Entered a code computed from the key → "On", 10 recovery codes dialog with Copy / Download / Print, Done disabled until saved; audit row; other sessions revoked (my API token died, as designed) | meets | — |
| Login challenge | Arabic, 375 px: "التحقق بخطوتين", code field, recovery-code link, back link; wrong frame has no cookie. API: login → `{twoFactorRequired, methods}` → verify → tokens; replaying the challenge → 401 `CHALLENGE_EXPIRED` | meets | — |
| Sessions | "Where you are signed in": device, IP, last active, This device, Sign out, Sign out all other devices | meets | `lastUsedAt` shown 4 h before `createdAt` (defect 1) |
| Change password, require-2FA | Form with live rules and code field once 2FA is on; company policy switch for owner/accountant/CFO. Covered by suite (AC17, require-2FA scope) | meets (suite) | — |
| API keys and docs | Developers page lists keys with prefix, permissions, status, last used, revoke. Key create returns the secret once. `/developers/api`: 29 endpoints from `/api/v1/openapi.json` (3.1, 21 paths), filter box, auth/idempotency/limits/money sections | meets | Docs English only (stated); no OAuth2 (cut) |
| API v1 behaviour | `GET /api/v1/invoices?limit=2`: envelope, money as "−210.00" strings, cursor, `RateLimit-*` draft-7 headers 60/min. No scope → 403; write without `Idempotency-Key` → 400; same key twice → 201 + `Idempotent-Replayed: true`, one invoice; different body → 422 | meets | Invoice list includes credit notes (`type` field present) (defect 8) |
| Export ZIP | Data & privacy: request → Ready in seconds, 51 KB, 24 h link. ZIP: 120 CSVs, `manifest.json` with rows and SHA-256 per file, secret columns listed as excluded | meets | Requested/expiry times skewed 4 h (defect 1) |
| Deletion | Without password → 401 `REAUTH_REQUIRED`; wrong name → 422; correct → pending, `purgeAfter` +30 d; member access → 403; restore → 200 and access back. Page copy explains 30 days, anonymisation, API-key revocation | meets | Copy says records kept 5 years; CT law says 7 (owner item, defect 5) |
| Import wizard | 6-step wizard (source → entity → upload → match → check → import) with Zoho/QuickBooks/Xero/generic. API: Zoho contacts CSV with 2 bad rows → suggested mapping, dry run 2 errors and no writes, commit created 2 contacts (3 → 5), recommit → 409 | meets | Opening-position step not driven by me (suite covers `postOpeningBalance`) |
| Help | 48 articles en and ar; Arabic search "ضريبة" → "تم العثور على 29 مقالًا"; contextual "Help with this page" on every page I opened (`/help/reports`, `/help/security` …) | meets | `?q=` in the URL is ignored (defect 10) |
| 375 px and a11y | `mobile-audit.mjs` 55/55 en+ar (no overflow, 24 px targets, labelled inputs); Arabic login and 2FA step at 375 px are clean; `check-a11y-basics` passes on a 78-item ratchet | meets | Sidebar group toggles are unnamed buttons (defect 9) |
| Camera capture | `CameraCapture.tsx` uses `capture="environment"` with downscale; not exercisable in a desktop browser | partly (code only) | — |

## Against the bar

| Area | Zoho Books | FreshBooks | Wafeq | Watin |
|---|---|---|---|---|
| Reports | At bar: 67 vs "50+", compare, drill, PDF/CSV/XLSX, schedules, Arabic PDFs Zoho lacks | Ahead | Ahead | Ahead |
| API | At bar: scoped keys, idempotency, OpenAPI; behind only on OAuth2 | Ahead | Ahead | Ahead (unsure of theirs) |
| Security | At bar: TOTP, recovery, sessions, require-2FA | At bar | Ahead (unsure) | Ahead (unsure) |
| Migration | At bar: wizard with presets and dry run | Ahead | Ahead | Ahead |
| Mobile | Behind: no native app; responsive web passes | Behind | Behind | Unsure |
| Help | At bar on articles and search; behind on webinars and chat | At bar | Ahead (Arabic parity) | Ahead |

## Defects

| # | Defect, reproduction | Severity | Smallest fix |
|---|---|---|---|
| 1 | Mixed timestamp sources: DB-default `now()` writes Dubai-local into `timestamp` columns while the app writes UTC (`SHOW timezone` = Asia/Dubai on the embedded DB). Repro: `GET /api/auth/sessions` → `createdAt` 14:48Z, `lastUsedAt` 10:48Z; export list shows "Requested 6:50 PM, expires 2:50 PM next day". Production Neon is UTC, so it hides there, but 24 h export links, 30-day purge and schedule slots depend on the DB's zone | Medium | `server/db.ts`: pool `options: "-c timezone=UTC"` (and in `migrate.ts`); one unit test asserting `SELECT now() = now() AT TIME ZONE 'UTC'` |
| 2 | Save-schedule POST returned 401 and the app bounced to login. Root cause was the shared browser pane: another agent's login on `localhost:<other port>` overwrote the host-scoped cookies (cookies ignore ports). Not a product bug; schedules verified through the API | None | Nothing; keep one browser per server in future sign-offs |
| 3 | Dashboard shows "Reports workspace · 25/25 ready" and "56 synced reports" next to a 67-report catalog (persona subsets, unlabelled) | Low | `Dashboard.tsx:806-824`: say "for the Owner persona" or use catalog totals |
| 4 | Net profit card "Margin 0.0%" when revenue is −200 and profit −200 (`Dashboard.tsx:1963` returns 0 for revenue ≤ 0) | Low | Margin = null when revenue ≤ 0; render "—" |
| 11 | Arabic dashboard read 2 s after load showed the headline "صافي الربح ‏0.00 AED" while the tile said −200: the headline is a 1.4 s `requestAnimationFrame` count-up (`Dashboard.tsx:124-146`), which never runs in a hidden tab and reads as 0.00 to a screen reader or a fast glance | Low | Skip the animation when `document.hidden` or reduce-motion and render the target; `aria-live="polite"` on the final value |
| 5 | Data & privacy copy and `RETENTION_YEARS = 5` (`retention.service.ts:2`); CT Law Art. 56 requires 7 | Low / owner | Set 7 after owner/legal confirm; copy key in `DataPrivacy.i18n.ts` |
| 6 | `2fa.enable`, `2fa.login`, `login` rows carry no `company_id`, so a firm owner's Audit Trail never shows who signed in | Low | In `management.ts:244` add a third UNION branch: `audit_logs` of users in `company_users` of the company where `company_id IS NULL`, labelled "security" |
| 7 | Non-JSON report formats limited to 30/min per user: a month-end pack of 31 PDFs hits 429 | Low | `report-run.routes.ts`: 60/min, or exempt CSV |
| 8 | `GET /api/v1/invoices` returns credit notes (negative totals) in the invoice list | Low | Default `type=invoice`; document `type=credit_note` filter in OpenAPI |
| 9 | Sidebar group toggles and three header buttons have no accessible name (`button [ref_11..20]` in every `read_page`) | Low | `aria-label` from the group label in the sidebar component; remove them from the ratchet |
| 10 | `/help?q=VAT` ignores the query; search works only by typing | Low | Read `q` into the search state on mount |

## Verdict

**Ship with listed fixes.** Both domains meet the bar I set; every money figure ties to the ledger; nothing in the UI
claims a feature that is off. Fix 1 before the first production deploy on any database whose zone is not UTC; 3-10 go in
the fix round.

Fix order: 1 (timezone), 6 (security events in the trail), 8 (v1 invoice list), 7 (export limiter), 3 and 4 (dashboard
copy and margin), 9 (sidebar names), 10 (help deep link), 5 (owner decision on 7 years). Owner items unchanged from the
bar document: email provider key, 2FA default for firm owners, retention 7 vs 5, publishing the API docs.

## Summary for the CTO

1. D4 and D5 pass the sign-off; verdict is ship with fixes, none blocking except the DB-timezone guard on non-UTC databases.
2. 67 live reports run through one route with range/as-of/comparison, drill-down, Arabic PDF, CSV/XLSX and schedules; I inspected the Arabic PDF visually and it is right.
3. Dashboard KPIs match `KPI_DEFINITIONS.md` and tie to 1040 and 2010 to the fils on my seed.
4. 2FA, login challenge (Arabic, 375 px), sessions, require-2FA, API keys, OpenAPI docs, export ZIP, deletion with restore and the Zoho import all worked end to end as a buyer would use them.
5. API v1 behaves like a public API should: envelope, scopes, idempotency replay, draft-7 rate headers.
6. Suites on my server: d4 307/307, platform 445/445, mobile audit 55/55, a11y and i18n gates green.
7. One medium defect: DB-default timestamps are local, app timestamps are UTC; one-line pool option fixes it.
8. Ten low defects, all with a named file and a small fix; none change money.
9. Not browser-verified: firm consolidation mismatch warnings and camera capture (suite and code only).
10. The shared browser pane logs agents out of each other's servers (host-scoped cookies); give each sign-off its own browser next time.
