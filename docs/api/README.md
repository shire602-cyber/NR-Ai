# Muhasib.ai public API (v1)

The public API is a versioned REST subset served at `/api/v1`. The machine-readable contract is
`/api/v1/openapi.json` (copy: [`openapi.json`](./openapi.json), regenerated from the zod schemas in
`server/routes/public-api.routes.ts`; `tests/unit/public-api-openapi.test.ts` fails when it drifts).

## Authentication

Create a key in **Settings → Developer Settings → API keys** (Enterprise plan, `settings.company`
permission). The full key (`muh_` + 64 hex) is shown once; only its SHA-256 hash and an 8-character
indexed prefix are stored.

```
Authorization: ApiKey muh_0123…      # preferred
X-API-Key: muh_0123…                  # alternative
```

- A key is bound to **one company**; every request reads and writes that company only. Another
  company's row id answers `404`.
- Keys are accepted on `/api/v1` only. Any other route answers `401 API_KEY_NOT_ACCEPTED`; the web
  app's session/JWT routes never accept keys.
- `last_used_at` is updated on use (at most every 30 seconds).
- Revoked or expired keys answer `401 API_KEY_INVALID` / `API_KEY_EXPIRED`.

## Scopes

| Scope            | Allows                                           |
| ---------------- | ------------------------------------------------ |
| `read:invoices`  | `GET /invoices`, `GET /invoices/{id}`            |
| `write:invoices` | `POST /invoices` (creates a **draft** invoice)   |
| `read:contacts`  | `GET /contacts`                                  |
| `write:contacts` | `POST /contacts`                                 |
| `read:bills`     | `GET /bills`                                     |
| `read:payments`  | `GET /payments`                                  |
| `write:payments` | `POST /invoices/{id}/payments` (issued invoices) |
| `read:accounts`  | `GET /accounts`                                  |
| `read:reports`   | `GET /reports/trial-balance?from=&to=`           |

A missing scope answers `403 INSUFFICIENT_SCOPE` with `details.required`.

## Rate limits

Each key has its own per-minute limit (default 120, set when the key is created). Over the limit:
`429 API_KEY_RATE_LIMITED` with a `Retry-After` header (seconds). The global per-IP limits still apply.

## Plan

The API is the `apiAccess` feature (Enterprise). With billing enforcement on, a key of a company on a
lower plan answers `403 TIER_LOCKED`.

## Writes

Bodies are strict: unknown keys or server-owned keys (`companyId`, `status`, `number`, …) answer
`400 VALIDATION_ERROR` with `fields`. Money is decimal AED (`"1234.50"` or a number with at most two
decimals). Writes are attributed to the user who created the key.

## Errors

`{ "message": "...", "code": "SOME_CODE", "details"?: {...} }` — see the error table in
`server/http/README.md`.

## Webhooks

See [`webhooks.md`](./webhooks.md). Backups and data portability: [`backups.md`](./backups.md).
Migration from other systems: [`imports.md`](./imports.md).
