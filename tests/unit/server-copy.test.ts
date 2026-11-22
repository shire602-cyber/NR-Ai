/**
 * D4: server-generated copy is described as stable keys + params and rendered from the en/ar
 * catalogs. Covers every template round trip, legacy stored English rows, catalog parity and
 * the notification/cash-forecast display helpers.
 */
import { describe, expect, it } from "vitest";
import enCatalog from "../../client/src/locales/en/components.json";
import arCatalog from "../../client/src/locales/ar/components.json";
import arReportCatalog from "../../client/src/locales/ar-catalog/reportCatalog.json";
import {
  ALL_SERVER_COPY_TEMPLATES,
  NOTIFICATION_MESSAGE_TEMPLATES,
  NOTIFICATION_TITLE_TEMPLATES,
  cashForecastCopy,
  describeAnomalyText,
  describeCategorisationReason,
  describeValueOpsText,
  describeCashForecastItemText,
  describeCashForecastText,
  describeEvidenceText,
  describeFirmText,
  describeLegalSource,
  describeMonthEndText,
  localizeFirmText,
  localizeServerText,
  describeNotificationCopy,
  notificationCopy,
  renderCopyTemplate,
  renderServerCopy,
  renderDescriptor,
  serverCopyCatalogKey,
  withNotificationCopy,
} from "../../shared/server-copy";
import { localizeNotification } from "../../client/src/lib/notification-display";
import { notificationForEvent } from "../../server/services/notification-engine.service";
import { buildReportDeliveryNotificationForPlan } from "../../server/services/report-delivery.service";

const en = enCatalog as Record<string, string>;
const ar = {
  ...(arCatalog as Record<string, string>),
  ...(arReportCatalog as Record<string, string>),
};

