# UAE e-invoicing providers: switching and discarding (E2)

Each company chooses from two MoF-accredited e-invoicing providers. Both use the same
`EInvoiceProvider` interface, two-track status model, onboarding table and durable queues.

| Provider   | Legal name (MoF register)       | Accreditation | Notes                                                |
| ---------- | ------------------------------- | ------------- | ---------------------------------------------------- |
| A-Cube     | Platform ACube Technologies LLC | 188961        | [einvoicing-acube.md](einvoicing-acube.md)           |
| Complyance | Complyance Electronics L.L.C    | 112219        | [einvoicing-complyance.md](einvoicing-complyance.md) |

Register: https://mof.gov.ae/en/about-us/initiatives/einvoicing/einvoicing-accredited-service-providers-asps/
(read 2026-11-17, 88 providers).

## Switching

Set up the company's encrypted credentials and provider environment using the
[company runtime guide](einvoicing-company-runtime.md). The Settings card shows local configuration
status. Changing providers requires a new EmaraTax appointment. Existing submission and status
work stays pinned to the provider and environment that received it.

## Partner choice, identity and the approver link (WQ5)

There is no default partner. Settings → E-invoicing lists every provider compiled into the build
(from `registeredProviderIds()`, so the card names none in code) and the company stores its choice
in `companies.einvoice_partner`. "Verify with partner" calls the selected provider's
`…/einvoicing/<id>/sync` route once the company's credentials are configured. The company can also
record its own unverified confirmation (`einvoice_appointment_confirmed_at`).

- Seller identity (`PUT /api/companies/:id/einvoicing/identity`, Settings → Company card and the
  first-invoice prompt): stored TIN (`einvoice_tin`, 10 digits starting with 1, must match the
  first 10 digits of the CT TRN and the VAT TRN when those are set), seller ID type and number
  (`seller_id_type` TL / EID / PAS / CD; a passport needs `seller_id_country`, ibr-012-ae), district,
  PO box, Arabic legal name and address. The EndpointID is the ASP participant id, else the stored
  TIN, else the CT TRN's (then the VAT TRN's) first 10 digits.
- Approver link: `einvoice_approver_links` (hashed 256-bit token, 14-day expiry, revocable,
  single-purpose). The no-login page `/portal/einvoicing-approve/:token` shows the company's display name,
  the chosen partner and the EmaraTax steps, never the TRN or TIN (owner decision pending), and
  Done notifies the owner through the email outbox.
- Code: `server/services/einvoice/identity.ts`, `server/routes/einvoice-identity.routes.ts`,
  `client/src/components/einvoice/EInvoicePartnerCard.tsx`, `TaxReadyModal.tsx`,
  `CompanyTaxIdentityCard.tsx`, `client/src/pages/EInvoicingApprove.tsx`, migration 0128.

## Provider-neutral layer (keep in either case)

- `server/services/einvoice-provider.ts` (interface: optional `requiresLegalEntity`, `displayName`,
  `inboundOwner`, `legalEntityPatch`, `listInbound`, `fetchSource`, `getReportingStatus`,
  `lookupSubmission` hooks), `providers/types.ts`, `providers/registry.ts`
- `server/services/einvoice/provider-events.ts` (durable inbox, `runProviderEvents`, `runProviderPoll`),
  `legal-entities.ts`, `tracks.ts`, `workflow.ts`, `status-view.ts`, `history.ts`, `inbound.ts`
- `server/routes/einvoice-provider.routes.ts`
- `client/src/components/einvoice/EInvoiceProviderCard.tsx`, `ProviderCardParts.tsx`,
  `provider-card-steps.ts`, `EInvoiceStatus.tsx`
- Migrations 0116 and 0117 (never delete an applied migration; the columns are provider-neutral)

Neutral code never falls back to a provider's error code or locale key: when a provider gives no
code of its own the workflow records `EINVOICE_VALIDATION` / `EINVOICE_DELIVERY_FAILED`, and the
neutral cards use `einvoicing.notConnected`.

## What discarding a provider really takes

