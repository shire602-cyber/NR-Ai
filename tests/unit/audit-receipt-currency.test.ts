// @vitest-environment jsdom
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { loadLocale } from "../../client/src/lib/i18n";
import {
  byTestId,
  click,
  flushUntil,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  resetHarness,
  setFixtures,
  unmountPage,
} from "./helpers/form-harness";

vi.mock("../../client/src/lib/queryClient", () => formHarnessQueryClientMock());
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());

afterEach(async () => {
  await unmountPage();
  vi.unstubAllGlobals();
  resetHarness();
});

it("keeps the VAT label on a foreign receipt consistent with the amount under review", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  const receipt = {
    merchant: "USD Stationery",
    subtotal: 100,
    vatAmount: 5,
    vatPercentage: 5,
    total: 105,
    currency: "USD",
    confidence: 1,
    date: "2026-06-01",
  };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/ocr/process")) return Response.json(receipt);
    if (url.endsWith("/api/csrf-token")) return Response.json({ csrfToken: "test-fixture" });
    throw new Error(`Unexpected fetch ${url}`);
  });
  setFixtures({ "/api/ocr/status": { aiConfigured: true } });
  await loadLocale("en");
  const { default: Receipts } = await import("../../client/src/pages/Receipts");
  await renderPage(Receipts);
  const input = byTestId("input-file") as HTMLInputElement;
  Object.defineProperty(input, "files", {
    value: [new File(["fixture"], "usd.png", { type: "image/png" })],
  });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flushUntil(() =>
    Boolean(
      byTestId("button-process-all") &&
      !(byTestId("button-process-all") as HTMLButtonElement).disabled
    )
  );
  await click(byTestId("button-process-all"));
  await flushUntil(() => Boolean(byTestId("input-merchant-0")));
  expect((byTestId("input-merchant-0") as HTMLInputElement).value).toBe("USD Stationery");
  const vatInput = [...document.querySelectorAll<HTMLInputElement>('input[type="number"]')].find(
    (field) => field.value === "5"
  );
  expect(vatInput).toBeDefined();
  const label = vatInput!.parentElement!.querySelector("label")!;
  expect(label.textContent).toMatch(/VAT/i);
  expect(label.textContent).not.toMatch(/AED/i);
}, 60_000);
