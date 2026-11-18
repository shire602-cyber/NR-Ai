// @vitest-environment jsdom
/**
 * STEP1 F10: the bill preview must decode the chosen file in the page. The production CSP
 * (connect-src 'self') refuses `fetch(data:...)`, so a revert to fetching the data URL would show
 * no preview in production. This renders the real panel and checks the behaviour: the chosen file
 * becomes a blob: URL on the iframe (PDF) or img (image) and no fetch is ever made for a data: URL.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const fetched: string[] = [];

const PDF = `data:application/pdf;base64,${btoa("%PDF-1.4\n%%EOF\n")}`;
const PNG = `data:image/png;base64,${btoa("\x89PNG\r\n")}`;

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  fetched.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      fetched.push(typeof input === "string" ? input : String(input));
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    })
  );
  let n = 0;
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (blob) =>
    `blob:http://localhost/${blob.type.replace("/", "-")}-${++n}`;
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {};
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(file: { name: string; type: string; dataUrl: string }) {
  const { queryClient } = await import("../../client/src/lib/queryClient");
  const { BillCapturePanel } = await import("../../client/src/components/bills/BillCapturePanel");
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(BillCapturePanel, {
          companyId: "c-1",
          file,
          onFile: () => {},
          onCaptured: () => {},
          result: null,
          aiAvailable: false,
        })
      )
    );
  });
  for (let i = 0; i < 5; i++)
    await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
}

describe("STEP1 F10: bill capture preview", () => {
  it("shows a PDF through a blob: iframe and never fetches the data URL", async () => {
    await render({ name: "bill.pdf", type: "application/pdf", dataUrl: PDF });
    const frame = container.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(frame!.getAttribute("src")).toMatch(/^blob:/);
    expect(fetched.filter((u) => u.startsWith("data:"))).toEqual([]);
  });

  it("shows an image through a blob: img and never fetches the data URL", async () => {
    await render({ name: "bill.png", type: "image/png", dataUrl: PNG });
    const img = container.querySelector('img[src^="blob:"]');
    expect(img).not.toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(fetched.filter((u) => u.startsWith("data:"))).toEqual([]);
  });
});
