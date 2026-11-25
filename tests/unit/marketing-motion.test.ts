// @vitest-environment jsdom
/**
 * Motion controls on the homepage: the tour stops auto-advancing on focus or hover and has a
 * Pause/Play button, the hero loop has its own Pause/Play, both stay static under
 * prefers-reduced-motion, and edits in the tour invoice flow into the VAT 201 tab.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let reducedMotion = false;
let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduce") && reducedMotion,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const byId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const click = (el: Element) =>
  act(() => {
    (el as HTMLElement).click();
  });

describe("product tour motion", () => {
  async function mount(locale: "en" | "ar") {
    const { ProductTour } =
      await import("../../client/src/components/marketing/phase/home/ProductTour");
    const tr = ((pair: readonly [string, string]) => pair[locale === "ar" ? 1 : 0]) as never;
    await act(async () => {
      root.render(createElement(ProductTour, { base: `/${locale}`, locale, tr }));
    });
  }
  const tabs = () => [...container.querySelectorAll<HTMLElement>('[role="tab"]')];
  const selected = () => tabs().findIndex((t) => t.getAttribute("aria-selected") === "true");
  const shell = () => container.querySelector(".mz-tour-shell")!;
  const advance = (ms: number) =>
    act(async () => {
      vi.advanceTimersByTime(ms);
    });

  beforeEach(() => {
    reducedMotion = false;
  });

  it("stops auto-advance when keyboard focus enters the tour", async () => {
    await mount("en");
    vi.useFakeTimers();
    await act(async () => {});
    act(() => {
      tabs()[0].dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    await advance(40_000);
    expect(selected()).toBe(0);
  });

  it("holds auto-advance while hovering and resumes on leave", async () => {
    await mount("en");
    vi.useFakeTimers();
    await act(async () => {});
    act(() => {
      shell().dispatchEvent(new Event("pointerover", { bubbles: true }));
    });
    await advance(30_000);
    expect(selected()).toBe(0);
    act(() => {
      shell().dispatchEvent(new Event("pointerout", { bubbles: true }));
    });
    await advance(8100);
    expect(selected()).toBe(1);
  });

  it("has a Pause/Play button that toggles auto-advance, labelled in both languages", async () => {
    await mount("en");
    vi.useFakeTimers();
    await act(async () => {});
    const button = () => byId("tour-pause") as HTMLButtonElement;
    expect(button().tagName).toBe("BUTTON");
    expect(button().textContent).toBe("Pause tour");
    click(button());
    expect(button().textContent).toBe("Play tour");
    await advance(30_000);
    expect(selected()).toBe(0);
    click(button());
    expect(button().textContent).toBe("Pause tour");
    await advance(8100);
    expect(selected()).toBe(1);

    act(() => root.render(null));
    await mount("ar");
    expect(byId("tour-pause").textContent).toBe("إيقاف الجولة مؤقتًا");
    click(byId("tour-pause"));
    expect(byId("tour-pause").textContent).toBe("تشغيل الجولة");
  });

  // Fake timers are active before mounting, and the lazy app module is resolved first, so the
  // demo's own timers (auto start 900 ms, stage 850 ms) are driven by the fake clock.
  async function mountWithFakeTimers() {
    vi.useFakeTimers();
    await import("../../client/src/components/marketing/phase/home/tour/TourApp");
    await mount("en");
    await act(async () => {});
    await act(async () => {});
    expect(byId("tour-issue")).not.toBeNull();
  }
  const pipelineStep = () =>
    [...container.querySelectorAll(".mz-tour-pipeline li")].findIndex(
      (li) => li.getAttribute("data-state") === "current"
    );

  it("Pause holds a running invoice demo and the selected tab, Play resumes it", async () => {
    await mountWithFakeTimers();
    await advance(900); // invoice auto start
    await advance(850); // stage 1
    expect(pipelineStep()).toBe(1);
    expect(byId("tour-pause").textContent).toBe("Pause tour");

    click(byId("tour-pause"));
    expect(byId("tour-pause").textContent).toBe("Play tour");
    await advance(30_000);
    expect(pipelineStep()).toBe(1);
    expect(selected()).toBe(0);

    click(byId("tour-pause"));
    expect(byId("tour-pause").textContent).toBe("Pause tour");
    await advance(900);
    expect(pipelineStep()).toBe(2);
  });

  it("keeps Pause available for a manually started demo after the visitor interacted", async () => {
    await mountWithFakeTimers();
    act(() => {
      shell().dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    // Interaction stopped auto-play and no demo is running: Play is offered.
    expect(byId("tour-pause").textContent).toBe("Play tour");
    click(byId("tour-issue"));
    expect(byId("tour-pause").textContent).toBe("Pause tour");
    await advance(850);
    expect(pipelineStep()).toBe(1);

    click(byId("tour-pause"));
    expect(byId("tour-pause").textContent).toBe("Play tour");
    await advance(30_000);
    expect(pipelineStep()).toBe(1);
    expect(selected()).toBe(0);
  });

  it("never advances away from a focused control", async () => {
    await mount("en");
    vi.useFakeTimers();
    await act(async () => {});
    // Focus lands without a focus event reaching React (e.g. a script focus before the timer fires).
    tabs()[0].focus();
    await advance(8100);
    expect(selected()).toBe(0);
  });

  it("stays static under prefers-reduced-motion and shows no pause button", async () => {
    reducedMotion = true;
    await mount("en");
    vi.useFakeTimers();
    await act(async () => {});
    expect(container.querySelector('[data-testid="tour-pause"]')).toBeNull();
    await advance(60_000);
    expect(selected()).toBe(0);
  });
});

describe("tour invoice feeds the VAT 201 tab", () => {
  it("changes the VAT 201 figures when the invoice is edited", async () => {
    reducedMotion = true;
    const { ProductTour } =
      await import("../../client/src/components/marketing/phase/home/ProductTour");
    const tr = ((pair: readonly [string, string]) => pair[0]) as never;
    await act(async () => {
      root.render(createElement(ProductTour, { base: "/en", locale: "en", tr }));
    });
    await vi.waitFor(() => expect(byId("tour-qty-0")).not.toBeNull());

    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    const openVat = async () => {
      click(container.querySelectorAll('[role="tab"]')[3]);
      await vi.waitFor(() => expect(byId("tour-vat-fill")).not.toBeNull());
      click(byId("tour-vat-fill"));
    };
    const row = (box: string) => container.querySelector(`tr[data-box="${box}"]`)!.textContent;

    await openVat();
    expect(row("14")).toContain("477.50");
    expect(row("1b")).toContain("11,000.00");

    click(container.querySelectorAll('[role="tab"]')[0]);
    await vi.waitFor(() => expect(byId("tour-qty-0")).not.toBeNull());
    act(() => {
      setValue.call(byId("tour-qty-0"), "5");
      byId("tour-qty-0").dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(byId("tour-vat").textContent).toBe("172.50");

    await openVat();
    // Invoice net 3,450.00 + 8,000.00 standard-rated sales; VAT 572.50 - 72.50 input = 500.00.
    expect(row("1b")).toContain("11,450.00");
    expect(row("1b")).toContain("572.50");
    expect(row("14")).toContain("500.00");
  });
});

describe("hero stage motion", () => {
  class FakeObserver {
    constructor(private cb: (entries: { isIntersecting: boolean }[]) => void) {}
    observe() {
      this.cb([{ isIntersecting: true }]);
    }
    disconnect() {}
    unobserve() {}
  }

  async function mount(locale: "en" | "ar") {
    const { default: HeroStage } =
      await import("../../client/src/components/marketing/phase/home/HeroStage");
    await act(async () => {
      // The hero band owns the data-motion switch, so the stage is rendered inside .mz-hero.
      root.render(createElement("section", { className: "mz-hero" }, createElement(HeroStage, { locale })));
    });
  }
  const stage = () => byId("hero-stage");
  const vatAmount = () => container.querySelector(".mz-stage-vat strong")?.textContent;
  // The frame timer is re-armed by an effect after each state change, so step the clock in
  // small slices and let React flush between them.
  const advance = async (ms: number) => {
    for (let spent = 0; spent < ms; spent += 100) {
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
    }
  };

  beforeEach(() => {
    reducedMotion = false;
    vi.stubGlobal("IntersectionObserver", FakeObserver);
  });

  it("loops, flips the invoice language from a keyed const, and pauses with the button", async () => {
    vi.useFakeTimers();
    await mount("en");
    expect(stage().getAttribute("data-animated")).toBe("true");
    const button = () => byId("hero-pause");
    expect(button().tagName).toBe("BUTTON");
    expect(button().textContent).toBe("Pause animation");
    expect(button().getAttribute("aria-pressed")).toBe("false");

    await advance(2800);
    // Flip frame: the invoice shows the other language without a second catalog.
    expect(container.querySelector(".mz-stage-invoice")?.getAttribute("lang")).toBe("ar");
    expect(container.querySelector(".mz-stage-invhead strong")?.textContent).toBe("فاتورة ضريبية");

    click(button());
    expect(button().getAttribute("aria-pressed")).toBe("true");
    expect(button().textContent).toBe("Play animation");
    const frozen = stage().getAttribute("data-status");
    await advance(20_000);
    expect(stage().getAttribute("data-status")).toBe(frozen);
    expect(stage().getAttribute("data-step")).toBe("1");

    click(button());
    expect(button().textContent).toBe("Pause animation");
    await advance(5000);
    expect(stage().getAttribute("data-status")).not.toBe(frozen);
  });

  it("holds the VAT count-up mid-way on Pause and resumes it on Play", async () => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "Date",
        "performance",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    });
    await mount("en");
    await advance(9300);
    expect(stage().getAttribute("data-step")).toBe("5");
    await advance(200);
    const band = () => container.querySelector(".mz-hero")!;
    const { VAT_PAYABLE_AED, formatFils, toFils } =
      await import("../../client/src/components/marketing/phase/home/hero/model");
    const final = `AED ${formatFils(toFils(Math.round(VAT_PAYABLE_AED)))}`;
    const mid = vatAmount();
    expect(mid).not.toBe(`AED ${formatFils(toFils(0))}`);
    expect(mid).not.toBe(final);

    click(byId("hero-pause"));
    expect(band().getAttribute("data-motion")).toBe("paused");
    await advance(5000);
    expect(vatAmount()).toBe(mid);

    click(byId("hero-pause"));
    expect(band().hasAttribute("data-motion")).toBe(false);
    await advance(300);
    expect(vatAmount()).not.toBe(mid);
  });

  it("labels the button in Arabic", async () => {
    await mount("ar");
    expect(byId("hero-pause").textContent).toBe("إيقاف مؤقت للحركة");
    click(byId("hero-pause"));
    expect(byId("hero-pause").textContent).toBe("تشغيل الحركة");
  });

  it("is static under prefers-reduced-motion", async () => {
    reducedMotion = true;
    await mount("en");
    vi.useFakeTimers();
    expect(stage().getAttribute("data-animated")).toBe("false");
    expect(stage().getAttribute("data-step")).toBe("5");
    expect(container.querySelector('[data-testid="hero-pause"]')).toBeNull();
    await advance(30_000);
    expect(stage().getAttribute("data-step")).toBe("5");
  });
});
