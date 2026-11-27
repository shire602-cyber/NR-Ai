// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { isLocaleLoaded, loadNamespaces, useI18n, useTranslation } from "@/lib/i18n";
import { verifyAuditChain } from "@/pages/activity-logs/ActivityLogAuditChain";

it("uses the localized unknown reason while the switched locale is still loading", async () => {
  await loadNamespaces("ar", ["adminConsole", "security"]);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ ok: false, checked: 7, firstBroken: { seq: 7, reason: "new_reason" } })
    )
  );
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    const result = await verifyAuditChain();
    function ChainStatus() {
      const { t, locale } = useTranslation();
      return createElement("span", { role: "status" }, result.format(t, locale));
    }

    // Inspect the first render after switching, before the remaining namespaces resolve.
    act(() => {
      useI18n.getState().setLocale("ar");
      root.render(createElement(ChainStatus));
    });
    expect(isLocaleLoaded("ar")).toBe(false);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "السلسلة مكسورة عند المدخل رقم ٧ (سبب غير معروف)."
    );
  } finally {
    act(() => root.unmount());
    useI18n.setState({ locale: "en" });
    vi.unstubAllGlobals();
  }
});
