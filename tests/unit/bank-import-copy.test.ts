// @vitest-environment jsdom
/**
 * Step 1 / F4: the bank statement import notification and toasts use the right Arabic plural
 * (zero, one, two, few, many) and a re-import that adds nothing says what it skipped.
 */
import { describe, expect, it } from "vitest";
import arComponents from "../../client/src/locales/ar/components.json";
import enComponents from "../../client/src/locales/en/components.json";
import arToasts from "../../client/src/locales/ar/toasts.json";
import enToasts from "../../client/src/locales/en/toasts.json";
import { formatMessage, loadLocale, useI18n } from "../../client/src/lib/i18n";
import { localizeApiError } from "../../client/src/lib/validation-messages";
import { bankStatementCopy } from "../../shared/bank-statement-copy";
import {
  describeNotificationCopy,
  notificationCopy,
  renderDescriptor,
  withNotificationCopy,
} from "../../shared/server-copy";

const ar = arComponents as Record<string, string>;
const en = enComponents as Record<string, string>;

const arMessage = (key: string, params: Record<string, string | number>) =>
  renderDescriptor(key, params as Record<string, string>, "", ar);

describe("bank statement imported notification", () => {
  const base = { bank: "بنك الإمارات" };
  const key = "notification.bankStatementImported.message";

  it.each([
    [0, "لم تُستورد أي معاملة"],
    [1, "تم استيراد معاملة واحدة"],
    [2, "تم استيراد معاملتين"],
    [4, "تم استيراد 4 معاملات"],
    [11, "تم استيراد 11 معاملة"],
  ])("%i created reads %s", (count, expected) => {
    const text = arMessage(key, { ...base, count });
    expect(text).toContain(expected);
    expect(text).toContain("من بنك الإمارات");
    expect(text).not.toMatch(/صيغة|CSV/);
    expect(text).not.toMatch(/[{}#]/);
  });

  it("English keeps the stored sentence and parses back to the same key", () => {
    const { message } = notificationCopy("notification.bankStatementImported.title", key, {
      ...base,
      count: 3,
    });
    expect(message).toBe("3 transaction(s) imported from بنك الإمارات");
    const described = describeNotificationCopy({
      title: "Bank statement imported",
      message,
    } as never);
    expect(described.messageKey).toBe(key);
  });

  it("a re-import that adds nothing names the rows it skipped", () => {
    const nothing = arMessage("notification.bankStatementNothingNew.message", {
      ...base,
      count: 0,
      skipped: 2,
    });
    expect(nothing).toContain("لا توجد معاملات جديدة");
    expect(nothing).toContain("معاملتان مستوردتان مسبقًا");
    const some = arMessage("notification.bankStatementImportedSkipped.message", {
      ...base,
      count: 3,
      skipped: 11,
    });
    expect(some).toContain("تم استيراد 3 معاملات");
    expect(some).toContain("11 معاملة مستوردة مسبقًا");
    const english = notificationCopy(
      "notification.bankStatementImported.title",
      "notification.bankStatementNothingNew.message",
      { ...base, count: 0, skipped: 2 }
    ).message;
    expect(english).toBe("No new transactions from بنك الإمارات; 2 already imported");
    expect(en["components.srv.notification.bankStatementNothingNew.message"]).toBeTruthy();
  });

  it.each([
    [
      "3 transaction(s) imported from بنك الإمارات (MT940 format)",
      "3 transaction(s) imported from بنك الإمارات",
      "notification.bankStatementImported.message",
    ],
    [
      "3 transaction(s) imported from بنك الإمارات (OFX/QFX format); 2 already imported",
      "3 transaction(s) imported from بنك الإمارات; 2 already imported",
      "notification.bankStatementImportedSkipped.message",
    ],
    [
      "No new transactions from  (CAMT.053 format); 2 already imported",
      "No new transactions; 2 already imported",
      "notification.bankStatementNothingNew.message",
    ],
  ])(
    "removes historical format copy while keeping transaction counts",
    (message, expected, key) => {
      const original = { title: "Bank statement imported", message };
      const described = describeNotificationCopy(original);
      const stored = withNotificationCopy(original);
      expect(stored.message).toBe(expected);
      expect(stored.copy).toEqual(described);
      expect(described.messageKey).toBe(key);
      expect(described.messageParams).not.toHaveProperty("format");
      expect(renderDescriptor(key, described.messageParams, "", en)).toBe(expected);
      const arabic = arMessage(key, described.messageParams);
      expect(arabic).not.toMatch(/MT940|CAMT|OFX|QFX|صيغة/);
      if (expected.includes("already imported"))
        expect(arabic).toContain("معاملتان مستوردتان مسبقًا");
    }
  );
});

describe("bank statement import toasts", () => {
  const toast = (catalog: Record<string, string>, key: string, values: Record<string, number>) =>
    formatMessage(catalog[key], values);

  it("Arabic counts agree with the noun", async () => {
    const { useI18n } = await import("../../client/src/lib/i18n");
    useI18n.getState().setLocale("ar");
    try {
      const t = arToasts as Record<string, string>;
      expect(toast(t, "toasts.importedMatchingPrepared", { imported: 0 })).toContain(
        "لم تُستورد أي معاملة"
      );
      expect(toast(t, "toasts.importedMatchingPrepared", { imported: 1 })).toContain(
        "معاملة واحدة"
      );
      expect(toast(t, "toasts.importedMatchingPrepared", { imported: 2 })).toContain("معاملتين");
      expect(toast(t, "toasts.importedMatchingPrepared", { imported: 4 })).toContain("4 معاملات");
      expect(toast(t, "toasts.importedMatchingPrepared", { imported: 11 })).toContain("11 معاملة");
      expect(toast(t, "toasts.importedSkippedDuplicates", { imported: 3, skipped: 1 })).toBe(
        "تم استيراد 3 معاملات جديدة؛ وتم تخطي معاملة مكررة واحدة."
      );
      expect(toast(t, "toasts.importedNothingNew", { skipped: 2 })).toContain(
        "معاملتان مستوردتان مسبقًا"
      );
    } finally {
      useI18n.getState().setLocale("en");
    }
  });

  it("English reads naturally for one and many", () => {
    const t = enToasts as Record<string, string>;
    expect(toast(t, "toasts.importedMatchingPrepared", { imported: 1 })).toContain(
      "Imported 1 transaction."
    );
    expect(toast(t, "toasts.importedSkippedDuplicates", { imported: 2, skipped: 1 })).toBe(
      "Imported 2 new transactions; skipped 1 duplicate."
    );
    expect(toast(t, "toasts.importedNothingNew", { skipped: 1 })).toBe(
      "No new transactions: 1 was already imported."
    );
  });
});

it.each(["en", "ar"] as const)("localizes empty statement input guidance in %s", async (locale) => {
  await loadLocale(locale);
  useI18n.getState().setLocale(locale);
  try {
    const message = localizeApiError({
      code: "VALIDATION_ERROR",
      fields: { _root: [bankStatementCopy.en] },
    });
    expect(message).toContain(bankStatementCopy[locale]);
    expect(message).not.toMatch(/XLSX|fileBase64/);
  } finally {
    useI18n.getState().setLocale("en");
  }
});
