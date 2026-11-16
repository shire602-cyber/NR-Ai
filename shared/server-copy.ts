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
  T("notification.paymentReceived.title", "Payment received[ for {number}]"),
  T("notification.billApproved.title", "Bill approved {label}"),
  T("notification.billPaid.title", "Bill paid {label}"),
  T("notification.payrollApproved.title", "Payroll approved"),
  T("notification.bankSyncFailed.title", "Bank feed sync failed"),
  T("notification.deadlineDue.title", "Deadline due[ {dueDate}]"),
  T("notification.taskDue.title", "Task due[ {dueDate}]"),
  T("notification.invoiceOverdue.title", "Invoice {number} is overdue"),
  T("notification.vatReturnDue.title", "VAT return due {dueDate}"),
  T("notification.newSignIn.title", "New sign-in to your account"),
  T("notification.signInLocked.title", "Sign-in temporarily locked"),
  T("notification.referralSignup.title", "New Referral Signup!"),
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
];

/** Notification messages, most specific first. `prefix` messages carry trailing catalog text. */
export const NOTIFICATION_MESSAGE_TEMPLATES: readonly CopyTemplate[] = [
  T("notification.invoiceIssued.message", "Invoice {number} was issued[ for {amount}]."),
  T("notification.invoicePaid.message", "Invoice {number} is fully paid."),
  T(
    "notification.paymentReceived.message",
    "A payment of {amount} was recorded[ against invoice {number}]."
  ),
  T("notification.billApproved.message", "Bill {label} was approved for payment."),
  T("notification.billPaid.message", "Bill {label} was paid."),
  T("notification.payrollApproved.message", "Payroll for {month}/{year} was approved."),
  T(
    "notification.bankSyncFailed.message",
    "The bank feed[ ({provider})] could not sync[: {reason}]. Reconnect it under Banking."
  ),
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

/** Older stored sentences that map onto a current key (parse only, never rendered or catalogued). */
export const LEGACY_NOTIFICATION_MESSAGE_TEMPLATES: readonly CopyTemplate[] = [
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

function compile(t: CopyTemplate): RegExp {
  const cached = compiled.get(t);
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
  const re = new RegExp(`^${out}${t.prefix ? "(?:\\s|$)" : "$"}`, "s");
  compiled.set(t, re);
  return re;
}

/** Fill `{param}` and `[optional {param}]` segments. Missing params drop their segment. */
export function renderCopyTemplate(
  template: string,
  params: Record<string, string | number | null | undefined> = {}
): string {
  const has = (name: string) => {
    const v = params[name];
    return v !== undefined && v !== null && String(v) !== "";
  };
  return template
    .replace(/\[([^\]]*)\]/g, (_m, inner: string) => {
      const names = [...inner.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      return names.every(has) ? inner : "";
    })
    .replace(/\{(\w+)\}/g, (_m, name: string) => (has(name) ? String(params[name]) : ""));
}

let byKeyCache: Map<string, CopyTemplate> | null = null;
const templateByKey = (key: string): CopyTemplate | undefined => {
  byKeyCache ??= new Map<string, CopyTemplate>(
    [...NOTIFICATION_TITLE_TEMPLATES, ...NOTIFICATION_MESSAGE_TEMPLATES, ...FIRM_TEMPLATES].map(
      (t) => [t.key, t]
    )
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
  for (const t of templates) {
    const m = compile(t).exec(text);
    if (!m) continue;
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(m.groups ?? {})) if (v !== undefined) params[k] = v;
    for (const [k, v] of Object.entries(t.defaults ?? {})) if (!(k in params)) params[k] = v;
    return { key: t.key, params };
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
  const title = parseServerCopy(n.title, NOTIFICATION_TITLE_TEMPLATES);
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
  T("firm.queue.accountingReview", "Accounting Review"),
  T("firm.queue.vat", "VAT"),
  T("firm.label.close", "Close"),
  T("firm.label.profile", "Profile"),
  T("firm.label.readiness", "Readiness"),
  T("firm.label.ct", "CT"),
  T("firm.label.books", "Books"),
  T("firm.ui.overdueDueNow", "Overdue / Due Now"),
  T("firm.ui.thisWeek", "This Week"),
  T("firm.ui.next28", "Next 28 Days"),
  T("firm.ui.closeBlockers", "Close Blockers"),
  T("firm.ui.vatCohorts", "VAT Cohorts"),
  T("firm.ui.bookkeepingClose", "Bookkeeping Close"),
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

/** Every server copy template (for catalog coverage tests). */
export const ALL_SERVER_COPY_TEMPLATES: readonly CopyTemplate[] = [
  ...NOTIFICATION_TITLE_TEMPLATES,
  ...NOTIFICATION_MESSAGE_TEMPLATES,
  ...CASH_FORECAST_TEMPLATES,
  ...CASH_FORECAST_ITEM_TEMPLATES,
  ...FIRM_TEMPLATES,
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
