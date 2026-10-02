# Phase 8 design — D2 Purchases, projects and people (lead L2, 2026-10-02)

S3 backend, S4 frontend, migrations 0106-0109. Cost first: cheapest correct route, no paid services, batch your work,
consult before spending. Code claims verified on `launch/phase-8-complete-product`; schema read from a migrated
database (`muhasib_p8_l2`).

## 1. Scope

| # | Stream | Delivered |
|---|---|---|
| A | Contacts (0106, first) | `contact_type`; `vendor_id` on bills, POs, vendor credits, backfilled; vendor resolution on writes; Drizzle definitions; 1080 |
| B | Vendor statement | JSON/PDF/email mirroring the customer one; payables ageing detail |
| C | Approvals (0108) | Amount/role rules, ≤ 2 steps, gating bill, claim, PO, payroll and manual-journal approval; queue; notifications; audit |
| D | Projects (0107) | Tasks, time (manual + timer), billable bill lines and claim items, invoice from unbilled, ledger profitability |
| E | People (0109) | Leave (Decree-Law 33/2021) with unpaid/sick deductions in the run, loans capped at 20% via 1080, final settlement, payroll register |

Gratuity accrual stays as built (Dr 5028 / Cr 2036, `payroll.routes.ts:1103-1110`, 1136-1143); the calculator
(`payroll.routes.ts:224-335`) is moved unchanged into `server/services/gratuity.ts` so settlement reuses it.

Cut (VP cuts or low demand against cost): fixed-fee billing, expense markup, labour cost, timesheet approval, live
timer across devices, WIP accrual; approvals beyond two steps or on non-amount conditions, delegation; leave pay-rule
engine (maternity, Hajj are `manual` types); leave-salary provision posting (D4 report); employee self-service;
holiday calendar; unpaid leave reducing gratuity service; settlement PDF; contact merge; project tags on journals.

Existing bugs fixed here because approvals depend on them:
1. `POST /api/bills/:id/payments` (`bill-pay.routes.ts:627-700`) has no status check: paying a pending bill posts
   Dr 2010 / Cr bank with no AP credit and sets `partial`, so `approve` (`:585`) refuses it forever. Fix: 409
   `BILL_NOT_APPROVED`.
2. Bill approve (`:563-625`) and payroll approve (`payroll.routes.ts:957-1215`) are unlocked check-then-write; payroll
   posting (source `system`, `:1153`) has no idempotency check, so parallel approves post twice. Fix: both run under
   `withDocumentLock(id, LOCK_NS.APPROVAL)` with the status re-read inside.
3. `generate-sif` (`:1217`) works on unapproved runs. Fix: 409 `PAYROLL_NOT_APPROVED` (summary item 10).
4. PO `receive` (`purchase-orders.routes.ts:275`) accepts `sent`. Fix: `approved` only when a PO rule exists.
5. `payableAgingAsOfSql` (`aging-as-of.service.ts:146-170`) counts `pending` (unposted) bills, so ageing ≠ 2010. Fix:
   exclude `pending`/`pending_approval` there; the Bill Pay to-do card keeps them.

Corrections: roles are `owner | accountant | cfo | employee` (`shared/schema.ts:460`), no "bookkeeper" (tests use
`employee`); a locked period returns 403 (`period-lock.service.ts:16-35`), not 409; `purchase_orders` is already
Drizzle (`shared/schema.ts:1273`); the platform VP's `billable_expenses`, `employee_loan_deductions`,
`eos_provisions` give way to the CTO names (EOS provision = `payroll_items.gratuity_accrual` less settlements).

## 2. Data

SQL is idempotent (`IF NOT EXISTS`, constraints in `DO $$ … duplicate_object`). Money `numeric(15,2)`, days
`numeric(6,2)`. Every new table has `company_id NOT NULL → companies ON DELETE CASCADE`; routes check
`hasCompanyAccess` and the row's company; ids in bodies (contact, project, employee, account, task) are re-checked
against the company (422 `INVALID_<THING>`).

