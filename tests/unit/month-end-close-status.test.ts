import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { closeChecklistStatus } from "../../client/src/pages/month-end/closeStatus";

describe("month-end close checklist status", () => {
  it("never reports a failed load as complete or as a count", () => {
    const s = closeChecklistStatus({ isLoading: false, isError: true, items: undefined });
    expect(s.state).toBe("error");
    expect(s.remaining).toBe(0);
  });
  it("reports a paused first fetch as waiting, not failed", () => {
    const input = { isLoading: false, isError: false, isPaused: true, items: undefined };
    expect(closeChecklistStatus(input).state).toBe("waiting");
    expect(closeChecklistStatus({ ...input, isError: true }).state).toBe("error");
  });
  it("keeps cached items after a failed refresh", () => {
    expect(
      closeChecklistStatus({ isLoading: false, isError: true, items: [{ done: false }] })
    ).toMatchObject({ state: "incomplete", total: 1, remaining: 1 });
    expect(closeChecklistStatus({ isLoading: false, isError: true, items: [] }).state).toBe(
      "empty"
    );
  });
  it("does not report an empty checklist as all clear", () => {
    expect(closeChecklistStatus({ isLoading: false, isError: false, items: [] }).state).toBe(
      "empty"
    );
  });
  it("counts remaining items", () => {
    const s = closeChecklistStatus({
      isLoading: false,
      isError: false,
      items: [{ done: true }, { done: false }, { done: false }],
    });
    expect(s).toMatchObject({ state: "incomplete", done: 1, total: 3, remaining: 2 });
    expect(
      closeChecklistStatus({ isLoading: false, isError: false, items: [{ done: true }] }).state
    ).toBe("complete");
  });
  it("has English and Arabic copy for every new error key", () => {
    for (const l of ["en", "ar"]) {
      const j = JSON.parse(readFileSync(`client/src/locales/${l}/monthEnd.json`, "utf8"));
      for (const k of [
        "checklistLoadFailed",
        "checklistUnavailable",
        "checklistEmpty",
        "lockChecklistUnavailable",
        "historyLoadFailed",
        "historyRefreshFailed",
        "historyWaitingToLoad",
        "retry",
        "retryingHistory",
        "historyWaitingForConnection",
        "retryingChecklist",
        "checklistWaitingForConnection",
        "checklistRefreshFailed",
        "checklistWaitingToLoad",
      ]) {
        expect(j[`monthEnd.${k}`], `${l}:${k}`).toBeTruthy();
      }
    }
  });
});
