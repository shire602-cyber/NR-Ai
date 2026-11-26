// @vitest-environment jsdom
// PR #159 review 6059432758: Document Vault loading, refresh, delete and file-opening states.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { onlineManager, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import DocumentVault from "../../client/src/pages/DocumentVault";
import { startBootFetch } from "../../client/src/lib/bootFetch";
import { getQueryFn, queryClient } from "../../client/src/lib/queryClient";
import {
  openVaultFile,
  VaultPopupBlockedError,
  VaultUnsupportedReferenceError,
} from "../../client/src/lib/vaultFile";
import { loadLocale, t } from "../../client/src/lib/i18n";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  queueForSync: vi.fn(),
  online: { value: true },
  refreshSession: vi.fn(),
  company: {
    value: { companyId: "c1", isLoading: false, error: null, isPaused: false } as {
      companyId: string | undefined;
      isLoading: boolean;
      error: unknown;
      isPaused: boolean;
    },
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: mocks.toast,
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock("@/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => mocks.company.value,
}));
vi.mock("@/components/layout/SettingsLayout", () => ({
  SettingsLayout: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/lib/pwa", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isOnline: () => mocks.online.value,
  queueForSync: mocks.queueForSync,
}));
vi.mock("@/lib/csrf", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  withCsrfHeader: async (_method: string, headers: Record<string, string>) => headers,
}));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  refreshSession: mocks.refreshSession,
}));

const KEY = ["/api/companies", "c1", "documents"];
const FILE_ID = "11111111-1111-1111-1111-111111111111";
const stored = { fileUrl: `/api/documents/${FILE_ID}/download`, fileName: "licence.pdf" };
const row = {
  ...stored,
  id: FILE_ID,
  companyId: "c1",
  name: "Trade licence",
  nameAr: null,
  category: "other",
  description: null,
  fileSize: 10,
  mimeType: "application/pdf",
  expiryDate: null,
  reminderDays: 30,
  reminderSent: false,
  tags: null,
  isArchived: false,
  uploadedBy: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

let container: HTMLDivElement;
let root: Root | undefined;
const fetchMock = vi.fn();

const byId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const waitFor = (check: () => void) =>
  vi.waitFor(async () => {
    await act(async () => {});
    check();
  });

async function render() {
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(QueryClientProvider, { client: queryClient }, createElement(DocumentVault))
    );
  });
}

async function click(id: string) {
  await act(async () => {
    byId(id)!.click();
  });
}

