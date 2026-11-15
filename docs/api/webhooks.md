# Outbound webhooks

Endpoints are managed in **Developer Settings → Webhooks** (Enterprise plan, `webhooks` feature,
`settings.company` permission). URLs must be `https://` and resolve to public addresses (checked when
saved and again before every delivery).

## Event catalogue

Events come from the application's domain-event bus (`server/platform/domain-events.ts`); the list is
also served at `GET /api/webhooks/events`.

| Event                | When                            |
| -------------------- | ------------------------------- |
| `invoice.created`    | a draft invoice was created     |
| `invoice.issued`     | an invoice was issued           |
| `invoice.paid`       | an invoice was settled in full  |
| `invoice.voided`     | an invoice was voided           |
| `payment.received`   | a customer payment was recorded |
| `credit_note.issued` | a credit note was issued        |
| `bill.approved`      | a vendor bill was approved      |
| `bill.paid`          | a vendor bill was paid          |
| `contact.created`    | a contact was created           |
| `payroll.approved`   | a payroll run was approved      |
| `payroll.paid`       | a payroll run was paid          |

Subscribe to a comma list or `*`.

## Payload

```json
{
  "id": "6c0c…", // event id: identical on retries and replays
  "type": "invoice.issued",
  "createdAt": "2026-11-15T10:00:00.000Z",
  "companyId": "…",
  "data": {
    "companyId": "…",
    "entityId": "<invoice id>",
    "occurredAt": "…",
    "number": "INV-2026-00012",
    "totalFils": 105000
  }
}
```

Payloads are small; fetch the entity with the public API when you need more.

## Signature

```
X-Muhasib-Signature: t=1763200800,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
X-Webhook-Signature: sha256=<hex HMAC-SHA256(secret, raw body)>   # legacy
X-Webhook-Event, X-Webhook-Id (event id), X-Webhook-Delivery, X-Webhook-Attempt
```

Verify `v1` over the raw body with a constant-time compare and reject timestamps older than five
minutes (reference implementation: `verifyWebhookSignature` in `server/services/webhook.service.ts`).
The secret is shown once when the endpoint is created and stored encrypted.

## Delivery, retries, dead letter

- Every event becomes a durable `webhook_deliveries` row (unique per endpoint and event id) and is
  attempted immediately.
- A non-2xx answer or network error schedules a retry with exponential backoff: 30 s, 2 min, 8 min,
  32 min, ~2 h (capped at 6 h). The `webhooks.deliveryRetry` job runs every minute.
- After 6 attempts the delivery is **dead**. Any delivery can be replayed from the UI or
  `POST /api/webhooks/{endpointId}/deliveries/{deliveryId}/replay` (same event id, new signature).
- Answer 2xx quickly and process asynchronously; dedupe on `X-Webhook-Id`.
