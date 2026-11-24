import { apiUrl } from "./api";

/**
 * Requests the signed-in shell is certain to make on first load (`/api/auth/me`, `/api/companies`),
 * started by main.tsx before the app chunks have downloaded so they travel in parallel with the
 * JavaScript instead of after it. The first matching read (`fetchCurrentUser`, the default query
 * function) takes the response over; later reads fetch normally. Dependency-free on purpose: it
 * lives in the startup chunk.
 */
const started = new Map<string, Promise<Response | undefined>>(
  // The server's document may already have started some of these before any script ran
  // (`window.__bootFetch`, see server/vite.ts); adopt them rather than asking twice.
  Object.entries(
    (typeof window === "undefined"
      ? undefined
      : (window as unknown as { __bootFetch?: Record<string, Promise<Response | undefined>> })
          .__bootFetch) ?? {}
  )
);

/** Start `paths` (same-origin API GETs, cookie session) now. A failed request is simply dropped. */
export function startBootFetch(paths: readonly string[]): void {
  for (const path of paths) {
    const url = apiUrl(path);
    if (started.has(url)) continue;
    started.set(
      url,
      fetch(url, { credentials: "include", headers: {} }).catch(() => undefined)
    );
  }
}

/** The pre-started response for `url` (once), or undefined when none was started or it failed. */
export async function takeBootFetch(url: string): Promise<Response | undefined> {
  const pending = started.get(url);
  if (!pending) return undefined;
  started.delete(url);
  return pending;
}
