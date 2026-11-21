/**
 * Server-generated user copy as stable message keys + params (D4).
 *
 * The server keeps writing the English sentence (stored notification rows, email, API
 * back-compat) but every sentence now comes from one template here, so it can also be
 * described as `{ key, params }`. The client renders the same key from its en/ar catalogs
 * (`components.srv.<key>`, same `{param}` / `[optional {param}]` syntax); rows stored before
 * this existed are mapped back to keys on read with `parseServerCopy`.
 *
 * Template syntax: `{name}` is a parameter, `[ ... ]` is an optional segment that is dropped
 * when any parameter inside it is missing or empty.
 */

import { EMAIL_NOT_SET_UP_RUN_ERROR } from "./notification-copy";

export interface CopyDescriptor {
  key: string;
  params: Record<string, string>;
}

/** Catalog key (in `components.json` en/ar) for a server copy key. */
export const serverCopyCatalogKey = (key: string) => `components.srv.${key}`;

export type CopyTemplate = {
  key: string;
  en: string;
  prefix?: boolean;
  /** Params filled in when an older stored sentence did not carry them (legacy wording). */
  defaults?: Record<string, string>;
};

const T = (
  key: string,
  en: string,
  prefix = false,
  defaults?: Record<string, string>
): CopyTemplate => ({ key, en, prefix, ...(defaults ? { defaults } : {}) });

/** Notification titles, most specific first. */
export const NOTIFICATION_TITLE_TEMPLATES: readonly CopyTemplate[] = [
  T("notification.invoiceIssued.title", "Invoice {number} issued"),
  T("notification.invoicePaid.title", "Invoice {number} paid"),
  T("notification.portalJoined.title", "{customer} joined your customer portal"),
  T("notification.paymentReceived.title", "Payment received[ for {number}]"),
  T("notification.billApproved.title", "Bill approved {label}"),
  T("notification.billPaid.title", "Bill paid {label}"),
  T("notification.payrollApproved.title", "Payroll approved"),
  T("notification.deadlineDue.title", "Deadline due[ {dueDate}]"),
  T("notification.taskDue.title", "Task due[ {dueDate}]"),
  T("notification.invoiceOverdue.title", "Invoice {number} is overdue"),
  T("notification.vatReturnDue.title", "VAT return due {dueDate}"),
  T("notification.newSignIn.title", "New sign-in to your account"),
  T("notification.signInLocked.title", "Sign-in temporarily locked"),
  T("notification.referralSignup.title", "New referral signup!"),
  T("notification.emailSentToClient.title", "Email sent to client"),
  T("notification.whatsappLogged.title", "WhatsApp message logged"),
  T("notification.bankStatementImported.title", "Bank statement imported"),
  T("notification.receiptUploaded.title", "Receipt uploaded"),
  T("notification.invoiceCreated.title", "Invoice created"),
  T("notification.invoiceVoid.title", "Invoice void"),
  T("notification.reportDeliverySent.title", "Report delivery sent: {title}"),
  T("notification.reportDeliveryBlocked.title", "Report delivery blocked: {title}"),
  T("notification.reportDeliveryFailed.title", "Report delivery failed: {title}"),
  T("notification.reportDeliveryQueued.title", "Report delivery queued: {title}"),
  T("notification.aiDraftsReview.title", "AI draft journal entries to review: {count}"),
];

/** Notification messages, most specific first. `prefix` messages carry trailing catalog text. */
export const NOTIFICATION_MESSAGE_TEMPLATES: readonly CopyTemplate[] = [
  T(
    "notification.aiDraftsReview.message",
    "The AI categorised {count} bank transaction(s) with high confidence. Review and approve each draft journal entry before it posts to the ledger."
  ),
  T("notification.invoiceIssued.message", "Invoice {number} was issued[ for {amount}]."),
  T("notification.invoicePaid.message", "Invoice {number} is fully paid."),
  T(
    "notification.portalJoined.message",
    "{email} accepted your invitation and can now see the invoices issued to {customer}."
  ),
  T(
    "notification.paymentReceived.message",
    "A payment of {amount} was recorded[ against invoice {number}]."
  ),
  T("notification.billApproved.message", "Bill {label} was approved for payment."),
  T("notification.billPaid.message", "Bill {label} was paid."),
  T("notification.payrollApproved.message", "Payroll for {month}/{year} was approved."),
  T("notification.deadlineDueGeneric.message", "A compliance obligation is due[ on {dueDate}]."),
  T("notification.taskDue.message", "A task is due[ on {dueDate}]."),
  T("notification.invoiceOverdue.message", "Invoice {number} for {customer} was due on {dueDate}."),
  T(
    "notification.vatReturnDue.message",
    "The VAT return for the period ending {periodEnd} is due on {dueDate}."
  ),
  T("notification.deadlineDue.message", "{obligation} is due[ on {dueDate}]."),
  T(
    "notification.newSignIn.message",
    "A sign-in from a new device ({device}) and network ({network}) was recorded. If this was not you, change your password and sign out every session."
  ),
  T(
    "notification.signInLocked.message",
    "Several failed sign-in attempts were made on your account. Sign-in is paused for about {minutes} minute(s). If this was not you, reset your password."
  ),
  T(
    "notification.referralSignup.message",
    "Someone signed up using your referral code. They'll need to complete a qualifying action for you to earn your reward."
  ),
  T("notification.emailSentToClient.message", 'Email "{subject}" sent to {recipient}'),
  T(
    "notification.whatsappLogged.message",
    "WhatsApp draft logged for {phone}; no provider delivery occurred."
  ),
  // Step 1 / F4: re-imports say what was skipped; the Arabic catalog entries use ICU plurals.
  T(
    "notification.bankStatementImportedSkipped.message",
    "{count} transaction(s) imported from {bank} ({format} format); {skipped} already imported"
  ),
  T(
    "notification.bankStatementNothingNew.message",
    "No new transactions from {bank} ({format} format); {skipped} already imported"
  ),
  T(
    "notification.bankStatementImported.message",
    "{count} transaction(s) imported from {bank} ({format} format)"
  ),
  T(
    "notification.receiptUploadedUnknown.message",
    "New receipt from unknown merchant[ for {amount}]"
  ),
  T("notification.receiptUploaded.message", "New receipt from {merchant}[ for {amount}]"),
  T("notification.invoiceCreated.message", "Invoice {number} for {customer} — {total} {currency}"),
  T("notification.invoiceVoid.message", "Invoice {number} for {customer} marked as void"),
  // Report delivery outcome sentences: followed by catalog channel/suite/guardrail text.
  T(
    "notification.reportDeliverySentOne.message",
    "Emailed PDF and Excel pack to 1 recipient.",
    true
  ),
  T(
    "notification.reportDeliverySent.message",
    "Emailed PDF and Excel pack to {count} recipients.",
    true
  ),
  T("notification.reportDeliveryNothingSent.message", "Nothing was sent.", true),
  T("notification.reportDeliveryScheduled.message", "{format} scheduled for {date}.", true),
];

/**
 * Report-delivery run errors and handoff-review sentences (stored on `errorMessage` / returned in
 * `handoffReview`). The English stays in the row; the client localises it with
 * `localizeReportDeliveryText`. Raw provider / exception text inside `{reason}` stays as is.
 */
export const REPORT_DELIVERY_TEMPLATES: readonly CopyTemplate[] = [
  T("reportDelivery.run.emailNotSetUp", EMAIL_NOT_SET_UP_RUN_ERROR),
  T(
    "reportDelivery.run.noRecipients",
    "No recipient email address: add addresses to the subscription's recipients setting or give a team member the matching role."
  ),
  T("reportDelivery.run.failed", "Report delivery failed: {reason}"),
  T("reportDelivery.run.recipientsFailed", "Could not resolve recipients: {reason}"),
  T("reportDelivery.run.renderFailed", "Report pack could not be rendered: {reason}"),
  T("reportDelivery.run.sheetsCopy", "Google Sheets copy: {url}"),
  T("reportDelivery.run.sheetsFailed", "Google Sheets copy failed: {reason}"),
  T("reportDelivery.run.providerRejected", "Email provider did not accept the message"),
  T("reportDelivery.run.recipientFailed", "Delivery to {recipient} failed: {reason}"),
  T("reportDelivery.handoff.title", "Report delivery has unresolved handoff gaps"),
  T("reportDelivery.handoff.blocked", "The latest delivery was blocked and nothing was sent."),
  T("reportDelivery.handoff.recover", "Recover the latest failed delivery before queueing again."),
  T("reportDelivery.handoff.reportsReady", "{ready}/{total} reports are ready for this delivery."),
  T("reportDelivery.handoff.readiness", "Latest delivery readiness is {status}."),
];

/** Older stored sentences that map onto a current key (parse only, never rendered or catalogued). */
export const LEGACY_NOTIFICATION_TITLE_TEMPLATES: readonly CopyTemplate[] = [
  // AI drafts notice stored before it was catalog copy (broken-path sweep).
  T("notification.aiDraftsReview.title", "{count} AI draft journal entries need review"),
  T("notification.aiDraftsReview.title", "{count} AI draft journal entry need review"),
];

