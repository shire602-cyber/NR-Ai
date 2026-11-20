/**
 * Injectable HTTP client for the e-commerce adapters. Production uses fetch
 * with a timeout against fixed platform hosts; tests replace it with recorded
 * API-shaped fixtures (setEcommerceHttpClient).
 */
export interface EcommerceHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export type EcommerceHttpClient = (
  url: string,
  init: { method?: "GET" | "POST"; headers: Record<string, string>; body?: string }
) => Promise<EcommerceHttpResponse>;

/** Thrown when the platform cannot be reached (DNS, TLS, timeout, egress blocked). */
export class PlatformUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformUnreachableError";
  }
}

const defaultClient: EcommerceHttpClient = async (url, init) => {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "GET",
      headers: init.headers,
      body: init.body,
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new PlatformUnreachableError((err as Error).message || "network error");
  }
  const text = await res.text().catch(() => "");
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
  return { status: res.status, headers, body };
};

let client: EcommerceHttpClient = defaultClient;

export function ecommerceHttp(): EcommerceHttpClient {
  return client;
}

/** Tests only. Pass null to restore the real client. */
export function setEcommerceHttpClient(c: EcommerceHttpClient | null): void {
  client = c ?? defaultClient;
}
