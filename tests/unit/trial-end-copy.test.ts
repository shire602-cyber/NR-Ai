import { expect, it } from "vitest";
import en from "../../client/src/locales/en/adminConsole.json";
import ar from "../../client/src/locales/ar/adminConsole.json";
import enComponents from "../../client/src/locales/en/components.json";
import arComponents from "../../client/src/locales/ar/components.json";

// Trial end is read-only until a plan is chosen: no copy may call the workspace "locked".
it("describes the no-plan trial end as read-only in English and Arabic", () => {
  expect(en["adminConsole.planNone"]).toMatch(/read-only/i);
  expect(en["adminConsole.planNone"]).not.toMatch(/locked/i);
  expect(ar["adminConsole.planNone"]).toContain("للقراءة فقط");
  expect(ar["adminConsole.planNone"]).not.toContain("تُقفل");
});

it("keeps the trial-ended banner read-only with a way to choose a plan, in both languages", () => {
  for (const [catalog, readOnly] of [
    [enComponents, /read-only/i],
    [arComponents, /للقراءة فقط/],
  ] as const) {
    const c = catalog as Record<string, string>;
    expect(c["components.planLockTrialEndedBody"]).toMatch(readOnly);
    expect(c["components.planLockChoosePlan"]).toBeTruthy();
  }
});