**Journal ordering hazard.** Drizzle applies only migrations whose `when` exceeds the last applied one. If 0106 is
journaled before D1's 0102 exists, any database that ran 0106 skips 0102 later. Rule for all leads: `when =
1781430160000 + (N − 101) × 10000`, `idx = N − 1`, journal kept sorted by tag; implementers drop and re-migrate their
`muhasib_p8_*` database after each merge of another domain's migration.

### 0106_unified_contacts_vendor_id.sql
```sql
ALTER TABLE customer_contacts ADD COLUMN IF NOT EXISTS contact_type text NOT NULL DEFAULT 'customer';
-- CHECK (contact_type IN ('customer','vendor','both'))
ALTER TABLE vendor_bills        ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES customer_contacts(id) ON DELETE SET NULL;
ALTER TABLE purchase_orders     ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES customer_contacts(id) ON DELETE SET NULL;
ALTER TABLE vendor_credit_notes ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES customer_contacts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_bills_company_vendor ON vendor_bills(company_id, vendor_id);   -- same for POs, credits
CREATE INDEX IF NOT EXISTS idx_customer_contacts_company_lname ON customer_contacts(company_id, lower(btrim(name)));
-- 1: insert a 'vendor' contact per (company, lower(btrim(name))) that has no contact; TRN only if ^[0-9]{15}$
-- 2: link rows whose normalised name matches exactly one contact (ambiguous stay NULL)
-- 3: linked 'customer' contacts become 'both'
```
SET NULL follows `invoices.contact_id`; statements fall back to the name snapshot as `buildCustomerStatement` does
(`customer-statement.service.ts:327`). Step 1 goes beyond the CTO's "exact name match" (summary item 9).

Drizzle: all D2 definitions go in a new `shared/schema-purchasing-hr.ts` (imported directly), so `shared/schema.ts`
(5,148 lines) gets only anchored edits: `export` on `money` (`:24`), `customerContacts.contactType`,
`purchaseOrders.vendorId`, `journalLines.projectId`, `invoiceLines.projectId`. Raw-SQL tables defined for every live
column: `vendorBills`, `billLineItems`, `billPayments`, `vendorCreditNotes`, `vendorCreditNoteLines`,
`vendorCreditApplications`, `expenseClaims`, `expenseClaimItems`, `employees`, `payrollRuns`, `payrollItems`.
Date-only `timestamp` columns use `{ mode: "string" }` (the local-time shift at `bill-pay.routes.ts:98-104`).
Account **1080 Employee Loans** (asset, system) joins the default chart and is ensured on demand like 5200
(`inventory-costing.service.ts:99-123`).

### 0107_projects_time.sql
| Table / column | Columns and constraints |
|---|---|
| `projects` | code (`P-0001`, unique per company), name, name_ar, contact_id → customer_contacts SET NULL, status (`active,on_hold,completed,cancelled`), billing_method (`hourly,non_billable`), hourly_rate, currency default 'AED', budget_amount, budget_hours, start_date, end_date, description |
| `project_tasks` | project_id CASCADE, name, hourly_rate NULL, is_billable default true, status (`open,done`) |
| `time_entries` | project_id RESTRICT, task_id SET NULL, user_id, entry_date, minutes 0..1440, started_at/ended_at, is_billable, rate NULL, notes, billed_invoice_id → invoices SET NULL; one running timer per user (unique partial index `WHERE ended_at IS NULL AND started_at IS NOT NULL`); index (company, project, date) |
| `project_expenses` | project_id RESTRICT, source_type (`bill_line,expense_claim_item`), bill_line_item_id UNIQUE → bill_line_items CASCADE, expense_claim_item_id UNIQUE → expense_claim_items CASCADE, CHECK exactly one source, expense_date, description, amount_aed (net cost), is_billable, billed_invoice_id → invoices SET NULL |
| `bill_line_items`, `expense_claim_items` | + project_id → projects SET NULL, + is_billable boolean NOT NULL DEFAULT false |
| `invoice_lines` | + project_id → projects SET NULL |
| `journal_lines` | + project_id → projects (RESTRICT; a project with postings cannot be deleted) + partial index WHERE project_id IS NOT NULL |

Unbilled ⇔ `billed_invoice_id IS NULL OR invoice.status IN ('void','cancelled')`. The link is to the invoice, not
the line, because invoice edits re-insert lines (`invoices.routes.ts:772`); deleting the draft frees the entries.

### 0108_approvals.sql
| Table | Columns and constraints |
|---|---|
| `approval_rules` | document_type (`bill,expense_claim,purchase_order,payroll_run,manual_journal`), name, threshold_aed ≥ 0 (applies when amount **>** threshold), approver_roles text[] (1-2 of `accountant,cfo,owner`), is_active; index `(company_id, document_type) WHERE is_active` |
| `approval_requests` | document_type, document_id, rule_id RESTRICT, amount_aed, required_steps, completed_steps, status (`pending,approved,rejected,cancelled`), previous_status, requested_by, created_at, decided_at; unique partial `(document_type, document_id) WHERE status='pending'` |
| `approval_steps` | request_id CASCADE, step_number, required_role, decided_by → users, decision (`approved,rejected`), comment, decided_at; unique `(request_id, step_number)` and `(request_id, decided_by)` (one person signs once) |

### 0109_leave_loans_settlement.sql
| Table / column | Columns and constraints |
|---|---|
| `leave_types` | code (unique per company), name_en, name_ar, pay_policy (`full,sick_tiered,half,unpaid,manual`), annual_days, accrual (`monthly_service,annual,none`), carry_forward_max_days, allow_negative default false, is_active. Seeded lazily: annual 30 (carry 30), sick 90, maternity 60 (manual), parental 5, bereavement 5, study 10, Hajj 30 and unpaid (unpaid) |
| `leave_balances` | employee_id CASCADE, leave_type_id CASCADE, leave_year, opening_days, adjustment_days, note; unique per (employee, type, year); overrides only, balances are derived |
| `leave_requests` | employee_id CASCADE, leave_type_id RESTRICT, start_date, end_date (≥ start), days > 0 (default calendar days inclusive, halves allowed), status (`pending,approved,rejected,cancelled`), reason, decided_by/at, created_by |
| `employee_loans` | employee_id RESTRICT, loan_number (`LN-0001`, unique per company), kind (`loan,advance`), principal > 0, instalment_count 1..120, instalment_amount, first_period_year/month, disbursement_date, payment_account_id → accounts, status (`active,settled,cancelled`), journal_entry_id, cancel_journal_entry_id |
| `employee_loan_installments` | loan_id CASCADE, sequence, period_year, period_month, amount, deducted_amount, status (`scheduled,reserved,deducted,settled,cancelled`), payroll_run_id/payroll_item_id SET NULL; unique `(loan_id, sequence)` |
| `employee_final_settlements` | employee_id RESTRICT, termination_date, reason (`resignation,termination,end_of_contract`), basic/wage/GCC/years snapshots, gratuity_amount, provision_used, gratuity_true_up (signed), leave days and encashment, loan_recovered, other_deductions, net_payable, status (`draft,posted,paid,void`), journal ids; unique partial `(employee_id) WHERE status IN ('draft','posted','paid')` |
| `payroll_items` | + leave_deduction, loan_deduction, unpaid_leave_days, half_pay_leave_days (default 0) |
| `payroll_runs` | + total_leave_deductions, total_loan_deductions |
| `employees` | + termination_date date |

## 3. Posting rules

All through `storage.createJournalEntry` (month lock and period re-check, `storage.ts:1915-1917`), with
`assertPeriodNotLocked` first for a clean 403. New sources are non-`manual`, hence read-only in
`journal-entry-protection.ts`; S3 adds an undo hint per source.

| Event | Journal | Date | Source |
|---|---|---|---|
| Bill approved (final step) | Unchanged (`bill-posting.service.ts:137-245`); expense lines carry `project_id` from their bill line | bill_date | `bill` |
| Claim approved (final step) | Unchanged, but `buildExpenseClaimJournalLines` aggregates by (code, project) instead of code (`expense-claim-posting.ts:87-115`) | latest item date | `expense_claim` |
| Project invoice issued | Existing invoice posting; revenue credit lines split by (account, project) | invoice date | `invoice` |
| Loan disbursed | Dr 1080 / Cr payment account (cash/bank type only, else 422) | disbursement_date, not future | `employee_loan` |
| Loan cancelled (no deductions) | Exact reversal | original date (403 if locked) | `employee_loan_cancel` |
| Loan repaid in cash | Dr payment account / Cr 1080; remaining instalments `settled` | given date | `employee_loan_repayment` |
| Payroll approved | Existing entry with Dr 5020 = Σ(gross − leave_deduction); + Cr 1080 Σ loan_deduction; net already reduced | period end | `system` (unchanged) |
| Final settlement posted | Dr 2036 provision_used; Dr 5028 true-up if > 0 (Cr 5028 if < 0, over-accrual released); Dr 5020 leave encashment; Cr 1080 loan recovered; Cr 2034 other deductions; Cr 2030 net payable | termination_date | `final_settlement` |
| Settlement paid | Dr 2030 / Cr payment account | given date | `final_settlement_payment` |
| Settlement voided (unpaid) | Exact reversal; employee back to active | original date | `final_settlement_void` |

Pure formulas: daily wage = basic/30 (`payroll.routes.ts:38-42`); leave deduction = basic/30 × unpaid days +
basic/60 × half-pay days; sick days tier cumulatively per calendar year: 15 full, 30 half, 45 unpaid (Art. 31);
annual accrual per completed month: 0 in service months 1-6, 2 days in months 7-12, 2.5 from month 13 (Art. 29;
summary item 8); balance = opening (override, else min(carry max, prior closing)) + accrued + adjustment − approved;
available = balance − pending. Loan instalment ≤ 20% of monthly wage (basic + all allowances), else 422
`DEDUCTION_CAP {maxInstalment}`; in a run, loan + general deductions ≤ 50% of gross, the excess rolls into a new
last instalment (Art. 25); the last instalment absorbs rounding. Provision used defaults to the employee's Σ
`gratuity_accrual` in approved runs; an override above the 2036 balance → 422 `PROVISION_EXCEEDS_BALANCE`; net < 0
→ 422 `SETTLEMENT_NEGATIVE`.

VAT only through existing bill, claim and invoice posting. FX: people items are AED; project invoices use
`resolveDocumentExchangeRate`; approval amount = bill total × rate, claim total, PO total (non-AED PO at the latest
company rate; none → the rule applies).

## 4. State machines and invariants

**Approval gate** (`approval-gate.service.ts`), called by each approve route inside
`withDocumentLock(documentId, LOCK_NS.APPROVAL)` after re-reading the document:
1. No active rule with amount > threshold → today's behaviour exactly (a 4,000 bill approves in one step).
2. Else (highest matching threshold wins) find or create the pending request (snapshot of rule, amount,
   `previous_status`). Step k needs rank ≥ the step role (owner 3, cfo 2, accountant 1, employee 0; firm staff and
   platform admins rank 1), else 403 `APPROVAL_REQUIRED {step, requiredSteps, requiredRole}`; a prior signer gets 403
   `APPROVER_ALREADY_SIGNED`; the claim submitter or journal creator 403 `SELF_APPROVAL`.
3. k < required → record the step, status `pending_approval`, notify the next role (in-app; email when configured).
4. k = required → existing posting, then the step, request and document `approved`. Bill and claim posting is
   idempotent per source; payroll relies on the in-lock re-read.

| Document | Before | During | After | Reject restores |
|---|---|---|---|---|
| bill | pending | pending_approval | approved | pending |
| expense_claim | submitted | pending_approval | approved | rejected (existing semantics) |
| purchase_order | sent (draft accepted) | pending_approval | approved | draft |
| payroll_run | calculated | pending_approval | approved | calculated |
| manual_journal | draft | draft + pending request | posted | draft |

Edit, delete, recalculate or pay with a pending request → 409 `APPROVAL_IN_PROGRESS`. Journal create-as-posted
passes the gate only for a one-step rule the creator may sign (else 403: save a draft). A period locked while waiting
makes the final step 403; reject, re-date, resubmit.

**Projects.** Invoicing runs in `withDocumentLock(projectId, LOCK_NS.PROJECT_INVOICE)`, selects the chosen unbilled
entries `FOR UPDATE`, creates one draft invoice and sets `billed_invoice_id` in the same transaction; nothing left →
409 `NOTHING_TO_BILL`. Billed entries are read-only (409 `TIME_ENTRY_BILLED`). Timer stop: minutes =
round((ended − started)/60 s). `project_expenses` rows are inserted (ON CONFLICT DO NOTHING) at bill/claim final
approval for lines with a project.

**Leave.** Create/approve under `withDocumentLock(employeeId, LOCK_NS.LEAVE)`: overlap with pending/approved → 409
`LEAVE_OVERLAP`; annual over available and not `allow_negative` → 422 `LEAVE_INSUFFICIENT_BALANCE`; inactive
employee → 409 `EMPLOYEE_NOT_ACTIVE`; changing approved leave inside an approved run's month → 409
`LEAVE_IN_APPROVED_PAYROLL`.

**Loans.** `active` → `settled` when every instalment is `deducted`/`settled`. Calculate reserves due instalments
(`period ≤ run period`, status scheduled) to the run and item, and releases them on recalculation; approve marks them
`deducted`. Calculate always recomputes leave and loan deductions and net for every item, including
`manually_edited` ones (`payroll.routes.ts:798-806` preserves those today).

**Settlement.** draft → posted (employee `terminated`, termination_date set) → paid; posted → void only while unpaid.
LOCK_NS 1020-1029 are reserved for D2 (APPROVAL 1020, PROJECT_INVOICE 1021, LEAVE 1022, EMPLOYEE_LOAN 1023,
SETTLEMENT 1024).

## 5. API contract

All: `authMiddleware, requireCustomer`, `hasCompanyAccess` (403), zod `validate()` (400), lists `limit ≤ 200,
offset`, errors `{message, code}`. HR writes need rank ≥ accountant (403 `ROLE_REQUIRED`); rules are owner-only.

**Contacts and purchases (extend).** `GET /api/companies/:companyId/customer-contacts?type=customer|vendor` (customer
includes both; omitted = all as today; `contacts.routes.ts:73`); POST/PUT take `contactType` (`:92`, `:346`); a
change stranding linked documents → 409 `CONTACT_TYPE_IN_USE`. Bill create/PATCH (`bill-pay.routes.ts:50-82`),
credit note and PO writes take `vendor_id`/`vendorId`; `resolveVendor` validates it (422 `INVALID_VENDOR`; a customer
becomes both) or links by normalised name, creating a vendor when none matches (ambiguous → unlinked, warning
`VENDOR_AMBIGUOUS`), and snapshots name/TRN; opening-balance bills (`opening-balance.service.ts:379`) use it too.
Bill lines and claim items take `project_id`, `is_billable`.

**Vendor statement.** `GET /api/companies/:companyId/contacts/:contactId/vendor-statement?from&to` →
the customer statement shape with line types `bill|vendor_credit|payment`; credit raises what we owe; bills count
once approved/partial/paid; AED at the document rate. `…/vendor-statement/pdf`, `POST …/vendor-statement/email` (503 `EMAIL_NOT_CONFIGURED`, 400 `NO_RECIPIENT`, as
`statements.routes.ts`). `GET /api/companies/:companyId/payables/ageing-detail?asOf&vendorId` →
`{asOf, vendors[{vendorId, name, rows[{billId, number, billDate, dueDate, currency, outstanding, outstandingAed,
daysPastDue, bucket}], totals}], totals}`, built on `billOutstandingAsOfSql` and `unappliedCreditAsOfSql`.

**Approvals (new `approvals.routes.ts`).** `GET/POST /api/companies/:companyId/approval-rules`, `PATCH/DELETE
/api/approval-rules/:id` (delete = deactivate). `GET /api/companies/:companyId/approvals?status&documentType` →
rows `{requestId|null, documentType, documentId, reference, counterparty, amountAed, completedSteps,
requiredSteps, nextRole, canAct}`; pending includes documents a rule covers that nobody has signed yet. `GET /api/approvals/:documentType/:documentId` (history), `POST /api/approvals/:documentType/:documentId/reject
{comment}`, `POST /api/journal/:id/submit-for-approval`. Gated: bill approve (`bill-pay.routes.ts:563`), claim approve
(`expense-claims.routes.ts:429`), PO approve (`purchase-orders.routes.ts:222`), payroll approve
(`payroll.routes.ts:958`), journal post and create (`journal.routes.ts:506`, `:125`).

**Projects (new `projects.routes.ts`).** `GET/POST /api/companies/:companyId/projects`, `GET/PATCH/DELETE
/api/projects/:id` (delete 409 `PROJECT_HAS_ACTIVITY`), `GET/POST /api/projects/:id/tasks`, `PATCH/DELETE
/api/project-tasks/:id`, `GET/POST /api/companies/:companyId/time-entries` (`{projectId, taskId?, entryDate, minutes
| hours, isBillable, rate?, notes}`), `PATCH/DELETE /api/time-entries/:id`, `GET /api/companies/:companyId/timer`,
`POST …/timer/start` (409 `TIMER_ALREADY_RUNNING`), `POST …/timer/stop`, `GET /api/projects/:id/unbilled` →
`{timeEntries, expenses, unbilledHours, unbilledAmount, unbilledExpenses}`, `POST /api/projects/:id/invoice
{timeEntryIds?, expenseIds?, date?, dueDate?, vatRate: 0|5 = 5}` → 201 draft, one line per item with `projectId` (422
`PROJECT_HAS_NO_CUSTOMER`; `CURRENCY_MISMATCH` for expenses on a non-AED project),
`GET /api/projects/:id/profitability?from&to` → `{revenue, costs, margin, marginPct, hours{total, billable,
billed, unbilled}, budget{amount, hours, usedPct}}` from posted `journal_lines` by project.

**People (new `leave.routes.ts`, `employee-loans.routes.ts`, `final-settlements.routes.ts`).**
`GET/POST /api/companies/:companyId/leave-types`, `PATCH /api/leave-types/:id`; `GET
/api/companies/:companyId/leave-balances?asOf&employeeId` → `[{employeeId, leaveTypeId, code, year, opening,
accrued, adjustment, taken, pending, balance, available}]`, `PUT …/leave-balances`; `GET/POST
/api/companies/:companyId/leave-requests`, `POST /api/leave-requests/:id/approve|reject|cancel`. `POST
/api/companies/:companyId/employee-loans/preview`, `GET/POST …/employee-loans`, `GET /api/employee-loans/:id`,
`POST /api/employee-loans/:id/cancel` (409 `LOAN_HAS_DEDUCTIONS`), `POST /api/employee-loans/:id/repay`. `POST
/api/companies/:companyId/final-settlements/preview`, `GET/POST …/final-settlements` (409 `SETTLEMENT_EXISTS`),
`POST /api/final-settlements/:id/post|pay|void`. `GET /api/payroll-runs/:id/register?format=json|csv` (per-employee
components, totals, `journalTieOut`). Payslips show leave and loan deductions.

## 6. UI

| Change | Files (S4) |
|---|---|
| Nav: Sales → Projects, Accounting → Approvals (keys in `client/src/lib/i18n.ts`, nav test updated) | `nav-config.ts`, `App.tsx` (`/projects`, `/projects/:id`, `/approvals`) |
| Projects list and form; detail tabs Time, Expenses, Unbilled → Create invoice, Profitability with budget | `pages/Projects.tsx`, `pages/ProjectDetail.tsx`, `components/projects/{TimerButton,TimeEntryDialog,ProjectInvoiceDialog}.tsx` |
| Approvals queue (filters, approve/reject, history drawer) and Rules tab (owner) | `pages/Approvals.tsx`, `components/approvals/{ApprovalStatusBadge,ApprovalHistory}.tsx` |
| Badge + 403 `APPROVAL_REQUIRED` toast naming the role | BillPay, ExpenseClaims, PurchaseOrders, Payroll, Journal |
| Vendor picker (type vendor, "create vendor" inline) replacing free-text vendor name; line Project + Billable | `components/purchases/VendorPicker.tsx`, BillPay, PurchaseOrders, VendorCredits, ExpenseClaims |
| Contacts: type field, type filter, "Vendor statement" action (statement + ageing tabs, PDF, email) | `CustomerContacts.tsx`, `components/VendorStatementDialog.tsx` (mirrors `CustomerStatementDialog.tsx`) |
| Payroll tabs Leave, Loans (schedule preview), Final settlement (preview, post, pay), Register with CSV | `components/payroll/{LeaveTab,LoansTab,FinalSettlementTab,PayrollRegisterDialog}.tsx`; `Payroll.tsx` anchored TabsTriggers |

Each new file has a `*.i18n.ts` with Arabic; `check-i18n` passes with no allow-list additions. The PDF is server-side:
`pdf-statement.service.ts` gains `party: "customer" | "vendor"` (labels, "SUPPLIER / المورد") on the `pdf-fonts` helpers.

## 7. Tests

`tests/integration/phase8-d2.test.mjs` (pattern of `phase6-vendor-credits.test.mjs`), in `test:integration`; ledger
checks read `journal_lines`. S3 writes it; S4 runs it before the walkthrough.

| AC | Test |
|---|---|
| D2-1 | Project rate 200; 2h, 1.5h, 0.5h non-billable → `unbilledHours 3.5`, `unbilledAmount 700`; timer start/stop rounds to the minute; second start 409 |
| D2-2 | Claim item 300 + bill line 500 tagged billable, both approved → `/invoice` gives 4 lines with `projectId`, VAT 5%; second call 409 `NOTHING_TO_BILL`; deleting the draft frees the entries |
| D2-3 | Issue it → profitability revenue 1,500, costs 800, margin 700, equal to a direct `journal_lines` sum |
| D2-4 | Rule > 5,000 [accountant, owner]: employee 403 `APPROVAL_REQUIRED`; accountant → 1/2, no JE; again 403 `APPROVER_ALREADY_SIGNED`; owner → one `bill` JE; audit row per step; 4,000 bill one step; 10 parallel finals → one JE |
| D2-5 | Same on claim, PO, journal, payroll: each refuses without the steps; queue lists all five; notifications; email 503 tolerated |
| D2-6 | Joined 2024-01-01, basic 6,000, annual type carry 0: balance at 2026-09-30 = 22.5; request 5 → available 17.5; overlap 409 |
| D2-7 | 20 sick days approved in one month → item gross 5,500, Dr 5020 reduced by 500 |
| D2-8 | 12,000 × 6 → 422 `DEDUCTION_CAP`; × 10 → Dr 1080 12,000 / Cr bank; run Cr 1080 1,200, net 4,800, SIF net 4,800 |
| D2-9 | Expat 3y 6m, basic 6,000, 4 leave days, provision 10,500 (2036 journal + override): gratuity = calculator (VP's 14,700 approximates the trailing /365); Dr 2036 10,500, Dr 5028 rest / Cr 2030; leave Dr 5020 800; GCC 0; 24 × wage cap |
| D2-10 | Register rows sum to the run; net = Cr 2030, gross − leave = Dr 5020, loans = Cr 1080 |
| D2-11 | Vendor: 3 bills, 1 credit, 1 payment → running balance; closing = 2010; ageing detail total = payables ageing for V; PDF starts `%PDF`; email 503 without provider |
| extra | 0106 backfill (case/space variants → one contact, ambiguous NULL); fixes 1-5; tenant probes (§10) |

S3 unit tests (vitest): leave accrual, sick tiers, loan schedule (caps, rounding), settlement, rule matching and
ranking, `computeVendorStatement`, project billing, claim posting split by project. S4: nav test, `VendorPicker` and
`ApprovalStatusBadge` tests, i18n gate, walkthrough at 1280 and 375 px in English and Arabic.

## 8. Work split

**S3 owns:** migrations 0106-0109 and their journal entries; `shared/schema-purchasing-hr.ts`; anchored edits in
`shared/schema.ts`; services `vendor-contact`, `vendor-statement`, `gratuity`, `project`,
`project-billing` (pure), `project-invoice`, `approval-rules` (pure), `approval-gate`, `approval-queue`,
`leave-math` (pure), `leave`, `loan-math` (pure), `employee-loan`, `final-settlement`, `payroll-register`; edits to
`bill-posting.service.ts`, `expense-claim-posting.ts`, `pdf-statement.service.ts`, `pdf-payslip.service.ts`,
`aging-as-of.service.ts`, `journal-entry-protection.ts`, `document-lock.ts`, `defaultChartOfAccounts.ts`,
`constants.ts`, `opening-balance.service.ts`; routes: new `projects`, `approvals`, `leave`, `employee-loans`,
`final-settlements`, `vendor-statements`; edits to `bill-pay`, `expense-claims`, `purchase-orders`, `payroll`,
`journal`, `contacts`, `vendor-credits` routes (+ `vendor-credit.service.ts`); `server/routes.ts`,
`config/route-registry.json`, `package.json` (test chain); all tests above except S4's.

**S4 owns:** every client file in §6 with its `*.i18n.ts`, `client/src/lib/i18n.ts` (nav keys), `nav-config.ts`
and its test, `App.tsx` (anchored), client component tests.

S3 order: (1) 0106, resolver, Drizzle definitions, 1080, then report "0106 in tree" to the CTO; (2) vendor
statement and ageing; (3) 0108 gate and fixes 1-4; (4) 0107 projects; (5) 0109 leave, loans, settlement, register.
S4 order: contacts and VendorPicker, statement dialog, approvals, projects, payroll tabs; until each S3 step lands S4
codes against §5 with typed stub responses. Migrations and server files are S3's only.

## 9. Dependencies

| Domain | Need | Fallback if late |
|---|---|---|
| D1 | `createInvoiceDraft` extracted from `invoices.routes.ts:396-567` (D1 needs it for sales orders) passing line `projectId`; revenue allocation keyed by (account, project), credit-note lines copying it; customer pickers use `?type=customer` | S3 extracts the service and makes the small allocation edit at step 4; D1 rebases. D2-3 fails if this is missing |
| D3 | Forecast treats `pending_approval` bills as outflows; payroll net includes loans | none needed |
| D4 | Reports 51-53, 57-58 and vendor reports over `shared/schema-purchasing-hr.ts`; catalog entries for ageing detail and register; fix 5 | endpoints work standalone |
| D5 | v1 `contacts.type` = `contact_type`; wizard vendors via `resolveVendor`; export/deletion cover new tables | — |
| All | Migration `when`/`idx` rule (§2); LOCK_NS 1020-1029 | — |

## 10. Review plan (live requests, two companies A and B)

1. Tenant: B's contact, project, employee or account ids in A's bills, lines, time, loans, leave and payments; a B
   user rejecting A's request → 403/422, nothing written; A's queue and statements never show B rows.
2. Money: profitability, vendor closing, register and settlement re-derived from `journal_lines`; trial balance after
   every step; a USD bill @3.6725 through approval and statement.
3. Bypass while `pending_approval`: pay, edit, delete, recalculate, receive, SIF, journal create-as-posted; role
   fields in bodies; one user signing both steps; rule edited mid-request.
4. Concurrency (10 parallel): final approves per type, `/invoice` on one project, timers, overlapping leave, loan
   cancel against payroll approve → one effect each.
5. Locked or VAT-filed month for approve, disburse, settle, pay → 403, nothing posted.
6. Labour law: caps with allowances, sick tiers across months, 6-12 month accrual, 2-year cap, GCC, settlement with a
   loan outstanding. 7. Re-run 0106 on legacy data: no duplicate contacts.

## Summary for the CTO

1. 0106 is small and lands first: `contact_type`, three `vendor_id` columns, backfill, Drizzle definitions, 1080.
2. Approvals wrap the five existing approve routes in a lock-safe gate; one new status `pending_approval`.
3. Five existing bugs fixed on the way: unapproved bills can be paid, payroll approve can post twice, SIF from
   unapproved runs, PO receive skips approval, payables ageing counts unposted bills.
4. Projects bill time and tagged costs into draft invoices; profitability is read from `journal_lines.project_id`.
5. Needs from D1: an extracted `createInvoiceDraft` and project-keyed revenue allocation (S3 does it if D1 is late).
6. Leave, sick tiers and loans flow into the existing payroll run and journal; settlement posts gratuity true-up,
   leave encashment and loan recovery.
7. All leads: reserve migration `when` values by number or later migrations are silently skipped.
8. Owner/accountant: the 6-12 month leave accrual reading, sick-leave year = calendar year, carry-forward default 30.
9. Owner: backfill creates vendor contacts for unmatched names (otherwise legacy bills stay out of statements).
10. Owner: SIF only after approval (behaviour change), and which pricing tier gets projects and approvals.
