/**
 * D2b (CTO checkpoint issue 11): notifications never expose environment variable names.
 * A delivery blocked for lack of an email provider says so in user terms; the client shows
 * it in the reader's language with a "Set up email" link, including legacy rows that still
 * carry the old technical text.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildReportDeliveryNotificationForPlan,
  getReportDeliveryPlans,
} from "../../server/services/report-delivery.service";
import {
  EMAIL_NOT_SET_UP_MESSAGE,
  EMAIL_SETUP_HREF,
  isEmailNotSetUpMessage,
  parseReportDeliveryTitle,
} from "../../shared/notification-copy";
import { localizeNotification } from "../../client/src/lib/notification-display";
import { withNotificationCopy } from "../../shared/server-copy";

it("uses CSV instructions in both languages for stored banking notices", () => {
  const notice = withNotificationCopy({
    title: "Former provider notification",
    message: "Former provider instructions",
    eventKey: "bank.sync_failed:fixture",
  });
  expect(localizeNotification(notice, en, "en").message).toBe(
    "Upload a CSV exported from your bank, review suggested matches, and reconcile against your books"
  );
  expect(localizeNotification(notice, ar, "ar").message).toBe(
    "ارفع كشف حسابك البنكي بصيغة CSV، وراجع المطابقات المقترحة، ثم طابقها مع دفاترك"
  );
});

const repo = process.cwd();
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const en = JSON.parse(read("client/src/locales/en/components.json")) as Record<string, string>;
const ar = JSON.parse(read("client/src/locales/ar/components.json")) as Record<string, string>;

describe("report delivery notification copy (CTO 11)", () => {
  const plan = getReportDeliveryPlans()[0];

  it("a no-email-provider block is user copy, with no env variable names", () => {
    const n = buildReportDeliveryNotificationForPlan({
      userId: "u",
      companyId: "c",
      plan,
      run: {
        status: "blocked",
        blockedReason: "no_email_provider",
        errorMessage: "anything",
        recipientAddresses: [],
      },
    });
    expect(n.message).toBe(EMAIL_NOT_SET_UP_MESSAGE);
    expect(`${n.title} ${n.message}`).not.toMatch(/RESEND|SMTP|API_KEY/);
    expect(parseReportDeliveryTitle(n.title)).toEqual({
      outcome: "blocked",
      planTitle: plan.title,
    });
  });

  it("server run errors for a missing provider no longer name env variables", () => {
    const delivery = read("server/services/report-render/delivery.ts");
    expect(delivery).not.toMatch(/errorMessage:\s*\n?\s*"No email provider is configured \(RESEND/);
    expect(delivery).toContain("errorMessage: EMAIL_NOT_SET_UP_RUN_ERROR");
  });

  it("recognises new and legacy messages", () => {
    expect(isEmailNotSetUpMessage(EMAIL_NOT_SET_UP_MESSAGE)).toBe(true);
    expect(
      isEmailNotSetUpMessage(
        "Nothing was sent. No email provider is configured (RESEND_API_KEY or SMTP_HOST). The pack was rendered"
      )
    ).toBe(true);
    expect(isEmailNotSetUpMessage("Emailed PDF and Excel pack to 2 recipients.")).toBe(false);
  });

  it("localises title and body in Arabic and adds the Set up email link", () => {
    const view = localizeNotification(
      {
        title: "Report delivery blocked: Owner weekly pack",
        message: "Nothing was sent. No email provider is configured (RESEND_API_KEY or SMTP_HOST).",
      },
      ar
    );
    expect(view.title).toBe("تم إيقاف إرسال التقرير: Owner weekly pack");
    expect(view.message).toBe(ar["components.notificationEmailNotSetUpBody"]);
    expect(view.message).not.toMatch(/RESEND|SMTP/);
    expect(view.setupEmailHref).toBe(EMAIL_SETUP_HREF);
    expect(ar["components.notificationEmailNotSetUpLink"]).toBeTruthy();
    expect(en["components.notificationEmailNotSetUpLink"]).toBe("Set up email");
  });

  it("leaves unrelated notifications untouched", () => {
    const view = localizeNotification({ title: "Invoice paid", message: "INV-1 was paid." }, en);
    expect(view).toEqual({ title: "Invoice paid", message: "INV-1 was paid." });
  });
});
