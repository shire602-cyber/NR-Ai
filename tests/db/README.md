# tests/db — real-Postgres harness

`npm run test:db` runs every `tests/db/**/*.test.ts` file against the real Express app and a
real, freshly migrated Postgres 16 database.

- `global-setup.ts` creates one template database per run and migrates it with the app's own
  `runMigrations` + `ensureCriticalSchema` (`server/db.ts`, same path as `server/migrate.ts`).
- Every test **file** clones the template (`CREATE DATABASE ... TEMPLATE`), boots the app
  (`registerRoutes` plus the middleware stack from `server/index.ts`) on an ephemeral port, and
  drops its database in `afterAll`. Files never share data.
- Admin URL: `TEST_DATABASE_ADMIN_URL`, else `.env` `DATABASE_URL` with the db name swapped for
  `postgres`. Only databases named `harness_*` are ever created or dropped.
- If the role cannot `CREATE DATABASE`, the harness falls back to in-process PGlite
  (`h.mode === "pglite"`, `h.concurrencySupported === false`) and prints the reason.
- Rate limits default to 1,000,000/min; `.env` is never loaded and AI/email/Stripe keys are unset.

## Usage

```ts
import { describe, expect, it } from "vitest";
import { accountByCode, freezeTime, ledgerTotals, postJournalEntry, useHarness } from "./harness";

const h = useHarness(); // registers beforeAll/afterAll for this file

describe("my feature", () => {
  it("is tenant-isolated and balanced", async () => {
    const a = await h.createTenant(); // registers via /api/auth/register; owner role
    const b = await h.createSecondTenant({ role: "accountant" });
    await postJournalEntry(a, {
      date: "2026-01-15",
      lines: [
        { code: "1020", debit: 500 },
        { code: "3010", credit: 500 },
      ],
    });
    expect(await ledgerTotals(a.company.id)).toEqual({ debit: 500, credit: 500 });
    const leak = await b.as.get(`/api/companies/${a.company.id}/journal`);
    expect([403, 404]).toContain(leak.status);
    const rows = await h.sql("SELECT status FROM journal_entries WHERE company_id = $1", [
      a.company.id,
    ]);
    expect(rows[0].status).toBe("posted");
    const bank = await accountByCode(a, "1020"); // { id, code, name_en, type }
    expect(bank.code).toBe("1020");
  });
});
```

## API (`./harness`)

| Export                                                                                      | Purpose                                                                                                                                                  |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useHarness()`                                                                              | Start/stop hooks; returns the harness handle `h`                                                                                                         |
| `h.createTenant({ role?, firmRole?, isAdmin?, userType?, planId?, companyColumns? })`       | `{ user, company, token, email, password, as }`; `as.get/post/put/patch/delete(url, body?)` use Bearer auth and return `{ status, body, text, headers }` |
| `h.createSecondTenant(opts?)`                                                               | Same, labelled "TenantB"                                                                                                                                 |
| `h.anon`, `h.client(token)`                                                                 | Anonymous / arbitrary-token clients                                                                                                                      |
| `h.sql(text, params?)`                                                                      | Direct SQL on this file's database (rows array)                                                                                                          |
| `h.setRateLimits({ api, read, auth, ai, authOAuth })` / `h.resetRateLimits()`               | Rebuild the app with real limits (fresh counters) / restore harness defaults                                                                             |
| `h.routes()`                                                                                | Every registered `{ method, path }` (Express router stack)                                                                                               |
| `freezeTime(date)`                                                                          | Fake `Date` only (test + in-process server); returns `restore()`                                                                                         |
| `accountByCode(tenant, code)`, `postJournalEntry(tenant, {...})`, `ledgerTotals(companyId)` | Ledger factories                                                                                                                                         |
| `golden/seedGoldenBooksFY2025_2026(tenant)`                                                 | Report 11 two-year synthetic books                                                                                                                       |

Known defects owned by later workstreams: use `it.fails("... [R0x-yy] reason", ...)`, and for the
cross-tenant matrix add/delete one JSON file per issue under `route-matrix-allow/`.
