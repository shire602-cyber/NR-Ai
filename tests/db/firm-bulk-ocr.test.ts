import { expect, it, vi } from "vitest";
import { useHarness } from "./harness";

const { extract } = vi.hoisted(() => ({ extract: vi.fn() }));
vi.mock("../../server/services/ocr-provider-clients", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/services/ocr-provider-clients")>()),
  createOcrClients: () => ({ anthropic: { messages: { create: extract } }, openai: null }),
}));

const h = useHarness();
const endpoint = "/api/firm/bulk/ocr";
const ocrResponse = { content: [{ type: "text", text: '{"merchant":"Shop","subtotal":50}' }] };

it("replays an OCR receipt whose commit acknowledgment outlived the deadline", async () => {
  const firm = await h.createTenant({ firmRole: "firm_owner" });
  const client = await firm.as.post("/api/firm/clients", {
    name: "Bulk OCR client",
    trnVatNumber: "100000000000003",
    emirate: "dubai",
  });
  expect(client.status, client.text).toBe(201);
  const companyId = client.body.id as string;
  const first = { companyId, filename: "first.png", imageData: "data:image/png;base64,AQID" };
  const second = { companyId, filename: "second.png", imageData: "data:image/png;base64,BAUG" };

  const { db } = await import("../../server/db");
  const runTransaction = db.transaction.bind(db);
  const deadline = new AbortController();
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  const timeout = vi.spyOn(AbortSignal, "timeout");
  timeout.mockImplementation((ms) => (ms === 40_000 ? deadline.signal : realTimeout(ms)));
  const transaction = vi.spyOn(db, "transaction");
  const acknowledgment = Promise.withResolvers<void>();
  let pendingCommit: Promise<unknown> | undefined;

  extract.mockResolvedValueOnce(ocrResponse).mockImplementationOnce(async () => {
    transaction.mockImplementationOnce((run, config) => {
      const pending = runTransaction(run, config).then(async (receipt) => {
        // PostgreSQL has saved the row. Keep the route's commit promise pending.
        deadline.abort();
        await acknowledgment.promise;
        return receipt;
      });
      pendingCommit = pending;
      return pending;
    });
    return ocrResponse;
  });

  try {
    const attempt = await firm.as.post(endpoint, { items: [first, second] });
    expect(attempt.status, attempt.text).toBe(504);
    expect(attempt.body).toMatchObject({ code: "OCR_TIMEOUT" });
    expect(attempt.body.results).toEqual([
      { companyId, filename: first.filename, success: true, receiptId: expect.any(String) },
    ]);
    const rows = await h.sql<{ id: string }>("SELECT id FROM receipts WHERE company_id = $1", [
      companyId,
    ]);
    expect(rows).toHaveLength(2);
    const lateReceipt = rows.find((row) => row.id !== attempt.body.results[0].receiptId);
    expect(lateReceipt).toBeDefined();

    timeout.mockRestore();
    const retry = await firm.as.post(endpoint, { items: [second] });
    expect(retry.status, retry.text).toBe(200);
    expect(retry.body.results).toEqual([
      { companyId, filename: second.filename, success: true, receiptId: lateReceipt!.id },
    ]);
    expect(extract).toHaveBeenCalledTimes(2);
    expect(await h.sql("SELECT id FROM receipts WHERE company_id = $1", [companyId])).toHaveLength(
      2
    );
  } finally {
    acknowledgment.resolve();
    await pendingCommit;
    timeout.mockRestore();
    transaction.mockRestore();
    extract.mockReset();
  }
});
