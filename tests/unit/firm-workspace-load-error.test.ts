// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buttonByText,
  byTestId,
  click,
  flushUntil,
  pickOption,
  renderPage,
  unmountPage,
} from "./helpers/form-harness";
import { loadLocale } from "../../client/src/lib/i18n";
import { ApiError, queryClient } from "../../client/src/lib/queryClient";
import PracticeWorkspace from "../../client/src/pages/firm/PracticeWorkspace";
import copy from "../../client/src/locales/en/firm.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const client = { id: "client-1", name: "Northwind" };
const lettersPath = `/api/firm/clients/${client.id}/engagement-letters`;
const serverError = new ApiError("Internal error injected", 500);
const defaults = queryClient.getDefaultOptions();
const reads = new Map<string, () => Promise<unknown>>();
const pageText = () => document.body.textContent ?? "";

beforeAll(async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  window.localStorage.clear();
  reads.clear();
  queryClient.setDefaultOptions({
    ...defaults,
    queries: {
      ...defaults.queries,
      retry: false,
      queryFn: async ({ queryKey: [path] }) => {
        if (path === "/api/firm/context") {
          return {
            membership: {
              firm: { name: "Example Firm" },
              role: "firm_owner",
              permissions: ["firm.clients.link"],
            },
          };
        }
        if (path === "/api/firm/clients?view=names") return [client];
        return reads.get(String(path))?.() ?? { tasks: [] };
      },
    },
  });
});

afterEach(async () => {
  await unmountPage();
  queryClient.clear();
  queryClient.setDefaultOptions(defaults);
});

async function renderTab(tab: string) {
  await renderPage(PracticeWorkspace);
  if (tab === copy["firm.tabTasks"]) return;
  const trigger = [...document.querySelectorAll('[role="tab"]')].find(
    (element) => element.textContent === tab
  );
  expect(trigger).toBeDefined();
  await act(async () => {
    trigger!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  if (tab === copy["firm.tabLetters"]) {
    await pickOption(document.querySelector('[role="combobox"]'), client.name);
  }
}

const lists = [
  {
    section: "tasks",
    tab: copy["firm.tabTasks"],
    path: "/api/firm/tasks",
    empty: copy["firm.noTasks"],
    emptyResponse: { tasks: [] },
    loaded: {
      tasks: [
        {
          id: "task-1",
          companyName: client.name,
          title: "Review ledger",
          dueDate: "2026-11-30",
          status: "open",
        },
      ],
    },
  },
  {
    section: "wip",
    tab: copy["firm.tabTime"],
    path: "/api/firm/wip",
    empty: copy["firm.noWip"],
    emptyResponse: { clients: [] },
    loaded: {
      clients: [
        {
          companyId: client.id,
          companyName: client.name,
          unbilledMinutes: 75,
          wipValue: "150.00",
          billedAmount: "0.00",
          realisationRate: null,
        },
      ],
    },
  },
  {
    section: "links",
    tab: copy["firm.tabLinks"],
    path: "/api/firm/client-links",
    empty: copy["firm.noLinks"],
    emptyResponse: { links: [] },
    loaded: { links: [{ id: "link-1", companyName: client.name, status: "active" }] },
  },
];

describe("firm workspace load failure", () => {
  it.each([
    ...lists,
    {
      section: "letters",
      tab: copy["firm.tabLetters"],
      path: lettersPath,
      empty: copy["firm.noLetters"],
      emptyResponse: { letters: [] },
    },
  ])(
    "keeps $section empty copy out of the first load retry",
    async ({ section, tab, path, empty, emptyResponse }) => {
      let finishRetry!: (value: unknown) => void;
      const pending = new Promise<unknown>((resolve) => {
        finishRetry = resolve;
      });
      const read = vi.fn().mockRejectedValueOnce(serverError).mockReturnValueOnce(pending);
      reads.set(path, read);

      await renderTab(tab);
      const errorId = `firm-${section}-load-error`;
      await flushUntil(() => byTestId(errorId) !== null);
      expect(pageText()).not.toContain(serverError.message);
      expect(pageText()).not.toContain(empty);

      await click(buttonByText(new RegExp(`^${copy["firm.retry"]}$`), byTestId(errorId)!));
      expect(read).toHaveBeenCalledTimes(2);
      expect(document.querySelector('[role="status"]')?.textContent).toBe("Loading…");
      expect(byTestId(errorId)).toBeNull();
      expect(pageText()).not.toContain(empty);

      await act(async () => finishRetry(emptyResponse));
      await flushUntil(() => pageText().includes(empty));
      expect(document.querySelector('[role="status"]')).toBeNull();
    }
  );

  it.each(lists)(
    "keeps the $section rows visible after a failed refresh",
    async ({ section, tab, path, empty, emptyResponse, loaded }) => {
      const read = vi
        .fn()
        .mockResolvedValueOnce(loaded)
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce(emptyResponse);
      reads.set(path, read);
      const hasRow = () => document.querySelector("tbody")?.textContent?.includes(client.name);

      await renderTab(tab);
      await flushUntil(() => hasRow() === true);
      await act(async () => queryClient.invalidateQueries({ queryKey: [path] }));

      const staleId = `firm-${section}-stale`;
      await flushUntil(() => byTestId(staleId) !== null);
      expect(hasRow()).toBe(true);
      expect(byTestId(`firm-${section}-load-error`)).toBeNull();
      expect(pageText()).not.toContain(empty);

      await click(buttonByText(/^Retry$/, byTestId(staleId)!));
      await flushUntil(() => pageText().includes(empty));
      expect(read).toHaveBeenCalledTimes(3);
      expect(byTestId(staleId)).toBeNull();
      expect(document.querySelector("tbody")).toBeNull();
    }
  );

  it("clears cached engagement letters and their actions after a 404", async () => {
    const title = "Northwind engagement";
    const sendLabel = new RegExp(`^${copy["firm.sendLetter"]}$`);
    const createLabel = new RegExp(`^${copy["firm.createLetter"]}$`);
    const loaded = { letters: [{ id: "letter-1", title, status: "draft", kind: "engagement" }] };
    reads.set(
      lettersPath,
      vi
        .fn()
        .mockResolvedValueOnce(loaded)
        .mockRejectedValueOnce(new ApiError("Client not found", 404))
    );

    await renderTab(copy["firm.tabLetters"]);
    await flushUntil(() => pageText().includes(title));
    expect(buttonByText(sendLabel)).not.toBeNull();
    expect(buttonByText(createLabel)).not.toBeNull();
    expect(queryClient.getQueryData([lettersPath])).toEqual(loaded);

    await act(async () => queryClient.invalidateQueries({ queryKey: [lettersPath] }));
    const errorId = "firm-letters-load-error";
    await flushUntil(() => byTestId(errorId) !== null);

    expect(byTestId(errorId)?.textContent).toContain(copy["firm.loadNotFoundTitle"]);
    expect(queryClient.getQueryData([lettersPath])).toBeUndefined();
    expect(pageText()).not.toContain(title);
    expect(pageText()).not.toContain(copy["firm.noLetters"]);
    expect(buttonByText(sendLabel)).toBeNull();
    expect(buttonByText(createLabel)).toBeNull();
  });
});