A provider is not only its own files. Besides deleting them, a discard edits a short list of
touch points outside them (route registration, the webhook raw-body prefix and CSRF exemption,
env detection, error-code lists, the settings-card entry, marketing copy) and deletes its locale
keys. The lists below are complete: `tests/unit/einvoice-provider-discard.test.ts` reads this file
and fails when a source file outside a provider's Delete/Edit lists names that provider in code,
when a kept file imports a file on the Delete list, or when a locale key that names the provider
(or is used only by its deleted files) is not covered by its locale-key list. Comments that name
both providers may stay.

## Discarding A-Cube (if Complyance is signed)

### Delete

- `server/services/einvoice/providers/acube.ts`
- `server/services/einvoice/providers/acube-onboarding.ts`
- `server/services/einvoice/acube-signature.ts`
- `server/routes/einvoice-acube.routes.ts`
- `client/src/components/einvoice/AcubeConnectCard.tsx`
- `tests/fixtures/pint-ae/asp/acube/`
- `tests/unit/einvoice-acube-adapter.test.ts`
- `tests/unit/einvoice-acube-signature.test.ts`
- `tests/unit/einvoice-acube-endpoint-scheme.test.ts`
- `tests/db/einvoice-acube.test.ts`
- `docs/einvoicing-acube.md`

### Edit

- `client/src/components/marketing/phase/content.ts` — update the bilingual e-invoicing product copy.
- `client/src/components/marketing/phase/PhaseSite.tsx` — remove the provider from the homepage.

- `server/services/einvoice/providers/registry.ts`: the `ACUBE_PROVIDER_MODULE` import and list entry
- `server/services/einvoice/providers/company-credentials.ts`: the A-Cube credential schema
- `server/services/einvoice/providers/company-provider.ts`: scoped authentication configuration for the provider
- `server/services/einvoice/workflow.ts`: provider-specific reconciliation rules and error codes
- `server/services/einvoice/legacy-tracking.ts`: A-Cube original source and outbound reference proof
- `server/routes.ts`: `registerEInvoiceAcubeRoutes` import and call
- `server/routes/einvoice.routes.ts` exposes the A-Cube submission reconciliation action.
- `scripts/ops/asp-sandbox-dryrun.ts`: the `acube` entry in `ASP_REQUIREMENTS` and its branch in `runProvider`
- `server/http/body-limits.ts`: the `/api/webhooks/einvoice/acube` entry in `RAW_WEBHOOK_PREFIXES`
  (shared by `server/index.ts` and `tests/db/harness.ts`)
- `server/middleware/csrf.ts`: the A-Cube webhook exemption
- `server/middleware/companyRolePolicy.ts` sets the permission for A-Cube settings writes.
- `client/src/components/einvoice/EInvoiceProviderCard.tsx`: the `acube` entry in `PROVIDER_CARDS`
- `server/services/einvoice/provider-events.ts`: `runAcubePoll` / `ACUBE_POLL_JOB` (the A-Cube job alias)
- `server/services/einvoice/legal-entities.ts`: the `patchFromAcube` alias
- `server/services/einvoice/tracks.ts`: `mapAcubeDeliveryStatus`, `acubeStatusErrorCode` and the
  `ACUBE_*` entries of `EINVOICE_ERROR_CODES`
- `server/services/einvoice/status-view.ts` maps A-Cube receipt and reporting states for display.
- `client/src/components/einvoice/EInvoiceListCell.tsx` shows the A-Cube recipient receipt badge.
- `client/src/components/einvoice/EInvoiceStatus.tsx` shows the A-Cube recipient receipt in history.
- `client/src/components/einvoice/einvoice-meta.ts`: the `ACUBE_*` entries of `KNOWN_ERRORS`
- `server/services/einvoice-submit.service.ts`: the `ACUBE_*` entries of `TRANSIENT_POLL_CODES`
- `shared/capabilities.ts`: the `ACUBE_*` env vars and detection branch
- `client/src/pages/Pricing.tsx`: "A-Cube / Complyance" in the e-invoicing feature line (en + ar)
- `tests/unit/einvoice-provider-registry.test.ts`: drop the A-Cube expectations
- `.env.example`: the A-Cube block

### Locale keys (en + ar)

