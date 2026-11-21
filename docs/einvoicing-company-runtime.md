# Company e-invoicing configuration

Choose A-Cube or Complyance in the company's e-invoicing settings. A new company has no selection. The
provider setup, legal entity and EmaraTax appointment are for that company. Its configuration check
reads local configuration and returns `not_selected`, `not_configured` or `configured`. A configured
company still needs an active provider legal entity before it can send.

`ACUBE_ENV` and `COMPLYANCE_ENV` independently select `sandbox` or `production`. Both default to
`sandbox`. Provision separate credentials for each environment. Work already queued or sent stays
bound to its original provider and environment. Changing the environment pauses that work until
its original environment is available again.

## Runtime credentials

The runtime reads an encrypted bundle from the secret store through an injected environment variable
or an injected path to a mounted file. The variable is
`EINVOICE_<PROVIDER>_<ENVIRONMENT>_<COMPANY_UUID_WITHOUT_HYPHENS>_CREDENTIALS`, with all components
in uppercase. Append `_FILE` to inject a path instead of the ciphertext. The ciphertext contains
the company UUID, provider and environment so it cannot be reused by moving it to another company
or environment.

The offline command `npx tsx scripts/ops/einvoice-seal-credentials.ts <company-uuid> <provider> <environment>`
reads JSON from standard input. Pipe JSON from the authorized secret manager and pipe the encrypted
result directly to the destination secret store. Run the command with the same vault key as the app,
injected as `TOKEN_ENCRYPTION_KEY` or, when absent, `SESSION_SECRET`. Re-seal the bundles before rotating
that key.

- A-Cube bundles contain `email`, `password` and optional `webhookToken`.
- Complyance bundles contain `apiKey` and optional `webhookSecret`.

A-Cube callbacks use `/api/webhooks/einvoice/acube/<environment>/<company-uuid>`. Set
`ACUBE_WEBHOOK_BASE_URL` to the public HTTPS origin. E-invoicing settings shows the selected
provider URL under **Developer details**. A company administrator registers or updates the
destinations using `POST /api/companies/<company-uuid>/einvoicing/acube/webhooks` with `{}` and normal
authentication. The route uses that company's A-Cube credentials in the current environment.

A-Cube's destination API configures events for the credential account. Use an account dedicated to
the company for this registration. The company UUID in the callback URL selects the local
credentials. A-Cube does not expose a taxpayer filter in its destination registration. The app
verifies the Ed25519 signature over the URL and raw body and checks company ownership against
authenticated provider data before using the event. It also requires the configured header when the
bundle has a webhook token. [A-Cube UAE OpenAPI](https://docs.acubeapi.com/openapi/gov-ae-api.json)

Complyance callbacks use `/api/webhooks/einvoice/complyance/<environment>/<company-uuid>` for event
types available to the company's integration. Configure the URL with its signing secret. The route
verifies the raw body with HMAC and reads the event type and deduplication identifiers from the
signed body. Complyance documents polling for UAE outbound sales status. Both provider callbacks
use a durable inbox and re-read provider data with the company's credentials.
[Complyance document status](https://docs.complyance.io/api-reference/unify/documents/)

**Direct signed XML endpoint** in settings is a separate inbound upload. It is listed only when its
own HMAC configuration is enabled.

The standalone legacy adapter tooling has its own direct environment configuration. A company's
settings and submission flows resolve the company's encrypted bundle.

## Restore tracking for an older e-invoice

Open the e-invoice status to restore tracking for an older submission with a missing environment
or an unknown provider document ID. The service uses the invoice's recorded provider. When the ID
is missing, A-Cube must return one exact match for the saved outbound XML. For Complyance, enter the
sales document ID from its portal so the service can verify the seller and original invoice number.
A verified email and the company's tax submission permission are required.

Verification is available in the provider's current runtime environment when the company has a
scoped encrypted credential bundle for it. The provider must confirm the original document.
Successful verification saves the environment, records an audit entry, and lets signed callbacks
and polling continue. If the provider environment has moved, an operator must restore the
original environment setting before verifying the document.

An older A-Cube validation refusal can also be verified when the invoice has one direct attempt
and the original audit records its environment. The saved XML, refusal history and seller must
agree with that record and the company's active A-Cube connection. Verification records the
connection and leaves the refusal in place. After correcting the invoice, use the separate
resubmit action to validate and queue it under the original invoice number.

A correction under the same invoice number requires an explicit resubmission through the original
provider connection and environment. For a tracked Complyance document, the worker verifies that
the provider still identifies it as terminal Needs Correction and that its seller and source match.
The corrected submission must retain the provider document ID. After an uncertain correction, the
app keeps tracking that original ID and prevents another submission while the outcome is unknown.
[Complyance document status](https://docs.complyance.io/api-reference/unify/documents/)
