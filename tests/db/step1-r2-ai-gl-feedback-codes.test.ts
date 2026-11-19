/**
 * STEP1 R2: Assistant > Review accept / reject / correct failures carry a stable code the client
 * has Arabic copy for, instead of a free-text English sentence.
 */
import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";
import { insertRow } from "./row-factory";

const h = useHarness();

describe("[R2] ai-gl feedback outcomes carry codes", () => {
  it("unknown queue item, already reviewed item and foreign account each return a code", async () => {
    const a = await h.createTenant();
    const base = `/api/companies/${a.company.id}/ai-gl/queue`;

    const missing = await a.as.post(`${base}/00000000-0000-4000-8000-000000000000/accept`, {});
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe("QUEUE_ITEM_NOT_FOUND");

    const id = await insertRow(
      h.sql,
      "ai_gl_queue",
      { companyId: a.company.id, userId: a.user.id },
      { status: "pending_review" }
    );
    expect((await a.as.post(`${base}/${id}/reject`, {})).status).toBe(200);
    const again = await a.as.post(`${base}/${id}/reject`, {});
    expect(again.status).toBe(400);
    expect(again.body.code).toBe("QUEUE_ITEM_NOT_PENDING");

    const id2 = await insertRow(
      h.sql,
      "ai_gl_queue",
      { companyId: a.company.id, userId: a.user.id },
      { status: "pending_review" }
    );
    const wrongAccount = await a.as.post(`${base}/${id2}/correct`, {
      accountId: "00000000-0000-4000-8000-000000000001",
    });
    expect(wrongAccount.status).toBe(400);
    expect(wrongAccount.body.code).toBe("ACCOUNT_NOT_IN_COMPANY");
  });
});