- `einvoicing.acube*`
- `einvoicing.connectAcube`
- `einvoicing.err_ACUBE_*`
- `einvoicing.step(Reserve|Approve|Synced)*`
- `einvoicing.approver*`
- `einvoicing.reservationExpires`
- `einvoicing.corner2Title`
- `einvoicing.corner5Body`
- `einvoicing.reportWindowAssumption`
- `einvoicing.requestConnectionSubject`
- `einvoicing.emaraStep4`
- `einvoicing.delinkedBody`
- `einvoicing.accreditation`
- `einvoicing.publishedOnPeppol`
- `activityLog.action.company.einvoicing_acube_reserve`

Env to unset: `ACUBE_*`.

## Discarding Complyance (if A-Cube is signed)

### Delete

- `server/services/einvoice/providers/complyance.ts`
- `server/services/einvoice/providers/complyance-gets.ts`
- `server/services/einvoice/providers/complyance-signature.ts`
- `server/services/einvoice/providers/complyance-events.ts`
- `server/services/einvoice/providers/complyance-onboarding.ts`
- `server/routes/einvoice-complyance.routes.ts`
- `client/src/components/einvoice/ComplyanceConnectCard.tsx`
- `tests/fixtures/pint-ae/asp/complyance/`
- `tests/unit/einvoice-complyance-adapter.test.ts`
- `tests/unit/einvoice-complyance-signature.test.ts`
- `tests/db/einvoice-complyance.test.ts`
- `docs/einvoicing-complyance.md`

### Edit

- `client/src/components/marketing/phase/content.ts` — update the bilingual e-invoicing product copy.
- `client/src/components/marketing/phase/PhaseSite.tsx` — remove the provider from the homepage.

- `server/services/einvoice/providers/registry.ts`: the `COMPLYANCE_PROVIDER_MODULE` import and list entry
- `server/services/einvoice/providers/company-credentials.ts`: the Complyance credential schema
- `server/services/einvoice/providers/company-provider.ts`: scoped authentication configuration for the provider
- `server/services/einvoice/workflow.ts`: provider-specific reconciliation rules and error codes
- `server/services/einvoice/legacy-tracking.ts`: Complyance outbound seller and reference proof
- `server/services/einvoice/provider-events.ts`: Complyance legacy purchase attribution and reporting poll
- `server/routes.ts`: `registerEInvoiceComplyanceRoutes` import and call
- `scripts/ops/asp-sandbox-dryrun.ts`: the `complyance` entry in `ASP_REQUIREMENTS` and its branch in `runProvider`
- `server/http/body-limits.ts`: the `/api/webhooks/einvoice/complyance` entry in `RAW_WEBHOOK_PREFIXES`
  (shared by `server/index.ts` and `tests/db/harness.ts`)
- `server/middleware/csrf.ts`: the Complyance webhook exemption
- `client/src/components/einvoice/EInvoiceProviderCard.tsx`: the `complyance` entry in `PROVIDER_CARDS`
- `server/services/einvoice/tracks.ts`: the `COMPLYANCE_*` codes (`NEW_DOCUMENT_REQUIRED_CODES` may then
  be emptied)
- `server/services/einvoice/status-view.ts` renders Complyance receipt and acceptance separately.
- `client/src/components/einvoice/einvoice-meta.ts`: the `COMPLYANCE_*` entries of `KNOWN_ERRORS`
- `server/services/einvoice-submit.service.ts`: the `COMPLYANCE_*` entries of `TRANSIENT_POLL_CODES`
- `shared/capabilities.ts`: the `COMPLYANCE_*` env vars and detection branch
- `server/middleware/companyRolePolicy.ts`: the Complyance link rule in `POLICY_RULES`
- `client/src/pages/Pricing.tsx`: "A-Cube / Complyance" in the e-invoicing feature line (en + ar)
- `tests/unit/einvoice-provider-registry.test.ts`: drop the Complyance expectations
- `.env.example`: the Complyance block

### Locale keys (en + ar)

- `einvoicing.cmp*`
- `einvoicing.err_COMPLYANCE_*`
- `einvoicing.err_EINVOICE_LINK_MISMATCH`
- `einvoicing.(corner2Title|corner5Body|accreditation|reportWindowAssumption)Provider` (the provider-named
  variants only the Complyance card uses)
- `activityLog.action.company.einvoicing_complyance_connect`
- `activityLog.action.invoice.einvoice_complyance_link`

Env to unset: `COMPLYANCE_*`.

After either: `npm run check`, `npm test`, `npm run test:db`, `npm run build`.
