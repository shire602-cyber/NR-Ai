import { marketingBrand } from "../../shared/marketing-brand";
import { BANK_RECONCILIATION_COPY } from "../../shared/bank-reconciliation-copy";
import { BANK_STATEMENT_REVIEW_TITLE } from "../../shared/notification-copy";
import { isBankStatementReviewCopy, normalizeNotificationCopy } from "../../shared/server-copy";
import { escapeHtml, renderBilingualEmail, renderEmailText } from "./email-layout";

const bankStatementReviewSubject = `${BANK_STATEMENT_REVIEW_TITLE.en} | ${BANK_STATEMENT_REVIEW_TITLE.ar}`;

export function renderQueuedNotificationEmail(input: { title: string; message: string }) {
  if (isBankStatementReviewCopy(input)) {
    const content = {
      brandName: marketingBrand,
      heading: BANK_STATEMENT_REVIEW_TITLE,
      paragraphs: { en: [BANK_RECONCILIATION_COPY.en], ar: [BANK_RECONCILIATION_COPY.ar] },
    };
    return {
      subject: bankStatementReviewSubject,
      html: renderBilingualEmail(content, "bilingual"),
      textBody: renderEmailText(content, "bilingual"),
    };
  }

  const { title, message } = normalizeNotificationCopy(input);
  return {
    subject: title,
    html: renderBilingualEmail(
      {
        brandName: marketingBrand,
        heading: { en: title, ar: title },
        paragraphs: { en: [escapeHtml(message)], ar: [] },
        footer: `${marketingBrand} notifications — manage them under Settings → Notifications`,
      },
      "en"
    ),
    textBody: message,
  };
}

export function refreshQueuedNotificationEmail(subject: string, textBody: string | null) {
  const title = subject === bankStatementReviewSubject ? BANK_STATEMENT_REVIEW_TITLE.en : subject;
  const message = textBody ?? "";
  const input =
    subject === bankStatementReviewSubject &&
    message.split(/\r?\n/).includes(BANK_RECONCILIATION_COPY.en)
      ? { title, message: BANK_RECONCILIATION_COPY.en }
      : { title, message };
  return isBankStatementReviewCopy(input) ? renderQueuedNotificationEmail(input) : null;
}
