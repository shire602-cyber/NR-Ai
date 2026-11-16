/**
 * D5b form-payload harness: renders a real page in jsdom with a fixture-backed
 * react-query client and a recorded `apiRequest`, so a test can open a create
 * dialog, fill it, submit, and assert the exact request body.
 *
 * Usage (in a `// @vitest-environment jsdom` test file):
 *   vi.mock("../../client/src/lib/queryClient", () => formHarnessQueryClientMock());
 *   vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());
 */
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";

export const COMPANY_ID = "c0000000-0000-4000-8000-000000000001";
export const COMPANY = {
  id: COMPANY_ID,
  name: "Synthetic Trading LLC",
  baseCurrency: "AED",
  country: "AE",
  emirate: "dubai",
  trnVatNumber: "100000000000003",
  locale: "en",
};

type Fixtures = Record<string, unknown>;
const state: {
  fixtures: Fixtures;
  calls: Array<{ method: string; url: string; body: unknown }>;
  responses: Record<string, unknown>;
} = { fixtures: {}, calls: [], responses: {} };

export function setFixtures(f: Fixtures) {
  state.fixtures = f;
}
export function apiCalls(method?: string) {
  return state.calls.filter((c) => !method || c.method === method);
}
export function resetHarness() {
  state.calls = [];
  state.fixtures = {};
  state.responses = {};
}

function keyToPath(key: readonly unknown[]): string {
  return key
    .filter((p) => p !== undefined && p !== null && typeof p !== "object")
    .map(String)
    .join("/")
    .replace(/\/+/g, "/");
}

function lookup(path: string): unknown {
  if (path in state.fixtures) return state.fixtures[path];
  const clean = path.split("?")[0];
  if (clean in state.fixtures) return state.fixtures[clean];
  return [];
}

export function formHarnessQueryClientMock() {
  const apiRequest = async (method: string, url: string, body?: unknown) => {
    state.calls.push({ method, url, body });
    if (method === "GET") return lookup(url);
    return { id: "new-id", status: "draft", number: "X-1", ...(state.responses[url] as object) };
  };
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        queryFn: async ({ queryKey }) => lookup(keyToPath(queryKey)),
      },
      mutations: { retry: false },
    },
  });
  class ApiError extends Error {
    status = 400;
    body: unknown = null;
  }
  return {
    apiRequest: vi.fn(apiRequest),
    queryClient: qc,
    ApiError,
    getQueryFn: () => async ({ queryKey }: { queryKey: readonly unknown[] }) =>
      lookup(keyToPath(queryKey)),
    apiFetch: vi.fn(async () => new Response("{}")),
  };
}

export function formHarnessCompanyMock() {
  return {
    useDefaultCompany: () => ({
      company: COMPANY,
      companyId: COMPANY_ID,
      companies: [COMPANY],
      hasNoCompanies: false,
      isLoading: false,
      error: null,
    }),
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

export async function renderPage(Component: ComponentType<any>, props: object = {}) {
  const { queryClient } = (await import("../../../client/src/lib/queryClient")) as unknown as {
    queryClient: QueryClient;
  };
  queryClient.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(QueryClientProvider, { client: queryClient }, createElement(Component, props))
    );
  });
  await flush();
}

export async function unmountPage() {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  container = null;
  root = null;
  document.body.innerHTML = "";
}

export async function flush(ms = 0) {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  }
}

export const byTestId = (id: string) =>
  document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

export function setValue(el: Element | null, value: string) {
  if (!el) throw new Error("element not found");
  const input = el as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(
    new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true })
  );
}

export async function type(el: Element | null, value: string) {
  await act(async () => setValue(el, value));
}

export async function click(el: Element | null) {
  if (!el) throw new Error("element not found");
  await act(async () => (el as HTMLElement).click());
  await flush();
}

/** Submit the form that owns `el` (or click it when it is a plain button). */
export async function submit(el: Element | null) {
  if (!el) throw new Error("submit element not found");
  await act(async () => (el as HTMLElement).click());
  await flush(5);
}

/** Find a visible-text button inside the current dialog/page. */
export function buttonByText(re: RegExp, scope: ParentNode = document) {
  return [...scope.querySelectorAll("button")].find((b) => re.test(b.textContent ?? "")) ?? null;
}

/** Input by its associated <label> text. */
export function inputByLabel(re: RegExp, scope: ParentNode = document) {
  const label = [...scope.querySelectorAll("label")].find((l) => re.test(l.textContent ?? ""));
  if (!label) return null;
  const id = label.getAttribute("for");
  if (id) return document.getElementById(id);
  return label.querySelector("input,textarea,select");
}
