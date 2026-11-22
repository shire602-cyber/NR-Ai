// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import {
  ReceiptQueueProvider,
  useReceiptQueue,
} from "../../client/src/components/receipts/ReceiptQueueProvider";

it("keeps a company batch locked while the receipt screen is unmounted", () => {
  let batch: ReturnType<typeof useReceiptQueue>[2];
  function ReceiptScreen() {
    [, , batch] = useReceiptQueue("company-a");
    return null;
  }
  const root = createRoot(document.createElement("div"));
  function render(show: boolean) {
    act(() =>
      root.render(
        createElement(ReceiptQueueProvider, {
          children: show ? createElement(ReceiptScreen) : null,
        })
      )
    );
  }
  try {
    render(true);
    const original = batch!;
    act(() => expect(original.start()).toBe(true));
    render(false);
    render(true);
    expect(batch!.saving).toBe(true);
    act(() => expect(batch!.start()).toBe(false));
    act(() => original.finish());
    expect(batch!.saving).toBe(false);
  } finally {
    act(() => root.unmount());
  }
});
