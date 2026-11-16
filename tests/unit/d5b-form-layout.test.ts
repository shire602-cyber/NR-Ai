// @vitest-environment jsdom
/**
 * D5b form primitives (CTO form spec): required marker, help/error typography, numeric and
 * Latin-identifier inputs, dialog sizes with a mobile sheet, error summary, and the en/ar
 * forms catalog. Behaviour tests render the real components.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useForm } from "react-hook-form";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../../client/src/components/ui/form";
import { Input } from "../../client/src/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "../../client/src/components/ui/dialog";
import {
  ErrorSummary,
  Field,
  FormErrorSummary,
  FormGrid,
} from "../../client/src/components/ui/form-layout";
import { InvoicePreview } from "../../client/src/components/invoices/InvoicePreview";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeAll(async () => {
  await loadLocale("en");
  await loadLocale("ar");
});
beforeEach(() => {
  useI18n.setState({ locale: "en" } as never);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});
const render = async (el: React.ReactElement) => {
  await act(async () => root.render(el));
};

describe("[D5b] labels, help and errors", () => {
  it("FormLabel required renders a text-danger asterisk and an announced 'required'", async () => {
    function Demo() {
      const form = useForm({ defaultValues: { name: "" } });
      return createElement(
        Form,
        form as never,
        createElement(FormField, {
          control: form.control,
          name: "name",
          render: ({ field }: { field: object }) =>
            createElement(
              FormItem,
              null,
              createElement(FormLabel, { required: true }, "Customer name"),
              createElement(FormControl, null, createElement(Input, field)),
              createElement(FormDescription, null, "Shown on the invoice"),
              createElement(FormMessage, null)
            ),
        })
      );
    }
    await render(createElement(Demo));
    const label = container.querySelector("label")!;
    const star = label.querySelector('[aria-hidden="true"]')!;
    expect(star.textContent).toBe("*");
    expect(star.className).toContain("text-danger");
    expect(label.querySelector(".sr-only")!.textContent).toContain("required");
    expect(label.className).toContain("text-small");
    const help = [...container.querySelectorAll("p")].find((p) =>
      p.textContent?.includes("Shown on")
    )!;
    expect(help.className).toContain("text-caption");
    expect(help.className).toContain("text-muted-foreground");
  });

  it("Field wires id, aria-invalid and aria-describedby to the control", async () => {
    await render(
      createElement(
        FormGrid,
        null,
        createElement(
          Field,
          { id: "f-trn", label: "TRN", required: true, help: "15 numbers", error: "Required" },
          createElement(Input, { ltr: true })
        )
      )
    );
    const input = container.querySelector("input")!;
    expect(input.id).toBe("f-trn");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("f-trn-help f-trn-error");
    expect(document.getElementById("f-trn-error")!.className).toContain("text-danger");
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.className).toContain("gap-x-6");
    expect(grid.className).toContain("gap-y-4");
    expect(grid.className).toContain("sm:grid-cols-2");
  });
});

describe("[D5b] numeric and Latin identifier inputs", () => {
  it("ltr inputs are LTR with tabular figures; number inputs get tabular figures", async () => {
    await render(
      createElement(
        "div",
        null,
        createElement(Input, { ltr: true, "data-testid": "iban" }),
        createElement(Input, { type: "number", "data-testid": "qty" }),
        createElement(Input, { "data-testid": "name" })
      )
    );
    const iban = container.querySelector('[data-testid="iban"]')!;
    expect(iban.getAttribute("dir")).toBe("ltr");
    expect(iban.hasAttribute("data-ltr-num")).toBe(true);
    expect(iban.className).toContain("tabular-nums");
    expect(container.querySelector('[data-testid="qty"]')!.className).toContain("tabular-nums");
    expect(container.querySelector('[data-testid="name"]')!.className).not.toContain(
      "tabular-nums"
    );
  });
});

describe("[D5b] dialog sizes", () => {
  const open = async (size?: "sm" | "md" | "lg" | "xl") =>
    render(
      createElement(
        Dialog,
        { open: true },
        createElement(
          DialogContent,
          { size, "aria-describedby": undefined },
          createElement(DialogTitle, null, "T")
        )
      )
    );

  it("md/lg/xl are full-screen sheets on phones and centred panels from 640px", async () => {
    for (const [size, max] of [
      ["md", "sm:max-w-xl"],
      ["lg", "sm:max-w-3xl"],
      ["xl", "sm:max-w-6xl"],
    ] as const) {
      await open(size);
      const el = document.querySelector('[role="dialog"]')!;
      expect(el.getAttribute("data-size")).toBe(size);
      expect(el.className).toContain("h-[100dvh]");
      expect(el.className).toContain(max);
      expect(el.className).toContain("sm:rounded-xl");
    }
  });

  it("sm is a bottom sheet on phones", async () => {
    await open("sm");
    const el = document.querySelector('[role="dialog"]')!;
    expect(el.className).toContain("bottom-0");
    expect(el.className).toContain("rounded-t-2xl");
    expect(el.className).toContain("sm:max-w-md");
  });

  it("without a size the legacy centred panel is unchanged", async () => {
    await open();
    const el = document.querySelector('[role="dialog"]')!;
    expect(el.getAttribute("data-size")).toBeNull();
    expect(el.className).toContain("max-w-lg");
    expect(el.className).not.toContain("100dvh]");
  });
});

describe("[D5b] error summary", () => {
  it("ErrorSummary lists items and focuses the field on click", async () => {
    await render(
      createElement(
        "div",
        null,
        createElement(ErrorSummary, {
          items: [{ id: "x-name", label: "Name", message: "Required" }],
        }),
        createElement("input", { id: "x-name" })
      )
    );
    const summary = container.querySelector('[data-testid="form-error-summary"]')!;
    expect(summary.getAttribute("role")).toBe("alert");
    expect(summary.textContent).toContain("Fix 1 field before saving");
    await act(async () => (summary.querySelector("button") as HTMLButtonElement).click());
    expect(document.activeElement?.id).toBe("x-name");
  });

  it("FormErrorSummary appears only after a failed submit and focuses the first invalid", async () => {
    function Demo() {
      const form = useForm<{ name: string }>({ defaultValues: { name: "" } });
      return createElement(
        Form,
        form as never,
        createElement(
          "form",
          { onSubmit: form.handleSubmit(() => {}), noValidate: true },
          createElement(FormErrorSummary),
          createElement(FormField, {
            control: form.control,
            name: "name",
            rules: { required: "Name is required" },
            render: ({ field }: { field: object }) =>
              createElement(
                FormItem,
                null,
                createElement(FormLabel, { required: true }, "Name"),
                createElement(FormControl, null, createElement(Input, field)),
                createElement(FormMessage)
              ),
          }),
          createElement("button", { type: "submit" }, "Save")
        )
      );
    }
    await render(createElement(Demo));
    expect(container.querySelector('[data-testid="form-error-summary"]')).toBeNull();
    await act(async () => container.querySelector("form")!.requestSubmit());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    const summary = container.querySelector('[data-testid="form-error-summary"]')!;
    expect(summary.textContent).toContain("Name");
    expect(summary.textContent).toContain("Name is required");
    expect(document.activeElement?.getAttribute("name")).toBe("name");
  });
});

describe("[D5b] bilingual invoice preview", () => {
  const props = {
    sellerName: "Synthetic Trading LLC",
    sellerTrn: "100000000000003",
    number: null,
    date: new Date("2026-03-15T00:00:00Z"),
    customerName: "Gulf Horizon Logistics",
    customerTrn: "100123456700003",
    placeOfSupply: "Dubai",
    currency: "AED",
    lines: [
      { description: "Consulting", quantity: 2, unitPrice: 1500, vatRate: 0.05, lineTotal: 3150 },
    ],
    subtotal: 3000,
    vatAmount: 150,
    total: 3150,
    ratesLabel: "5%",
  };

  it("shows English and Arabic labels together, active language first", async () => {
    await render(createElement(InvoicePreview, props));
    const preview = container.querySelector('[data-testid="invoice-preview"]')!;
    const title = [...preview.querySelectorAll("span")].find(
      (s) => s.textContent === "Tax invoice"
    )!;
    const ar = title.nextElementSibling!;
    expect(ar.textContent).toBe("فاتورة ضريبية");
    expect(ar.getAttribute("lang")).toBe("ar");
    expect(ar.getAttribute("dir")).toBe("rtl");
    // TRN is an isolated LTR run; the total uses the shared Money formatter
    const trn = [...preview.querySelectorAll('[dir="ltr"]')].find(
      (s) => s.textContent === "100123456700003"
    );
    expect(trn).toBeTruthy();
    const total = preview.querySelector('[data-testid="invoice-preview-total"]')!;
    expect(total.querySelector(".money-amount")?.textContent).toBe("3,150.00");
  });

  it("in Arabic the Arabic label leads", async () => {
    useI18n.setState({ locale: "ar" } as never);
    await render(createElement(InvoicePreview, props));
    const preview = container.querySelector('[data-testid="invoice-preview"]')!;
    const title = [...preview.querySelectorAll("span")].find(
      (s) => s.textContent === "فاتورة ضريبية"
    )!;
    expect(title.nextElementSibling!.textContent).toBe("Tax invoice");
  });
});

describe("[D5b] forms catalog", () => {
  it("en and ar have the same keys and every Arabic value is Arabic", () => {
    const read = (l: string) =>
      JSON.parse(
        readFileSync(resolve(__dirname, `../../client/src/locales/${l}/forms.json`), "utf8")
      ) as Record<string, string>;
    const en = read("en");
    const ar = read("ar");
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
    for (const [k, v] of Object.entries(ar)) {
      expect(v.trim(), k).not.toBe("");
      expect(/[؀-ۿ]/.test(v), `${k} should be Arabic: ${v}`).toBe(true);
    }
  });
});
