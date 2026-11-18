// @vitest-environment jsdom
/**
 * STEP1 F12: copy polish. Receipt-uploaded notifications show a formatted amount in both
 * languages (the stored text read "6100 AED" and rendered raw), counts use plurals.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { localizeNotification } from "../../client/src/lib/notification-display";
import { notificationCopy } from "../../shared/server-copy";
import { formatMessage, loadLocale, t as catalogs, useI18n } from "../../client/src/lib/i18n";

const catalog = (lang: string, ns: string): Record<string, string> =>
  JSON.parse(readFileSync(`client/src/locales/${lang}/${ns}.json`, "utf8"));

describe("F12: receipt-uploaded notification amount", () => {
  const en = catalog("en", "components");
  const ar = catalog("ar", "components");

  it("formats the new 'AED 6100.00' server string as money in both languages", () => {
    const copy = notificationCopy(
      "notification.receiptUploaded.title",
      "notification.receiptUploaded.message",
      { merchant: "Spinneys", amount: "AED 6100.00" }
    );
    const view = localizeNotification({ ...copy, copy: undefined } as never, en, "en");
    expect(view.message).toContain("6,100.00");
    expect(view.message).not.toContain("AED 6100.00");
    const viewAr = localizeNotification({ ...copy, copy: undefined } as never, ar, "ar");
    expect(viewAr.message).toContain("6,100.00");
    expect(viewAr.message).not.toMatch(/6100/);
  });

  it("also formats rows already stored as '6100 AED' (amount first)", () => {
    const stored = {
      title: "New receipt uploaded",
      message: "New receipt from Spinneys for 6100 AED",
    };
    const view = localizeNotification(stored, en, "en");
    expect(view.message).toContain("6,100.00");
    expect(view.message).not.toContain("6100 AED");
  });
});

describe("F12: chart of accounts group count is a plural", () => {
  it("reads '1 account' / '3 accounts' and the Arabic plural forms", async () => {
    await Promise.all([loadLocale("en"), loadLocale("ar")]);
    const en = (catalogs.en as Record<string, string>)["accounts.groupCount"];
    const ar = (catalogs.ar as Record<string, string>)["accounts.groupCount"];
    expect(formatMessage(en, { count: 1 })).toBe("1 account");
    expect(formatMessage(en, { count: 3 })).toBe("3 accounts");
    // Plural categories follow the active locale.
    useI18n.getState().setLocale("ar");
    expect(formatMessage(ar, { count: 1 })).toBe("حساب واحد");
    expect(formatMessage(ar, { count: 2 })).toBe("حسابان");
    expect(formatMessage(ar, { count: 5 })).toBe("5 حسابات");
    expect(formatMessage(ar, { count: 11 })).toBe("11 حسابًا");
    useI18n.getState().setLocale("en");
  });
});

describe("F12: security devices and evidence copy", () => {
  it("labels an unrecognised client as unknown instead of showing its raw agent string", async () => {
    const { describeUserAgent } = await import("../../client/src/pages/settings/sessions");
    expect(describeUserAgent("node")).toBeNull();
    expect(describeUserAgent(null)).toBeNull();
    expect(describeUserAgent("Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0 Safari/537.36")).toBe(
      "Chrome · Linux"
    );
    expect(catalog("en", "security")["security.unknownDevice"]).toBe("Unknown device");
    expect(catalog("ar", "security")["security.unknownDevice"]).toMatch(/[؀-ۿ]/);
  });

  it("Arabic evidence copy has no stray space after the prefix and no slash plural", () => {
    const ar = catalog("ar", "documentsEvidence");
    expect(ar["evidenceCenter.focus.showing"]).not.toMatch(/بـ /);
    expect(ar["evidenceCenter.focus.matching"]).not.toContain("صف/صفوف");
    expect(catalog("en", "documentsEvidence")["evidenceCenter.focus.matching"]).not.toContain(
      "row(s)"
    );
  });
});
