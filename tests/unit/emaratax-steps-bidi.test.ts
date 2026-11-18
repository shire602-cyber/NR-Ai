// @vitest-environment jsdom
/**
 * Arabic step 3 of the EmaraTax approval steps interpolates Latin partner and company names
 * and a number into an Arabic sentence with brackets. Each value must be bidi-isolated so the
 * brackets stay attached to their own text (the page showed "Complyance) ... (").
 */
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FSI = "⁨";
const PDI = "⁩";

beforeAll(async () => {
  const { loadLocale, useI18n } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
  act(() => useI18n.getState().setLocale("ar"));
});

let container: HTMLDivElement | null = null;
afterEach(() => container?.remove());

describe("EmaraTaxSteps bidi isolation (ar)", () => {
  it("isolates the Latin partner, legal name, number and company", async () => {
    const { EmaraTaxSteps } = await import("../../client/src/components/einvoice/EmaraTaxSteps");
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        createElement(EmaraTaxSteps, {
          partner: {
            displayName: "Complyance",
            legalName: "Complyance Electronics L.L.C",
            accreditationNumber: "112219",
          },
          companyName: "Pearl Trading",
        })
      )
    );
    const steps = [...container.querySelectorAll("li")].map((li) => li.textContent ?? "");
    expect(steps[0]).toContain(`${FSI}Pearl Trading${PDI}`);
    expect(steps[2]).toContain(`${FSI}Complyance${PDI}`);
    expect(steps[2]).toContain(`${FSI}Complyance Electronics L.L.C${PDI}`);
    expect(steps[2]).toContain(`${FSI}112219${PDI}`);
    // The whole partner label is itself one isolate inside the sentence.
    expect(steps[2]).toMatch(new RegExp(`${FSI}[^${PDI}]*${FSI}Complyance${PDI}`));
    await act(async () => root.unmount());
  });
});
