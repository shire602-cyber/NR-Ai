import { apiUrl } from "@/lib/api";
import { withCsrfHeader } from "@/lib/csrf";
import { ApiError } from "@/lib/queryClient";

/**
 * POST to a public (no login) endpoint: quote accept / decline and Pay now. These are CSRF-protected, so the
 * double-submit cookie travels with the request (credentials: include) and the matching header is added.
 * A failed call throws an ApiError carrying the server's `code` so the page can explain it in the user's language.
 */
export async function publicPost<T = unknown>(path: string, body: unknown): Promise<T> {
  const headers = await withCsrfHeader("POST", { "Content-Type": "application/json" });
  const res = await fetch(apiUrl(path), { method: "POST", headers, credentials: "include", body: JSON.stringify(body ?? {}) });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const message = (json && (json.message || json.error)) || res.statusText || "Request failed";
    throw new ApiError(String(message), res.status, typeof json?.code === "string" ? json.code : undefined);
  }
  return json as T;
}

export async function publicGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path), { credentials: "include" });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const message = (json && (json.message || json.error)) || res.statusText || "Request failed";
    throw new ApiError(String(message), res.status, typeof json?.code === "string" ? json.code : undefined);
  }
  return json as T;
}
