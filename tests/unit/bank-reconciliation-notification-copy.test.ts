import { beforeAll, describe, expect, it } from "vitest";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { localizeNotification } from "../../client/src/lib/notification-display";
import { serverErrorMessage } from "../../client/src/lib/validation-messages";
import arComponents from "../../client/src/locales/ar/components.json";
import enComponents from "../../client/src/locales/en/components.json";
import arPreferences from "../../client/src/locales/ar/portal.json";
import enPreferences from "../../client/src/locales/en/portal.json";
import { BANK_RECONCILIATION_COPY } from "../../shared/bank-reconciliation-copy";
import { BANK_SYNC_FAILED_NOTIFICATION } from "../../shared/notification-copy";
import { notificationCopy, withNotificationCopy } from "../../shared/server-copy";

const { titleKey, messageKey } = BANK_SYNC_FAILED_NOTIFICATION;
const failure = /reconnect|live bank feed|أعد الربط|الربط البنكي المباشر/i;
const bankErrors = [
  "BANK_CONNECTION_NOT_FOUND",
  "BANK_FEED_ACCOUNT_NOT_LINKED",
  "BANK_FEED_BALANCE_UNAVAILABLE",
  "BANK_FEED_NOT_CONFIGURED",
  "BANK_FEED_NOT_SUPPORTED",
  "BANK_FEED_NO_ACCOUNTS",
  "BANK_FEED_PROVIDER_ERROR",
  "BANK_FEED_RECONNECT_REQUIRED",
  "BANK_FEED_UNKNOWN_PROVIDER",
  "INVALID_OAUTH_STATE",
  "REDIRECT_URI_NOT_ALLOWED",
] as const;

const legacy = {
  title: "Bank feed sync failed",
  message:
    "The bank feed (Example Bank Provider) could not sync: HTTP 502. Reconnect it under Banking.",
};

const legacyWithLead = {
  title: "Continue bank reconciliation",
  message:
    "The bank connection could not sync. Upload a CSV exported from your bank, review suggested matches, and reconcile against your books.",
};

describe("bank sync failure copy", () => {
  beforeAll(async () => {
    await Promise.all([loadLocale("en"), loadLocale("ar")]);
  });

  it.each([
    {
      locale: "en",
      catalog: enComponents,
      preference: enPreferences["portal.eventType.bank.sync_failed"],
      reconciliation: "Bank reconciliation",
      guidance:
        "Upload a CSV exported from your bank, review suggested matches, and reconcile against your books",
    },
    {
      locale: "ar",
      catalog: arComponents,
      preference: arPreferences["portal.eventType.bank.sync_failed"],
      reconciliation: "التسوية البنكية",
      guidance: "ارفع كشف حسابك البنكي بصيغة CSV، وراجع المطابقات المقترحة، ثم طابقها مع دفاترك",
    },
  ] as const)(
    "shows neutral preferences and CSV guidance in $locale",
    ({ locale, catalog, guidance, preference, reconciliation }) => {
      expect(preference).toBe(reconciliation);
      for (const notification of [notificationCopy(titleKey, messageKey), legacy, legacyWithLead]) {
        const copy = localizeNotification(notification, catalog, locale);
        expect(copy).toEqual({
          title: BANK_SYNC_FAILED_NOTIFICATION.title[locale],
          message: BANK_RECONCILIATION_COPY[locale],
        });
        expect(copy.message).not.toMatch(failure);
        expect(copy.message).not.toMatch(/Example Bank Provider|HTTP 502/);
      }

      const original = useI18n.getState().locale;
      useI18n.setState({ locale });
      try {
        for (const code of bankErrors) {
          const message = serverErrorMessage(
            { code, message: "Example Bank Provider HTTP 502. Reconnect to keep syncing." },
            "Fallback"
          );
          expect(message, code).toBe(guidance);
          expect(message, code).not.toMatch(failure);
          expect(message, code).not.toMatch(/Example Bank Provider|HTTP 502/);
        }
      } finally {
        useI18n.setState({ locale: original });
      }
    }
  );

  it("normalizes legacy API fallback text without exposing server parameters", () => {
    for (const notification of [legacy, legacyWithLead]) {
      const safe = withNotificationCopy({ ...notification, id: "existing" });
      expect(safe).toEqual({
        id: "existing",
        title: BANK_SYNC_FAILED_NOTIFICATION.title.en,
        message: BANK_RECONCILIATION_COPY.en,
        copy: { titleKey, titleParams: {}, messageKey, messageParams: {} },
      });
    }
    const unknown = { title: "An unrelated notice", message: "Unchanged text." };
    expect(withNotificationCopy(unknown)).toMatchObject(unknown);
  });
});
