// @vitest-environment jsdom
/**
 * E3 (J2-r3 High): on /register, switching English -> Arabic in the page (no reload) and
 * submitting failed with "Cannot read properties of undefined (reading 'includes')". The public
 * route loads only its own namespaces after a switch, and RegisterForm read
 * `onboarding.defaultCompanyName` from a namespace that was never fetched. Components now declare
 * the namespaces they read (`useTranslation([...])`), handlers await them, and formatMessage never
 * throws on a missing template.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const calls: { url: string; body: any }[] = [];

beforeEach(() => {
  vi.resetModules();
  calls.length = 0;
  window.localStorage.clear();
  window.history.replaceState(null, "", "/register");
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(url).endsWith("/api/auth/register")) {
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    }
    return new Response(JSON.stringify({ message: "no" }), { status: 401 });
  }) as typeof fetch;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function settle(rounds = 10) {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

/** Settle until `done()` holds: namespace loads are dynamic imports, slower under machine load. */
async function settleUntil(done: () => boolean, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!done() && Date.now() < deadline) await settle(1);
  await settle(2);
}

function typeInto(testId: string, value: string) {
  const input = container.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("[E3][J2-r3] register after an in-page language switch", () => {
  it("formatMessage never throws on a template that is not loaded", async () => {
    const { formatMessage } = await import("../../client/src/lib/i18n");
    expect(formatMessage(undefined, { name: "x" })).toBe("");
  });

  it("en -> ar on /register, then submit: the request is sent with the Arabic company name", async () => {
    const i18n = await import("../../client/src/lib/i18n");
    // Boot like main.tsx on /register in English: route namespaces, then the idle warm-up.
    i18n.setPublicBootScope("/register");
    await i18n.loadLocaleForPath("en", "/register");
    await i18n.loadLocale("en");
    expect(i18n.t.ar["onboarding.defaultCompanyName"]).toBeUndefined();

    const { default: PublicProviders } =
      await import("../../client/src/components/marketing/PublicProviders");
    const { RegisterForm } = await import("../../client/src/components/auth/RegisterForm");
    const onSuccess = vi.fn();
    await act(async () =>
      root.render(createElement(PublicProviders, null, createElement(RegisterForm, { onSuccess })))
    );
    await settle();

    // The in-page switch (the header language toggle calls setLocale).
    await act(async () => i18n.useI18n.getState().setLocale("ar"));
    await settleUntil(
      () =>
        !!i18n.t.ar["onboarding.defaultCompanyName"] && !!i18n.t.ar["forms.errors.uaeTrn15Digits"]
    );
    // The declared namespaces were fetched for Arabic on the switch.
    expect(i18n.t.ar["onboarding.defaultCompanyName"]).toBe("شركة {name}");
    expect(i18n.t.ar["forms.errors.uaeTrn15Digits"]).toBeTruthy();
    expect(i18n.isLocaleLoaded("ar")).toBe(false);

    typeInto("input-name", "سارة");
    typeInto("input-email", "sara@example.ae");
    typeInto("input-password", "Str0ng-pass-123");
    await act(async () => {
      (container.querySelector('[data-testid="button-register"]') as HTMLButtonElement).click();
    });
    await settleUntil(
      () =>
        onSuccess.mock.calls.length > 0 ||
        !!container.querySelector('[data-testid="register-error"]')
    );

    expect(container.querySelector('[data-testid="register-error"]')).toBeNull();
    const register = calls.find((c) => c.url.endsWith("/api/auth/register"));
    expect(register, "registration request sent").toBeTruthy();
    expect(register!.body.companyName).toBe("شركة سارة");
    expect(onSuccess).toHaveBeenCalled();
  }, 30_000);

  it("an invalid TRN after the switch shows the Arabic message, not a key", async () => {
    const i18n = await import("../../client/src/lib/i18n");
    i18n.setPublicBootScope("/register");
    await i18n.loadLocaleForPath("en", "/register");
    const { default: PublicProviders } =
      await import("../../client/src/components/marketing/PublicProviders");
    const { RegisterForm } = await import("../../client/src/components/auth/RegisterForm");
    await act(async () =>
      root.render(
        createElement(PublicProviders, null, createElement(RegisterForm, { onSuccess: vi.fn() }))
      )
    );
    await act(async () => i18n.useI18n.getState().setLocale("ar"));
    await settleUntil(() => !!i18n.t.ar["forms.errors.uaeTrn15Digits"]);
    typeInto("input-name", "سارة");
    typeInto("input-email", "sara@example.ae");
    typeInto("input-password", "Str0ng-pass-123");
    typeInto("input-trn", "123");
    await act(async () => {
      (container.querySelector('[data-testid="button-register"]') as HTMLButtonElement).click();
    });
    await settleUntil(() =>
      (container.textContent ?? "").includes(i18n.t.ar["forms.errors.uaeTrn15Digits"] ?? "\u0000")
    );
    const text = container.textContent ?? "";
    expect(text).not.toContain("forms.errors.uaeTrn15Digits");
    expect(text).toContain(i18n.t.ar["forms.errors.uaeTrn15Digits"]);
    expect(calls.find((c) => c.url.endsWith("/api/auth/register"))).toBeUndefined();
  }, 30_000);
});

/**
 * Sweep (source inspection, because the failure only shows in a handler or on a later render after
 * an in-page switch, which a render test of every public component cannot reach): every module
 * reachable from the light public root that reads a key from a namespace outside its route set
 * declares that namespace in a `*_NAMESPACES` list (read by `useTranslation([...])`), and every
 * public module that shows validation / server-error copy declares VALIDATION_NAMESPACES.
 */
describe("[E3][J2-r3] public components declare the namespaces they read", () => {
  it("no public module reads an undeclared namespace", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = path.resolve(__dirname, "../../client/src");
    const i18n = await import("../../client/src/lib/i18n");
    const routeNs = new Set(i18n.namespacesForPath("/register"));
    const allNs = new Set(
      fs.readdirSync(path.join(src, "locales/en")).map((f: string) => f.replace(/\.json$/, ""))
    );
    const seen = new Set<string>();
    const problems: string[] = [];
    const resolve = (spec: string, from: string) => {
      let p: string;
      if (spec.startsWith("@/")) p = path.join(src, spec.slice(2));
      else if (spec.startsWith(".")) p = path.resolve(path.dirname(from), spec);
      else return null;
      for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) {
        if (fs.existsSync(p + ext) && fs.statSync(p + ext).isFile()) return p + ext;
      }
      return null;
    };
    const walk = (file: string) => {
      if (seen.has(file) || !/\.(tsx?)$/.test(file) || file.endsWith("/App.tsx")) return;
      seen.add(file);
      const text = fs.readFileSync(file, "utf8");
      const declared = new Set<string>();
      for (const m of text.matchAll(/_NAMESPACES\s*=\s*\[([^\]]*)\]/g)) {
        for (const ns of m[1].matchAll(/"(\w+)"/g)) declared.add(ns[1]);
        if (m[1].includes("VALIDATION_NAMESPACES")) declared.add("forms");
      }
      const rel = path.relative(src, file);
      for (const m of text.matchAll(/["'`]([a-zA-Z]+)\.[a-zA-Z0-9_.]+["'`]/g)) {
        const ns = m[1];
        if (allNs.has(ns) && !routeNs.has(ns) && !declared.has(ns)) {
          problems.push(`${rel}: ${m[0]}`);
        }
      }
      const showsServerErrors = /\b(serverErrorMessage|localizeApiError)\(/.test(text);
      if (showsServerErrors && !rel.includes("validation-messages")) {
        if (!/(VALIDATION|SERVER_ERROR)_NAMESPACES/.test(text)) {
          problems.push(
            `${rel}: shows server errors without VALIDATION_NAMESPACES or SERVER_ERROR_NAMESPACES`
          );
        }
      }
      for (const m of text.matchAll(/(?:import|from)\s*\(?\s*["']([^"']+)["']/g)) {
        const r = resolve(m[1], file);
        if (r && !r.includes("/locales/")) walk(r);
      }
    };
    walk(path.join(src, "PublicApp.tsx"));
    expect(seen.size).toBeGreaterThan(30);
    expect(problems).toEqual([]);
  });
});
