# A-Cube sandbox: owner runbook (short)

Plain-language steps for the first real run against A-Cube's **sandbox**. Nothing here touches
production, and nothing is sent to the FTA. Background and the full adapter notes:
[einvoicing-acube.md](einvoicing-acube.md). The longer ASP checklist:
[release/asp-sandbox-runbook.md](release/asp-sandbox-runbook.md).

## What is already proven without A-Cube

The adapter is tested against a local stand-in server that copies A-Cube's documented requests and
replies (`tests/unit/einvoice-acube-mock-server.test.ts`, `tests/db/einvoice-acube-mock-server.test.ts`).
That proves our side: one login, XML submit, status polling, 422/400/404 handling, timeouts, and that
a lost reply never causes a second send. It cannot prove what A-Cube really answers. That is what
Wednesday is for.

## 1. Set these variables (names only; put the values in the secret store, never in chat or git)

| Variable                | What it is                                                               |
| ----------------------- | ------------------------------------------------------------------------ |
| `ACUBE_EMAIL`           | Your A-Cube sandbox login email (secret)                                 |
| `ACUBE_PASSWORD`        | Your A-Cube sandbox login password (secret)                              |
| `ASP_DRYRUN_SELLER_TRN` | The 15-digit TRN of the test company you linked in the A-Cube sandbox    |
| `ASP_DRYRUN_BUYER_TRN`  | Optional: a 15-digit test buyer TRN A-Cube accepts                       |
| `ACUBE_ENV`             | Leave unset, or `sandbox`. The test refuses to run if it says production |

Optional overrides, normally not needed: `ACUBE_BASE_URL`, `ACUBE_LOGIN_URL`, `ACUBE_TIMEOUT_MS`
(default 20000).

## 2. Run these two commands

```bash
npm run test:acube-sandbox
npx tsx scripts/ops/asp-sandbox-dryrun.ts --provider acube --status
```

The first runs the live checks (login, send an invoice, read its status, send a credit note, send a
deliberately broken invoice). With no variables set it skips itself and says so. The second is the
older one-document dry run.

## 3. What a pass looks like

- `npm run test:acube-sandbox` ends with `4 passed` and no `skipped`.
- The output shows lines starting `[acube-sandbox]`: the status words A-Cube really uses, in order
  (for example `processed`, then `delivered`, then `accepted`) and the shape of the rejection body for the
  broken invoice. Copy these lines into the "Sandbox run log" in the ASP runbook.
- The dry run prints `status`, a `providerMessageId`, and no error code.
- A failure with a 404 about the "legal entity" means `ASP_DRYRUN_SELLER_TRN` is not the TRN linked in
  the A-Cube sandbox. Fix that first.

## 4. After a pass

Re-record `tests/fixtures/pint-ae/asp/acube/*.json` from the logged words and body shape, then update the
"To verify" list in [einvoicing-acube.md](einvoicing-acube.md).

## Doc gaps to confirm with A-Cube

A-Cube's public documentation is silent on these. We built client-side protection instead of guessing.

1. **Idempotency.** Is there any idempotency-key header? What happens when the same document is POSTed
   twice (refused, or a second copy)? We never send an invented header; we post once and, after a lost
   reply, search the outgoing list for our XML before anything else.
2. **Error semantics on submit.** What exactly do 401, 409, 429 and 5xx mean, and are they safe to retry?
3. **Rate limits.** Requests per minute for login, submit and the outgoing-list search.
4. **Credit notes.** Does A-Cube require or check the reference to the original invoice? What does it do
   with a credit note for an invoice it does not hold?
5. **Webhook authentication conflict.** The security page documents only a shared token (sent in a header
   or the query string). Our code also verifies a signed request (RFC 9421, Ed25519). Which does the
   sandbox actually send? We accept both and remove neither until A-Cube answers.
6. **Webhook event names and status words.** Confirm `invoice.outbound` / `credit_note.outbound`, the
   payload fields, and the full list of status values (we know `processed`, `delivered`,
   `delivery_failed`, `accepted`, `rejected`).
7. **Exchange rate in foreign-currency invoices.** Not an A-Cube question: it is an open owner decision
   (see below).

## Open owner question (VAT and foreign currency)

For an invoice in a foreign currency, the e-invoice states the AED tax using the exchange rate in force at
the sales tax point, taken from the rate table. The ledger and the VAT 201 use the rate booked on the
invoice. When those two rates differ, the AED VAT can differ by fils. The test
`tests/db/einvoice-vat-fils-exact.test.ts` ties the two together when they match and records the size of
the gap when they do not. Which rate should drive the VAT 201 is your decision.
