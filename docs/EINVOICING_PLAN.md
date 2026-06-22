# UAE E-Invoicing Readiness Plan

_Drafted 2026-06-11. Regulatory facts below reflect public announcements
known as of early 2026 and MUST be re-verified against the Ministry of
Finance / FTA's current publications before implementation._

## Context

The UAE Ministry of Finance is rolling out a national e-invoicing
("e-billing") regime modelled on the OpenPeppol **five-corner** model:
supplier → Accredited Service Provider (ASP) → ASP → buyer, with corner 5
reporting to the FTA. The data format is **PINT AE** (the Peppol
International invoice profile localized for the UAE). Phased B2B/B2G
adoption was announced to begin around July 2026, starting with larger
taxpayers. Action item: confirm the current phase dates, taxpayer
thresholds, and the published ASP register before building.

## What this means for Muhasib

Muhasib will NOT need to become an ASP. The strategy is to be the best
**ASP-ready bookkeeping source**: produce compliant PINT AE payloads and
hand off to a certified ASP via API.

## Technical workstream

1. **Schema readiness (already partly done)**: invoices carry
   `einvoiceUuid`, `einvoiceXml`, `einvoiceHash`, `einvoiceStatus`
   columns. Extend with `aspMessageId`, `aspName`, `submittedAt`,
   `buyerEndpointId` when integrating.
2. **PINT AE serializer**: a service converting our invoice + lines +
   company/customer TRNs into PINT AE XML (UBL 2.1 base). Unit-test
   against the official validation artefacts once published.
3. **Validation gate**: TRN presence/format, line VAT category codes
   (S/Z/E/O map to our `vatSupplyType`), rounding rules, mandatory buyer
   fields — surfaced as fix-it errors on the invoice before submission.
4. **ASP integration layer**: an adapter interface (like
   `open-banking.service.ts`) so the first ASP choice isn't load-bearing.
   Candidate ASPs to evaluate once the official register is live (e.g.
   Pagero, Sovos, EDICOM and regional entrants — verify accreditation).
5. **Status lifecycle**: generated → submitted → accepted/rejected with
   webhook/poll updates, shown on the invoice and in Filing Pulse.
6. **E2E flow**: invoice → serialize → validate → (sandbox ASP) submit →
   status assertion, added to the CI gate like every other feature.

## Sequencing

Build 2–3 (serializer + validation) early — they are provider-independent
and de-risk the deadline. Defer 4–5 until an ASP sandbox account exists
(owner action, like Stripe/Lean).

## Progress (2026-06-21) — P1 increment, serializer/validation hardened

Provider-independent work (items 2–3) advanced and test-backed (`tests/unit/einvoice.test.ts`,
full suite 707 green):

- **PINT-AE profile identifiers** extracted to constants `EINVOICE_CUSTOMIZATION_ID` /
  `EINVOICE_PROFILE_ID` (replacing the generic EU EN16931/Peppol-BIS IDs hardcoded inline, which an
  AE validator rejects). ⚠️ The exact URNs still MUST be confirmed against the FTA PINT-AE spec /
  Peppol PINT-AE package before go-live — they are now a single point of truth.
- **Credit notes** now serialize as `InvoiceTypeCode` **381** with a `cac:BillingReference` to the
  original invoice (previously every document, including credit notes, was emitted as type 380).
- **Validation gate** now also requires a document currency code.
- (Already in place and verified: per-line UNCL5305 VAT categories S/Z/E/O, grouped tax subtotals,
  supplier/buyer TRN 15-digit checks, line-vs-total reconciliation, SHA-256 hash + UUID, QR code.)

### Remaining gaps before an FTA/ASP submission (prioritised)

1. **Verify exact PINT-AE CustomizationID/ProfileID** and validate generated XML against the official
   PINT-AE validation artefacts once published (owner: obtain spec).
2. **Foreign-currency invoices:** PINT-AE/FTA require the VAT total also expressed in AED (tax currency)
   — depends on the FX work (A-B4 done; settlement-rate items A-B5 deferred). Add `TaxCurrencyCode` +
   AED `TaxTotal`.
3. **Full CreditNote document syntax:** strict PINT-AE credit notes use a `<CreditNote>` root, not an
   `<Invoice>` with type 381. Current output is an interim improvement; add a dedicated CreditNote
   serializer.
4. **Peppol routing identifiers:** seller/buyer `cbc:EndpointID schemeID="…"` (e.g. TRN/Peppol ID) —
   needed at the ASP hand-off (item 4).
5. **ASP adapter + status lifecycle (items 4–5):** deferred until a certified-ASP sandbox account exists
   (owner action). Build behind an adapter interface like `open-banking.service.ts`.
