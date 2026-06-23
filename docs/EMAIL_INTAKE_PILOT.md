# Email-to-VAT Document Intake — Internal Pilot Spec

> **What this is.** Clients email their source documents (invoices, receipts,
> bank statements) to NR Accounting. The system pulls those emails, OCRs the
> attachments, classifies and drafts the bookkeeping entries, and the accountant
> reviews and approves — feeding the existing VAT 201 engine. The first-pass data
> entry is automated; the human stays in the loop for completeness and judgement.
>
> **Scope guardrails (firm-only, controlled pilot):**
> - **NR Accounting clients only.** Gated behind `firmRole` (`firm_owner` /
>   `firm_admin`) — never exposed to regular SaaS customers or `client_portal`.
> - **Feature-flagged** (`EMAIL_INTAKE_ENABLED`) and **off by default**.
> - **No public release** until proven on our own clients for **≥ 6 months**
>   (see §7 exit criteria). We control the senders, the mailbox, and the accountant.
> - **Nothing is filed automatically.** Output is always a *draft* return an
>   accountant approves. Human approval is mandatory and audited.

## 1. Pipeline and reuse map

The pipeline is ~75–80% existing code. Only the front of the pipe is new.

| Stage | Status | Component |
|-------|--------|-----------|
| 1. Client emails documents | **NEW** | inbound ingestion + sender→company routing (this spec) |
| 2. Extract data from attachments | reuse | `/api/ocr/process` (Claude/GPT vision → structured JSON) |
| 3. Classify (sales/purchase, category, VAT) | reuse | `receipt-classifier.service` (rule→keyword→statistical→AI) |
| 4. Draft / auto-post entry | reuse | `receipt-autopilot.service` (confidence-gated, audited) |
| 5. Accountant review & approve | reuse | AI Inbox / unposted `receipts` queue (firm view) |
| 6. VAT 201 return | reuse | `vat-autopilot.service` + firm VAT workspace |

The new build is: **ingest emails → match sender to a client company → split
attachments → hand each file to the existing OCR endpoint** with the resolved
`companyId`. Everything downstream already works.

## 2. Architecture — ingestion

Two ways to get the email in. Recommendation: start with **A** for the pilot
(matches "scan our mailbox", zero change for clients), design the routing layer
so **B** can slot in later without a rewrite.

**Option A — connect one firm mailbox, filter by sender (pilot default).**
NR connects a dedicated mailbox (e.g. `documents@nraccounting.ae`) via Gmail API
(OAuth) or IMAP. A scheduled poller (reuse `scheduler.service`) reads new
messages, matches each `From:` address against the sender→company map, pulls
attachments for matched senders, and ignores the rest. Clients just email the
address they already use. No new domain, no per-client setup beyond the mapping.

**Option B — inbound parse webhook + per-client sub-address (scale path).**
Provider (Mailgun/Postmark/Resend inbound) parses incoming mail and POSTs it to a
webhook. Each client gets `docs+<clientCode>@yourdomain` — routing is unambiguous
from the address, no `From`-matching needed. Cleaner and more robust at volume;
adopt after the pilot proves the flow.

Either way the ingestion layer normalises to one internal shape
`{ companyId, fromEmail, subject, receivedAt, messageId, attachments[] }` and the
rest of the pipeline is identical.

## 3. Data model (new tables)

```
client_email_sources              -- the sender→company link ("link an email to a customer")
  id, company_id (FK), firm_id, sender_email (citext, unique per firm),
  label, status ('active'|'paused'), require_dkim_pass (bool, default true),
  created_by, created_at

email_intake_messages             -- one row per ingested email (idempotent on message_id)
  id, company_id (FK), source_id (FK), provider_message_id (unique),
  from_email, subject, received_at, attachment_count,
  status ('received'|'processing'|'partially_processed'|'done'|'ignored'|'error'),
  error, created_at

email_intake_documents            -- one row per attachment; links to the created receipt
  id, message_id (FK), company_id (FK), filename, mime_type, byte_size,
  storage_path, sha256 (dedup key), doc_kind ('invoice'|'receipt'|'statement'|'unknown'),
  ocr_status, receipt_id (FK -> receipts), is_duplicate (bool), created_at
```

`receipts` already holds the OCR output and the review/approve state
(`posted`/`autoPosted`/`classifierMethod`/`journalEntryId`), so no change there —
intake documents just point at the receipt they produced.

## 4. Routing, de-duplication, completeness

- **Routing.** `sender_email → company_id` via `client_email_sources`. Unmatched
  senders are logged and skipped (never auto-created — prevents poisoning a ledger).
- **De-dup.** SHA-256 of each attachment; a repeat hash for the same company is
  flagged `is_duplicate` and skipped, not posted. Guards against the client
  emailing the same invoice twice, or an invoice arriving by email *and* bank feed.
- **Completeness — the most important control.** OCR can't flag a document that
  never arrived, and a VAT return is only correct if *all* sales and purchases are
  captured. So intake is paired with the existing **bank-feed reconciliation**:
  unmatched bank lines = "evidence we expect but haven't received", which drives
  the existing **document-chasing** nudges to the client. The accountant sees a
  reconciliation gap before approving, not after filing.
