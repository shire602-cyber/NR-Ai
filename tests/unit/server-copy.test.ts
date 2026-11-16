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
  describeCashForecastItemText,
  describeCashForecastText,
  describeFirmText,
  localizeFirmText,
  describeNotificationCopy,
  notificationCopy,
  renderCopyTemplate,
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
        const d =
          describeCashForecastText(text) ??
          describeCashForecastItemText(text) ??
          describeFirmText(text);
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
    expect(issued?.message).toBe("Invoice INV-1 was issued for AED 1050.00.");
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
    expect(localizeNotification(row, en)).toEqual({ title: row.title, message: row.message });
    // Unknown rows pass through untouched.
    expect(localizeNotification({ title: "Hello", message: "World" }, ar)).toEqual({
      title: "Hello",
      message: "World",
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