export const LEGACY_NOTIFICATION_MESSAGE_TEMPLATES: readonly CopyTemplate[] = [
  T(
    "notification.aiDraftsReview.message",
    "The AI categorized {count} bank transactions with high confidence. Review and approve each draft journal entry before it posts to the GL."
  ),
  T(
    "notification.aiDraftsReview.message",
    "The AI categorized {count} bank transaction with high confidence. Review and approve each draft journal entry before it posts to the GL."
  ),
  // Legacy wording stored before the format was part of the sentence: same key, neutral format.
  T("notification.reportDeliveryScheduled.message", "Report delivery scheduled for {date}.", true, {
    format: "PDF + Excel",
  }),
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Tighter patterns for well-known params so free text never matches a count/amount slot. */
const PARAM_PATTERNS: Record<string, string> = {
  n: "\\d+",
  m: "\\d+",
  due: "(?:\\d+d (?:overdue|left)|due today|no date)",
};

const compiled = new WeakMap<CopyTemplate, RegExp>();
const compiledLoose = new WeakMap<CopyTemplate, RegExp>();

function compile(t: CopyTemplate, loose = false): RegExp {
  const cache = loose ? compiledLoose : compiled;
  const cached = cache.get(t);
  if (cached) return cached;
  let out = "";
  const seen = new Set<string>();
  for (const part of t.en.split(/(\[|\]|\{\w+\})/)) {
    if (part === "[") out += "(?:";
    else if (part === "]") out += ")?";
    else if (/^\{\w+\}$/.test(part)) {
      const name = part.slice(1, -1);
      // A parameter repeated in one template would need a unique group name.
      out += seen.has(name) ? `\\k<${name}>` : `(?<${name}>${PARAM_PATTERNS[name] ?? ".+?"})`;
      seen.add(name);
    } else out += escapeRe(part);
  }
  // `loose` (case-insensitive) is the second pass: text stored or emitted before the
  // sentence-case pass (Fable B10) reads "Bank Reconciliation Complete" and still maps to its key.
  const re = new RegExp(`^${out}${t.prefix ? "(?:\\s|$)" : "$"}`, loose ? "si" : "s");
  cache.set(t, re);
  return re;
}

/**
 * ICU-style plurals in a catalog template: `{count, plural, one {# item} other {# items}}`.
 * The language is read from the template itself (Arabic letters select the Arabic CLDR rules:
 * zero, one, two, few, many, other), so the same shared renderer serves both catalogs.
 */
function expandCopyPlurals(
  template: string,
  params: Record<string, string | number | null | undefined>
): string {
  if (!template.includes(", plural,")) return template;
  const rules = new Intl.PluralRules(/[\u0600-\u06FF]/.test(template) ? "ar" : "en");
  const head = /\{(\w+),\s*plural,\s*/g;
  let out = "";
  let last = 0;
  for (let m = head.exec(template); m; m = head.exec(template)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const bodyStart = i;
    while (i < template.length && depth > 0) {
      if (template[i] === "{") depth++;
      else if (template[i] === "}") depth--;
      i++;
    }
    if (depth !== 0) break;
    const body = template.slice(bodyStart, i - 1);
    const forms: Record<string, string> = {};
    const formRe = /(\w+)\s*\{([^{}]*)\}/g;
    for (let f = formRe.exec(body); f; f = formRe.exec(body)) forms[f[1]] = f[2];
    const raw = params[m[1]];
    const n = Number(raw);
    const category = Number.isFinite(n) ? rules.select(n) : "other";
    const chosen = (n === 0 && forms.zero) || forms[category] || forms.other || "";
    out += template.slice(last, m.index) + chosen.replace(/#/g, String(raw ?? ""));
    last = i;
    head.lastIndex = i;
  }
  return out + template.slice(last);
}

/**
 * Fill `{param}`, `[optional {param}]` segments and `{n, plural, ...}` blocks. Missing params
 * drop their segment.
 */
export function renderCopyTemplate(
  template: string,
  params: Record<string, string | number | null | undefined> = {}
): string {
  const has = (name: string) => {
    const v = params[name];
    return v !== undefined && v !== null && String(v) !== "";
  };
  return expandCopyPlurals(template, params)
    .replace(/\[([^\]]*)\]/g, (_m, inner: string) => {
      const names = [...inner.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      return names.every(has) ? inner : "";
    })
    .replace(/\{(\w+)\}/g, (_m, name: string) => (has(name) ? String(params[name]) : ""));
}

let byKeyCache: Map<string, CopyTemplate> | null = null;
const templateByKey = (key: string): CopyTemplate | undefined => {
  byKeyCache ??= new Map<string, CopyTemplate>(
    [
      ...NOTIFICATION_TITLE_TEMPLATES,
      ...NOTIFICATION_MESSAGE_TEMPLATES,
      ...FIRM_TEMPLATES,
      ...MONTH_END_TEMPLATES,
      ...LEGAL_SOURCE_TEMPLATES,
      ...EVIDENCE_TEMPLATES,
      ...REPORT_DELIVERY_TEMPLATES,
      ...ANOMALY_TEMPLATES,
      ...CATEGORISATION_REASON_TEMPLATES,
      ...VALUE_OPS_TEMPLATES,
    ].map((t) => [t.key, t])
  );
  return byKeyCache.get(key);
};

/** English sentence for a key (server side: what is stored and emailed). */
export function renderServerCopy(
  key: string,
  params: Record<string, string | number | null | undefined> = {}
): string {
  const t = templateByKey(key);
  if (!t) throw new Error(`Unknown server copy key: ${key}`);
  return renderCopyTemplate(t.en, params);
}

/** Map an English sentence back to its key + params, or null when it is not a known template. */
export function parseServerCopy(
  text: string | null | undefined,
  templates: readonly CopyTemplate[]
): CopyDescriptor | null {
  if (!text) return null;
  for (const loose of [false, true]) {
    for (const t of templates) {
      const m = compile(t, loose).exec(text);
      if (!m) continue;
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(m.groups ?? {})) if (v !== undefined) params[k] = v;
      for (const [k, v] of Object.entries(t.defaults ?? {})) if (!(k in params)) params[k] = v;
      return { key: t.key, params };
    }
  }
  return null;
}

export interface NotificationCopyDescriptor {
  titleKey: string | null;
  titleParams: Record<string, string>;
  messageKey: string | null;
  messageParams: Record<string, string>;
}

/** Keys + params for a stored notification (old or new rows alike). */
export function describeNotificationCopy(n: {
  title: string;
  message: string;
}): NotificationCopyDescriptor {
  const title = parseServerCopy(n.title, [
    ...NOTIFICATION_TITLE_TEMPLATES,
    ...LEGACY_NOTIFICATION_TITLE_TEMPLATES,
  ]);
  const message = parseServerCopy(n.message, [
    ...NOTIFICATION_MESSAGE_TEMPLATES,
    ...LEGACY_NOTIFICATION_MESSAGE_TEMPLATES,
  ]);
  return {
    titleKey: title?.key ?? null,
    titleParams: title?.params ?? {},
    messageKey: message?.key ?? null,
    messageParams: message?.params ?? {},
  };
}

/** Render a descriptor with catalog strings; falls back to the English source on a miss. */
export function renderDescriptor(
  key: string | null,
  params: Record<string, string>,
  fallback: string,
  catalog: Record<string, string | undefined>
): string {
  if (!key) return fallback;
  const template = catalog[serverCopyCatalogKey(key)];
  return template ? renderCopyTemplate(template, params) : fallback;
}

// ─── Anomaly checks and categorisation reasons ───────────────────────────────

/**
 * Anomaly descriptions (server: anomaly-detection.service). The English sentence stays in the
 * alert row and the API (`description`); `message` carries the same sentence as key + params so
 * the client renders it from the catalogs. Alerts stored before this existed are mapped back by
 * `describeAnomalyText`. Params are raw values: money is a formatted figure, `date` an ISO day
 * the client formats with `formatDate`.
 */
export const ANOMALY_TEMPLATES: readonly CopyTemplate[] = [
  T(
    "anomaly.duplicateReceipts",
    "{n} receipts with the same amount (AED {amount}) on {date}. Possible duplicate entries from {merchants}."
  ),
  T(
    "anomaly.duplicateInvoices",
    "{n} invoices with the same total (AED {amount}) on {date}. Customers: {customers}."
  ),
  T(
    "anomaly.unusualReceipt",
    "Receipt from {merchant} for AED {amount} is {ratio}x the average receipt (AED {average})."
  ),
  T(
    "anomaly.unusualInvoice",
    "Invoice #{number} for {customer} (AED {amount}) is {ratio}x the average invoice amount."
  ),
  T(
    "anomaly.weekendSaturday",
    "Journal entry {number} dated Saturday {date} for AED {amount}. UAE businesses typically don't transact on weekends."
  ),
  T(
    "anomaly.weekendSunday",
    "Journal entry {number} dated Sunday {date} for AED {amount}. UAE businesses typically don't transact on weekends."
  ),
  T(
    "anomaly.roundReceipt",
    "Receipt from {merchant} has a perfectly round amount of AED {amount}. Round amounts may indicate estimates rather than actual transactions."
  ),
  T(
    "anomaly.duplicateCharge",
    "{merchant} billed AED {amount} twice within {days} day(s). This may be a duplicate charge."
  ),
  T(
    "anomaly.duplicateSupplierInvoice",
    "Supplier invoice number {number} from {vendor} was entered more than once (AED {amount}). Check for a duplicate payment."
  ),
  T(
    "anomaly.vatMismatchInvoice",
    "Invoice #{number} for {customer}: VAT AED {vat} is not 5% of the net AED {net} (expected AED {expected})."
  ),
  T(
    "anomaly.vatMismatchReceipt",
    "Receipt from {merchant}: VAT AED {vat} is not 5% of the net AED {net}."
  ),
  T(
    "anomaly.vatMismatchBill",
    "Vendor bill from {vendor}: VAT AED {vat} is not 5% of the net AED {net}."
  ),
  T(
    "anomaly.trnMissingBill",
    "Vendor bill from {vendor} carries AED {vat} input VAT but no supplier TRN. Input VAT is not recoverable without a valid TRN."
  ),
  T(
    "anomaly.trnMalformedBill",
    'Vendor bill from {vendor} has a malformed TRN "{trn}" (a UAE TRN is 15 digits).'
  ),
  T(
    "anomaly.trnMalformedInvoice",
    'Invoice #{number} for {customer} has a malformed customer TRN "{trn}" (a UAE TRN is 15 digits).'
  ),
  T(
    "anomaly.baselineSpike",
    "{account} this month (AED {amount}) is {z} standard deviations above its trailing {months}-month average (months with activity) (AED {mean})."
  ),
];

const anomalyByKey = new Map(ANOMALY_TEMPLATES.map((t) => [t.key, t]));

/** English sentence + key/params for one anomaly (server side). */
export function anomalyCopy(
  key: string,
  params: Record<string, string | number>
): { text: string; message: CopyDescriptor } {
  const t = anomalyByKey.get(key);
  if (!t) throw new Error(`Unknown anomaly copy key: ${key}`);
  const stringParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) stringParams[k] = String(v);
  return { text: renderCopyTemplate(t.en, stringParams), message: { key, params: stringParams } };
}

/** Map a stored anomaly description back to its key + params (null for an unknown sentence). */
export function describeAnomalyText(text: string | null | undefined): CopyDescriptor | null {
  return parseServerCopy(text, ANOMALY_TEMPLATES);
}

/**
 * Reasons the transaction categoriser stores on a queue row (server: autonomous-gl.service).
 * The model's own free-text reason is not a template: it is requested in the company language.
 * `operator` reasons describe server configuration and are never shown to customers.
 */
export const CATEGORISATION_REASON_TEMPLATES: readonly CopyTemplate[] = [
  T(
    "categorise.matchedRule",
    "Matched rule: {pattern} (applied {applied} times, {accepted} accepted)"
  ),
  T("categorise.operator.notConfigured", "OpenAI not configured — manual categorization required"),
  T("categorise.operator.error", "AI classification error: {error}"),
];

const categoriseByKey = new Map(CATEGORISATION_REASON_TEMPLATES.map((t) => [t.key, t]));

export function categorisationReasonCopy(
  key: string,
  params: Record<string, string | number> = {}
): { text: string; message: CopyDescriptor } {
  const t = categoriseByKey.get(key);
  if (!t) throw new Error(`Unknown categorisation copy key: ${key}`);
  const stringParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) stringParams[k] = String(v);
  return { text: renderCopyTemplate(t.en, stringParams), message: { key, params: stringParams } };
}

