import { describe, expect, it, vi } from "vitest";
import {
  assertTransition,
  defineMachine,
  journalLifecycle,
  journalMachine,
  transitionRow,
} from "../../server/ledger/state-machines";
import { journalEntries } from "../../shared/schema";

describe("ledger state machines (W2-A)", () => {
  const m = defineMachine({
    states: ["draft", "sent", "paid", "void"] as const,
    transitions: { draft: ["sent", "void"], sent: ["paid", "void"] },
  });

  it("allows declared transitions and treats states without targets as terminal", () => {
    expect(m.can("draft", "sent")).toBe(true);
    expect(m.can("sent", "draft")).toBe(false);
    expect(m.isTerminal("paid")).toBe(true);
    expect(m.isTerminal("draft")).toBe(false);
    expect(() => assertTransition(m, "draft", "void")).not.toThrow();
  });

  it("assertTransition throws 409 INVALID_TRANSITION for illegal or unknown moves", () => {
    for (const [from, to] of [
      ["paid", "draft"],
      ["draft", "paid"],
      ["bogus", "sent"],
    ]) {
      try {
        assertTransition(m, from, to);
        throw new Error("expected a throw");
      } catch (err) {
        expect(err).toMatchObject({ code: "INVALID_TRANSITION", statusCode: 409 });
      }
    }
  });

  it("defineMachine rejects malformed specs", () => {
    expect(() => defineMachine({ states: [], transitions: {} })).toThrow();
    expect(() =>
      defineMachine({ states: ["a", "a"] as const, transitions: {} as Record<string, never> })
    ).toThrow(/duplicate/);
    expect(() =>
      defineMachine({ states: ["a", "b"] as const, transitions: { a: ["c" as "b"] } })
    ).toThrow(/unknown target/);
    expect(() => defineMachine({ states: ["a"] as const, transitions: { a: ["a"] } })).toThrow(
      /self-transition/
    );
  });

  it("journal machine: draft -> posted -> reversed | voided, nothing else", () => {
    expect(journalMachine.can("draft", "posted")).toBe(true);
    expect(journalMachine.can("posted", "reversed")).toBe(true);
    expect(journalMachine.can("posted", "voided")).toBe(true);
    expect(journalMachine.can("posted", "draft")).toBe(false);
    expect(journalMachine.can("reversed", "posted")).toBe(false);
    expect(journalMachine.isTerminal("voided")).toBe(true);
  });

  it("R02-09: journalLifecycle derives reversed/voided from the original's link, status stays posted", () => {
    expect(journalLifecycle({ status: "draft" })).toBe("draft");
    expect(journalLifecycle({ status: "posted", reversedByEntryId: null })).toBe("posted");
    expect(
      journalLifecycle({ status: "posted", reversedByEntryId: "x", reversalKind: "reversed" })
    ).toBe("reversed");
    expect(
      journalLifecycle({ status: "posted", reversedByEntryId: "x", reversalKind: "voided" })
    ).toBe("voided");
    expect(journalLifecycle({ status: "void" })).toBe("void");
  });

  it("transitionRow issues ONE conditional update and returns null when nothing matched", async () => {
    const calls: string[] = [];
    let rows: unknown[] = [{ id: "1", status: "posted" }];
    const chain = {
      set: vi.fn((patch: Record<string, unknown>) => {
        calls.push(`set:${patch.status}`);
        return chain;
      }),
      where: vi.fn(() => {
        calls.push("where");
        return chain;
      }),
      returning: vi.fn(async () => rows),
    };
    const tx = { update: vi.fn(() => chain) } as never;
    const row = await transitionRow(
      tx,
      journalEntries,
      "1",
      "draft",
      "posted",
      { postedBy: "u" },
      {
        machine: journalMachine,
      }
    );
    expect(row).toEqual({ id: "1", status: "posted" });
    expect(calls).toEqual(["set:posted", "where"]);
    rows = [];
    expect(await transitionRow(tx, journalEntries, "1", "draft", "posted")).toBeNull();
    await expect(
      transitionRow(tx, journalEntries, "1", "posted", "draft", {}, { machine: journalMachine })
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await expect(
      transitionRow(tx, journalEntries, "1", "draft", "posted", { status: "x" })
    ).rejects.toThrow(/target state/);
  });
});
