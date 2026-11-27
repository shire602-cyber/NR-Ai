// @vitest-environment jsdom
/** UAE e-invoicing deadline finder: Dubai-calendar maths and the rendered section (EN and AR). */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEADLINES,
  PENALTY_AED_CAP,
  PENALTY_AED_PER_MONTH,
  daysUntil,
  deadlineState,
  dubaiToday,
  formatDeadlineDate,
  timelineLayout,
} from "../../client/src/components/marketing/phase/home/deadlines";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date("2026-11-24T08:00:00Z");

describe("dubaiToday / daysUntil", () => {
  it("uses the Dubai calendar day (UTC+4) around midnight", () => {
    expect(dubaiToday(new Date("2027-03-31T19:59:00Z"))).toEqual({ y: 2027, m: 3, d: 31 });
    expect(dubaiToday(new Date("2027-03-31T20:00:00Z"))).toEqual({ y: 2027, m: 4, d: 1 });
  });

  it("is 0 on the deadline day and negative after the Dubai day ends", () => {
    expect(daysUntil("2027-03-31", new Date("2027-03-31T19:59:00Z"))).toBe(0);
    expect(daysUntil("2027-03-31", new Date("2027-03-31T20:00:00Z"))).toBe(-1);
    expect(daysUntil("2027-03-31", new Date("2027-03-30T20:00:00Z"))).toBe(0);
    expect(daysUntil("2027-03-31", new Date("2027-03-30T19:59:00Z"))).toBe(1);
  });
});