export function describeCategorisationReason(
  text: string | null | undefined
): CopyDescriptor | null {
  return parseServerCopy(text, CATEGORISATION_REASON_TEMPLATES);
}

// ─── Value programmes (server: firm-value-ops.service) ───────────────────────

/**
 * Action, review-queue and audit-pack sentences of the value programmes page. The English stays
 * in the API; the client maps each sentence to its key with `describeValueOpsText` (parse on
 * read, like the firm dashboard sentences) and renders it from the catalogs.
 */
export const VALUE_OPS_TEMPLATES: readonly CopyTemplate[] = [
  T("valueOps.penalty.title", "Prevent filing or document penalty"),
  T("valueOps.penalty.detail", "{docs} overdue docs, VAT due {days} days"),
  T("valueOps.cash.title", "Recover overdue receivables"),
  T("valueOps.cash.detail", "{n} collection or document messages ready"),
  T("valueOps.close.title", "Unblock month-end close"),
  T("valueOps.close.detail", "{bank} bank items, {receipts} receipts need review"),
  T("valueOps.audit.title", "Complete audit defense evidence"),
  T("valueOps.audit.detailReady", "{docs} missing documents; archived return ready"),
  T("valueOps.audit.detailMissing", "{docs} missing documents; archived return missing"),
  T("valueOps.review.bankSuggested.title", "Confirm suggested bank match"),
  T("valueOps.review.bank.title", "Match unreconciled bank transaction"),
  T("valueOps.review.bank.explanation", "{description} for AED {amount} is not reconciled."),
  T(
    "valueOps.review.bankSuggested.action",
    "Confirm the suggested match or correct the counterparty before close."
  ),
  T(
    "valueOps.review.bank.action",
    "Match to an invoice, receipt, journal entry, or create a transfer."
  ),
  T("valueOps.review.receipt.title", "Review unposted receipt"),
  T("valueOps.review.receipt.explanation", "{merchant} has not posted to GL or VAT evidence yet."),
  T(
    "valueOps.review.receiptSuggested.action",
    "Approve the suggested expense account or correct it before posting."
  ),
  T("valueOps.review.receipt.action", "Classify the receipt, confirm VAT treatment, then post."),
  T(
    "valueOps.review.anomaly.action",
    "Review the source transaction and resolve or document the exception."
  ),
  T("valueOps.review.vat.title", "Review VAT return before deadline"),
  T("valueOps.review.vat.explanation", "VAT return is {status}; due {date}."),
  T(
    "valueOps.review.vat.action",
    "Open the audit pack, clear missing evidence, and submit or mark filed."
  ),
  T("valueOps.review.document.explanation", "Required document is {status}."),
  T(
    "valueOps.review.document.action",
    "Send a WhatsApp document request and attach the received file to the client vault."
  ),
  T("valueOps.review.trial.title", "Trial balance discrepancy"),
  T("valueOps.review.trial.explanation", "Posted journals are out of balance by AED {amount}."),
  T(
    "valueOps.review.trial.action",
    "Inspect recent posted journals and reverse or correct the unbalanced entry before close."
  ),
  T("valueOps.pack.vatCalc", "VAT return calculation"),
  T("valueOps.pack.vatCalcDetail", "{status} return for {from} to {to}"),
  T("valueOps.pack.noVat", "No VAT return exists for this client"),
  T("valueOps.pack.sales", "Sales invoice evidence"),
  T("valueOps.pack.salesDetail", "AED {amount} output VAT represented"),
  T("valueOps.pack.expense", "Expense receipt evidence"),
  T("valueOps.pack.expenseDetail", "AED {amount} input VAT represented"),
  T("valueOps.pack.bank", "Bank statement support"),
  T("valueOps.pack.bankDetail", "Bank statement documents in the client vault"),
  T("valueOps.pack.trn", "TRN/tax certificate"),
  T("valueOps.pack.trnDetail", "TRN {trn}"),
  T("valueOps.pack.noTrn", "No TRN or tax certificate evidence found"),
  T("valueOps.pack.archive", "Filed-return archive"),
  T("valueOps.pack.archiveDetail", "Historical filed returns available for audit continuity"),
  T("valueOps.pack.anomaly", "Open anomaly clearance"),
  T("valueOps.pack.anomalyDetail", "Unresolved anomaly alerts before sign-off"),
  T("valueOps.cfo.revenue", "Revenue for the month was AED {amount}."),
  T(
    "valueOps.cfo.expenses",
    "Expenses were AED {expenses}, leaving AED {net} net before owner adjustments."
  ),
  T(
    "valueOps.cfo.receivables",
    "Open receivables stand at AED {open}, with AED {overdue} overdue."
  ),
  T("valueOps.cfo.vat", "Latest VAT return is {status} with AED {amount} payable."),
  T("valueOps.cfo.noVat", "No VAT return is currently available for this client."),
  T("valueOps.cfo.collect", "Prioritize collections on AED {amount} overdue AR."),
  T("valueOps.cfo.reviewVat", "Review VAT return due {date}."),
  T(
    "valueOps.cfo.requestDocs",
    "Request missing bank statements or source documents for the month."
  ),
];

export function describeValueOpsText(text: string | null | undefined): CopyDescriptor | null {
  return parseServerCopy(text, VALUE_OPS_TEMPLATES);
}

// ─── Cash forecast ───────────────────────────────────────────────────────────

export const CASH_FORECAST_TEMPLATES: readonly CopyTemplate[] = [
  T(
    "cashForecast.insufficientData",
    "Insufficient data: there are no open invoices, bills or scheduled items in the forecast window, so no inflows or outflows are projected. Add invoices, bills or scheduled items to build a forecast."
  ),
  T(
    "cashForecast.negativeBalance",
    "Projected negative balance of AED {amount} in week {week} ({weekStart})."
  ),
  T("cashForecast.lowCash", "Cash may drop below AED 10,000 in week {week} ({weekStart})."),
  T(
    "cashForecast.overdueReceivables",
    "AED {amount} is overdue across {count} invoice(s); the forecast assumes it is collected {days} day(s) from today."
  ),
  T("cashForecast.openPayables", "AED {amount} of approved vendor bills is open."),
  T(
    "cashForecast.assumeOpeningBalance",
    "Opening balance is the ledger balance of cash and bank accounts as of today."
  ),
  T(
    "cashForecast.assumeInvoices",
    "Open invoices are collected on their due date; overdue invoices are assumed collected {days} days from today."
  ),
  T(
    "cashForecast.assumeBills",
    "Open vendor bills are paid on their due date; overdue bills are assumed paid today."
  ),
  T(
    "cashForecast.assumeNoExtrapolation",
    "No historical weekly averages are extrapolated: only documents and scheduled items are projected."
  ),
  T("cashForecast.assumeDelay", "All receipts are delayed by {days} day(s)."),
];

