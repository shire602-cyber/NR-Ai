// @vitest-environment jsdom
/**
 * STEP1 F6: the admin buttons that did nothing now work or are gone. Integrations shows the
 * server's real status and Google Sheets "Test connection" posts to the server; the audit export
 * is the localised table without ids; stored documents are fetched through the vault download.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let calls: Array<{ method: string; url: string }> = [];
let responses: Record<string, unknown> = {};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  calls = [];
  responses = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, url });
      if (url.includes("/api/csrf-token")) return json({ csrfToken: "x" });
      for (const [key, body] of Object.entries(responses)) {
        const [m, frag] = key.split(" ");
        if (m === method && url.includes(frag)) return json(body);
      }
      return json({});
    })
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  const { useI18n } = await import("../../client/src/lib/i18n");
  useI18n.getState().setLocale("en");
});

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function mount(el: ReturnType<typeof createElement>) {
  const { queryClient } = await import("../../client/src/lib/queryClient");
  queryClient.clear();
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: queryClient }, el));
  });
  await flush();
}

describe("STEP1 F6: Admin > Integrations", () => {
  it("shows the server's configured status (no hard-coded Connected) and no secret inputs", async () => {
    responses["GET /api/admin/integrations/status"] = {
      stripe: { configured: false },
      openai: { configured: true },
      googleSheets: { configured: false },
    };
    const { IntegrationsTab } = await import("../../client/src/pages/admin/IntegrationsTab");
    await mount(createElement(IntegrationsTab));
    const text = (id: string) =>
      container.querySelector(`[data-testid="${id}"]`)?.textContent?.trim();
    expect(text("badge-stripe-status")).toBe("Not configured");
    expect(text("badge-openai-status")).toBe("Configured");
    expect(text("badge-sheets-status")).toBe("Not configured");
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector('[data-testid="button-save-stripe"]')).toBeNull();
    expect(container.querySelector('[data-testid="button-save-openai"]')).toBeNull();
    expect(
      (container.querySelector('[data-testid="button-test-sheets"]') as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it("Test connection posts to the server and shows the real result", async () => {
    responses["GET /api/admin/integrations/status"] = {
      stripe: { configured: true },
      openai: { configured: true },
      googleSheets: { configured: true },
    };
    responses["POST /api/admin/integrations/google-sheets/test"] = {
      ok: false,
      code: "failed",
    };
    const { IntegrationsTab } = await import("../../client/src/pages/admin/IntegrationsTab");
    await mount(createElement(IntegrationsTab));
    const button = container.querySelector('[data-testid="button-test-sheets"]') as HTMLElement;
    expect(button).not.toBeNull();
    await act(async () => button.click());
    await flush();
    expect(
      calls.some(
        (c) => c.method === "POST" && c.url.includes("/api/admin/integrations/google-sheets/test")
      )
    ).toBe(true);
    expect(container.querySelector('[data-testid="badge-sheets-status"]')?.textContent).toBe(
      "Connection failed"
    );
  });
});

describe("STEP1 F6: audit log search, filter and export", () => {
  it("filters the localised rows and exports them without ids", async () => {
    const { t } = await import("../../client/src/lib/i18n");
    const { filterAuditLogs, auditExportRows } =
      await import("../../client/src/pages/admin/audit-export");
    const en = t.en as Record<string, string>;
    const ar = t.ar as Record<string, string>;
    const uuid = "30cbacca-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
    const logs = [
      {
        id: "1",
        userId: "u1",
        action: "auth.login_success",
        resourceType: "security",
        details: JSON.stringify({ target: uuid, plan: "pro" }),
        ipAddress: "10.0.0.1",
        createdAt: "2026-11-18T08:00:00Z",
      },
      {
        id: "2",
        userId: null,
        action: "invoice.create",
        resourceType: "invoice",
        details: null,
        ipAddress: null,
        createdAt: "2026-11-18T09:00:00Z",
      },
    ];
    const users = [{ id: "u1", name: "Sara", email: "sara@example.com" }];
    expect(filterAuditLogs(en, logs, users, { search: "sara", action: "all" })).toHaveLength(1);
    expect(filterAuditLogs(en, logs, users, { search: "", action: "login" })).toHaveLength(1);
    expect(filterAuditLogs(en, logs, users, { search: "", action: "all" })).toHaveLength(2);
    expect(filterAuditLogs(en, logs, users, { search: "zzz", action: "all" })).toHaveLength(0);
    for (const table of [en, ar]) {
      const rows = auditExportRows(table, logs, users, table === ar ? "ar" : "en");
      expect(rows).toHaveLength(2);
      expect(JSON.stringify(rows)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    }
    expect(auditExportRows(ar, logs, users, "ar")[0].action).toMatch(/[؀-ۿ]/);
  });
});

describe("STEP1 F6: stored documents are read through the vault download", () => {
  it("fetchStoredBlob requests the file with credentials and reports a missing file", async () => {
    const { fetchStoredBlob, StoredFileError } = await import("../../client/src/lib/stored-file");
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response("%PDF-1.4", {
        status: 200,
        headers: { "Content-Disposition": 'attachment; filename="licence.pdf"' },
      })
    );
    const ok = await fetchStoredBlob("/api/documents/d1/download");
    expect(ok.filename).toBe("licence.pdf");
    expect(await ok.blob.text()).toBe("%PDF-1.4");
    expect(fetchMock.mock.calls.at(-1)?.[1]).toMatchObject({ credentials: "include" });

    fetchMock.mockResolvedValueOnce(json({ message: "File not found" }, 404));
    await expect(fetchStoredBlob("/api/documents/legacy/download")).rejects.toBeInstanceOf(
      StoredFileError
    );
  });

  // Source guard (a behaviour test would need the company picker, a Radix Select that jsdom cannot
  // drive): the row buttons must stay wired to the stored-file helpers.
  it("AdminDocuments wires View and Download and uploads the bytes", () => {
    const src = readFileSync("client/src/pages/AdminDocuments.tsx", "utf8");
    expect(src).toMatch(/onClick=\{\(\) => void openStored\(doc, "view"\)\}/);
    expect(src).toMatch(/onClick=\{\(\) => void openStored\(doc, "download"\)\}/);
    expect(src).toContain("fileData: await readFileAsDataUrl(data.file)");
    expect(src).not.toContain("/uploads/${data.fileName}");
    expect(src).not.toMatch(/MMM d, yyyy/);
  });
});
