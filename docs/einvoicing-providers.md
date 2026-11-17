# UAE e-invoicing providers: switching and discarding (E2)

Muhasib is built against two MoF-accredited e-invoicing service providers and switches on the one it
signs with. Both stay behind the same `EInvoiceProvider` interface (`server/services/einvoice-provider.ts`)
and the same two-track status model, onboarding table, durable event inbox and settings card shell.

| Provider   | Legal name (MoF register)       | Accreditation | Notes                                                |
| ---------- | ------------------------------- | ------------- | ---------------------------------------------------- |
| A-Cube     | Platform ACube Technologies LLC | 188961        | [einvoicing-acube.md](einvoicing-acube.md)           |
| Complyance | Complyance Electronics L.L.C    | 112219        | [einvoicing-complyance.md](einvoicing-complyance.md) |

Register: https://mof.gov.ae/en/about-us/initiatives/einvoicing/einvoicing-accredited-service-providers-asps/
(read 2026-11-17, 88 providers).

## Switching

`EINVOICE_PROVIDER` selects exactly one provider (`acube` or `complyance`; `http` is the generic
mapping-driven adapter, `mock` is dev/test only). The registry
(`server/services/einvoice/providers/registry.ts`) only exposes the selected provider and only once its
credentials are set (`configuredProviderModules`, tested in `tests/unit/einvoice-provider-registry.test.ts`):
credentials of a provider that is not selected are never used. The settings card asks
`GET /api/companies/:id/einvoicing/provider` which provider is live and shows that provider's card
(name, accreditation number, its own onboarding steps) or a neutral "Not connected" card.

Data is kept per provider and environment (`einvoice_legal_entities.provider`,
`einvoice_documents.provider`, `einvoice_provider_events.provider`), so switching never mixes rows; a
company must onboard again at the new provider (the taxpayer re-authorises in EmaraTax).

## Provider-neutral layer (keep in either case)

- `server/services/einvoice-provider.ts` (interface: optional `requiresLegalEntity`, `displayName`,
  `inboundOwner`, `legalEntityPatch`, `listInbound`, `fetchSource`, `getReportingStatus`,
  `lookupSubmission` hooks), `providers/types.ts`, `providers/registry.ts`
- `server/services/einvoice/provider-events.ts` (durable inbox, `runProviderEvents`, `runProviderPoll`),
  `legal-entities.ts`, `tracks.ts`, `workflow.ts`, `status-view.ts`, `history.ts`, `inbound.ts`
- `server/routes/einvoice-provider.routes.ts`
- `client/src/components/einvoice/EInvoiceProviderCard.tsx`, `ProviderCardParts.tsx`,
  `provider-card-steps.ts`
- Migrations 0116 and 0117 (never delete an applied migration; the columns are provider-neutral)

## Discarding A-Cube (if Complyance is signed)

Delete:

- `server/services/einvoice/providers/acube.ts`, `server/services/einvoice/acube-signature.ts`
- `server/routes/einvoice-acube.routes.ts`
- `client/src/components/einvoice/AcubeConnectCard.tsx`
- `tests/fixtures/pint-ae/asp/acube/`, `tests/unit/einvoice-acube-adapter.test.ts`,
  `tests/unit/einvoice-acube-signature.test.ts`, `tests/unit/einvoice-acube-endpoint-scheme.test.ts`,
  `tests/db/einvoice-acube.test.ts`
- `docs/einvoicing-acube.md`

Edit (one line or block each):

- `providers/registry.ts`: the `ACUBE_PROVIDER_MODULE` import and list entry
- `server/routes.ts`: `registerEInvoiceAcubeRoutes` import and call
- `server/index.ts` and `tests/db/harness.ts`: the `/api/webhooks/einvoice/acube` raw-body prefix
- `server/middleware/csrf.ts`: the A-Cube webhook exemption
- `client/src/components/einvoice/EInvoiceProviderCard.tsx`: the `acube` entry in `PROVIDER_CARDS`
- `server/services/einvoice/provider-events.ts`: `runAcubePoll` / `ACUBE_POLL_JOB` (the A-Cube job alias)
- `server/services/einvoice/legal-entities.ts`: the `patchFromAcube` alias
- `server/services/einvoice/tracks.ts`: `mapAcubeDeliveryStatus`, `acubeStatusErrorCode` and the
  `ACUBE_*` entries of `EINVOICE_ERROR_CODES`; `client/src/components/einvoice/einvoice-meta.ts`
  `KNOWN_ERRORS`; `server/services/einvoice-submit.service.ts` `TRANSIENT_POLL_CODES`
- `shared/capabilities.ts`: the `ACUBE_*` env vars and detection branch
- `.env.example`: the A-Cube block; locale keys `einvoicing.acube*`, `einvoicing.err_ACUBE_*`,
  `einvoicing.step(Reserve|Approve|Synced)*`, `einvoicing.approver*`, `einvoicing.reservationExpires`,
  `einvoicing.corner2Title`/`corner5Body`, `einvoicing.reportWindowAssumption`,
  `activityLog.action.company.einvoicing_acube_reserve` (en + ar)

Env to unset: `ACUBE_*`.

## Discarding Complyance (if A-Cube is signed)

Delete:

- `server/services/einvoice/providers/complyance.ts`, `complyance-gets.ts`, `complyance-signature.ts`,
  `complyance-events.ts`, `complyance-onboarding.ts` (everything matching `providers/complyance*.ts`)
- `server/routes/einvoice-complyance.routes.ts`
- `client/src/components/einvoice/ComplyanceConnectCard.tsx`
- `tests/fixtures/pint-ae/asp/complyance/`, `tests/unit/einvoice-complyance-adapter.test.ts`,
  `tests/unit/einvoice-complyance-signature.test.ts`, `tests/db/einvoice-complyance.test.ts`
- `docs/einvoicing-complyance.md`

Edit:

- `providers/registry.ts`: the `COMPLYANCE_PROVIDER_MODULE` import and list entry
- `server/routes.ts`: `registerEInvoiceComplyanceRoutes` import and call
- `server/index.ts` and `tests/db/harness.ts`: the `/api/webhooks/einvoice/complyance` raw-body prefix
- `server/middleware/csrf.ts`: the Complyance webhook exemption
- `client/src/components/einvoice/EInvoiceProviderCard.tsx`: the `complyance` entry in `PROVIDER_CARDS`
- `server/services/einvoice/tracks.ts` (`COMPLYANCE_*` codes, and `NEW_DOCUMENT_REQUIRED_CODES` may then be
  emptied), `einvoice-meta.ts` `KNOWN_ERRORS`, `einvoice-submit.service.ts` `TRANSIENT_POLL_CODES`
- `shared/capabilities.ts`: the `COMPLYANCE_*` env vars and detection branch
- `tests/unit/einvoice-provider-registry.test.ts`: drop the Complyance expectations
- `.env.example`: the Complyance block; locale keys `einvoicing.cmp*`, `einvoicing.err_COMPLYANCE_*`,
  `einvoicing.err_EINVOICE_LINK_MISMATCH`, `activityLog.action.company.einvoicing_complyance_connect`,
  `activityLog.action.invoice.einvoice_complyance_link` (en + ar)

Env to unset: `COMPLYANCE_*`.

After either: `npm run check`, `npm test`, `npm run test:db`, `npm run build`.
