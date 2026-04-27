import { apiUrl } from "./api";

let cachedToken: string | null = null;
let inflight: Promise<string> | null = null;

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isStateChangingMethod(method: string): boolean {
  return STATE_CHANGING.has(method.toUpperCase());
}

async function fetchCsrfToken(): Promise<string> {
  const res = await fetch(apiUrl("/api/csrf-token"), {
    method: "GET",
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch CSRF token: ${res.status}`);
  }
  const json = await res.json();
  return json.csrfToken as string;
}

export async function getCsrfToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  if (inflight) return inflight;
  inflight = fetchCsrfToken()
    .then((tok) => {
      cachedToken = tok;
      return tok;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function clearCsrfToken(): void {
  cachedToken = null;
}

export async function withCsrfHeader(
  method: string,
  headers: Record<string, string>,
): Promise<Record<string, string>> {
  if (!isStateChangingMethod(method)) return headers;
  const token = await getCsrfToken();
  return { ...headers, "x-csrf-token": token };
}
