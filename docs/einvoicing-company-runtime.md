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

A-Cube callbacks use `/api/webhooks/einvoice/acube/<environment>/<company-uuid>`. The settings page
can register this URL. A-Cube's Ed25519 signature covers the URL and the message body. If the bundle
includes a webhook token, the route accepts it in the configured header.

Complyance callbacks use `/api/webhooks/einvoice/complyance/<environment>/<company-uuid>`. Register
the URL with the company's webhook signing secret. The route verifies the raw body with HMAC
and uses event type and deduplication identifiers from the signed body. Without a signing secret,
status is obtained by polling. For both providers, callbacks use a durable inbox and re-read
provider state with the company's credentials.

The standalone legacy adapter tooling has its own direct environment configuration. A company's
settings and submission flows resolve the company's encrypted bundle.

## Restore tracking for an older e-invoice

For a document already held by A-Cube or Complyance that lacks a recorded environment, open its
e-invoice status and verify the environment explicitly. The invoice's saved provider and outbound
document ID determine what the service checks. A verified email and the company's tax submission
permission are required.

Verification is available in the provider's current runtime environment when the company has a
scoped encrypted credential bundle for it. The provider must confirm the original document.
Successful verification saves the environment, records an audit entry, and lets signed callbacks
and polling continue. If the provider environment has moved, an operator must restore the
original environment setting before verifying the document.