/** Forecast line descriptions and notes (parsed on read; user data stays in the params). */
export const CASH_FORECAST_ITEM_TEMPLATES: readonly CopyTemplate[] = [
  T("cashForecast.item.invoice", "Invoice {number} – {name}"),
  T("cashForecast.item.bill", "Bill {number} – {name}"),
  T("cashForecast.item.recurringInvoice", "Recurring invoice – {name}"),
  T("cashForecast.item.payroll", "Payroll {period}"),
  T("cashForecast.item.vatPaymentDraft", "VAT return payment (latest draft return)"),
  T("cashForecast.item.vatPayment", "VAT return payment"),
  T("cashForecast.item.corporateTaxPayment", "Corporate tax payment"),
  T("cashForecast.item.vatPaymentPeriod", "VAT return payment {from} to {to}"),
  T("cashForecast.item.corporateTaxPaymentPeriod", "Corporate tax payment {from} to {to}"),
  T("cashForecast.item.finalSettlement", "Final settlement – {name}"),
  T("cashForecast.item.gpssa", "GPSSA pension contributions payable"),
  T(
    "cashForecast.note.settlementOverdue",
    "Past the 14-day settlement deadline; assumed paid today"
  ),
  T(
    "cashForecast.note.gpssa",
    "Amount = 2032 Pension Payable balance; due date assumed (15th of next month)"
  ),
  T(
    "cashForecast.note.overdueReceivable",
    "Overdue by {days} day(s); recovery date is an assumption[; delayed {delay} day(s)]"
  ),
  T("cashForecast.note.overduePayable", "Overdue by {days} day(s); assumed paid today"),
  T("cashForecast.note.delayed", "delayed {delay} day(s)"),
  T("cashForecast.note.netThirty", "Assumes net-30 collection after the run date"),
  T("cashForecast.note.payrollEstimate", "Estimated from the latest payroll run"),
  T("cashForecast.note.vatBalance", "Amount = current VAT payable balance in the ledger"),
  T("cashForecast.note.ctEstimate", "Estimate from fiscal-year-to-date ledger profit"),
];

export function describeCashForecastItemText(text: string): CopyDescriptor | null {
  return parseServerCopy(text, CASH_FORECAST_ITEM_TEMPLATES);
}

const cashByKey = new Map(CASH_FORECAST_TEMPLATES.map((t) => [t.key, t]));

export function cashForecastCopy(
  key: string,
  params: Record<string, string | number> = {}
): { text: string; message: CopyDescriptor } {
  const t = cashByKey.get(key);
  if (!t) throw new Error(`Unknown cash forecast copy key: ${key}`);
  const stringParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) stringParams[k] = String(v);
  return { text: renderCopyTemplate(t.en, stringParams), message: { key, params: stringParams } };
}

/** Map an English insight/assumption sentence (old API responses) back to its key. */
export function describeCashForecastText(text: string): CopyDescriptor | null {
  return parseServerCopy(text, CASH_FORECAST_TEMPLATES);
}

// ─── Firm bookkeeper / VAT workspace (server dashboard + helper strings) ────

export const FIRM_TEMPLATES: readonly CopyTemplate[] = [
  // Blockers (server: bookkeeper-dashboard)
  T("firm.blocker.missingVatTrn", "Missing VAT TRN"),
  T("firm.blocker.customerTrn", "{n} taxable invoices missing customer TRN"),
  T("firm.blocker.receiptsNotPosted", "{n} receipts not posted"),
  T("firm.blocker.bankLinesUnreconciled", "{n} bank lines unreconciled"),
  T("firm.blocker.vatPendingReview", "VAT return pending review"),
  T("firm.blocker.missingCtRegistration", "Missing corporate tax registration"),
  T("firm.blocker.tbNotBalanced", "Trial balance not balanced"),
  T("firm.blocker.expenseReceiptsNotPosted", "Expense receipts not posted"),
  T("firm.blocker.bankRecIncomplete", "Bank reconciliation incomplete"),
  T("firm.blocker.noOperatingDocs", "No operating documents loaded"),
  T("firm.blocker.unpostedReceipts", "{n} unposted receipts"),
  T("firm.blocker.unreconciledBankLines", "{n} unreconciled bank lines"),
  T("firm.blocker.overdueInvoices", "{n} overdue invoices"),
  T("firm.blocker.noActivity30", "No activity in 30+ days"),
  T("firm.blocker.tbOffBy", "Trial balance off by AED {amount}"),
  T("firm.blocker.noPostedJournals", "No posted journals"),
  // Next best actions / owner actions / titles
  T("firm.action.clearVatBlockers", "Clear VAT filing blockers"),
  T("firm.action.prepareCtFiling", "Prepare corporate tax filing"),
  T("firm.action.loadSourceDocs", "Load and reconcile source documents"),
  T("firm.action.fixTbDiscrepancy", "Fix trial balance discrepancy"),
  T("firm.action.prepareVatReturn", "Prepare upcoming VAT return"),
  T("firm.action.reviewCtReadiness", "Review corporate tax readiness"),
  T("firm.action.finishClose", "Finish monthly close"),
  T("firm.action.postJournals", "Post journal activity"),
  T("firm.action.readyForReview", "Ready for review"),
  T("firm.action.assignOwner", "Assign an owner"),
  T("firm.action.escalateVat", "Escalate VAT filing"),
  T("firm.action.lockCtPlan", "Lock CT preparation plan"),
  T("firm.action.requestSourceDocs", "Request missing source documents"),
  T("firm.action.startPaymentChase", "Start payment chase"),
  T("firm.action.clearCloseBlockers", "Clear close blockers"),
  T("firm.action.reviewTb", "Review trial balance"),
  T("firm.title.ownerNeeded", "Owner assignment needed"),
  T("firm.title.vatAtRisk", "VAT filing at risk"),
  T("firm.title.ctAtRisk", "Corporate tax at risk"),
  T("firm.title.sourceDocIntervention", "Source-document intervention"),
  T("firm.title.paymentDrag", "Payment collection drag"),
  T("firm.title.accountingReview", "Accounting review required"),
  // Intervention reasons / deadline labels
  T("firm.reason.vatDue", "VAT {due}"),
  T("firm.reason.ctDue", "CT {due}"),
  T("firm.reason.noOwner", "No owner assigned"),
  T("firm.reason.noSourceDocs", "No source documents loaded"),
  T("firm.reason.trnGaps", "{n} invoice TRN gaps"),
  T("firm.reason.sinceActivity", "{n}d since activity"),
  T("firm.reason.tbVariance", "Trial balance variance"),
  T("firm.reason.none", "No active intervention signals"),
  T("firm.deadline.none", "No deadline pressure"),
  // Queue metrics
  T("firm.metric.payable", "AED {amount} payable"),
  T("firm.metric.ctReadiness", "CT readiness"),
  T("firm.metric.closeReady", "{n}% close-ready"),
  T("firm.metric.variance", "AED {amount} variance"),
  T("firm.metric.reviewRequired", "Review required"),
  T("firm.owner.unassigned", "Unassigned"),
  // Due labels (server dueLabel + client formatDays)
  T("firm.due.overdue", "{n}d overdue"),
  T("firm.due.today", "Due today"),
  T("firm.due.todayLower", "due today"),
  T("firm.due.left", "{n}d left"),
  T("firm.due.noDate", "No date"),
  T("firm.due.noDateLower", "no date"),
  T("firm.due.noPeriod", "No period"),
  // Client helper labels
  T("firm.priority.onTrack", "On track"),
  T("firm.priority.attention", "Attention"),
  T("firm.priority.critical", "Critical"),
  T("firm.priority.filed", "Filed"),
  T("firm.blockers.none", "No blockers"),
  T("firm.queue.corporateTax", "Corporate Tax"),
  T("firm.queue.bookkeeping", "Bookkeeping"),
  T("firm.queue.accounting", "Accounting"),
  T("firm.queue.accountingReview", "Accounting review"),
  T("firm.queue.vat", "VAT"),
  T("firm.label.close", "Close"),
  T("firm.label.profile", "Profile"),
  T("firm.label.readiness", "Readiness"),
  T("firm.label.ct", "CT"),
  T("firm.label.books", "Books"),
  T("firm.ui.overdueDueNow", "Overdue / Due Now"),
  T("firm.ui.thisWeek", "This week"),
  T("firm.ui.next28", "Next 28 days"),
  T("firm.ui.closeBlockers", "Close blockers"),
  T("firm.ui.vatCohorts", "VAT cohorts"),
  T("firm.ui.bookkeepingClose", "Bookkeeping close"),
  T("firm.ui.dueBlocked", "{n} due · {m} blocked"),
  T("firm.ui.clearBlockers", "Clear blockers"),
  T("firm.ui.prepareReturns", "Prepare returns"),
  T("firm.ui.monitorCohort", "Monitor cohort"),
  T("firm.ui.due30", "Due in 30d"),
  T("firm.ui.due90", "Due in 90d"),
  T("firm.ui.futureParked", "Future / parked"),
  T("firm.ui.urgentFilings", "urgent filings"),
  T("firm.ui.lockFilingPlan", "Lock filing plan"),
  T("firm.ui.preparationWindow", "preparation window"),
  T("firm.ui.startReadinessReview", "Start readiness review"),
  T("firm.ui.futureFilings", "future filings"),
  T("firm.ui.monitorReadiness", "Monitor readiness"),
  T("firm.ui.blocked", "Blocked"),
  T("firm.ui.sourceDocsBankGaps", "source docs / bank gaps"),
  T("firm.ui.inProgress", "In progress"),
  T("firm.ui.needsStaffPush", "needs staff push"),
  T("firm.ui.finishCloseWork", "Finish close work"),
  T("firm.ui.reviewReady", "Review-ready"),
  T("firm.ui.closeReady90", "90%+ close-ready"),
  T("firm.ui.managerReview", "Manager review"),
  T("firm.ui.tbVariance", "TB variance"),
  T("firm.ui.requiresCorrection", "requires correction"),
  T("firm.ui.reviewJournals", "Review journals"),
  T("firm.ui.needsJournals", "Needs journals"),
  T("firm.ui.postingRequired", "posting required"),
  T("firm.ui.postActivity", "Post activity"),
  T("firm.ui.cleanFiles", "Clean files"),
  T("firm.ui.balancedLedgers", "balanced ledgers"),
  T("firm.ui.keepCadence", "Keep cadence"),
  T("firm.ui.noActiveClients", "No active clients"),
  T("firm.ui.vatDue28", "VAT due 28d"),
  T("firm.ui.ctDue90", "CT due 90d"),
  // Revenue opportunities (server: firm-growth.service)
  T("firm.growth.serviceAr.title", "Recover NRA service AR"),
  T(
    "firm.growth.serviceAr.reason",
    "{client} has {n} overdue invoice(s) and AED {amount} open AR."
  ),
  T("firm.growth.cleanup.title", "Bill cleanup work"),
  T(
    "firm.growth.cleanup.reason",
    "{n} VAT/bookkeeping source items need cleanup before the file is ready."
  ),
  T("firm.growth.cfoPack.title", "Offer monthly CFO pack"),
  T(
    "firm.growth.cfoPack.reason",
    "{client} has enough transaction volume or AR exposure for a higher-value advisory cadence."
  ),
  T("firm.growth.compliance.title", "Compliance setup opportunity"),
  T(
    "firm.growth.compliance.missingBoth",
    "{client} is missing VAT TRN and corporate tax registration."
  ),
  T("firm.growth.compliance.missingTrn", "{client} is missing VAT TRN."),
  T("firm.growth.compliance.missingCt", "{client} is missing corporate tax registration."),
];

