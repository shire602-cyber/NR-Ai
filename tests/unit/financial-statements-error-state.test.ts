// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { StatementLoadError } from "../../client/src/components/reports/StatementLoadError";

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await loadLocale("en");
  await loadLocale("ar");
}, 120_000);

describe("financial statements load error", () => {
  it.each([
    ["en", "Failed to load the statement.", "Try again"],
    ["ar", "تعذّر تحميل القائمة.", "حاول مرة أخرى"],
  ] as const)("announces the failure with a retry in %s", async (locale, message, retry) => {
    const prior = useI18n.getState().locale;
    const node = document.createElement("div");
    const root = createRoot(node);
    try {
      useI18n.setState({ locale });
      await act(async () => {
        root.render(
          createElement(StatementLoadError, {
            messageKey: "statements.loadFailed",
            onRetry: () => {},
          })
        );
      });
      expect(node.querySelector('[role="alert"]')).not.toBeNull();
      expect(node.textContent).toContain(message);
      expect(node.textContent).toContain(retry);
    } finally {
      await act(async () => root.unmount());
      useI18n.setState({ locale: prior });
    }
  });
});