beforeAll(async () => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await loadLocale("en");
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  vi.stubGlobal("fetch", fetchMock);
  mocks.online.value = true;
  mocks.company.value = { companyId: "c1", isLoading: false, error: null, isPaused: false };
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
  queryClient.clear();
  onlineManager.setOnline(true);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe("list states", () => {
  it("shows a waiting state, not the first-upload prompt, while the first load is paused", async () => {
    onlineManager.setOnline(false);
    await render();
    expect(byId("vault-waiting")?.textContent).toContain(t.en["documentVault.waitingTitle"]);
    expect(byId("button-upload-first-document")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows waiting, not the earlier error, while a retry of the first load is paused", async () => {
    fetchMock.mockImplementation(async () => json({ message: "no" }, 400));
    await render();
    await waitFor(() => expect(byId("vault-load-error")).not.toBeNull());
    onlineManager.setOnline(false);
    await act(async () => {
      byId("vault-load-error")!.querySelector("button")!.click();
    });
    await waitFor(() => expect(byId("vault-waiting")).not.toBeNull());
    expect(byId("vault-load-error")).toBeNull();
    expect(byId("button-upload-first-document")).toBeNull();
  });

  it("shows waiting, not the company failure, while a company retry is paused", async () => {
    // Company list failed; the retry went offline (isPaused). The documents query is disabled.
    mocks.company.value = {
      companyId: undefined,
      isLoading: false,
      error: new Error("companies failed"),
      isPaused: false,
    };
    await render();
    expect(byId("vault-load-error")).not.toBeNull();
    mocks.company.value = { ...mocks.company.value, isPaused: true };
    await act(async () =>
      root!.render(
        createElement(QueryClientProvider, { client: queryClient }, createElement(DocumentVault))
      )
    );
    expect(byId("vault-waiting")).not.toBeNull();
    expect(byId("vault-load-error")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the empty state only after an empty list loaded", async () => {
    fetchMock.mockResolvedValue(json([]));
    await render();
    await waitFor(() => expect(byId("button-upload-first-document")).not.toBeNull());
    expect(byId("vault-waiting")).toBeNull();
  });

  it("shows the hard error when the first load fails", async () => {
    fetchMock.mockImplementation(async () => json({ message: "no" }, 400));
    await render();
    await waitFor(() => expect(byId("vault-load-error")).not.toBeNull());
    expect(byId("button-upload-first-document")).toBeNull();
  });

  it("keeps rows, search and upload after a failed refresh, with a warning", async () => {
    queryClient.setQueryData(KEY, [row]);
    fetchMock.mockImplementation(async () => json({ message: "no" }, 400));
    await render();
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: KEY });
    });
    await waitFor(() => expect(byId("vault-refresh-error")).not.toBeNull());
    expect(byId(`row-document-${FILE_ID}`)).not.toBeNull();
    expect(byId("input-search-documents")).not.toBeNull();
    expect(byId("button-upload-document")).not.toBeNull();
    expect(byId("vault-load-error")).toBeNull();
  });

  it("does not show the first-upload prompt for a cached empty list while the refresh is paused", async () => {
    queryClient.setQueryData(KEY, []);
    await render();
    expect(byId("button-upload-first-document")).not.toBeNull();

    onlineManager.setOnline(false);
    act(() => {
      void queryClient.refetchQueries({ queryKey: KEY });
    });
    await waitFor(() => expect(byId("vault-refresh-paused")).not.toBeNull());
    expect(byId("button-upload-first-document")).toBeNull();
    expect(byId("button-upload-document")).not.toBeNull();

    // A fresh, settled empty list brings the prompt back.
    fetchMock.mockImplementation(async () => json([]));
    await act(async () => {
      onlineManager.setOnline(true);
    });
    await waitFor(() => expect(byId("button-upload-first-document")).not.toBeNull());
  });

  // jsdom has no layout, so overlap cannot be measured. This pins the structure that prevents it:
  // the icon is a flex sibling and the field reserves no one-sided space for it.
  it("keeps the icon clear of LTR text typed into the search field on an RTL page", async () => {
    container.dir = "rtl";
    queryClient.setQueryData(KEY, [row]);
    await render();
    const input = byId("input-search-documents") as HTMLInputElement;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setValue.call(input, "Trade");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input.value).toBe("Trade");
    expect(input.closest('[dir="rtl"]')).toBe(container);
    expect(input.getAttribute("dir")).toBe("auto");
    expect(input.className).not.toMatch(/(^|\s)(ps|pe|pl|pr)-\d+(\s|$)/);
    const wrapper = input.parentElement!;
    expect(wrapper.className).toMatch(/(^|\s)flex(\s|$)/);
    const icon = wrapper.querySelector(":scope > svg")!;
    expect(icon.getAttribute("class")).not.toContain("absolute");
  });
});

