import { beforeAll, describe, expect, it } from "vitest";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { serverErrorMessage } from "../../client/src/lib/validation-messages";
import { BANK_RECONCILIATION_COPY } from "../../shared/bank-reconciliation-copy";
import { BANK_STATEMENT_REVIEW_TITLE } from "../../shared/notification-copy";
import { normalizeNotificationCopy } from "../../shared/server-copy";
import {
  refreshQueuedNotificationEmail,
  renderQueuedNotificationEmail,
} from "../../server/services/notification-email-copy";

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

describe("bank reconciliation copy", () => {
  beforeAll(async () => {
    await Promise.all([loadLocale("en"), loadLocale("ar")]);
  });

  it.each([legacy, legacyWithLead])("normalizes stored notification $title", (notice) => {
    expect(normalizeNotificationCopy(notice)).toEqual({
      title: BANK_STATEMENT_REVIEW_TITLE.en,
      message: BANK_RECONCILIATION_COPY.en,
    });
    const queued = renderQueuedNotificationEmail(notice);
    expect(refreshQueuedNotificationEmail(notice.title, notice.message)).toEqual(queued);
    expect(refreshQueuedNotificationEmail(queued.subject, queued.textBody)).toEqual(queued);
  });

  it("leaves unrelated notification text alone", () => {
    const notice = { title: legacyWithLead.title, message: "Unchanged text." };
    expect(normalizeNotificationCopy(notice)).toBe(notice);
    expect(refreshQueuedNotificationEmail(notice.title, notice.message)).toBeNull();
  });

  it.each(["en", "ar"] as const)(
    "shows approved CSV guidance for legacy API errors in %s",
    (locale) => {
      const original = useI18n.getState().locale;
      useI18n.setState({ locale });
      try {
        for (const code of [
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
        ]) {
          expect(
            serverErrorMessage({ code, message: "Example provider HTTP 502" }, "Fallback"),
            code
          ).toBe(BANK_RECONCILIATION_COPY[locale]);
        }
      } finally {
        useI18n.setState({ locale: original });
      }
    }
  );
});
