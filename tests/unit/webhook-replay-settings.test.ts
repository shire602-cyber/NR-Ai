// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLocale, useI18n } from "@/lib/i18n";
import { queryClient } from "@/lib/queryClient";
import DeveloperSettings from "@/pages/DeveloperSettings";

vi.mock("@/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "company-1" }),
}));

vi.mock("@/hooks/useSubscription", () => ({
  useSubscription: () => ({ canAccess: () => true }),
}));

const deliveriesPath = "/api/webhooks/endpoint-1/deliveries";
const delivery = {
  event: "invoice.issued",
  responseStatus: null,
  attemptNumber: 1,
  maxAttempts: 5,
  createdAt: "2026-11-21T10:00:00Z",
};

const json = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url.endsWith("/api/companies/company-1/api-keys")) return json([]);
  if (url.endsWith("/api/companies/company-1/webhooks")) {
    return json([
      {
        id: "endpoint-1",
        url: "https://receiver.example.test/events",
        events: "invoice.issued",
        isActive: true,
        failureCount: 0,
        lastTriggeredAt: null,
      },
    ]);
  }
  if (url.endsWith(deliveriesPath)) {
    return json([
      {
        ...delivery,
        id: "uncertain",
        status: "dead",
        replayEligible: false,
        replayUnavailableReason: "delivery_uncertain",
      },
      {
        ...delivery,
        id: "pending",
        status: "retrying",
        nextAttemptAt: "2026-11-21T10:30:00Z",
        replayEligible: false,
        replayUnavailableReason: "delivery_pending",
      },
      {
        ...delivery,
        id: "eligible",
        status: "delivered",
        responseStatus: 200,
        success: true,
        replayEligible: true,
        replayUnavailableReason: null,
      },
    ]);
  }
  if (url.endsWith("/api/csrf-token")) return json({ csrfToken: "" });
  if (url.endsWith(`${deliveriesPath}/eligible/replay`) && init?.method === "POST") {
    return json({ id: "queued" });
  }
  throw new Error(`Unexpected request for ${url}`);
});

let root: Root;
let container: HTMLDivElement;

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  queryClient.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await flush(() => root.unmount());
  container.remove();
  queryClient.clear();
  useI18n.getState().setLocale("en");
  vi.unstubAllGlobals();
});

const copy = {
  en: {
    direction: "ltr",
    tab: "Webhooks",
    deliveries: "View deliveries",
    replay: "Replay",
    uncertain: "The endpoint may already have received this event.",
    pending: "A delivery is pending or in progress.",
    time: "Date & time",
    retryStatus: "Retry scheduled",
    nextAttempt: "Next attempt at",
  },
  ar: {
    direction: "rtl",
    tab: "الويب هوك (Webhooks)",
    deliveries: "عرض الإرسالات",
    replay: "إعادة الإرسال",
    uncertain: "ربما تلقّت نقطة النهاية هذا الحدث بالفعل.",
    pending: "هناك إرسال قيد الانتظار أو التنفيذ.",
    time: "التاريخ والوقت",
    retryStatus: "تمت جدولة إعادة المحاولة",
    nextAttempt: "المحاولة التالية عند",
  },
};

function replayButton(id: string) {
  return document.querySelector<HTMLButtonElement>(`[data-testid="button-replay-${id}"]`);
}

function sentReplays() {
  return fetchMock.mock.calls.filter(([url]) => url.endsWith("/replay")).map(([url]) => url);
}

async function flush(action?: () => void) {
  await act(async () => {
    action?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitForElement<T extends HTMLElement>(find: () => T | null): Promise<T> {
  for (let tries = 0; tries < 6 && !find(); tries++) await flush();
  const found = find();
  expect(found).not.toBeNull();
  return found!;
}

describe("Webhook replay in Developer Settings", () => {
  it.each(["en", "ar"] as const)(
    "shows localized eligibility and only replays eligible rows (%s)",
    async (locale) => {
      useI18n.getState().setLocale(locale);
      const localeCopy = copy[locale];
      expect(document.documentElement.dir).toBe(localeCopy.direction);
      await flush(() =>
        root.render(
          createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(DeveloperSettings)
          )
        )
      );

      const tab = [...container.querySelectorAll('[role="tab"]')].find(
        (candidate) => candidate.textContent === localeCopy.tab
      );
      expect(tab).toBeDefined();
      await flush(() =>
        tab!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
      );

      const deliveriesButton = () =>
        container.querySelector<HTMLButtonElement>(`[title="${localeCopy.deliveries}"]`);
      const viewDeliveries = await waitForElement(deliveriesButton);
      await flush(() => viewDeliveries.click());
      const eligible = await waitForElement(() => replayButton("eligible"));
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(dialog.textContent).toContain(localeCopy.time);
      expect(dialog.textContent).toContain(localeCopy.retryStatus);
      expect(dialog.textContent).toContain(localeCopy.nextAttempt);
      expect(dialog.textContent).not.toMatch(/\b(in_flight|retrying|dead)\b/);

      for (const id of ["uncertain", "pending"] as const) {
        const button = replayButton(id)!;
        expect(button.disabled).toBe(true);
        expect(button.getAttribute("aria-label")).toBe(localeCopy.replay);
        const reason = document.getElementById(button.getAttribute("aria-describedby")!);
        expect(reason?.textContent).toContain(localeCopy[id]);
        act(() => button.click());
      }
      expect(sentReplays()).toEqual([]);

      expect(eligible.disabled).toBe(false);
      expect(eligible.hasAttribute("aria-describedby")).toBe(false);
      await flush(() => eligible.click());
      await flush();
      expect(sentReplays()).toEqual([`${deliveriesPath}/eligible/replay`]);
    }
  );
});