export function describeFirmText(text: string | null | undefined): CopyDescriptor | null {
  return parseServerCopy(text, FIRM_TEMPLATES);
}

/** Convenience for the client: localise a known firm-dashboard sentence, else show it as is. */
export function localizeFirmText(
  text: string | null | undefined,
  catalog: Record<string, string | undefined>
): string {
  if (!text) return text ?? "";
  const d = describeFirmText(text);
  if (!d) return text;
  // Params can themselves be firm sentences (e.g. "VAT {due}" with due = "19d overdue").
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.params)) {
    params[k] = describeFirmText(v) ? localizeFirmText(v, catalog) : v;
  }
  return renderDescriptor(d.key, params, text, catalog);
}

// ─── Month-end close checklist (server: month-end.service) ──────────────────

/** Checklist step titles, descriptions, detail lines and the computed-close memo. */
export const MONTH_END_TEMPLATES: readonly CopyTemplate[] = [
  T("monthEnd.bank.title", "Bank reconciliation complete"),
  T("monthEnd.bank.description", "All bank transactions for the period are reconciled"),
  T("monthEnd.bank.none", "No bank transactions in this period"),
  T("monthEnd.bank.progress", "{done}/{total} reconciled ({left} remaining)"),
  T("monthEnd.invoices.title", "All invoices posted"),
  T("monthEnd.invoices.description", "No draft invoices remain for the period"),
  T("monthEnd.invoices.none", "No invoices in this period"),
  T("monthEnd.invoices.progress", "{done}/{total} posted ({left} drafts remaining)"),
  T("monthEnd.receipts.title", "All receipts categorized"),
  T("monthEnd.receipts.description", "Every receipt has an assigned expense account"),
  T("monthEnd.receipts.none", "No receipts in this period"),
  T("monthEnd.receipts.progress", "{done}/{total} categorized ({left} remaining)"),
  T("monthEnd.anomaly.title", "Anomaly scan clean"),
  T("monthEnd.anomaly.description", "No critical anomalies detected in transactions"),
  T("monthEnd.anomaly.clean", "Scan clean ({n} non-critical items)"),
  T("monthEnd.anomaly.critical", "{n} critical anomalies require attention"),
  T("monthEnd.anomaly.failed", "Unable to run anomaly scan"),
  T("monthEnd.aiInbox.title", "Assistant review clear"),
  T("monthEnd.aiInbox.descriptionQueue", "All AI-suggested entries reviewed and processed"),
  T("monthEnd.aiInbox.descriptionClassifications", "All AI-suggested classifications reviewed"),
  T("monthEnd.aiInbox.clear", "All AI suggestions processed"),
  T("monthEnd.aiInbox.pendingItems", "{n} items pending review"),
  T("monthEnd.aiInbox.pendingClassifications", "{n} classifications pending review"),
  T("monthEnd.depreciation.title", "Depreciation entries posted"),
  T(
    "monthEnd.depreciation.description",
    "Monthly depreciation has been recorded for all active fixed assets"
  ),
  T("monthEnd.depreciation.none", "No active fixed assets"),
  T("monthEnd.depreciation.progress", "{done}/{total} assets depreciated for this period"),
  T("monthEnd.depreciation.notConfigured", "Fixed assets module not configured"),
  T("monthEnd.vat.title", "VAT return prepared"),
  T("monthEnd.vat.description", "VAT 201 return has been prepared or filed for the period"),
  T("monthEnd.vat.prepared", "{n} VAT return(s) prepared"),
  T("monthEnd.vat.missing", "No VAT return prepared for this period"),
  T("monthEnd.vat.notRegistered", "Not VAT registered: no VAT return to prepare"),
  T("monthEnd.vat.notReturnMonth", "No VAT return due this month: the VAT period ends {date}"),
  T("monthEnd.accruals.title", "Accruals recorded"),
  T(
    "monthEnd.accruals.description",
    "Expenses incurred but not yet billed are accrued (auto-reversing journals)"
  ),
  T("monthEnd.accruals.noActivity", "No expense activity in this period"),
  T("monthEnd.accruals.postedOne", "1 accrual entry posted"),
  T("monthEnd.accruals.posted", "{n} accrual entries posted"),
  T(
    "monthEnd.accruals.missing",
    "No accrual entries found. Post accruals or sign this step off as not required."
  ),
  T("monthEnd.prepayments.title", "Prepayments amortised"),
  T(
    "monthEnd.prepayments.description",
    "The period's share of prepaid expenses has been released to the P&L"
  ),
  T("monthEnd.prepayments.none", "No prepaid balance"),
  T("monthEnd.prepayments.released", "AED {released} released; AED {balance} remaining"),
  T("monthEnd.prepayments.unreleased", "AED {balance} prepaid with no release this period"),
  T("monthEnd.fx.title", "FX revaluation run"),
  T("monthEnd.fx.description", "Foreign-currency balances revalued at the period-end rate"),
  T("monthEnd.fx.none", "No foreign-currency balances"),
  T("monthEnd.fx.postedOne", "1 revaluation entry posted"),
  T("monthEnd.fx.posted", "{n} revaluation entries posted"),
  T("monthEnd.fx.missing", "{n} account(s) hold foreign-currency balances; run the revaluation"),
  T("monthEnd.controls.title", "Control accounts reconciled"),
  T(
    "monthEnd.controls.description",
    "Receivables, payables, inventory, VAT and payroll control accounts equal their sub-ledgers"
  ),
  T("monthEnd.controls.none", "No control-account activity in this period"),
  T("monthEnd.controls.tied", "{n} control account(s) tie to their sub-ledgers"),
  T("monthEnd.controls.differences", "{n} control account(s) differ from their sub-ledger: {list}"),
  T("monthEnd.opening.title", "Opening balances complete"),
  T(
    "monthEnd.opening.description",
    "The open invoices and bills behind the opening trial balance are imported"
  ),
  T(
    "monthEnd.opening.pending",
    "Opening balances at {date} still await their documents: receivables {ar}, payables {ap}; until they are imported the difference sits in Opening Balance Equity (3040)"
  ),
  T(
    "monthEnd.opening.complete",
    "Open invoices and bills match the opening trial balance at {date}"
  ),
  T("monthEnd.closeMemo", "Computed close for {start} to {end}"),
  T(
    "monthEnd.closeMessage",
    "Monthly close posts no journal entry: statements roll earnings into retained earnings by computation. Use the year-end close to record (and, if enabled, post) the fiscal-year close."
  ),
];

/** English month-end sentence for a key (server side: what the API writes). */
export function monthEndCopy(
  key: string,
  params: Record<string, string | number> = {}
): { text: string; copy: CopyDescriptor } {
  const t = templateByKey(key);
  if (!t) throw new Error(`Unknown month-end copy key: ${key}`);
  const p: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) p[k] = String(v);
  return { text: renderCopyTemplate(t.en, p), copy: { key, params: p } };
}

export function describeMonthEndText(text: string | null | undefined): CopyDescriptor | null {
  return parseServerCopy(text, MONTH_END_TEMPLATES);
}

// ─── Compliance calendar legal citations (server: compliance-obligations.service) ──

/**
 * Whole-citation templates: the law/article reference stays in the sentence (the Arabic
 * catalog spells the official law names), the surrounding words are localised.
 */
