/**
 * User-facing notification copy shared by the server (which stores the English text) and the
 * client (which recognises it and shows the reader's language). D2b, CTO checkpoint issue 11:
 * notifications never expose environment variable names or provider configuration; that
 * detail goes to the server log only.
 */

/** Event key prefix for historical alerts about retired provider diagnostics. */
export const RETIRED_BANK_NOTIFICATION_PREFIX = "bank.sync_failed:";

export const BANK_STATEMENT_REVIEW_TITLE = {
  en: "Import a CSV bank statement",
  ar: "استورد كشف حساب بنكي بصيغة CSV",
} as const;

/** Body of a report-delivery notification when no email provider is configured. */
export const EMAIL_NOT_SET_UP_MESSAGE =
  "Email isn't set up yet, so nothing was sent. The report pack is ready to download.";

/** Run error stored on a delivery run blocked for lack of an email provider. */
export const EMAIL_NOT_SET_UP_RUN_ERROR =
  "Email isn't set up yet, so nothing was sent. The pack was rendered and can be downloaded.";

/** Where "Set up email" points. */
export const EMAIL_SETUP_HREF = "/integrations-hub";

/** Report delivery notification title prefixes, by run outcome. */
export const REPORT_DELIVERY_TITLE_PREFIX = {
  sent: "Report delivery sent: ",
  blocked: "Report delivery blocked: ",
  failed: "Report delivery failed: ",
  queued: "Report delivery queued: ",
} as const;

export type ReportDeliveryTitleOutcome = keyof typeof REPORT_DELIVERY_TITLE_PREFIX;

/** True for a notification/run message about missing email configuration (incl. legacy rows). */
export function isEmailNotSetUpMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  return (
    message.startsWith(EMAIL_NOT_SET_UP_MESSAGE) ||
    message.includes(EMAIL_NOT_SET_UP_RUN_ERROR) ||
    /No email provider (is )?configured|RESEND_API_KEY|SMTP_HOST/.test(message)
  );
}

/** Split a report delivery title into its outcome and plan title, or null if it is not one. */
export function parseReportDeliveryTitle(
  title: string
): { outcome: ReportDeliveryTitleOutcome; planTitle: string } | null {
  for (const [outcome, prefix] of Object.entries(REPORT_DELIVERY_TITLE_PREFIX)) {
    if (title.startsWith(prefix)) {
      return {
        outcome: outcome as ReportDeliveryTitleOutcome,
        planTitle: title.slice(prefix.length),
      };
    }
  }
  return null;
}