const params = (template: string) => {
  const out: Record<string, string> = {};
  for (const m of template.matchAll(/\{(\w+)\}/g)) {
    out[m[1]] = m[1] === "n" || m[1] === "m" ? "7" : m[1] === "due" ? "5d left" : `v_${m[1]}`;
  }
  return out;
};
const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("server copy templates", () => {
  it("renders optional segments only when their params are present", () => {
    expect(renderCopyTemplate("Task due[ {dueDate}]", { dueDate: "2026-12-01" })).toBe(
      "Task due 2026-12-01"
    );
    expect(renderCopyTemplate("Task due[ {dueDate}]", {})).toBe("Task due");
    expect(renderCopyTemplate("A[ ({x})][: {y}]!", { y: "why" })).toBe("A: why!");
  });

  it("round-trips every template through its English sentence", () => {
    for (const t of ALL_SERVER_COPY_TEMPLATES) {
      const p = params(t.en);
      const text = renderCopyTemplate(t.en, p);
      const list = t.key.startsWith("notification.")
        ? t.key.endsWith(".title")
          ? NOTIFICATION_TITLE_TEMPLATES
          : NOTIFICATION_MESSAGE_TEMPLATES
        : null;
      if (list) {
        const d = describeNotificationCopy(
          t.key.endsWith(".title") ? { title: text, message: "" } : { title: "", message: text }
        );
        const key = t.key.endsWith(".title") ? d.titleKey : d.messageKey;
        const got = t.key.endsWith(".title") ? d.titleParams : d.messageParams;
        expect(key, t.key).toBe(t.key);
        expect(got, t.key).toEqual(p);
      } else {
        // Evidence sentences are resolved in their own family first ("AED {amount} CT payable"
        // would otherwise also read as the firm "AED {amount} payable" template).
        const d = t.key.startsWith("evidence.")
          ? describeEvidenceText(text)
          : t.key.startsWith("anomaly.")
            ? describeAnomalyText(text)
            : t.key.startsWith("categorise.")
              ? describeCategorisationReason(text)
              : t.key.startsWith("valueOps.")
                ? describeValueOpsText(text)
                : (describeCashForecastText(text) ??
                  describeCashForecastItemText(text) ??
                  describeFirmText(text) ??
                  describeMonthEndText(text) ??
                  describeLegalSource(text));
        expect(d?.key, t.key).toBe(t.key);
        expect(d?.params, t.key).toEqual(p);
      }
    }
  });

  it("has en and ar catalog entries with matching placeholders for every key", () => {
    for (const t of ALL_SERVER_COPY_TEMPLATES) {
      const key = serverCopyCatalogKey(t.key);
      expect(en[key], key).toBe(t.en);
      expect(ar[key], key).toBeTruthy();
      // Arabic may omit a param (catalog-only English data such as a report format name).
      expect(names(t.en), key).toEqual(expect.arrayContaining(names(ar[key])));
      expect(ar[key], key).toMatch(/[؀-ۿ]/);
    }
  });

  it("maps legacy stored English notification rows to keys", () => {
    const legacy = [
      { title: "Invoice INV-7 issued", message: "Invoice INV-7 was issued for AED 1050.00." },
      { title: "Payment received", message: "A payment of AED 10.00 was recorded." },
      {
        title: "Invoice INV-9 is overdue",
        message: "Invoice INV-9 for Acme LLC was due on 2026-10-01.",
      },
      { title: "Task due", message: "A task is due." },
    ];
    expect(describeNotificationCopy(legacy[0])).toMatchObject({
      titleKey: "notification.invoiceIssued.title",
      titleParams: { number: "INV-7" },
      messageKey: "notification.invoiceIssued.message",
      messageParams: { number: "INV-7", amount: "AED 1050.00" },
    });
    expect(describeNotificationCopy(legacy[1]).titleKey).toBe("notification.paymentReceived.title");
    expect(describeNotificationCopy(legacy[2]).messageParams).toEqual({
      number: "INV-9",
      customer: "Acme LLC",
      dueDate: "2026-10-01",
    });
    expect(describeNotificationCopy(legacy[3]).messageKey).toBe("notification.taskDue.message");
    // Unknown text stays unmapped (shown as stored).
    expect(describeNotificationCopy({ title: "Something custom", message: "x" })).toMatchObject({
      titleKey: null,
      messageKey: null,
    });
  });

  it("emits the same sentences the engine used to write, now with keys", async () => {
    const issued = await notificationForEvent({
      type: "invoice.issued",
      payload: {
        companyId: "c1",
        entityId: "e1",
        number: "INV-1",
        totalFils: 105000,
        occurredAt: "2026-11-16T00:00:00.000Z",
      },
    } as never);
    expect(issued?.title).toBe("Invoice INV-1 issued");
    expect(issued?.message).toBe("Invoice INV-1 was issued for AED 1,050.00.");
    const copy = withNotificationCopy({ title: issued!.title, message: issued!.message }).copy;
    expect(copy.titleKey).toBe("notification.invoiceIssued.title");
    const deadline = await notificationForEvent({
      type: "compliance.deadline_due",
      payload: {
        companyId: "c1",
        entityId: "e2",
        obligation: "VAT return",
        dueDate: "2026-11-28",
        occurredAt: "2026-11-16T00:00:00.000Z",
      },
    } as never);
    expect(deadline?.message).toBe("VAT return is due on 2026-11-28.");
    expect(describeNotificationCopy(deadline as never).messageKey).toBe(
      "notification.deadlineDue.message"
    );
  });

  it("localises notifications into Arabic and keeps English as the fallback", () => {
    const row = notificationCopy(
      "notification.invoiceOverdue.title",
      "notification.invoiceOverdue.message",
      {
        number: "INV-9",
        customer: "Acme LLC",
        dueDate: "2026-10-01",
      }
    );
    const view = localizeNotification({ ...row, copy: withNotificationCopy(row).copy }, ar);
    expect(view.title).toBe("الفاتورة INV-9 متأخرة السداد");
    expect(view.message).toContain("Acme LLC");
    expect(view.message).toMatch(/[؀-ۿ]/);
    // F3 (Fable sign-off 2): the stored ISO date reads in the app date format.
    expect(localizeNotification(row, en)).toEqual({
      title: row.title,
      message: row.message.replace("2026-10-01", "1 Oct 2026"),
    });
    // Unknown rows pass through untouched.
    expect(localizeNotification({ title: "Hello", message: "World" }, ar)).toEqual({
      title: "Hello",
      message: "World",
    });
  });

  it("renders CSV guidance in both locales for an existing statement notice", () => {
    const row = withNotificationCopy({
      eventKey: "bank.sync_failed:legacy-notice",
      title: "Previous title",
      message: "Previous message",
    });

    expect(row.title).toBe("Import a CSV bank statement");
    expect(row.message).toBe(
      "Upload a CSV exported from your bank, review suggested matches, and reconcile against your books"
    );
    expect(localizeNotification(row, ar, "ar")).toEqual({
      title: "استورد كشف حساب بنكي بصيغة CSV",
      message: "ارفع كشف حسابك البنكي بصيغة CSV، وراجع المطابقات المقترحة، ثم طابقها مع دفاترك",
    });
  });

  it("guides customers to CSV statement import after a bank transaction import fails", async () => {
    const row = await notificationForEvent({
      type: "bank.sync_failed",
      payload: {
        companyId: "c1",
        entityId: "e1",
        provider: "wio",
        reason: "internal-provider-error",
        occurredAt: "2026-11-16T00:00:00.000Z",
      },
    } as never);
    const english = {
      title: "Import a CSV bank statement",
      message:
        "Upload a CSV exported from your bank, review suggested matches, and reconcile against your books",
    };
    expect(row).toMatchObject({
      ...english,
      actionUrl: "/bank-reconciliation?import=1",
    });
    const notification = withNotificationCopy(row!);
    expect(localizeNotification(notification, en, "en")).toEqual(english);
    expect(localizeNotification(notification, ar, "ar")).toEqual({
      title: "استورد كشف حساب بنكي بصيغة CSV",
      message: "ارفع كشف حسابك البنكي بصيغة CSV، وراجع المطابقات المقترحة، ثم طابقها مع دفاترك",
    });
  });

  it("localises report delivery names and outcomes", () => {
    const n = buildReportDeliveryNotificationForPlan({
      userId: "u",
      companyId: "c",
      plan: {
        title: "Accountant close workpaper delivery",
        format: "Close review workbook",
        channel: "Email with PDF and Excel attachments",
        reportSuites: [],
        deliveryGuardrail: "Hold delivery while gaps are open.",
        nextRunAt: "2026-11-17T08:00:00.000Z",
        href: "/reports",
        status: "ready",
      } as never,
      run: { status: "sent", recipientAddresses: ["a@x.ae", "b@x.ae"] } as never,
    });
    expect(n.title).toBe("Report delivery sent: Accountant close workpaper delivery");
    const view = localizeNotification(n as { title: string; message: string }, ar);
    expect(view.title).toBe("تم إرسال التقرير: تسليم أوراق عمل الإقفال للمحاسب");
    expect(view.message).toBe("تم إرسال حزمة PDF وExcel بالبريد إلى 2 من المستلمين.");
  });

  it("localises firm dashboard sentences, including nested due labels", () => {
    expect(localizeFirmText("Missing VAT TRN", ar)).toBe(
      "رقم التسجيل الضريبي لضريبة القيمة المضافة مفقود"
    );
    expect(localizeFirmText("VAT 19d overdue", ar)).toBe("ضريبة القيمة المضافة متأخر 19 يومًا");
    expect(localizeFirmText("5 unposted receipts", ar)).toBe("5 إيصالات غير مرحّلة");
    expect(localizeFirmText("Trial balance off by AED 12.50", ar)).toBe(
      "ميزان المراجعة مختل بمقدار 12.50 د.إ"
    );
    // Unknown text (client names, free text) is left alone; English catalog = source text.
    expect(localizeFirmText("Acme Trading LLC", ar)).toBe("Acme Trading LLC");
    expect(localizeFirmText("VAT 19d overdue", en)).toBe("VAT 19d overdue");
  });

  it("maps cash-forecast sentences and line items", () => {
    const c = cashForecastCopy("cashForecast.negativeBalance", {
      amount: "1,200.00",
      week: 3,
      weekStart: "2026-12-01",
    });
    expect(c.text).toBe("Projected negative balance of AED 1,200.00 in week 3 (2026-12-01).");
    expect(describeCashForecastText(c.text)).toEqual(c.message);
    expect(renderDescriptor(c.message.key, c.message.params, c.text, ar)).toBe(
      "رصيد سالب متوقع بقيمة 1,200.00 د.إ في الأسبوع 3 (2026-12-01)."
    );
    expect(describeCashForecastItemText("Invoice INV-2 – Acme")?.key).toBe(
      "cashForecast.item.invoice"
    );
    expect(
      describeCashForecastItemText(
        "Overdue by 12 day(s); recovery date is an assumption; delayed 5 day(s)"
      )?.params
    ).toEqual({ days: "12", delay: "5" });
  });
});

