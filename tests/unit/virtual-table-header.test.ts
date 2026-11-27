// @vitest-environment jsdom
/**
 * STEP5 final F-1: a narrow control column (the Contacts select-all checkbox) must not get the
 * header `truncate` ellipsis, while plain text headers keep truncating.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { VirtualTable } from "../../client/src/components/VirtualTable";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const host = document.createElement("div");
document.body.appendChild(host);
afterEach(() => {
  host.innerHTML = "";
});

describe("VirtualTable header cells [STEP5 F-1]", () => {
  it("applies truncate to string headers only", async () => {
    const root = createRoot(host);
    await act(async () => {
      root.render(
        createElement(VirtualTable<{ id: string }>, {
          rows: [{ id: "a" }],
          columns: [
            {
              key: "select",
              header: createElement("input", { type: "checkbox", "data-testid": "all" }),
              width: "44px",
              cell: () => null,
            },
            { key: "name", header: "Name", cell: () => "x" },
          ],
        })
      );
    });
    const headers = host.querySelectorAll('[role="columnheader"]');
    expect(headers).toHaveLength(2);
    expect(headers[0].className).not.toContain("truncate");
    expect(headers[1].className).toContain("truncate");
    await act(async () => root.unmount());
  });
});