describe("delete", () => {
  beforeEach(() => {
    vi.stubGlobal("confirm", () => true);
    queryClient.setQueryData(KEY, [row]);
  });

  it("is neither queued nor paused for replay while offline", async () => {
    mocks.online.value = false;
    await render();
    onlineManager.setOnline(false);
    await click(`button-delete-${FILE_ID}`);
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: t.en["documentVault.deleteFailedTitle"] })
      )
    );
    expect(mocks.queueForSync).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      queryClient
        .getMutationCache()
        .getAll()
        .some((m) => m.state.isPaused)
    ).toBe(false);
  });

  it.each([
    ["a lost response", null],
    ["a refusal status", 403],
    ["a server error", 500],
  ])("says the outcome is unknown after %s", async (_label, status) => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "DELETE") return json([row]);
      if (status === null) throw new TypeError("Failed to fetch");
      return json({ message: "no" }, status);
    });
    await render();
    await click(`button-delete-${FILE_ID}`);
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ description: t.en["documentVault.deleteUnconfirmedBody"] })
      )
    );
    expect(mocks.toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ description: t.en["documentVault.deleteFailedBody"] })
    );
  });

  it("keeps the list until the refetch answers a confirmed delete", async () => {
    let answer!: (response: Response) => void;
    const refetched = new Promise<Response>((resolve) => {
      answer = resolve;
    });
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "DELETE" ? new Response(null, { status: 204 }) : refetched
    );
    await render();
    await click(`button-delete-${FILE_ID}`);
    await waitFor(() => expect(queryClient.isFetching({ queryKey: KEY })).toBe(1));
    expect(byId(`row-document-${FILE_ID}`)).not.toBeNull();
    expect(byId("button-upload-first-document")).toBeNull();
    await act(async () => answer(json([])));
    await waitFor(() => expect(byId("button-upload-first-document")).not.toBeNull());
    expect(byId(`row-document-${FILE_ID}`)).toBeNull();
  });

  it("says the refresh is paused, over an older error, until the reconnect answers", async () => {
    let reads = 0;
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        // The connection drops after the delete is confirmed, before the list is re-read.
        onlineManager.setOnline(false);
        return new Response(null, { status: 204 });
      }
      reads += 1;
      return reads === 1 ? json({ message: "no" }, 400) : json([]);
    });
    await render();
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: KEY });
    });
    await waitFor(() => expect(byId("vault-refresh-error")).not.toBeNull());

    await click(`button-delete-${FILE_ID}`);
    await waitFor(() => expect(byId("vault-refresh-paused")).not.toBeNull());
    expect(queryClient.getQueryState(KEY)).toMatchObject({
      status: "error",
      fetchStatus: "paused",
    });
    expect(byId("vault-refresh-paused")!.textContent).toContain(
      t.en["documentVault.refreshPausedTitle"]
    );
    expect(byId("vault-refresh-paused")!.textContent).toContain(
      t.en["documentVault.refreshPausedBody"]
    );
    expect(byId("vault-refresh-error")).toBeNull();
    expect(byId(`row-document-${FILE_ID}`)).not.toBeNull();
    expect(reads).toBe(1);

    await act(async () => {
      onlineManager.setOnline(true);
    });
    await waitFor(() => expect(byId("button-upload-first-document")).not.toBeNull());
    expect(byId(`row-document-${FILE_ID}`)).toBeNull();
    expect(byId("vault-refresh-paused")).toBeNull();
    expect(byId("vault-refresh-error")).toBeNull();
    expect(reads).toBe(2);
  });

  it("cancels a read issued before the delete was confirmed", async () => {
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      signals.push(init!.signal!);
      // The first read stays in flight; the one issued after the delete answers.
      return signals.length === 1 ? new Promise<Response>(() => {}) : json([]);
    });
    await render();
    act(() => {
      void queryClient.refetchQueries({ queryKey: KEY });
    });
    await waitFor(() => expect(signals).toHaveLength(1));
    await click(`button-delete-${FILE_ID}`);
    await waitFor(() => expect(byId("button-upload-first-document")).not.toBeNull());
    expect(signals[0].aborted).toBe(true);
    expect(signals).toHaveLength(2);
  });
});

