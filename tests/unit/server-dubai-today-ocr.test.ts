import { afterEach, expect, it, vi } from "vitest";
import { parseReceiptOcrText } from "../../shared/receipt-ocr-parser";

afterEach(() => vi.useRealTimers());

it("an undated receipt defaults to the Dubai day at 01:30 on 28 Nov (21:30Z on 27 Nov)", () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-27T21:30:00Z") });
  expect(parseReceiptOcrText("Cafe\nTotal AED 25.00").date).toBe("2026-11-28");
});
