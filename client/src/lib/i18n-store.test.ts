// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

function installBrowserStubs() {
  const storage = new Map<string, string>();
  const documentElement = { lang: "en", dir: "ltr" };
  vi.stubGlobal("document", { documentElement });
  const localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  };
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("window", { localStorage }); // zustand's persist reads window.localStorage
  return { storage, documentElement };
}

describe("language switch state", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("sets <html lang> and dir and persists the choice", async () => {
    const { storage, documentElement } = installBrowserStubs();
    const { useI18n } = await import("./i18n");
    useI18n.getState().setLocale("ar");
    expect(documentElement.lang).toBe("ar");
    expect(documentElement.dir).toBe("rtl");
    expect(JSON.parse(storage.get("i18n-storage") as string).state.locale).toBe("ar");

    useI18n.getState().setLocale("en");
    expect(documentElement.dir).toBe("ltr");
    expect(JSON.parse(storage.get("i18n-storage") as string).state.locale).toBe("en");
  });

  it("restores lang/dir from storage on load, before any component renders", async () => {
    const { storage, documentElement } = installBrowserStubs();
    storage.set("i18n-storage", JSON.stringify({ state: { locale: "ar" }, version: 0 }));
    const { useI18n } = await import("./i18n");
    expect(useI18n.getState().locale).toBe("ar");
    expect(documentElement.lang).toBe("ar");
    expect(documentElement.dir).toBe("rtl");
  });
});