describe("F10 report delivery scheduled copy, current and legacy wording", () => {
  it("maps both stored wordings to the same copy key and renders in both locales", () => {
    const current = describeNotificationCopy({
      title: "Report delivery queued: Owner pack",
      message: "PDF scheduled for 2026-11-20.",
    });
    const legacy = describeNotificationCopy({
      title: "Report delivery queued: Owner pack",
      message: "Report delivery scheduled for 2026-11-20.",
    });
    const key = "notification.reportDeliveryScheduled.message";
    expect(current.messageKey).toBe(key);
    expect(legacy.messageKey).toBe(key);
    expect(current.messageParams).toMatchObject({ format: "PDF", date: "2026-11-20" });
    expect(legacy.messageParams).toMatchObject({ date: "2026-11-20" });
    expect(legacy.messageParams.format).toBeTruthy();
    const catalogKey = serverCopyCatalogKey(key);
    expect(renderCopyTemplate(en[catalogKey], legacy.messageParams)).toContain("2026-11-20");
    expect(
      renderCopyTemplate((arCatalog as Record<string, string>)[catalogKey], legacy.messageParams)
    ).toContain("مجدول");
  });
});

describe("F10 firm revenue-opportunity copy", () => {
  const arCat = arCatalog as Record<string, string>;
  const cases: Array<[string, Record<string, string | number>]> = [
    ["firm.growth.serviceAr.title", {}],
    ["firm.growth.serviceAr.reason", { client: "Al Noor Trading LLC", n: 2, amount: "8,400" }],
    ["firm.growth.cleanup.title", {}],
    ["firm.growth.cleanup.reason", { n: 7 }],
    ["firm.growth.cfoPack.title", {}],
    ["firm.growth.cfoPack.reason", { client: "Gulf Harbor Logistics" }],
    ["firm.growth.compliance.title", {}],
    ["firm.growth.compliance.missingBoth", { client: "Al Noor Trading LLC" }],
    ["firm.growth.compliance.missingTrn", { client: "Al Noor Trading LLC" }],
    ["firm.growth.compliance.missingCt", { client: "Al Noor Trading LLC" }],
  ];
  it.each(cases)("%s renders in English and localises to Arabic", (key, params) => {
    const english = renderServerCopy(key, params);
    const ar = localizeFirmText(english, arCat);
    expect(ar).not.toBe(english);
    expect(ar).toMatch(/[\u0600-\u06FF]/);
    // Client names pass through untouched.
    if ("client" in params) expect(ar).toContain(String(params.client));
    if ("n" in params) expect(ar).toContain(String(params.n));
  });
});

