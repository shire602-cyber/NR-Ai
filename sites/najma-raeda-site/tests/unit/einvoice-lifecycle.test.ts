import { describe, it, expect } from "vitest";
import {
  canTransitionEInvoice,
  assertEInvoiceTransition,
  isEInvoiceTerminal,
} from "../../server/services/einvoice-status";
import {
  MockEInvoiceProvider,
  getEInvoiceProvider,
} from "../../server/services/einvoice-provider";

describe("e-invoice status lifecycle", () => {
  it("allows the happy path generated → submitted → accepted", () => {
    expect(canTransitionEInvoice("not_generated", "generated")).toBe(true);
    expect(canTransitionEInvoice("generated", "submitted")).toBe(true);
    expect(canTransitionEInvoice("submitted", "accepted")).toBe(true);
  });

  it("allows correct-and-resubmit from rejected/failed", () => {
    expect(canTransitionEInvoice("rejected", "submitted")).toBe(true);
    expect(canTransitionEInvoice("rejected", "generated")).toBe(true);
    expect(canTransitionEInvoice("failed", "submitted")).toBe(true);
  });

  it("treats accepted as terminal", () => {
    expect(isEInvoiceTerminal("accepted")).toBe(true);
    expect(canTransitionEInvoice("accepted", "submitted")).toBe(false);
    expect(canTransitionEInvoice("accepted", "rejected")).toBe(false);
  });

  it("rejects nonsensical transitions", () => {
    expect(canTransitionEInvoice("not_generated", "accepted")).toBe(false);
    expect(canTransitionEInvoice("generated", "accepted")).toBe(false);
    expect(canTransitionEInvoice("bogus", "submitted")).toBe(false);
  });

  it("assertEInvoiceTransition throws a coded error on invalid moves", () => {
    expect(() => assertEInvoiceTransition("accepted", "submitted")).toThrowError();
    try {
      assertEInvoiceTransition("not_generated", "accepted");
    } catch (e: any) {
      expect(e.code).toBe("EINVOICE_INVALID_TRANSITION");
    }
  });
});

describe("MockEInvoiceProvider + provider selection", () => {
  it("submit hands off and reports submitted", async () => {
    const p = new MockEInvoiceProvider();
    const r = await p.submit({ invoiceId: "i1", invoiceNumber: "INV-1", uuid: "u1", xml: "<x/>" });
    expect(r.providerMessageId).toBe("mock-u1");
    expect(r.status).toBe("submitted");
  });

  it("getStatus returns the configured clearance outcome", async () => {
    expect((await new MockEInvoiceProvider().getStatus("mock-u1")).status).toBe("accepted");
    expect(
      (await new MockEInvoiceProvider({ outcome: "rejected", detail: "bad TRN" }).getStatus("m")).status
    ).toBe("rejected");
  });

  it("parseWebhook normalises provider payloads", () => {
    const p = new MockEInvoiceProvider();
    expect(p.parseWebhook({ messageId: "m1", status: "cleared" })).toEqual({
      providerMessageId: "m1",
      status: "accepted",
      detail: null,
    });
    expect(p.parseWebhook({ messageId: "m1", status: "unknown" })).toBeNull();
    expect(p.parseWebhook({ status: "accepted" })).toBeNull();
  });

  it("getEInvoiceProvider defaults to mock and rejects unknown providers", () => {
    expect(getEInvoiceProvider({} as NodeJS.ProcessEnv).name).toBe("mock");
    expect(getEInvoiceProvider({ EINVOICE_PROVIDER: "mock" } as any).name).toBe("mock");
    expect(() => getEInvoiceProvider({ EINVOICE_PROVIDER: "nope" } as any)).toThrowError();
  });
});