export const LEGAL_SOURCE_TEMPLATES: readonly CopyTemplate[] = [
  T("legal.vatReturn", "FDL 8/2017 Art. 64; Executive Regulation Art. 59 (28 days)"),
  T("legal.ctReturn", "FDL 47/2022 Art. 53(1) (9 months after the tax period)"),
  T("legal.ctRegistration", "FDL 47/2022 Art. 51; FTA Decision 3/2024"),
  T("legal.tradeLicence", "Licensing authority of the emirate / free zone"),
  T("legal.ubo", "Cabinet Decision 58/2020 (UBO register; update within 15 days of change)"),
  T("legal.excise", "FDL 7/2017 (Excise Tax); Cabinet Decision 52/2019 as amended (15 days)"),
  T("legal.einvoicing", "Ministerial Decisions 243/2025 and 244/2025 (confirm with your adviser)"),
  T("legal.wps", "FDL 33/2021 Art. 22; MoHRE Ministerial Resolution 43/2022 (WPS)"),
];

export function describeLegalSource(text: string | null | undefined): CopyDescriptor | null {
  return parseServerCopy(text, LEGAL_SOURCE_TEMPLATES);
}

/** Localise a compliance citation or month-end sentence; unknown text is shown as stored. */
export function localizeServerText(
  text: string | null | undefined,
  catalog: Record<string, string | undefined>,
  copy?: CopyDescriptor | null
): string {
  if (!text) return text ?? "";
  const d = copy ?? describeMonthEndText(text) ?? describeLegalSource(text);
  if (!d) return text;
  return renderDescriptor(d.key, d.params, text, catalog);
}

// ─── Evidence Center (server-composed payload + stored audit descriptions) ───

/**
 * Evidence Center sentences. `buildEvidenceCenter` writes the English text from these templates and
 * attaches `{ key, params }` descriptors (`copy`) so the client renders the same key from its
 * en/ar catalogs; the English stays in the payload for exports and API back-compat. Specific
 * templates come before generic ones (`Missing {type}`) because `parseServerCopy` is first-match.
 */