describe("query cancellation", () => {
  const run = (signal: AbortSignal) =>
    getQueryFn({ on401: "throw" })({ queryKey: KEY, signal } as never);

  it("passes the query signal to fetch", async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValue(json([]));
    await run(controller.signal);
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it("does not retry after a 401 refresh once cancelled", async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValue(json({}, 401));
    mocks.refreshSession.mockImplementation(async () => {
      controller.abort();
      return true;
    });
    await expect(Promise.resolve(run(controller.signal))).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still adopts a pre-started boot response if the query is cancelled while it answers", async () => {
    const controller = new AbortController();
    let answer!: (response: Response) => void;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        answer = resolve;
      })
    );
    startBootFetch([KEY.join("/")]);
    const result = Promise.resolve(run(controller.signal));
    controller.abort();
    answer(json([row]));
    // takeBootFetch has already consumed the boot entry; rejecting here would force a remount to fetch again.
    await expect(result).resolves.toEqual([row]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("opening files", () => {
  const fakeTab = () => ({
    opener: {} as unknown,
    closed: false,
    close: vi.fn(),
    location: { replace: vi.fn() },
  });
  const fileResponse = (type: string) =>
    ({ ok: true, blob: async () => new Blob(["x"], { type }) }) as Response;

  const urlStatics = ["createObjectURL", "revokeObjectURL"] as const;
  const originals = urlStatics.map((name) => Object.getOwnPropertyDescriptor(URL, name));

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:vault");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    urlStatics.forEach((name, i) => {
      const original = originals[i];
      if (original) Object.defineProperty(URL, name, original);
      else delete (URL as unknown as Record<string, unknown>)[name];
    });
  });

  it.each([false, true])("rejects an unsupported reference (download: %s)", async (download) => {
    await expect(
      openVaultFile({ fileUrl: "/uploads/old.pdf", fileName: "old.pdf" }, download)
    ).rejects.toBeInstanceOf(VaultUnsupportedReferenceError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a localized error from both buttons for an unsupported reference", async () => {
    queryClient.setQueryData(KEY, [{ ...row, fileUrl: "/uploads/old.pdf" }]);
    await render();
    for (const id of [`button-view-${FILE_ID}`, `button-download-${FILE_ID}`]) {
      mocks.toast.mockClear();
      await click(id);
      await waitFor(() =>
        expect(mocks.toast).toHaveBeenCalledWith(
          expect.objectContaining({ description: t.en["documentVault.unsupportedFileBody"] })
        )
      );
    }
  });

  it("reserves the tab before fetching, drops the opener, then navigates it", async () => {
    vi.useFakeTimers();
    const tab = fakeTab();
    const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    fetchMock.mockResolvedValue(fileResponse("application/pdf"));
    const done = openVaultFile(stored, false);
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(tab.opener).toBeNull();
    await done;
    expect(tab.location.replace).toHaveBeenCalledWith("blob:vault");
    vi.advanceTimersByTime(120_000);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    tab.closed = true;
    vi.advanceTimersByTime(1_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:vault");
  });

  it("saves instead of previewing a type that could run script", async () => {
    vi.useFakeTimers();
    const tab = fakeTab();
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    const save = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fetchMock.mockResolvedValue(fileResponse("text/html"));
    await openVaultFile(stored, false);
    expect(tab.location.replace).not.toHaveBeenCalled();
    expect(tab.close).toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:vault");
  });

  it("releases the object URL when the preview navigation throws", async () => {
    const tab = fakeTab();
    tab.location.replace.mockImplementation(() => {
      throw new Error("navigation refused");
    });
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    fetchMock.mockResolvedValue(fileResponse("application/pdf"));
    await expect(openVaultFile(stored, false)).rejects.toThrow("navigation refused");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:vault");
    expect(tab.close).toHaveBeenCalled();
  });

  it("releases the object URL when the save click throws", async () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("click refused");
    });
    fetchMock.mockResolvedValue(fileResponse("application/pdf"));
    await expect(openVaultFile(stored, true)).rejects.toThrow("click refused");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:vault");
  });

  const external = { fileUrl: "https://files.example.com/licence.pdf", fileName: "licence.pdf" };
  const externalTab = () => ({
    opener: {} as unknown,
    close: vi.fn(),
    document: document.implementation.createHTMLDocument(""),
  });

  it.each([false, true])("reports a blocked https pop-up (download: %s)", async (download) => {
    vi.spyOn(window, "open").mockReturnValue(null);
    await expect(openVaultFile(external, download)).rejects.toBeInstanceOf(VaultPopupBlockedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("navigates a reserved tab to an https link without opener or referrer", async () => {
    const tab = externalTab();
    const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    const clicked: { href: string; rel: string; opener: unknown }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicked.push({ href: this.href, rel: this.rel, opener: tab.opener });
    });
    const done = openVaultFile(external, false);
    expect(open).toHaveBeenCalledWith("", "_blank");
    await done;
    expect(clicked).toEqual([{ href: external.fileUrl, rel: "noreferrer", opener: null }]);
    expect(tab.close).not.toHaveBeenCalled();
  });

  it("closes the reserved tab when the https navigation throws", async () => {
    const tab = externalTab();
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("navigation refused");
    });
    await expect(openVaultFile(external, false)).rejects.toThrow("navigation refused");
    expect(tab.close).toHaveBeenCalled();
  });

  it.each(["https://", `/api/documents/${"-".repeat(36)}/download`])(
    "rejects a malformed reference: %s",
    async (fileUrl) => {
      const open = vi.spyOn(window, "open");
      await expect(openVaultFile({ fileUrl, fileName: "x" }, false)).rejects.toBeInstanceOf(
        VaultUnsupportedReferenceError
      );
      expect(open).not.toHaveBeenCalled();
    }
  );

  it("closes the reserved tab when the fetch fails", async () => {
    const tab = fakeTab();
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    fetchMock.mockResolvedValue({ ok: false, status: 404 } as Response);
    await expect(openVaultFile(stored, false)).rejects.toThrow("HTTP 404");
    expect(tab.close).toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("reports a blocked pop-up without fetching", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    await expect(openVaultFile(stored, false)).rejects.toBeInstanceOf(VaultPopupBlockedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
