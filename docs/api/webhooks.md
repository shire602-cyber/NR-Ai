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
  attempted immediately. A durable event redelivery reuses matching historical records and keeps
  their original event IDs.
- A non-2xx HTTP response or a confirmed pre-send failure such as a refused connection or a URL
  rejection schedules a retry with backoff of 30 s, 2 min, 8 min, 32 min, and about 2 h, capped at
  6 h. The retry job runs every minute and recovers interrupted pre-send claims.
- The webhook transport allows 15 seconds to receive HTTP headers and up to two further seconds
  to read the body. The HTTP status determines delivery even if the body is slow or incomplete.
  A request that may have reached the receiver without a known response is marked **dead** with a
  reason and cannot be replayed.
- Pausing an endpoint holds queued deliveries until reactivation. The API returns 409 for manual
  test sends and replays while the endpoint is paused.
- After 6 failed attempts the delivery is **dead**. Settled deliveries with a known outcome can
  be replayed from the UI or `POST /api/webhooks/{endpointId}/deliveries/{deliveryId}/replay`.
  A replay keeps the event ID and body and uses a new delivery ID and signature. The API returns
  409 if a delivery of that event to the same endpoint is active or uncertain. The delivery list
  includes `replayEligible` and `replayUnavailableReason` (`delivery_pending`, `delivery_uncertain`,
  `endpoint_disabled`, or `null`).
- Answer 2xx quickly, process asynchronously, and deduplicate on `X-Webhook-Id` to handle retries
  and deliberate replays.
