/**
 * Step 1 / F8: anomaly findings name the record they are about and link to it, and the AI scan is
 * told the reader's language so its title and description come back in Arabic for Arabic users.
 * The model provider is stubbed; nothing here calls a real model.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("../../server/storage", () => ({
  storage: {
    hasCompanyAccess: vi.fn(async () => true),
    getInvoicesByCompanyId: vi.fn(async () => [
      {
        id: "11111111-1111-4111-8111-111111111111",
        number: "INV-2026-00004",
        customerName: "شركة النور",
        total: 1000,
        date: "2026-11-18",
      },
    ]),
    getReceiptsByCompanyId: vi.fn(async () => []),
    getJournalEntriesByCompanyId: vi.fn(async () => []),
    getInvoice: vi.fn(async () => ({ id: "11111111-1111-4111-8111-111111111111" })),
    getReceipt: vi.fn(async () => undefined),
    getJournalEntry: vi.fn(async () => undefined),
    createAnomalyAlert: vi.fn(async (data: Record<string, unknown>) => {
      stored.push(data);
      return { id: "alert-1", ...data };
    }),
  },
}));
vi.mock("../../server/db", () => ({ pool: { query: vi.fn(async () => ({ rows: [] })) } }));

import {
  anomalyLanguageInstruction,
  buildAnomalySystemPrompt,
  handlePostAiDetectAnomalies,
} from "../../server/routes/ai/anomalies";
import { anomalyRecordHref, anomalyRecordRef } from "../../client/src/lib/anomaly-record-link";

describe("AI anomaly prompt language", () => {
  it("asks for Modern Standard Arabic for an Arabic user and keeps record references as given", () => {
    const prompt = buildAnomalySystemPrompt("ar");
    expect(prompt).toContain("Modern Standard Arabic");
    expect(prompt).toContain("do not translate them");
    expect(prompt).toContain('"severity": "low|medium|high|critical"');
  });

  it("asks for English otherwise (also for a missing or odd locale)", () => {
    for (const locale of ["en", "en-AE", undefined, 42, ""]) {
      const prompt = buildAnomalySystemPrompt(locale);
      expect(prompt).not.toContain("Modern Standard Arabic");
      expect(prompt).toContain("Write every `title` and `description` in English.");
    }
    expect(anomalyLanguageInstruction("ar-AE")).toContain("Arabic");
  });

  it("the handler sends the language instruction to the (stubbed) model and stores its Arabic text", async () => {
    stored.length = 0;
    const create = vi.fn(async (_args: unknown) => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              anomalies: [
                {
                  type: "potential_fraud",
                  severity: "high",
                  title: "مبلغ مقرّب",
                  description: "الفاتورة INV-2026-00004 بمبلغ مقرّب يستحق المراجعة",
                  entityType: "invoice",
                  entityId: "11111111-1111-4111-8111-111111111111",
                  confidence: 0.8,
                },
              ],
              summary: { totalAnomalies: 1 },
            }),
          },
        },
      ],
    }));
    const handler = handlePostAiDetectAnomalies({
      getAI: (() => ({ chat: { completions: { create } } })) as never,
    });
    const json = vi.fn();
    await handler(
      {
        body: { companyId: "co-1", locale: "ar" },
        user: { id: "u1" },
      } as never,
      { json, status: () => ({ json }) } as never
    );
    const sent = create.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
    expect(sent.messages[0].content).toContain("Modern Standard Arabic");
    expect(stored[0]).toMatchObject({
      title: "مبلغ مقرّب",
      relatedEntityType: "invoice",
      relatedEntityId: "11111111-1111-4111-8111-111111111111",
    });
  });
});

describe("anomaly record link", () => {
  const alert = {
    relatedType: "invoice",
    relatedId: "11111111-1111-4111-8111-111111111111",
    relatedLabel: "INV-2026-00004",
  };

  beforeEach(() => undefined);

  it("names the invoice by number and opens it", () => {
    expect(anomalyRecordRef(alert, "en")).toEqual({
      label: "INV-2026-00004",
      href: "/invoices?open=11111111-1111-4111-8111-111111111111",
    });
  });

  it("uses the Arabic account name in Arabic mode and links to the account ledger", () => {
    const account = {
      relatedType: "account",
      relatedId: "22222222-2222-4222-8222-222222222222",
      relatedLabel: "5100 Rent Expense",
      relatedLabelAr: "5100 مصروف الإيجار",
    };
    expect(anomalyRecordRef(account, "ar")?.label).toBe("5100 مصروف الإيجار");
    expect(anomalyRecordRef(account, "en")?.label).toBe("5100 Rent Expense");
    expect(anomalyRecordRef(account, "en")?.href).toBe(
      "/accounts/22222222-2222-4222-8222-222222222222/ledger"
    );
  });

  it("shows no link when the server could not name the record", () => {
    expect(anomalyRecordRef({ relatedType: "invoice", relatedId: "x" }, "en")).toBeNull();
  });

  it("maps every record type an alert can point at to a real page", () => {
    expect(anomalyRecordHref("journal_entry", "j1")).toBe("/journal/j1");
    expect(anomalyRecordHref("vendor_bill", "b1")).toBe("/bill-pay/b1/edit");
    expect(anomalyRecordHref("receipt", "r1")).toBe("/receipts");
    expect(anomalyRecordHref("mystery", "r1")).toBeNull();
    expect(anomalyRecordHref("invoice", null)).toBeNull();
  });
});