export const EVIDENCE_TEMPLATES: readonly CopyTemplate[] = [
  T("evidence.issue.missingTrn.title", "Company TRN is missing"),
  T(
    "evidence.issue.missingTrn.detail",
    "VAT and official filing drafts need the company TRN before they can be finalized."
  ),
  T("evidence.action.addTrn", "Add TRN"),
  T("evidence.issue.noWorkpaper.title", "No VAT evidence workpaper exists yet"),
  T(
    "evidence.issue.noWorkpaper.detail",
    "Create the period workpaper before relying on VAT return or refund support totals."
  ),
  T("evidence.action.openVatWorkpaper", "Open VAT workpaper"),
  T("evidence.issue.draftRows.title", "{count} VAT workpaper row(s) still draft"),
  T(
    "evidence.issue.draftRows.detail",
    "Draft rows are excluded from VAT 201 totals until reviewed and approved."
  ),
  T("evidence.action.reviewRows", "Review rows"),
  T("evidence.issue.inputProof.title", "Input VAT proof needed for {ref}"),
  T("evidence.issue.inputProofRow.title", "Input VAT proof needed for row"),
  T(
    "evidence.issue.inputProof.detail",
    "Refund support is stronger when each input VAT row links to the source tax invoice or receipt."
  ),
  T("evidence.action.attachProof", "Attach proof"),
  T("evidence.issue.supplierTrn.title", "Supplier TRN missing on {ref}"),
  T("evidence.issue.supplierTrnRow.title", "Supplier TRN missing on input VAT row"),
  T(
    "evidence.issue.supplierTrn.detail",
    "Input VAT recovery may be challenged when the supplier TRN is absent from the evidence row."
  ),
  T("evidence.issue.docRequirement.title", "Missing {type}"),
  T("evidence.issue.docRequirement.detail", "Required document is {status}."),
  T("evidence.action.requestDocument", "Request document"),
  T("evidence.issue.receiptImage.title", "Tax invoice image missing for {merchant}"),
  T("evidence.issue.receiptImageGeneric.title", "Tax invoice image missing for receipt"),
  T(
    "evidence.issue.receiptImage.detail",
    "Claimed input VAT should be backed by a readable tax invoice or receipt image."
  ),
  T("evidence.action.uploadReceipt", "Upload receipt"),
  T("evidence.issue.receiptUnposted.title", "Input VAT receipt is not posted"),
  T(
    "evidence.issue.receiptUnposted.detail",
    "{merchant} has VAT but is not posted to the ledger yet."
  ),
  T(
    "evidence.issue.receiptUnpostedGeneric.detail",
    "Receipt has VAT but is not posted to the ledger yet."
  ),
  T("evidence.issue.customerTrn.title", "Customer TRN missing on invoice {number}"),
  T(
    "evidence.issue.customerTrn.detail",
    "Output VAT is still reported, but missing customer tax details weaken evidence quality."
  ),
  T("evidence.issue.draftInvoice.title", "Draft invoice in VAT period: {number}"),
  T(
    "evidence.issue.draftInvoice.detail",
    "Draft invoices are not issued evidence and should be resolved before filing."
  ),
  T("evidence.issue.billPending.title", "Supplier bill pending: {ref}"),
  T("evidence.issue.billPendingGeneric.title", "Supplier bill pending: bill"),
  T(
    "evidence.issue.billPending.detail",
    "Pending supplier bills with VAT should be approved before claiming input VAT."
  ),
  T("evidence.issue.bankUnreconciled.title", "{count} bank transaction(s) unreconciled this month"),
  T(
    "evidence.issue.bankUnreconciled.detail",
    "Close and tax evidence should be reviewed after bank reconciliation is current."
  ),
  T("evidence.action.reconcileBank", "Reconcile bank"),
  T("evidence.issue.ctNotStarted.title", "Corporate tax workpaper is not started"),
  T(
    "evidence.issue.ctNotStarted.detail",
    "Start a CT workpaper so taxable-profit adjustments can be tracked from evidence."
  ),
  T("evidence.action.openCorporateTax", "Open corporate tax"),
  T("evidence.issue.ctNoAdjustments.title", "Corporate tax bridge has no adjustment review"),
  T(
    "evidence.issue.ctNoAdjustments.detail",
    "Confirm disallowable expenses, exempt income, related-party items, and loss relief before filing."
  ),
  T("evidence.action.openClose", "Open close"),
  T("evidence.issue.overdueTask.title", "Overdue: {title}"),
  T("evidence.issue.overdueTask.detail", "Due {date}."),
  T("evidence.issue.overdueTaskNoDate.detail", "Due date unknown."),
  T("evidence.action.resolveNow", "Resolve now"),
  T("evidence.proof.label.vatOutput", "VAT output row"),
  T("evidence.proof.label.vatInput", "VAT input row"),
  T("evidence.proof.label.salesInvoice", "Sales invoice"),
  T("evidence.proof.label.purchaseReceipt", "Purchase receipt"),
  T("evidence.proof.doc.linkedSource", "Linked source document"),
  T("evidence.proof.doc.noSourceLinked", "No source file linked"),
  T("evidence.proof.doc.linkedTaxInvoice", "Linked tax invoice"),
  T("evidence.proof.doc.taxInvoiceNotLinked", "Tax invoice not linked"),
  T("evidence.proof.doc.draftInvoice", "Draft invoice"),
  T("evidence.proof.doc.generatedInvoice", "Generated invoice record"),
  T("evidence.proof.doc.receiptAttached", "Receipt image attached"),
  T("evidence.proof.doc.ocrOnly", "OCR/source text only"),
  T("evidence.proof.doc.receiptMissing", "Receipt image missing"),
  T("evidence.proof.preview.outputLinked", "Document {id} linked to this output VAT row."),
  T(
    "evidence.proof.preview.outputUnlinked",
    "Review whether the generated invoice or source document is linked before filing."
  ),
  T("evidence.proof.preview.inputLinked", "Document {id} supports the input VAT claim."),
  T(
    "evidence.proof.preview.inputUnlinked",
    "Input VAT recovery should have a readable supplier tax invoice or receipt image."
  ),
  T(
    "evidence.proof.preview.draftInvoice",
    "Draft invoices are not issued evidence until finalized."
  ),
  T(
    "evidence.proof.preview.invoiceAvailable",
    "Invoice record is available from the sales module."
  ),
  T(
    "evidence.proof.preview.receiptAttached",
    "Readable receipt image is attached to this source row."
  ),
  T(
    "evidence.proof.preview.sourceTextOnly",
    "Source text exists, but a readable tax invoice image is stronger refund support."
  ),
  T(
    "evidence.proof.preview.receiptMissing",
    "No readable source file is attached for this input VAT claim."
  ),
  T("evidence.timeline.vatWorkpaperDue", "VAT workpaper due"),
  T("evidence.timeline.ctDeadline", "Corporate tax filing deadline"),
  T(
    "evidence.timeline.consequence.vat",
    "VAT penalties, blocked refund support, or late payment exposure."
  ),
  T(
    "evidence.timeline.consequence.task",
    "Compliance task can block close, filing, or document readiness."
  ),
  T(
    "evidence.timeline.consequence.vatWorkpaper",
    "Incomplete evidence can delay filing and weaken refund support."
  ),
  T(
    "evidence.timeline.consequence.ct",
    "Unreviewed taxable-profit adjustments can create incorrect CT exposure."
  ),
  T("evidence.owner.refund.title", "Refund support needed for AED {amount}"),
  T(
    "evidence.owner.refund.detail",
    "{count} evidence gap(s) should be closed before relying on the refund claim."
  ),
  T("evidence.action.buildRefundPack", "Build refund pack"),
  T("evidence.owner.monthEnd.title", "{count} month-end check(s) open"),
  T(
    "evidence.owner.monthEnd.detail",
    "Close the month before trusting tax, reports, or cash decisions."
  ),
  T("evidence.action.openCloseCockpit", "Open close cockpit"),
  T("evidence.owner.ct.title", "Start the corporate tax workpaper"),
  T(
    "evidence.owner.ct.detail",
    "Pull revenue and expense totals into the CT bridge and review UAE tax adjustments."
  ),
  T("evidence.action.openCtWorkpaper", "Open CT workpaper"),
  T("evidence.owner.monitor.title", "Evidence pack is in good shape"),
  T(
    "evidence.owner.monitor.detail",
    "Keep recording source rows and proof links as new documents arrive."
  ),
  T("evidence.action.monitorEvidence", "Monitor evidence"),
  T("evidence.workflow.refundPack.title", "Refund pack builder"),
  T(
    "evidence.workflow.refundPack.description",
    "Builds a refund-ready support pack from input VAT rows, attachments, and evidence gaps."
  ),
  T("evidence.workflow.refundPack.metric", "AED {amount} refund exposure"),
  T("evidence.workflow.refundPack.noExposure", "No refund exposure"),
  T("evidence.workflow.refundPack.bullet.inputRows", "{count} approved input VAT row(s)"),
  T("evidence.workflow.refundPack.bullet.gaps", "{count} refund evidence gap(s)"),
  T("evidence.workflow.refundPack.bullet.certs", "{count} tax certificate document(s) in vault"),
  T("evidence.action.openVatEvidence", "Open VAT evidence"),
  T("evidence.workflow.proof.title", "Every number has proof"),
  T(
    "evidence.workflow.proof.description",
    "Shows the exact invoices, receipts, and workpaper rows behind each headline number."
  ),
  T("evidence.workflow.proof.metric", "{ready}/{total} proof lines ready"),
  T("evidence.workflow.proof.bullet.output", "VAT output rows: {count}"),
  T("evidence.workflow.proof.bullet.input", "VAT input rows: {count}"),
  T("evidence.workflow.proof.bullet.invoices", "Current-period invoices: {count}"),
  T("evidence.action.reviewProof", "Review proof"),
  T("evidence.workflow.ct.title", "Corporate tax workpaper"),
  T(
    "evidence.workflow.ct.description",
    "Turns accounting profit into a taxable-profit bridge with add-backs, deductions, relief, and loss review."
  ),
  T("evidence.workflow.ct.metric", "AED {amount} CT payable"),
  T("evidence.workflow.ct.notStarted", "Not started"),
  T("evidence.workflow.ct.bullet.status", "Latest status: {status}"),
  T("evidence.workflow.ct.bullet.noReturn", "No CT return found"),
  T("evidence.workflow.ct.bullet.workpaperExists", "Workpaper data exists"),
  T("evidence.workflow.ct.bullet.adjustmentNeeded", "Adjustment review needed"),
  T(
    "evidence.workflow.ct.bullet.engine",
    "Uses UAE zero-rate band and existing CT computation engine"
  ),
  T("evidence.workflow.missing.title", "Missing evidence inbox"),
  T(
    "evidence.workflow.missing.description",
    "Collects missing documents, TRNs, tax invoices, and source proof into one queue."
  ),
  T("evidence.workflow.missing.metric", "{count} open item(s)"),
  T("evidence.workflow.missing.bullet.requirements", "{count} document requirement(s) open"),
  T("evidence.workflow.missing.bullet.receipts", "{count} receipt(s) scanned in VAT period"),
  T("evidence.workflow.missing.bullet.critical", "{count} critical blocker(s)"),
  T("evidence.action.workInbox", "Work inbox"),
  T("evidence.workflow.request.title", "Client request autopilot"),
  T(
    "evidence.workflow.request.description",
    "Creates a focused draft message for missing evidence without sending anything automatically."
  ),
  T("evidence.workflow.request.metric", "{count} request item(s) drafted"),
  T(
    "evidence.workflow.request.bullet.draftOnly",
    "Draft only - no email, WhatsApp, or upload side effect"
  ),
  // E2 (J4-r2): customer copy names no messaging channel (WhatsApp is NR firm-only).
  T("evidence.workflow.request.bullet.draftOnlyNoSend", "Draft only - nothing is sent or uploaded"),
  T("evidence.workflow.request.bullet.queue", "Uses current missing evidence queue"),
  T("evidence.workflow.request.bullet.otp", "Reminds users not to send OTPs or credentials"),
  T("evidence.action.reviewDraft", "Review draft"),
  T("evidence.workflow.monthEnd.title", "Month-end close cockpit"),
  T(
    "evidence.workflow.monthEnd.description",
    "Combines bank, invoices, receipts, anomaly review, AI inbox, reports, and lock readiness."
  ),
  T("evidence.workflow.monthEnd.metric", "{done}/{total} checks complete"),
  T(
    "evidence.workflow.monthEnd.bullet.bank",
    "{reconciled}/{total} bank transaction(s) reconciled"
  ),
  T("evidence.workflow.monthEnd.bullet.blockers", "{count} close blocker(s)"),
  T("evidence.workflow.monthEnd.bullet.period", "Period {start} to {end}"),
  T("evidence.action.openMonthEnd", "Open month-end"),
  T("evidence.workflow.risk.title", "Error detector before filing"),
  T(
    "evidence.workflow.risk.description",
    "Flags missing TRNs, draft rows, unposted input VAT, pending bills, and close blockers."
  ),
  T("evidence.workflow.risk.metric", "{count} risk signal(s)"),
  T("evidence.workflow.risk.bullet.critical", "{count} critical risk(s)"),
  T("evidence.workflow.risk.bullet.draftRows", "{count} draft VAT workpaper row(s)"),
  T("evidence.workflow.risk.bullet.bills", "{count} supplier bill(s) in VAT period"),
  T("evidence.action.reviewRisks", "Review risks"),
  T("evidence.workflow.excel.title", "Smart import from Excel"),
  T(
    "evidence.workflow.excel.description",
    "Accepts spreadsheet-style VAT rows and maps columns such as Date, Vendor, Sr. Number, and Amount."
  ),
  T("evidence.workflow.excel.ready", "VAT paste/import ready"),
  T("evidence.workflow.excel.createFirst", "Create workpaper first"),
  T("evidence.workflow.excel.bullet.tab", "Supports tab-delimited Excel paste"),
  T("evidence.workflow.excel.bullet.dates", "Normalizes DD/MM/YYYY evidence dates"),
  T("evidence.workflow.excel.bullet.category", "Defaults pasted rows into the active VAT category"),
  T("evidence.action.pasteVatRows", "Paste VAT rows"),
  T("evidence.workflow.timeline.title", "Filing timeline with consequences"),
  T(
    "evidence.workflow.timeline.description",
    "Shows deadlines together with the operational consequence and readiness score."
  ),
  T("evidence.workflow.timeline.metric", "{count} deadline(s) tracked"),
  T("evidence.workflow.timeline.bullet.overdue", "{count} overdue deadline(s)"),
  T("evidence.workflow.timeline.bullet.openTasks", "{count} open compliance task(s)"),
  T(
    "evidence.workflow.timeline.bullet.tied",
    "VAT and CT deadlines are tied back to evidence readiness"
  ),
  T("evidence.action.openCalendar", "Open calendar"),
  T("evidence.workflow.owner.title", "Owner-friendly what should I do?"),
  T(
    "evidence.workflow.owner.description",
    "Translates accounting evidence into plain business actions for the owner."
  ),
  T("evidence.workflow.owner.metric", "{count} recommended action(s)"),
  T("evidence.action.reviewActions", "Review actions"),
  T("evidence.audit.resolved", "Resolved evidence issue: {title}"),
  T("evidence.audit.waived", "Waived evidence issue: {title}"),
  T("evidence.audit.requestReviewed", "Reviewed evidence request for {recipient}"),
  T("evidence.audit.ctPackExported", "Exported corporate tax evidence pack for {company}"),
  T("evidence.audit.refundPackExported", "Exported evidence refund pack for {company}"),
  T("evidence.audit.refundCoverExported", "Exported evidence refund pack cover for {company}"),
  T("evidence.audit.refundBundleExported", "Exported evidence refund pack bundle for {company}"),
  T("evidence.ct.check.return_exists", "Corporate tax return prepared for the latest period"),
  T("evidence.ct.check.computed", "Computation run on the books"),
  T("evidence.ct.check.reviewed", "Reviewed by a second person"),
  T(
    "evidence.ct.check.adjustments_supported",
    "Every adjustment has support (ledger account or notes)"
  ),
  T("evidence.ct.check.related_party_register", "Related-party register maintained"),
  T("evidence.ct.detail.status", "Status: {status}"),
  T("evidence.ct.detail.noReturn", "No corporate tax return yet"),
  T("evidence.ct.detail.computedOn", "Computed {date}"),
  T("evidence.ct.detail.notComputed", "Not computed"),
  T("evidence.ct.detail.reviewerRecorded", "Reviewer recorded"),
  T("evidence.ct.detail.noReviewer", "No reviewer recorded"),
  T("evidence.ct.detail.noAdjustments", "No adjustments"),
  T("evidence.ct.detail.adjustmentsSupported", "{supported} of {total} adjustments supported"),
  T("evidence.ct.detail.relatedRecorded", "{count} related parties recorded"),
  T("evidence.ct.detail.noRelatedActivity", "No related-party activity found"),
  T("evidence.close.title.bank", "Bank reconciliation complete"),
  T("evidence.close.title.invoices", "All invoices posted"),
  T("evidence.close.title.receipts", "All receipts categorized"),
  T("evidence.close.title.anomaly", "Anomaly scan clean"),
  T("evidence.close.title.aiInbox", "Assistant review clear"),
  T("evidence.close.title.depreciation", "Depreciation entries posted"),
  T("evidence.close.title.vat", "VAT return prepared"),
  T("evidence.close.title.accruals", "Accruals recorded"),
  T("evidence.close.title.prepayments", "Prepayments amortised"),
  T("evidence.close.title.fx", "FX revaluation run"),
  T("evidence.close.desc.bank", "All bank transactions for the period are reconciled"),
  T("evidence.close.desc.invoices", "No draft invoices remain for the period"),
  T("evidence.close.desc.receipts", "Every receipt has an assigned expense account"),
  T("evidence.close.desc.anomaly", "No critical anomalies detected in transactions"),
  T("evidence.close.desc.aiEntries", "All AI-suggested entries reviewed and processed"),
  T("evidence.close.desc.aiClassifications", "All AI-suggested classifications reviewed"),
  T(
    "evidence.close.desc.depreciation",
    "Monthly depreciation has been recorded for all active fixed assets"
  ),
  T("evidence.close.desc.vat", "VAT 201 return has been prepared or filed for the period"),
  T(
    "evidence.close.desc.accruals",
    "Expenses incurred but not yet billed are accrued (auto-reversing journals)"
  ),
  T(
    "evidence.close.desc.prepayments",
    "The period's share of prepaid expenses has been released to the P&L"
  ),
  T("evidence.close.desc.fx", "Foreign-currency balances revalued at the period-end rate"),
  T("evidence.close.detail.noBank", "No bank transactions in this period"),
  T("evidence.close.detail.bank", "{reconciled}/{total} reconciled ({remaining} remaining)"),
  T("evidence.close.detail.noInvoices", "No invoices in this period"),
  T("evidence.close.detail.invoices", "{posted}/{total} posted ({drafts} drafts remaining)"),
  T("evidence.close.detail.noReceipts", "No receipts in this period"),
  T("evidence.close.detail.receipts", "{categorized}/{total} categorized ({remaining} remaining)"),
  T("evidence.close.detail.anomalyClean", "Scan clean ({count} non-critical items)"),
  T("evidence.close.detail.anomalyCritical", "{count} critical anomalies require attention"),
  T("evidence.close.detail.anomalyFailed", "Unable to run anomaly scan"),
  T("evidence.close.detail.aiDone", "All AI suggestions processed"),
  T("evidence.close.detail.aiItems", "{count} items pending review"),
  T("evidence.close.detail.aiClassifications", "{count} classifications pending review"),
  T("evidence.close.detail.noAssets", "No active fixed assets"),
  T("evidence.close.detail.assets", "{posted}/{total} assets depreciated for this period"),
  T("evidence.close.detail.noAssetsModule", "Fixed assets module not configured"),
  T("evidence.close.detail.vatPrepared", "{count} VAT return(s) prepared"),
  T("evidence.close.detail.noVat", "No VAT return prepared for this period"),
  T("evidence.close.detail.noExpenseActivity", "No expense activity in this period"),
  T("evidence.close.detail.accrualOne", "{count} accrual entry posted"),
  T("evidence.close.detail.accrualMany", "{count} accrual entries posted"),
  T(
    "evidence.close.detail.noAccruals",
    "No accrual entries found. Post accruals or sign this step off as not required."
  ),
  T("evidence.close.detail.noPrepaid", "No prepaid balance"),
  T("evidence.close.detail.prepaidReleased", "AED {released} released; AED {remaining} remaining"),
  T(
    "evidence.close.detail.prepaidNoRelease",
    "AED {remaining} prepaid with no release this period"
  ),
  T("evidence.close.detail.noFx", "No foreign-currency balances"),
  T("evidence.close.detail.fxOne", "{count} revaluation entry posted"),
  T("evidence.close.detail.fxMany", "{count} revaluation entries posted"),
  T(
    "evidence.close.detail.fxRun",
    "{count} account(s) hold foreign-currency balances; run the revaluation"
  ),
];

