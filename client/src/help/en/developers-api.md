---
title: API keys and webhooks
summary: Connect your own software to your books with scoped keys.
category: security
keywords: API, REST, API key, scopes, webhook, OpenAPI, idempotency, rate limit, developer
related: security, integrations, subscription
---

Open [Developers](/developer-settings). API keys and webhooks are available on the Professional plan and above.

## Create a key

1. Choose **Create API key**, name it and pick its access. Presets cover read-only and invoicing, or tick each resource: contacts, items, invoices, bills, payments, journals and reports.
2. Optionally set an expiry and limits per minute and per day.
3. **Copy the key now.** It looks like `muh_xxxxxxxx_...` and is shown only once. We store only a hash.

A key acts as the person who created it and can never do more than that person's role allows. Keys cannot be edited: revoke one and create another.

## Use it

Send the key as `Authorization: Bearer <key>`. Every write needs an `Idempotency-Key` header, so a retry does not create a second record. Past a limit you get HTTP 429 and a `Retry-After` header.

## Documentation

The full reference, generated from the live definitions, is at [API documentation](/developers/api). You can download the OpenAPI file from there.

## Revoke

Revoke a key at any time. It stops working immediately and the change is recorded.

## Webhooks

Webhooks send signed notifications to your system when invoices, payments, credit notes and bills change. Verify the signature before you trust a request.

## Good to know

- Writes through the API follow the same posting rules, period locks and VAT checks as the app.
- Keep keys in a secret manager, never in code or chat.
