import { describe, expect, it } from "vitest";
import { normalizeEntry, parseLedgerDate } from "../../server/ledger/normalize";
import { legacyLinesToInput } from "../../server/ledger/legacy";
import type { PostJournalInput } from "../../server/ledger";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

function input(lines: PostJournalInput["lines"], extra: Partial<PostJournalInput> = {}) {
  return { companyId: C, date: "2026-01-15", status: "posted" as const, lines, ...extra };
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

describe("ledger normalisation (W2-A)", () => {
  it("R02-01: 100.01 vs 100.00 is ENTRY_UNBALANCED (no 0.01 tolerance)", () => {
    expect(
      codeOf(() =>
        normalizeEntry(
          input([
            { accountId: A, debit: 100.01 },
            { accountId: B, credit: 100 },
          ])
        )
      )
    ).toBe("ENTRY_UNBALANCED");
  });

  it("R02-18: amounts become integer fils and float artefacts never leak", () => {
    const n = normalizeEntry(
      input([
        { accountId: A, debit: "0.10" },
        { accountId: A, debit: 0.2 },
        { accountId: B, creditFils: 30 },
      ])
    );
    expect(n.totalDebitFils).toBe(30);
    expect(n.totalCreditFils).toBe(30);
    expect(n.lines.map((l) => [l.debitFils, l.creditFils])).toEqual([
      [10, 0],
      [20, 0],
      [0, 30],
    ]);
    // 0.1 + 0.2 as a float has >2dp and is rejected rather than rounded.
    expect(
      codeOf(() =>
        normalizeEntry(
          input([
            { accountId: A, debit: 0.1 + 0.2 },
            { accountId: B, credit: "0.30" },
          ])
        )
      )
    ).toBe("INVALID_AMOUNT");
  });

  it("R02-07: NaN, Infinity, exponent strings, overflow and bad dates are 422 codes", () => {
    const bad: Array<[unknown, string]> = [
      ["Infinity", "INVALID_AMOUNT"],
      ["NaN", "INVALID_AMOUNT"],
      ["1e3", "INVALID_AMOUNT"],
      [1e30, "INVALID_AMOUNT"],
      [99999999999999, "INVALID_AMOUNT"],
      [{}, "INVALID_AMOUNT"],
    ];
    for (const [amount, code] of bad) {
      expect(
        codeOf(() =>
          normalizeEntry(
            input([
              { accountId: A, debit: amount as string },
              { accountId: B, credit: 1 },
            ])
          )
        ),
        String(amount)
      ).toBe(code);
    }
    for (const date of ["garbage", "2025-02-30", "", "1899-12-31", "2026-13-01"]) {
      expect(
        codeOf(() => parseLedgerDate(date)),
        date
      ).toBe("INVALID_DATE");
    }
    expect(
      codeOf(() =>
        normalizeEntry(
          input(
            [
              { accountId: A, debit: 1 },
              { accountId: B, credit: 1 },
            ],
            { date: "2999-01-01" }
          )
        )
      )
    ).toBe("FUTURE_DATE");
  });

  it("R02-07: zero, negative and two-sided lines are rejected", () => {
    const cases: Array<[PostJournalInput["lines"], string]> = [
      [
        [
          { accountId: A, debit: 5 },
          { accountId: B, credit: 5 },
          { accountId: B, debit: 0, credit: 0 },
        ],
        "ZERO_AMOUNT_LINE",
      ],
      [
        [
          { accountId: A, debit: -5 },
          { accountId: B, credit: -5 },
        ],
        "NEGATIVE_JOURNAL_AMOUNT",
      ],
      [
        [
          { accountId: A, debit: 5, credit: 5 },
          { accountId: B, credit: 0.01 },
        ],
        "LINE_HAS_BOTH_SIDES",
      ],
      [[{ accountId: "nope", debit: 1 }], "ACCOUNT_NOT_FOUND"],
      [[{ accountId: A, debit: 1 }], "TOO_FEW_LINES"],
    ];
    for (const [lines, code] of cases)
      expect(codeOf(() => normalizeEntry(input(lines)))).toBe(code);
  });

  it("R02-12: same-account net-zero entries are rejected unless explicitly allowed", () => {
    const lines = [
      { accountId: A, debit: 10 },
      { accountId: A, credit: 10 },
    ];
    expect(codeOf(() => normalizeEntry(input(lines)))).toBe("SAME_ACCOUNT_ENTRY");
    expect(normalizeEntry(input(lines, { allowSameAccount: true })).totalDebitFils).toBe(1000);
  });

  it("R02-08: foreign amounts must sit on the base side; rates are positive with <= 6dp", () => {
    expect(
      codeOf(() =>
        normalizeEntry(
          input([
            { accountId: A, debit: 367.25, foreignCredit: 100, foreignCurrency: "USD" },
            { accountId: B, credit: 367.25 },
          ])
        )
      )
    ).toBe("FOREIGN_SIDE_MISMATCH");
    expect(
      codeOf(() =>
        normalizeEntry(
          input([
            { accountId: A, debit: 1, exchangeRate: "3.1234567" },
            { accountId: B, credit: 1 },
          ])
        )
      )
    ).toBe("INVALID_EXCHANGE_RATE");
    const n = normalizeEntry(
      input([
        {
          accountId: A,
          debit: "367.25",
          foreignDebit: "100",
          foreignCurrency: "usd",
          exchangeRate: "3.6725",
        },
        { accountId: B, credit: "367.25" },
      ])
    );
    expect(n.lines[0]).toMatchObject({
      foreignCurrency: "USD",
      foreignDebitFils: 10000,
      exchangeRate: "3.6725",
    });
  });

  it("R02-18: the legacy adapter rounds each line half-up first, then still demands exact balance", () => {
    const lines = legacyLinesToInput([
      { accountId: A, debit: 1296.288, credit: 0 },
      { accountId: B, debit: 0, credit: 1296.29 },
      { accountId: B, debit: 0, credit: 0 },
      { accountId: A, debit: -5, credit: 0 },
      { accountId: B, debit: 0, credit: -5 },
    ] as never);
    expect(lines.map((l) => [l.debitFils, l.creditFils])).toEqual([
      [129629, 0],
      [0, 129629],
      [0, 500],
      [500, 0],
    ]);
  });
});
