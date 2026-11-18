import { beforeAll, describe, expect, it } from "vitest";
import {
  activityActionLabel,
  activityDescription,
  activityEntityLabel,
  activitySentence,
  withoutIds,
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

  it("STEP1 F5: a generic Arabic row is exactly the action label (no repeated entity, no dangling separator)", () => {
    const uuid = "30cbacca-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
    const log = {
      action: "auth.login_success",
      entityType: "security",
      entityId: uuid,
      description: `Auth login success on security ${uuid}`,
    };
    expect(activitySentence(ar, log, "ar")).toBe("تسجيل دخول ناجح");
    expect(activitySentence(en, log, "en")).toBe(en["activityLog.action.auth.login_success"]);
  });

  it("STEP1 F5: an action without a catalog label keeps the entity but never an id or a trailing dot", () => {
    const uuid = "30cbacca-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
    const out = activitySentence(
      ar,
      {
        action: "security.unknown_event",
        entityType: "security",
        entityId: uuid,
        description: "x",
      },
      "ar"
    );
    expect(out).not.toContain(uuid);
    expect(out).not.toMatch(/^·|·$/);
  });

  it("STEP1 F5: withoutIds trims separators left behind by a removed id", () => {
    expect(withoutIds("Login · Security · 30cbacca-1a2b-4c3d-8e9f-0a1b2c3d4e5f")).toBe(
      "Login · Security"
    );
  });

  it("STEP1 F5: the export Description column is the localised sentence, never a UUID", () => {
    const uuid = "30cbacca-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
    const logs = [
      {
        action: "auth.login_success",
        entityType: "security",
        entityId: uuid,
        description: `Auth login success on security ${uuid}`,
      },
      {
        action: "einvoice.approver_link_create",
        entityType: "company",
        entityId: uuid,
        description: `Company einvoicing approver link create on einvoice approver link ${uuid}`,
      },
    ];
    for (const locale of ["en", "ar"] as const) {
      const table = locale === "ar" ? ar : en;
      for (const log of logs)
        expect(activitySentence(table, log, locale)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    }
  });
});