describe("deadlineState", () => {
  it("50m or more: appointment has passed, go-live is next", () => {
    const state = deadlineState("large", NOW);
    expect(state.appoint).toMatchObject({ date: "2026-10-30", passed: true });
    expect(state.live).toMatchObject({ date: "2027-01-01", daysLeft: 38, passed: false });
    expect(state.next?.key).toBe("live");
  });

  it("under 50m: appointment is next", () => {
    const state = deadlineState("small", NOW);
    expect(state.appoint).toMatchObject({ date: "2027-03-31", daysLeft: 127, passed: false });
    expect(state.live.date).toBe("2027-07-01");
    expect(state.next?.key).toBe("appoint");
  });

  it("government: appointment is next, go-live 1 October 2027", () => {
    const state = deadlineState("government", NOW);
    expect(state.live.date).toBe("2027-10-01");
    expect(state.next?.key).toBe("appoint");
  });

  it("has no next milestone once both have passed", () => {
    for (const segment of ["large", "small", "government"] as const) {
      const state = deadlineState(segment, new Date("2027-11-02T00:00:00Z"));
      expect(state.next).toBeNull();
      expect(state.appoint.passed && state.live.passed).toBe(true);
    }
  });

  it("keeps the config and penalty in line with the published facts", () => {
    expect(DEADLINES.large).toEqual({ appoint: "2026-10-30", live: "2027-01-01" });
    expect(PENALTY_AED_PER_MONTH).toBe(5000);
    expect(PENALTY_AED_CAP).toBe(50000);
  });

  it("places the milestones and today inside the timeline", () => {
    for (const segment of ["large", "small", "government"] as const) {
      const layout = timelineLayout(segment, NOW);
      for (const value of Object.values(layout)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
      expect(layout.appoint).toBeLessThan(layout.live);
    }
  });
});

describe("formatDeadlineDate", () => {
  it("formats with Western digits per locale", () => {
    expect(formatDeadlineDate("2027-03-31", "en")).toBe("31 March 2027");
    const ar = formatDeadlineDate("2027-03-31", "ar");
    expect(ar).toMatch(/^31 \S+ 2027$/);
    expect(ar).toContain("مارس");
  });
});

describe("DeadlineFinder render", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(async () => {
    const { loadLocale } = await import("../../client/src/lib/i18n");
    await Promise.all([loadLocale("en"), loadLocale("ar")]);
  });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function render(locale: "en" | "ar") {
    const { DeadlineFinder } =
      await import("../../client/src/components/marketing/phase/home/DeadlineFinder");
    await act(async () =>
      root.render(createElement(DeadlineFinder, { base: `/${locale}`, locale }))
    );
  }
  const q = (selector: string) => container.querySelector<HTMLElement>(selector)!;
  const pick = (segment: string) =>
    act(async () => {
      q(`[data-testid="deadline-segment-${segment}"]`).click();
    });

  it("renders the English section and updates when the segment changes", async () => {
    await render("en");
    const section = q('[data-testid="section-e-invoicing-deadlines"]');
    expect(section.id).toBe("e-invoicing-deadlines");
    expect(section.textContent).toContain("Is your business ready for 2027?");

    // Default: under AED 50m.
    expect(q('[data-testid="deadline-segment-small"]').getAttribute("aria-checked")).toBe("true");
    expect(q('[data-testid="deadline-count"]').textContent).toBe("127");
    expect(q('[data-testid="deadline-result"]').textContent).toContain(
      "If your business or government entity is in scope"
    );
    expect(q('[data-testid="deadline-sentence"]').textContent).toContain("127\u00a0days");
    expect(q('[data-testid="deadline-milestone-appoint"]').textContent).toContain("31 March 2027");
    expect(q('[data-testid="deadline-milestone-live"]').textContent).toContain("1 July 2027");
    expect(container.textContent).not.toContain("Deadline passed - act now");

    await pick("large");
    expect(q('[data-testid="deadline-segment-large"]').getAttribute("aria-checked")).toBe("true");
    expect(q('[data-testid="deadline-count"]').textContent).toBe("38");
    expect(q('[data-testid="deadline-sentence"]').textContent).toContain("38\u00a0days");
    expect(q('[data-testid="deadline-flag"]').textContent).toContain("Deadline passed - act now");
    expect(q('[data-testid="deadline-milestone-appoint"]').textContent).toContain(
      "30 October 2026"
    );
    expect(q('[data-testid="deadline-milestone-live"]').textContent).toContain("1 January 2027");

    await pick("government");
    expect(q('[data-testid="deadline-milestone-live"]').textContent).toContain("1 October 2027");
    expect(container.textContent).not.toContain("Deadline passed - act now");
  });

  it("shows the scope amendment, official sources, setup steps and CTA", async () => {
    await render("en");
    expect(q('[data-testid="deadline-penalty"]').textContent).toBe(
      "Late implementation: AED 5,000 for the initial violation, then AED 5,000 for each month or part thereof that non-compliance continues, capped at AED 50,000 in any 12 consecutive months (UAE Ministry of Finance)"
    );
    const hrefs = [
      ...container.querySelectorAll<HTMLAnchorElement>('[data-testid="deadline-sources"] a'),
    ];
    expect(hrefs.map((a) => a.href)).toEqual([
      "https://tax.gov.ae/en/taxes/Vat/uae.einvoicing.aspx",
      "https://mof.gov.ae/en/about-us/initiatives/einvoicing/",
      "https://mof.gov.ae/en/news/ministry-of-finance-amends-electronic-invoicing-regulations-to-ease-the-burden-on-businesses/",
      "https://mof.gov.ae/en/news/mof-announces-updated-administrative-penalties-related-to-the-uae-einvoicing-system-to-enhance-clarity-and-support-business-compliance/",
    ]);
    for (const a of hrefs) {
      expect(a.target).toBe("_blank");
      expect(a.rel).toBe("noopener noreferrer");
    }
    expect(q('[data-testid="deadline-sources"]').textContent).toContain(
      "Ministerial Decision 244 of 2025, as amended"
    );
    expect(q('[data-testid="deadline-sources"]').textContent).toContain(
      "Transactions within the same tax group are excluded for 24 months from 1 January 2027."
    );
    const steps = container.querySelectorAll(".mz-dl-steps li");
    expect(steps[1].textContent).toContain("through EmaraTax and complete onboarding");
    expect(steps[2].textContent).toContain("Once onboarding is complete");
    expect(q('[data-testid="deadline-cta"]').getAttribute("href")).toBe(
      "/en/tools/e-invoicing-readiness"
    );
    expect(q('[aria-live="polite"]')).toBeTruthy();
    expect(container.textContent).not.toMatch(/a-?cube|complyance|zatca|saudi|ksa/i);
    expect(container.textContent).toContain("accredited service provider");
    // Provider fees are never described as zero while the owner flag is off.
    expect(container.textContent).not.toContain("No accredited provider fees");
  });

  it("supports arrow-key selection (mirrored in RTL)", async () => {
    await render("en");
    await act(async () => {
      q('[data-testid="deadline-segment-small"]').dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
      );
    });
    expect(q('[data-testid="deadline-segment-government"]').getAttribute("aria-checked")).toBe(
      "true"
    );
    act(() => root.unmount());
    root = createRoot(container);
    await render("ar");
    await act(async () => {
      q('[data-testid="deadline-segment-small"]').dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })
      );
    });
    expect(q('[data-testid="deadline-segment-government"]').getAttribute("aria-checked")).toBe(
      "true"
    );
  });

  it("renders the Arabic section with RTL, Arabic copy and Western digits", async () => {
    await render("ar");
    const section = q('[data-testid="section-e-invoicing-deadlines"]');
    expect(section.getAttribute("dir")).toBe("rtl");
    expect(section.textContent).toContain("هل شركتك جاهزة لعام 2027؟");
    expect(q('[data-testid="deadline-count"]').textContent).toBe("127");
    expect(q('[data-testid="deadline-result"]').textContent).toContain("خاضعة للنظام");
    expect(q('[data-testid="deadline-sources"]').textContent).toContain("المجموعة الضريبية نفسها");
    expect(q('[data-testid="deadline-sentence"]').textContent).toContain("127\u00a0يومًا");
    expect(q('[data-testid="deadline-milestone-appoint"]').textContent).toMatch(/31 \S+ 2027/);
    expect(q('[data-testid="deadline-penalty"]').textContent).toContain("5,000");
    expect(q('[data-testid="deadline-cta"]').getAttribute("href")).toBe(
      "/ar/tools/e-invoicing-readiness"
    );
    await pick("large");
    expect(q('[data-testid="deadline-flag"]').textContent).toContain("انتهى الموعد - تحرّك الآن");
    expect(container.textContent).not.toMatch(/a-?cube|complyance|zatca|saudi|ksa/i);
  });

  it("shows Mandatory now once every date has passed", async () => {
    vi.setSystemTime(new Date("2027-11-02T00:00:00Z"));
    await render("en");
    expect(q('[data-testid="deadline-flag"]').textContent).toContain("Mandatory now");
    expect(container.querySelector('[data-testid="deadline-count"]')).toBeNull();
  });
});
