import { it, expect, vi } from "vitest";
import { ErrorBoundary } from "../../client/src/components/ErrorBoundary";

vi.mock("../../client/src/lib/api", () => ({ apiUrl: (path: string) => path }));

it("reports the join page before its fragment has been cleared without sending the token", () => {
  const token = "a4".repeat(32);
  const fetch = vi.fn(
    async (_url: string, _options: RequestInit) => new Response(null, { status: 204 })
  );
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("window", {
    location: new URL(`https://example.test/portal/join?source=email#t=${token}`),
  });
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    new ErrorBoundary({ children: null }).componentDidCatch(new Error(`Echoed ${token}`), {
      componentStack: `component ${token}`,
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/client-errors",
      expect.objectContaining({ method: "POST", referrerPolicy: "no-referrer" })
    );
    const body = JSON.parse(fetch.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      url: "/portal/join",
      message: "Echoed [redacted]",
      componentStack: "component [redacted]",
    });
    expect(JSON.stringify(body)).not.toContain(token);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(token);
  } finally {
    consoleError.mockRestore();
    vi.unstubAllGlobals();
  }
});