- **Tax-point / period mapping.** Each receipt's date determines its VAT period;
  documents landing after a period is locked surface as a late-document exception
  (reuse `period-lock.service`), not a silent post into the wrong return.

## 5. Review & approve (reuse, firm-scoped)

High-confidence, standard-category, AED documents auto-post (existing autopilot
rules: confidence ≥ threshold, ≥5 rule acceptances); everything else queues for
review. The firm sees a per-client intake queue: source document side-by-side with
the proposed entry, an Internal-vs-AI confidence badge, and approve / correct /
reject. Corrections feed the classifier's learning loop. Sales-vs-purchase,
zero-rated/exempt/out-of-scope, reverse-charge on imports, and blocked input VAT
(entertainment, certain motor vehicles) remain **accountant decisions** — the
queue surfaces the suggestion, the human confirms.

## 6. Security, privacy, compliance

- **Firm-only + flagged.** `firmRole` gate on every route; `EMAIL_INTAKE_ENABLED`
  off by default; all reads tenant-scoped by `companyId`.
- **Sender authenticity.** Verify SPF/DKIM pass before ingesting (`From` is
  spoofable); `require_dkim_pass` per source. Allowlist-only — unknown senders ignored.
- **Mailbox credentials are an owner action.** Connecting Gmail/IMAP or the inbound
  provider is done by NR in the provider's own consent screen; the app stores tokens
  encrypted (existing `TOKEN_ENCRYPTION_KEY` vault). I won't enter those credentials.
- **PDPL + retention.** Client financial data already covered by the Privacy Policy
  and the 5-year FTA retention posture; intake docs inherit both. Every auto-post and
  approval writes an audit row.
- **No auto-file.** The return is never submitted without explicit accountant approval.

## 7. Pilot success criteria — the 6-month exit gate

Proven enough to consider a wider release only when, across NR's own clients:

1. **Extraction accuracy** ≥ target on the fields that matter (total, VAT amount,
   date, supplier, TRN) — measured against accountant corrections, not self-reported.
2. **Classification precision** on sales-vs-purchase and rate treatment high enough
   that review is a confirmation, not a re-do.
3. **Completeness:** intake + bank reconciliation catches missing documents *before*
   filing; zero periods filed with a known unreconciled gap.
4. **Time saved per return** quantified vs the current manual process (the headline ROI).
5. **Zero incorrect auto-posts** reaching a filed return without a human catch.
6. **Operational:** dedup, period-lock exceptions, and spoof rejection all behaving.

Track these per return in a simple pilot scorecard from day one.

## 8. Phased build plan

- **P1 — Ingestion skeleton.** `client_email_sources` + mapping UI (firm settings);
  Gmail/IMAP poller via scheduler; normalise to the internal message shape; store
  attachments + dedup hash. Flagged off.
- **P2 — Wire to OCR/autopilot. [DONE]** Each non-duplicate, processable
  attachment is OCR'd in-memory during ingestion (`ocr-extraction.service.ts`:
  `extractReceiptToOcr` for the vision call, pure `normalizeOcrJson` for the
  amount math — made self-consistent since results auto-post), then run through
  the existing `runAutopilot` (draft or auto-post + audit), with the created
  `receiptId` linked back onto the intake document and `ocr_status` updated.
  Extractor + autopilot are injectable seams; no-op when no AI key is set.
  Tests: `ocr-extraction.test.ts`. (Firm intake queue *view* is the remaining
  P2 UI piece, deferred with the rest of the client UI.)
- **P3 — Completeness + exceptions. [DONE, backend]** `intake-completeness.ts`:
  pure `computeCompletenessGaps` turns a period's unmatched bank lines into an
  evidence-gap list (unmatched outflow = missing purchase doc; unmatched inflow =
  possibly-unrecorded sale; "suggested" still counts as a gap until a human
  confirms), sorted biggest-first, plus a coverage ratio — the completeness check
  before filing. Exposed at `GET /api/firm/email-intake/completeness/:companyId`
  (firm-gated, period query). Late-document/period-lock is already handled:
  `runAutopilot` never posts into a locked period (assertPeriodNotLocked) and
  queues the receipt for review instead. Duplicate detection landed in P1/P2
  (sha256, `is_duplicate`). Tests: `intake-completeness.test.ts` (9).
  Remaining: wire gaps into document-chasing nudges + the firm UI (with the rest
  of the client UI).
- **P4 — Pilot instrumentation.** Per-return scorecard (accuracy, time saved,
  completeness), correction-feedback loop, weekly review with the accountant.
- **P5 — Hardening for the sub-address model (Option B)** only if/when going wider.

## 9. Owner setup actions (not code)

- Pick and create the intake mailbox (or domain for Option B) and connect it
  (OAuth/IMAP) — you do this in the provider's consent screen.
- Decide the per-field accuracy targets for §7.
- Identify the pilot clients and brief them on the email address to use.

_Status: spec / not started. Scoped as a firm-internal, flagged, 6-month controlled
pilot. No public release until §7 is met._
