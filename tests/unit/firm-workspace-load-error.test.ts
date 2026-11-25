// @vitest-environment jsdom
/**
 * Accountant multi-client polish: when the firm workspace tabs fail to load (tasks, WIP, client
 * links) they show a retryable error state, not "No tasks" / "No WIP" / "No links", which an
 * accountant would read as a client with nothing outstanding.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  flush,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  resetHarness,
  setFixtures,
  unmountPage,
} from "./helpers/form-harness";
import { loadLocale } from "../../client/src/lib/i18n";

vi.mock("../../client/src/lib/queryClient", () => formHarnessQueryClientMock());
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});
beforeEach(() => {
  resetHarness();
  window.localStorage.clear();
});
afterEach(unmountPage);

describe("firm workspace load failure", () => {
  it("shows an error state instead of the empty copy when the tasks load fails", async () => {
    const qc = (await import("../../client/src/lib/queryClient")) as unknown as {
      queryClient: {
        getDefaultOptions(): { queries: { queryFn: (ctx: { queryKey: unknown[] }) => unknown } };
        setDefaultOptions(o: unknown): void;
      };
    };
    const defaults = qc.queryClient.getDefaultOptions();
    const original = defaults.queries.queryFn;
    qc.queryClient.setDefaultOptions({
      ...defaults,
      queries: {
        ...defaults.queries,
        queryFn: async (ctx: { queryKey: unknown[] }) => {
          if (ctx.queryKey[0] === "/api/firm/tasks") throw new Error("Internal error injected");
          return original(ctx);
        },
      },
    });
    setFixtures({});
    const { default: PracticeWorkspace } =
      await import("../../client/src/pages/firm/PracticeWorkspace");
    await renderPage(PracticeWorkspace);
    await flush(20);
    const text = document.body.textContent ?? "";
    expect(document.querySelector('[data-testid="firm-tasks-load-error"]')).not.toBeNull();
    expect(text).not.toContain("Internal error injected");
    expect(text).not.toMatch(/no tasks/i);
  });
});
