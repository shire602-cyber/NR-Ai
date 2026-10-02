import { describe, expect, it } from "vitest";
import {
  booksStartBody,
  booksStartOk,
  filedElsewhereBody,
  filingDateOk,
  isCalendarDay,
} from "../../client/src/lib/vat-filed-elsewhere";

describe("filed outside Muhasib", () => {
  it("accepts a real day between the period end and today", () => {
    expect(filingDateOk("2024-01-28", "2023-12-31T23:59:59.999Z", "2026-10-02")).toBe(true);
    expect(filingDateOk("2026-10-02", "2026-09-30", "2026-10-02")).toBe(true);
  });
  it("refuses a future day, a day before the period ended, or a non-date", () => {
    expect(filingDateOk("2026-10-03", "2026-09-30", "2026-10-02")).toBe(false);
    expect(filingDateOk("2026-09-29", "2026-09-30", "2026-10-02")).toBe(false);
    expect(filingDateOk("2026-02-30", "2025-12-31", "2026-10-02")).toBe(false);
    expect(filingDateOk("", "2025-12-31", "2026-10-02")).toBe(false);
  });
  it("sends days only and leaves out a blank reference", () => {
    expect(
      filedElsewhereBody("2023-10-01T00:00:00.000Z", "2023-12-31T23:59:59.999Z", "2024-01-25", "  ")
    ).toEqual({ periodStart: "2023-10-01", periodEnd: "2023-12-31", filingDate: "2024-01-25" });
    expect(filedElsewhereBody("2023-10-01", "2023-12-31", "2024-01-25", " FTA-123 ")).toEqual({
      periodStart: "2023-10-01",
      periodEnd: "2023-12-31",
      filingDate: "2024-01-25",
      reference: "FTA-123",
    });
  });
  it("validates the books start as blank or the first of a month", () => {
    expect(isCalendarDay("2026-07-01")).toBe(true);
    expect(booksStartOk("")).toBe(true);
    expect(booksStartOk("2026-07-01")).toBe(true);
    expect(booksStartOk("2026-07-15")).toBe(false);
    expect(booksStartBody("")).toEqual({ vatBooksStart: null });
    expect(booksStartBody("2026-07-01")).toEqual({ vatBooksStart: "2026-07-01" });
  });
});
