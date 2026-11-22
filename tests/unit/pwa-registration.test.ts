import { afterEach, describe, expect, it, vi } from "vitest";
import { registerServiceWorker } from "../../client/src/lib/pwa";

afterEach(() => vi.unstubAllGlobals());

describe("service worker registration", () => {
  it("allows the app to load when browser policy leaves no registration", async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    const addEventListener = vi.fn();
    vi.stubGlobal("navigator", { serviceWorker: { register, addEventListener } });

    await expect(registerServiceWorker()).resolves.toBeNull();
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    expect(addEventListener).not.toHaveBeenCalled();
  });
});
