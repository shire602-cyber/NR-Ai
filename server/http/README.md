# Platform contracts (wave 1, W1-B)

These are the shared building blocks for every route and module. New code uses them; legacy code
moves onto them as the guard baselines burn down.

| Contract                             | Module                                | Use it for                                                                                                                                                                 |
| ------------------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `strictBody(schema)`                 | `server/http/strict-body.ts`          | Validating request bodies. Unknown keys and server-owned keys get a 400.                                                                                                   |
| zod primitives                       | `shared/validators/primitives.ts`     | `zMoney`, `zDate`, `zUuid`, `zTrn`, `zIbanAE`, `zEmiratesId`, `zCurrency`, `zEmirate`, `zVatRate`, `zSupplyType`, `zAccountType`, `zText(max)`, `zHttpsUrl`, `zEmail`, ... |
| Money in fils                        | `shared/money.ts`                     | `toFils`, `fromFils`, `sumFils`, `mulRate`, `allocate`, `formatFils`, `roundHalfUp`. No floats, no tolerance.                                                              |
| `DomainError(code, status, details)` | `server/errors.ts`                    | Business-rule failures with a stable `code`.                                                                                                                               |
| Domain events                        | `server/platform/domain-events.ts`    | `emitDomainEvent` / `onDomainEvent`. Handlers run after the current tick; their errors never reach the emitter.                                                            |
| Service registry                     | `server/platform/service-registry.ts` | `provide` / `resolve` / `has`. Lets one module call another without importing it. A missing service gives a 503.                                                           |
| Job registry                         | `server/platform/job-registry.ts`     | `registerJob({ name, cron, run })`. `initScheduler` runs each job with its own try/catch and skips a tick if the previous run is still going.                              |
| Capabilities                         | `shared/capabilities.ts`              | `getCapabilities()` returns `live`, `sandbox`, `requires_external` or `disabled` for each integration, with en and ar copy.                                                |

## A route written against the contracts

```ts
import { z } from "zod";
import { strictBody } from "../http/strict-body";
import { DomainError } from "../errors";
import { zDate, zMoneyFils, zText, zUuid } from "../../shared/validators/primitives";
import { fromFils, mulRate, sumFils } from "../../shared/money";
import { emitDomainEvent } from "../platform/domain-events";
import { has, resolve } from "../platform/service-registry";

const createCreditNoteBody = z.object({
  invoiceId: zUuid,
  issueDate: zDate,
  reason: zText(500, { min: 1 }),
  lines: z.array(z.object({ description: zText(200), netFils: zMoneyFils }).strict()).min(1),
});
type CreateCreditNoteBody = z.output<typeof createCreditNoteBody>;

app.post(
  "/api/companies/:companyId/credit-notes",
  authMiddleware,
  requireCustomer,
  strictBody(createCreditNoteBody), // 400 { code: "VALIDATION_ERROR", fields } on bad input
  asyncHandler(async (req, res) => {
    const { companyId } = req.params; // companyId comes from the URL, never the body
    const body = req.body as CreateCreditNoteBody;

    const invoice = await storage.getInvoice(body.invoiceId);
    if (!invoice || invoice.companyId !== companyId)
      throw new DomainError("INVOICE_NOT_FOUND", 404);
    if (invoice.status === "void") throw new DomainError("INVOICE_VOID", 409);

    const netFils = sumFils(body.lines.map((l) => l.netFils));
    const vatFils = mulRate(netFils, "0.05"); // rounded half-up to whole fils
    const note = await storage.createCreditNote({
      companyId,
      invoiceId: invoice.id,
      issueDate: body.issueDate,
      subtotal: fromFils(netFils), // "1234.50" for numeric(15,2)
      vatAmount: fromFils(vatFils),
    });

    // Runs after this tick. A failing handler cannot break the request.
    emitDomainEvent("credit_note.issued", {
      companyId,
      entityId: note.id,
      invoiceId: invoice.id,
      totalFils: netFils + vatFils,
    });

    // Optional module: call it only if it is registered. resolve() on a
    // missing service throws DomainError("SERVICE_UNAVAILABLE", 503).
    if (has("einvoice.submit"))
      await resolve<(id: string) => Promise<void>>("einvoice.submit")(note.id);

    res.status(201).json(note);
  })
);
```

Background work goes in the job registry, not in a separate `cron.schedule` call:

```ts
registerJob({ name: "compliance.deadlineScan", cron: "10 5 * * *", run: scanDeadlines });
```

## Error contract (global handler)

| Input                                                                        | Status         | `code`                                                                                                                                |
| ---------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Malformed JSON body                                                          | 400            | `INVALID_JSON`                                                                                                                        |
| Body over the size limit                                                     | 413            | `PAYLOAD_TOO_LARGE`                                                                                                                   |
| Origin not allowed by CORS (including preflight)                             | 403            | `ORIGIN_NOT_ALLOWED`                                                                                                                  |
| zod failure (`strictBody`, `validate`, a thrown `ZodError`)                  | 400            | `VALIDATION_ERROR` + `fields`                                                                                                         |
| `MoneyError` from `shared/money.ts`                                          | 400            | `MONEY_*`                                                                                                                             |
| Postgres `22P02` / `22007` / `22008` / `22003` / `22001` / `23502` / `23514` | 400            | `INVALID_IDENTIFIER` / `INVALID_DATE` / `NUMERIC_OUT_OF_RANGE` / `VALUE_TOO_LONG` / `REQUIRED_FIELD_MISSING` / `CONSTRAINT_VIOLATION` |
| Postgres `23505` / `23503`                                                   | 409            | `DUPLICATE_VALUE` / `REFERENCE_CONFLICT`                                                                                              |
| `DomainError` / `AppError`                                                   | its own status | its own `code`                                                                                                                        |
| Anything else                                                                | 500            | `INTERNAL_ERROR` (no SQL text and no stack trace)                                                                                     |

## Server-owned fields

`strictBody` rejects these body keys: `companyId`, `status`, `posted`, `autoPosted`, `journalEntryId`,
`isSystemAccount`, `createdBy`, `number`, `entryNumber`, `totals`.

A route that really does accept one of them, such as a status-transition endpoint, opts in with
`strictBody(schema, { allowServerOwned: ["status"] })`. Handlers that cannot use the middleware call
`assertNoServerOwned(req.body)` instead.

## CI guards (ratchets)

- `node scripts/check-raw-body.mjs` fails on new raw `req.body` writes: spreads, `.set(req.body)`,
  `.values(req.body)`, `storage.update*/create*/upsert*(…, req.body)`, `pickAllowed(req.body)` with
  no schema, and aliases of `req.body`.
- `node scripts/check-ledger-writes.mjs` fails on new direct `insert(journalEntries|journalLines)` or
  `storage.createJournalEntry(` calls outside `server/ledger/` and `server/storage.ts`.

Each guard compares against its baseline in `scripts/guard-baselines/`. The baselines record counts
per file, so a new offender in a file that already has offenders also fails. After you remove
offenders, run the guard with `--update` so the baseline goes down. Never raise a baseline by hand.