describe("F12 month-end and legal-citation copy", () => {
  const arCat = ar as Record<string, string>;

  it("maps every month-end sentence the service writes to a key (legacy English rows too)", () => {
    const sentences: Array<[string, string, Record<string, string>]> = [
      ["Bank Reconciliation Complete", "monthEnd.bank.title", {}],
      ["No bank transactions in this period", "monthEnd.bank.none", {}],
      [
        "3/5 reconciled (2 remaining)",
        "monthEnd.bank.progress",
        { done: "3", total: "5", left: "2" },
      ],
      ["Scan clean (1 non-critical items)", "monthEnd.anomaly.clean", { n: "1" }],
      ["1 accrual entry posted", "monthEnd.accruals.postedOne", {}],
      ["4 accrual entries posted", "monthEnd.accruals.posted", { n: "4" }],
      [
        "AED 10.50 released; AED 99.00 remaining",
        "monthEnd.prepayments.released",
        { released: "10.50", balance: "99.00" },
      ],
      [
        "2 account(s) hold foreign-currency balances; run the revaluation",
        "monthEnd.fx.missing",
        { n: "2" },
      ],
      [
        "Computed close for 2026-10-01 to 2026-10-31",
        "monthEnd.closeMemo",
        { start: "2026-10-01", end: "2026-10-31" },
      ],
    ];
    for (const [text, key, params] of sentences) {
      expect(describeMonthEndText(text), text).toEqual({ key, params });
    }
    expect(describeMonthEndText("Something the service never wrote")).toBeNull();
  });

  it("renders month-end sentences in Arabic with their parameters", () => {
    const text = "3/5 reconciled (2 remaining)";
    const arabic = localizeServerText(text, arCat);
    expect(arabic).toBe("3/5 مطابَقة (المتبقي 2)");
    expect(localizeServerText("Anomaly Scan Clean", arCat)).toBe("فحص الشذوذ سليم");
    // Unknown text (user data) is shown as stored.
    expect(localizeServerText("Free text", arCat)).toBe("Free text");
  });

  it("localises every legal citation but keeps the law and article numbers", () => {
    const citations = [
      "FDL 8/2017 Art. 64; Executive Regulation Art. 59 (28 days)",
      "FDL 47/2022 Art. 53(1) (9 months after the tax period)",
      "FDL 47/2022 Art. 51; FTA Decision 3/2024",
      "Licensing authority of the emirate / free zone",
      "Cabinet Decision 58/2020 (UBO register; update within 15 days of change)",
      "FDL 7/2017 (Excise Tax); Cabinet Decision 52/2019 as amended (15 days)",
      "Ministerial Decisions 243/2025 and 244/2025 (confirm with your adviser)",
      "FDL 33/2021 Art. 22; MoHRE Ministerial Resolution 43/2022 (WPS)",
    ];
    for (const c of citations) {
      expect(describeLegalSource(c), c).not.toBeNull();
      const arabic = localizeServerText(c, arCat);
      expect(arabic, c).toMatch(/[؀-ۿ]/);
      // Every number in the English citation survives in the Arabic one.
      for (const n of c.match(/\d+/g) ?? []) expect(arabic, `${c} -> ${n}`).toContain(n);
      expect(arabic, c).not.toMatch(/\b(FDL|Art\.|Decision|Ministerial)\b/);
    }
    expect(localizeServerText("Custom adviser note", arCat)).toBe("Custom adviser note");
  });
});
