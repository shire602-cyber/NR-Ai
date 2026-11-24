// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import DocumentVersions from "../../client/src/pages/DocumentVersions";

vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "company-1" }),
}));

it("localizes populated document history and isolates references and raw snapshots in Arabic", async () => {
  const documentNumber = "INV/2026-0014";
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(
    ["/api/companies", "company-1", "invoices"],
    [{ id: "invoice-1", number: documentNumber }]
  );
  client.setQueryData(
    ["/api/companies", "company-1", "document-versions", "invoice", "invoice-1"],
    [
      {
        id: "version-1",
        version: 1,
        createdAt: "2026-11-19T12:00:00Z",
        snapshotData: JSON.stringify({ number: documentNumber }),
      },
    ]
  );
  const originalUrl = window.location.href;
  const originalLocale = useI18n.getState().locale;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  try {
    window.history.replaceState(null, "", "/document-versions?type=invoice&id=invoice-1");
    await loadLocale("ar");
    useI18n.setState({ locale: "ar" });
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client }, createElement(DocumentVersions)));
    });

    expect(container.textContent).toContain("إصدار واحد");
    expect(container.textContent).toContain("النظام");
    expect(container.textContent).toContain("نوفمبر");
    expect(container.querySelector('bdi[dir="ltr"][translate="no"]')?.textContent).toBe(
      documentNumber
    );

    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-expanded="false"]:not([role])'
    );
    expect(toggle?.textContent).toBe("عرض");
    await act(async () => toggle?.click());

    expect(toggle?.textContent).toBe("إخفاء");
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('pre[dir="ltr"][translate="no"]')?.textContent).toContain(
      documentNumber
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
    client.clear();
    useI18n.setState({ locale: originalLocale });
    window.history.replaceState(null, "", originalUrl);
    vi.unstubAllGlobals();
  }
});
