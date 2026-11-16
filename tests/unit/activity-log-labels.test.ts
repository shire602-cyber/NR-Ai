import { beforeAll, describe, expect, it } from "vitest";
import {
  activityActionLabel,
  activityDescription,
  activityEntityLabel,
} from "../../client/src/lib/activity-log-labels";
import { loadLocale, t } from "../../client/src/lib/i18n";

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

const ARABIC = /[؀-ۿ]/;
const hasLatinWord = (value: string) => /[A-Za-z]{2,}/.test(value);

describe("activity log labels (S1 Arabic sweep)", () => {
  const ar = t.ar as Record<string, string>;
  const en = t.en as Record<string, string>;

  it("keeps the server English description in English mode", () => {
    const log = {
      action: "invoice.create",
      entityType: "invoice",
      description: "Invoice INV-2026-00001 created",
    };
    expect(activityDescription(en, log, "en")).toBe("Invoice INV-2026-00001 created");
  });

  it("rebuilds known descriptions in Arabic and keeps the document number", () => {
    const out = activityDescription(
      ar,
      {
        action: "journal.create_draft",
        entityType: "journal_entry",
        description: "Journal entry JE-20261116-001 saved as draft",
      },
      "ar"
    );
    expect(out).toMatch(ARABIC);
    expect(out).toContain("JE-20261116-001");
    expect(out).not.toContain("Journal entry");
  });

  it("falls back to action and entity labels (plus id) for other codes", () => {
    const out = activityDescription(
      ar,
      {
        action: "auth.register",
        entityType: "user",
        entityId: "f6a1ad7a-d8fb-4eac",
        description: "Auth register on user f6a1ad7a-d8fb-4eac",
      },
      "ar"
    );
    expect(out).toMatch(ARABIC);
    expect(out).toContain("f6a1ad7a-d8fb-4eac");
    expect(out.replace("f6a1ad7a-d8fb-4eac", "")).not.toMatch(/[A-Za-z]{2,}/);
  });

  it("translates every action code and entity type the audit log emits", () => {
    const actions = Object.keys(ar).filter((key) => key.startsWith("activityLog.action."));
    const entities = Object.keys(ar).filter((key) => key.startsWith("activityLog.entity."));
    expect(actions.length).toBeGreaterThan(100);
    expect(entities.length).toBeGreaterThan(20);
    for (const key of [...actions, ...entities]) {
      expect(hasLatinWord(ar[key].replace(/API|OpenAI|XML|PDF/g, "")), key).toBe(false);
      expect(ar[key]).toMatch(ARABIC);
    }
    expect(activityActionLabel(ar, "auth.login_success")).toMatch(ARABIC);
    expect(activityEntityLabel(ar, "bank_statement")).toMatch(ARABIC);
  });
});
