import { describe, it, expect } from "vitest";
import {
  canQuoteTransition,
  isQuoteDeletable,
  isQuoteEditable,
  isQuoteExpiredByDate,
  quoteContentHash,
} from "../../server/services/quote-state-machine";

describe("quote state machine", () => {
  it("draft -> sent is the only way out of draft except conversion", () => {
    expect(canQuoteTransition("draft", "send")).toBe(true);
    expect(canQuoteTransition("draft", "accept")).toBe(false);
    expect(canQuoteTransition("draft", "convert")).toBe(true);
  });
  it("only a sent quote can be accepted, declined or expired", () => {
    for (const a of ["accept", "decline", "expire"] as const) {
      expect(canQuoteTransition("sent", a)).toBe(true);
      expect(canQuoteTransition("accepted", a)).toBe(false);
      expect(canQuoteTransition("declined", a)).toBe(false);
      expect(canQuoteTransition("expired", a)).toBe(false);
    }
  });
  it("revise reopens sent, declined and expired quotes but never an accepted or converted one", () => {
    expect(canQuoteTransition("sent", "revise")).toBe(true);
    expect(canQuoteTransition("declined", "revise")).toBe(true);
    expect(canQuoteTransition("expired", "revise")).toBe(true);
    expect(canQuoteTransition("accepted", "revise")).toBe(false);
    expect(canQuoteTransition("converted", "revise")).toBe(false);
  });
  it("convert is possible from draft, sent and accepted, once", () => {
    expect(canQuoteTransition("sent", "convert")).toBe(true);
    expect(canQuoteTransition("accepted", "convert")).toBe(true);
    expect(canQuoteTransition("converted", "convert")).toBe(false);
    expect(canQuoteTransition("declined", "convert")).toBe(false);
    expect(canQuoteTransition("expired", "convert")).toBe(false);
  });
  it("only a draft is editable; only draft, declined and expired may be deleted", () => {
    expect(isQuoteEditable("draft")).toBe(true);
    expect(isQuoteEditable("sent")).toBe(false);
    expect(isQuoteDeletable("draft")).toBe(true);
    expect(isQuoteDeletable("declined")).toBe(true);
    expect(isQuoteDeletable("expired")).toBe(true);
    expect(isQuoteDeletable("sent")).toBe(false);
    expect(isQuoteDeletable("accepted")).toBe(false);
    expect(isQuoteDeletable("converted")).toBe(false);
  });
  it("a quote is expired when its expiry day is before today", () => {
    expect(isQuoteExpiredByDate("2026-10-01", "2026-10-02")).toBe(true);
    expect(isQuoteExpiredByDate("2026-10-02", "2026-10-02")).toBe(false);
    expect(isQuoteExpiredByDate(null, "2026-10-02")).toBe(false);
  });
  it("the content hash changes with any amount or line and not with line order of keys", () => {
    const a = quoteContentHash({ subtotal: 100, vatAmount: 5, total: 105, lines: [{ description: "x", quantity: 1, unitPrice: 100, vatRate: 0.05 }] });
    const b = quoteContentHash({ total: 105, vatAmount: 5, subtotal: 100, lines: [{ vatRate: 0.05, unitPrice: 100, quantity: 1, description: "x" }] });
    const c = quoteContentHash({ subtotal: 100, vatAmount: 5, total: 105, lines: [{ description: "x", quantity: 2, unitPrice: 100, vatRate: 0.05 }] });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
