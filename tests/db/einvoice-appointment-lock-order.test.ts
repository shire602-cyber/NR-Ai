import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { expect, it, vi } from "vitest";
import { recordTestAppointment } from "./einvoice-appointment-fixture";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();

it("PR #178 lets submission record validation while an active confirmation retry waits", async (ctx) => {
  ctx.skip(!h.concurrencySupported);
  const provider = "complyance";
  const owner = await h.createTenant({ companyColumns: { einvoice_partner: provider } });
  const companyId = owner.company.id;
  const path = `/api/companies/${companyId}/einvoice/partner`;
  await recordTestAppointment(owner, provider);
  const active = await owner.as.get(path);
  expect(active.status, active.text).toBe(200);
  expect(active.body.state).toBe("active");

  const { submissionAppointmentGate } =
    await import("../../server/services/einvoice-appointment.service");
  const { recordValidationEvent } = await import("../../server/services/einvoice/history");
  const invoiceId = randomUUID();
  const submitter = new pg.Client({ connectionString: h.databaseUrl, statement_timeout: 15_000 });
  let retry: ReturnType<Tenant["as"]["post"]> | undefined;
  try {
    await submitter.connect();
    await drizzle(submitter).transaction(async (tx) => {
      const {
        rows: [backend],
      } = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
      expect(await submissionAppointmentGate(companyId, provider, tx)).toBeNull();

      retry = owner.as.post(`${path}/confirm-emaratax`, {
        expectedProvider: provider,
        expectedAcceptanceRevision: active.body.appointment.termsAcceptedAt,
        confirmed: true,
      });
      // The retry has locked the company and is waiting to update the appointment.
      await vi.waitFor(
        async () => {
          const blocked = await h.sql(
            `SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
               AND $1::int = ANY(pg_blocking_pids(pid))`,
            [backend.pid]
          );
          expect(blocked).toHaveLength(1);
        },
        { timeout: 8_000, interval: 25 }
      );

      // The validation event's company FK takes KEY SHARE while the gate still holds SHARE.
      await recordValidationEvent(companyId, invoiceId, true, { source: "user" }, tx);
    });
  } finally {
    await submitter.end();
    await Promise.allSettled([retry]);
  }

  const result = await retry!;
  expect(result.status, result.text).toBe(200);
  expect(result.body).toMatchObject({
    state: "active",
    appointment: { provider, termsAcceptedAt: active.body.appointment.termsAcceptedAt },
  });
  const events = await h.sql(
    `SELECT to_status FROM einvoice_document_events
     WHERE company_id = $1 AND invoice_id = $2 AND track = 'validation'`,
    [companyId, invoiceId]
  );
  expect(events).toEqual([{ to_status: "passed" }]);
});
