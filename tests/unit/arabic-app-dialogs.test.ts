// @vitest-environment jsdom
import { act, createElement, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLocale, useI18n } from "@/lib/i18n";
import { apiRequest } from "@/lib/queryClient";
import CorporateTax from "@/pages/CorporateTax";
import DeveloperSettings from "@/pages/DeveloperSettings";

vi.mock("@/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "company-1", company: {}, isLoading: false }),
}));
vi.mock("@/hooks/useCompanyPermission", () => ({
  useCompanyPermission: () => ({ gate: () => ({}), gateApproval: () => ({}) }),
}));
vi.mock("@/hooks/useSubscription", () => ({
  useSubscription: () => ({ canAccess: () => true }),
}));
vi.mock("@/components/layout/SettingsLayout", () => ({
  SettingsLayout: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/lib/queryClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queryClient")>()),
  apiRequest: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const companyKey = ["/api/companies", "company-1"];
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;

beforeAll(async () => {
  await loadLocale("ar");
  useI18n.getState().setLocale("ar");
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, queryFn: async () => [] } },
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  client.clear();
  vi.mocked(apiRequest).mockReset();
});

function render(Page: ComponentType) {
  return act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(Page)));
  });
}

function openDialog() {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!dialog) throw new Error("Expected an open dialog");
  return dialog;
}

function button(name: string, within: ParentNode = document) {
  const match = Array.from(within.querySelectorAll("button")).find(
    (el) => (el.getAttribute("aria-label") ?? el.textContent?.trim()) === name
  );
  if (!match) throw new Error(`Expected button: ${name}`);
  return match;
}

function fill(id: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`#${id}`);
  if (!input) throw new Error(`Expected input: ${id}`);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Arabic app dialogs", () => {
  it("shows corporate tax return labels and dates in Arabic", async () => {
    client.setQueryData(
      [...companyKey, "corporate-tax", "returns"],
      [
        {
          id: "return-1",
          status: "filed",
          taxPeriodStart: "2025-01-01",
          taxPeriodEnd: "2025-12-31",
          filedAt: "2026-03-15T12:30:00Z",
          notes: "تمت المراجعة",
          totalRevenue: 500000,
          totalExpenses: 100000,
          totalDeductions: 0,
          taxableIncome: 400000,
          exemptionThreshold: 375000,
          taxRate: 0.09,
          taxPayable: 2250,
        },
      ]
    );
    await render(CorporateTax);
    act(() => button("عرض التفاصيل").click());

    const text = openDialog().textContent;
    for (const expected of [
      "الفترة:",
      "الحالة:",
      "تاريخ التقديم:",
      "ملاحظات:",
      "يناير",
      "ديسمبر",
      "مارس",
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toMatch(/\b(?:Period|Status|Filed on|Date filed|Notes|Jan|Dec|Mar)\b/);
  });

  it.each([
    {
      resource: "api-keys",
      create: "إنشاء مفتاح",
      inputId: "key-name",
      inputValue: "مفتاح الاختبار",
      result: { key: "muh_test" },
      copy: "نسخ مفتاح واجهة برمجة التطبيقات",
    },
    {
      resource: "webhooks",
      create: "إضافة نقطة اتصال",
      inputId: "webhook-url",
      inputValue: "https://example.com/webhook",
      result: { secret: "secret_test" },
      copy: "نسخ مفتاح التوقيع السري",
    },
  ])("localizes creation and the copy control for $resource", async (flow) => {
    client.setQueryData([...companyKey, "api-keys"], []);
    client.setQueryData(
      [...companyKey, "webhooks"],
      [null, "2026-05-10T12:00:00Z"].map((lastTriggeredAt, index) => ({
        id: `webhook-${index}`,
        url: "https://example.com/webhook",
        events: "invoice.created",
        lastTriggeredAt,
        failureCount: 0,
        isActive: true,
      }))
    );
    let resolveCreation!: (result: typeof flow.result) => void;
    const creation = new Promise<typeof flow.result>((resolve) => {
      resolveCreation = resolve;
    });
    vi.mocked(apiRequest).mockReturnValueOnce(creation);
    await render(DeveloperSettings);

    if (flow.resource === "webhooks") {
      const tab = button("الويب هوك (Webhooks)");
      act(() => tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
      expect(container.textContent).toContain("أبدًا");
      expect(container.textContent).toContain("مايو");
      expect(container.textContent).not.toMatch(/\b(?:Never|May)\b/);
    }

    act(() => button(flow.create).click());
    act(() => fill(flow.inputId, flow.inputValue));
    if (flow.resource === "webhooks") {
      const event = openDialog().querySelector<HTMLButtonElement>('[role="checkbox"]');
      expect(event).toBeTruthy();
      act(() => event!.click());
    }
    const submit = button(flow.create, openDialog());
    expect(submit.disabled).toBe(false);
    await act(async () => submit.click());
    await vi.waitFor(() => expect(button("جارٍ الإنشاء...", openDialog()).disabled).toBe(true));
    expect(openDialog().textContent).not.toMatch(/\bCreating\b/);

    await act(async () => resolveCreation(flow.result));
    await vi.waitFor(() => expect(button(flow.copy, openDialog())).toBeTruthy());
    expect(button("تم", openDialog())).toBeTruthy();
    expect(openDialog().textContent).not.toMatch(/\bDone\b/);
  });
});