/** Stored audit-trail descriptions written by the evidence routes (parsed on read). */
export const EVIDENCE_AUDIT_TEMPLATES: readonly CopyTemplate[] = EVIDENCE_TEMPLATES.filter((t) =>
  t.key.startsWith("evidence.audit.")
);

/** Parse order: fewest parameters first, then the longest literal text, so `... for row` wins over `... for {ref}`. */
const EVIDENCE_PARSE_ORDER: readonly CopyTemplate[] = [...EVIDENCE_TEMPLATES].sort((a, b) => {
  const params = (t: CopyTemplate) => (t.en.match(/\{\w+\}/g) ?? []).length;
  return (
    params(a) - params(b) ||
    b.en.replace(/\{\w+\}/g, "").length - a.en.replace(/\{\w+\}/g, "").length
  );
});

/** Map an English Evidence Center sentence (payload or stored audit row) back to its key. */
export function describeEvidenceText(text: string | null | undefined): CopyDescriptor | null {
  return parseServerCopy(text, EVIDENCE_PARSE_ORDER);
}

/** Localise an Evidence Center sentence: params that are themselves known sentences are localised too. */
export function localizeEvidenceText(
  text: string | null | undefined,
  catalog: Record<string, string | undefined>,
  descriptor?: CopyDescriptor | null
): string {
  if (!text) return text ?? "";
  const d = descriptor ?? describeEvidenceText(text);
  // Broken-path sweep: the Evidence Center also lists month-end checks ("Control accounts
  // reconciled"), which are month-end copy, not evidence copy; they showed in English in Arabic.
  if (!d) return localizeServerText(text, catalog);
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.params)) {
    if (describeEvidenceText(v)) params[k] = localizeEvidenceText(v, catalog);
    else if (k === "status" || k === "type") {
      // Enum-like data (document type, record status): `evidenceCenter.status.<slug>`.
      params[k] = catalog[`evidenceCenter.status.${v.trim().replace(/\s+/g, "_")}`] ?? v;
    } else params[k] = v;
  }
  return renderDescriptor(d.key, params, text, catalog);
}

const evidenceByKey = new Map(EVIDENCE_TEMPLATES.map((t) => [t.key, t]));

/** English text for an Evidence Center key plus its descriptor (all params stringified). */
export function evidenceCopy(
  key: string,
  params: Record<string, string | number> = {}
): { text: string; copy: CopyDescriptor } {
  const t = evidenceByKey.get(key);
  if (!t) throw new Error(`Unknown evidence copy key: ${key}`);
  const stringParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) stringParams[k] = String(v);
  return { text: renderCopyTemplate(t.en, stringParams), copy: { key, params: stringParams } };
}

/** Every server copy template (for catalog coverage tests). */
export const ALL_SERVER_COPY_TEMPLATES: readonly CopyTemplate[] = [
  ...NOTIFICATION_TITLE_TEMPLATES,
  ...NOTIFICATION_MESSAGE_TEMPLATES,
  ...CASH_FORECAST_TEMPLATES,
  ...CASH_FORECAST_ITEM_TEMPLATES,
  ...FIRM_TEMPLATES,
  ...MONTH_END_TEMPLATES,
  ...LEGAL_SOURCE_TEMPLATES,
  ...EVIDENCE_TEMPLATES,
  ...ANOMALY_TEMPLATES,
  ...CATEGORISATION_REASON_TEMPLATES,
  ...VALUE_OPS_TEMPLATES,
];

type CopyParams = Record<string, string | number | null | undefined>;

/** English `{ title, message }` for a notification built from title/message keys. */
export function notificationCopy(
  titleKey: string,
  messageKey: string,
  params: CopyParams = {}
): { title: string; message: string } {
  return {
    title: renderServerCopy(titleKey, params),
    message: renderServerCopy(messageKey, params),
  };
}

/** Attach `copy` (stable keys + params) to a notification for API/socket responses. */
export function withNotificationCopy<T extends { title: string; message: string }>(
  n: T
): T & { copy: NotificationCopyDescriptor } {
  return { ...n, copy: describeNotificationCopy(n) };
}

/** Key + params for a stored report-delivery run error or handoff sentence, or null. */
export function describeReportDeliveryText(text: string | null | undefined): CopyDescriptor | null {
  return parseServerCopy(text, REPORT_DELIVERY_TEMPLATES);
}

/**
 * Localise a delivery run error / handoff sentence. Several per-recipient errors are stored joined
 * by "; ": each part is localised on its own. Unknown text is returned as stored.
 */
export function localizeReportDeliveryText(
  text: string | null | undefined,
  catalog: Record<string, string | undefined>
): string {
  if (!text) return text ?? "";
  const parts = text.split("; ");
  const described = parts.map((part) => describeReportDeliveryText(part));
  // Joined per-recipient errors: only split when every part is a known sentence, otherwise the
  // semicolon belongs to a raw reason inside one sentence.
  if (parts.length > 1 && described.every((d) => d !== null)) {
    return parts
      .map((part, i) => {
        const d = described[i]!;
        return renderDescriptor(d.key, d.params, part, catalog);
      })
      .join("; ");
  }
  const whole = describeReportDeliveryText(text);
  return whole ? renderDescriptor(whole.key, whole.params, text, catalog) : text;
}
