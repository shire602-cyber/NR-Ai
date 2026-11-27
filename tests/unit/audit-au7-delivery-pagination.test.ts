import { it, expect } from "vitest";
import { AcubeEInvoiceProvider } from "../../server/services/einvoice/providers/acube";
import { FAKE_PASSWORD } from "../fixtures/credentials/fake-credentials";
it("includes every inbound invoice across provider pages during reconciliation", async () => {
  const localFetch = (async (resource: string) => {
    const url = new URL(resource);
    let json: unknown = [];
    if (url.pathname === "/login") json = { token: "local-only" };
    if (url.pathname === "/invoices") {
      const page = Number(url.searchParams.get("page"));
      const count = page === 1 ? 30 : page === 2 ? 1 : 0;
      json = {
        "hydra:totalItems": 31,
        "hydra:member": Array.from({ length: count }, (_, i) => ({
          invoiceId: "00000000-0000-4000-9000-" + String(30 * (page - 1) + i + 1).padStart(12, "0"),
          direction: "incoming",
        })),
        "hydra:view":
          page === 1
            ? {
                "hydra:next": "/invoices?direction=incoming&itemsPerPage=30&page=2",
              }
            : {},
      };
    }
    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const provider = new AcubeEInvoiceProvider(
    { ACUBE_EMAIL: "mock@example.invalid", ACUBE_PASSWORD: FAKE_PASSWORD },
    { fetch: localFetch }
  );
  expect(await provider.listInbound()).toHaveLength(31);
});
