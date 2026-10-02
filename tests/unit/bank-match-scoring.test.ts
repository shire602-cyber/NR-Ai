import { describe, expect, it } from "vitest";
import {
  CONFIDENT_SCORE,
  assignGreedy,
  mentionsDocumentNumber,
  nameSimilarity,
  scoreCandidate,
} from "../../server/services/bank-match-scoring";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("bank match scoring", () => {
  it("D3-5: an exact amount two days from the due date scores 80", () => {
    const r = scoreCandidate({
      amount: 997.5,
      date: d("2026-09-10"),
      text: "TRANSFER",
      candidate: { openAmount: 997.5, dates: [d("2026-09-01"), d("2026-09-12")] },
    });
    expect(r?.score).toBe(80);
    expect(r?.score).toBeGreaterThanOrEqual(CONFIDENT_SCORE);
    expect(r?.reasons).toEqual(["AMOUNT_EXACT", "DATE_WITHIN_3_DAYS"]);
  });

  it("the invoice outranks a receipt dated 20 days earlier", () => {
    const invoice = scoreCandidate({ amount: 997.5, date: d("2026-09-10"), text: "x", candidate: { openAmount: 997.5, dates: [d("2026-09-12")] } });
    const receipt = scoreCandidate({ amount: 997.5, date: d("2026-09-10"), text: "x", candidate: { openAmount: 997.5, dates: [d("2026-08-21")] } });
    expect(invoice!.score).toBeGreaterThan(receipt!.score);
    expect(receipt!.score).toBe(65);
  });

  it("rejects an amount more than 5% away", () => {
    expect(scoreCandidate({ amount: 100, date: d("2026-09-10"), text: "x", candidate: { openAmount: 106, dates: [] } })).toBeNull();
    expect(scoreCandidate({ amount: 105, date: d("2026-09-10"), text: "x", candidate: { openAmount: 100, dates: [] } })?.reasons).toContain("AMOUNT_WITHIN_5_PCT");
    expect(scoreCandidate({ amount: 100.5, date: d("2026-09-10"), text: "x", candidate: { openAmount: 100, dates: [] } })?.reasons).toContain("AMOUNT_WITHIN_1_PCT");
  });

  it("adds the document number and name points and caps at 100", () => {
    const r = scoreCandidate({
      amount: 500,
      date: d("2026-09-10"),
      text: "PEARL TRADING LLC INV-2001 settlement",
      candidate: { openAmount: 500, dates: [d("2026-09-10")], documentNumber: "INV-2001", name: "Pearl Trading" },
    });
    expect(r?.reasons).toEqual(["AMOUNT_EXACT", "DATE_SAME_DAY", "DOCUMENT_NUMBER_IN_TEXT", "NAME_STRONG"]);
    expect(r?.score).toBe(100);
  });

  it("matches document numbers ignoring punctuation and refuses very short ones", () => {
    expect(mentionsDocumentNumber("payment inv 2001 thanks", "INV-2001")).toBe(true);
    expect(mentionsDocumentNumber("payment 12", "12")).toBe(false);
    expect(mentionsDocumentNumber("anything", null)).toBe(false);
  });

  it("name similarity ignores stop words", () => {
    expect(nameSimilarity("Gulf Supplies LLC", "GULF SUPPLIES")).toBe(1);
    expect(nameSimilarity("payment transfer bank", "invoice")).toBe(0);
  });

  it("greedy assignment uses each transaction and each target once", () => {
    const pairs = assignGreedy(
      [
        { transactionId: "t1", scored: [{ candidate: "A", score: 80 }, { candidate: "B", score: 60 }] },
        { transactionId: "t2", scored: [{ candidate: "A", score: 90 }] },
        { transactionId: "t3", scored: [{ candidate: "B", score: 50 }] },
      ],
      (c) => c
    );
    expect(pairs.map((p) => `${p.transactionId}:${p.candidate}`)).toEqual(["t2:A", "t1:B"]);
  });
});
