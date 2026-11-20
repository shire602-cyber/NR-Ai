import { describe, it, expect } from "vitest";
import {
  canTransitionEInvoice,
  assertEInvoiceTransition,
  isEInvoiceTerminal,
  nextRetryAt,
  EINVOICE_MAX_ATTEMPTS,
} from "../../server/services/einvoice-status";
import { MockEInvoiceProvider, getEInvoiceProvider } from "../../server/services/einvoice-provider";

describe("e-invoice status lifecycle", () => {
  it("allows the happy path generated → submitted → accepted → cleared (R07-13)", () => {
    expect(canTransitionEInvoice("not_generated", "generated")).toBe(true);
    expect(canTransitionEInvoice("generated", "submitted")).toBe(true);
    expect(canTransitionEInvoice("submitted", "accepted")).toBe(true);
    expect(canTransitionEInvoice("accepted", "cleared")).toBe(true);
    expect(canTransitionEInvoice("submitted", "cleared")).toBe(true);
    // the FTA leg can still reject after ASP acceptance
    expect(canTransitionEInvoice("accepted", "rejected")).toBe(true);
  });

  it("allows correct-and-resubmit from rejected/failed", () => {
    expect(canTransitionEInvoice("rejected", "submitted")).toBe(true);
    expect(canTransitionEInvoice("rejected", "generated")).toBe(true);
    expect(canTransitionEInvoice("failed", "submitted")).toBe(true);
  });

  it("treats cleared and cancelled as terminal; accepted cannot be resubmitted", () => {
    expect(isEInvoiceTerminal("cleared")).toBe(true);
    expect(isEInvoiceTerminal("cancelled")).toBe(true);
    expect(isEInvoiceTerminal("accepted")).toBe(false);
    expect(canTransitionEInvoice("accepted", "submitted")).toBe(false);
    expect(canTransitionEInvoice("cleared", "rejected")).toBe(false);
    expect(canTransitionEInvoice("cleared", "cancelled")).toBe(false);
  });

  it("backs off exponentially and gives up after the retry budget", () => {
    const now = new Date("2027-01-01T00:00:00Z");
    const delays = [1, 2, 3, 4, 5].map(
      (n) => (nextRetryAt(n, now) as Date).getTime() - now.getTime()
    );
    expect(delays).toEqual([60_000, 120_000, 240_000, 480_000, 960_000]);
    expect(nextRetryAt(EINVOICE_MAX_ATTEMPTS, now)).toBeNull();
  });

  it("rejects nonsensical transitions", () => {
    expect(canTransitionEInvoice("not_generated", "accepted")).toBe(false);
    expect(canTransitionEInvoice("generated", "accepted")).toBe(false);
    expect(canTransitionEInvoice("bogus", "submitted")).toBe(false);
  });

  it("assertEInvoiceTransition throws a coded error on invalid moves", () => {
    expect(() => assertEInvoiceTransition("cleared", "submitted")).toThrowError();
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
    expect((await new MockEInvoiceProvider().getStatus("mock-u1")).status).toBe("cleared");
    expect(
      (await new MockEInvoiceProvider({ outcome: "rejected", detail: "bad TRN" }).getStatus("m"))
        .status
    ).toBe("rejected");
  });

  it("parseWebhook normalises provider payloads", () => {
    const p = new MockEInvoiceProvider();
    expect(p.parseWebhook({ messageId: "m1", status: "cleared" })).toEqual({
      providerMessageId: "m1",
      status: "cleared",
      detail: null,
    });
    expect(p.parseWebhook({ messageId: "m1", status: "delivered" })?.status).toBe("accepted");
    expect(p.parseWebhook({ messageId: "m1", status: "unknown" })).toBeNull();
    expect(p.parseWebhook({ status: "accepted" })).toBeNull();
  });

  it("getEInvoiceProvider defaults to mock and rejects unknown providers", () => {
    expect(getEInvoiceProvider({} as NodeJS.ProcessEnv).name).toBe("mock");
    expect(getEInvoiceProvider({} as NodeJS.ProcessEnv).capabilities).toEqual({
      submit: true,
      getStatus: true,
      receive: true,
      cancel: true,
    });
    expect(getEInvoiceProvider({ EINVOICE_PROVIDER: "mock" } as any).name).toBe("mock");
    expect(() => getEInvoiceProvider({ EINVOICE_PROVIDER: "nope" } as any)).toThrowError();
  });
});
