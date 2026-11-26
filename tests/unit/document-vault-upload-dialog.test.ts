// @vitest-environment jsdom
// PR #159: the upload dialog loads on first use; the page still owns the form and the upload.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import DocumentVault from "../../client/src/pages/DocumentVault";
import { queryClient } from "../../client/src/lib/queryClient";
import { loadLocale } from "../../client/src/lib/i18n";

const toast = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-toast", () => ({ toast, useToast: () => ({ toast }) }));
vi.mock("@/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "c1", isLoading: false, error: null }),
}));
vi.mock("@/components/layout/SettingsLayout", () => ({
  SettingsLayout: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/lib/csrf", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  withCsrfHeader: async (_method: string, headers: Record<string, string>) => headers,
}));

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

// The dialog renders in a portal, so look at the whole document.
const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.querySelector<T>(`[data-testid="${id}"]`);
const waitFor = (check: () => void) =>
  vi.waitFor(
    async () => {
      await act(async () => {});
      check();
    },
    { timeout: 10_000 }
  );
const click = (element: HTMLElement) => act(async () => element.click());

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function openDialog() {
  await click(byId("button-upload-document")!);
  await waitFor(() => expect(byId("input-document-name")).not.toBeNull());
}

beforeAll(async () => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await loadLocale("en");
});

beforeEach(async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(
    async () => new Response("[]", { headers: { "content-type": "application/json" } })
  );
  queryClient.setQueryData(["/api/companies", "c1", "documents"], []);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(QueryClientProvider, { client: queryClient }, createElement(DocumentVault))
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  queryClient.clear();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("upload dialog", () => {
  it(
    "keeps the vault usable when the dialog is first requested offline",
    { timeout: 15_000 },
    async () => {
      const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      try {
        await click(byId("button-upload-first-document")!);
        expect(byId("vault-upload-dialog-error")).not.toBeNull();
        expect(byId("button-upload-first-document")).not.toBeNull();
        expect(byId("input-document-name")).toBeNull();

        online.mockReturnValue(true);
        await click(byId("vault-upload-dialog-retry")!);
        await waitFor(() => expect(byId("input-document-name")).not.toBeNull());
      } finally {
        online.mockRestore();
      }
    }
  );

  it("is absent until asked for, and Cancel clears the form", async () => {
    expect(byId("input-document-name")).toBeNull();
    await openDialog();
    await type(byId<HTMLInputElement>("input-document-name")!, "Licence");
    const cancel = [...document.querySelectorAll("button")].find((b) => b.textContent === "Cancel");
    await click(cancel!);
    await waitFor(() => expect(byId("input-document-name")).toBeNull());
    await openDialog();
    expect(byId<HTMLInputElement>("input-document-name")!.value).toBe("");
  });

  it("posts the typed name and chosen file, then closes", async () => {
    await openDialog();
    await type(byId<HTMLInputElement>("input-document-name")!, "Licence");
    const fileInput = byId<HTMLInputElement>("input-document-file")!;
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [new File(["x"], "licence.pdf", { type: "application/pdf" })],
    });
    await act(async () => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click(byId("button-confirm-upload")!);
    await waitFor(() => expect(byId("input-document-name")).toBeNull());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    const form = post[1].body as FormData;
    expect(form.get("name")).toBe("Licence");
    expect((form.get("file") as File).name).toBe("licence.pdf");
  });
});
