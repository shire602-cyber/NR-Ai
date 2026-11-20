/**
 * SSRF protection for user-supplied outbound URLs (webhook endpoints).
 *
 * Policy:
 * - Only http/https. HTTPS is required in production.
 * - No credentials (user:pass@) in the URL.
 * - The hostname must not resolve to loopback, private, link-local,
 *   carrier-grade NAT, multicast, reserved, or documentation ranges
 *   (IPv4 and IPv6, including IPv4-mapped IPv6 and NAT64).
 * - DNS is resolved at dispatch time (not just at registration), ONCE per
 *   hop, and the connection is pinned to the validated IP (R17-15).
 * - Redirects are not followed unless asked; each followed hop is re-validated
 *   and re-pinned, which closes the redirect-to-internal-host bypass.
 * - Response bodies are read with a hard byte cap.
 *
 * Escape hatch: WEBHOOK_ALLOW_PRIVATE_URLS=true disables the IP range checks
 * (self-hosted installs / local development against a local receiver).
 */
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const PRIVATE_URLS_ALLOWED = () => process.env.WEBHOOK_ALLOW_PRIVATE_URLS === "true";
const IS_PRODUCTION = () => process.env.NODE_ENV === "production";

/** IPv4 CIDR blocklist expressed as [network, prefixLength]. */
const BLOCKED_IPV4: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local / cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function ipv4InCidr(ip: string, network: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(network) & mask);
}

function isBlockedIpv4(ip: string): boolean {
  return BLOCKED_IPV4.some(([network, prefix]) => ipv4InCidr(ip, network, prefix));
}

function isBlockedIpv6(rawIp: string): boolean {
  const ip = rawIp.toLowerCase();

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible forms — check embedded v4.
  const v4Match = ip.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4Match && (ip.startsWith("::ffff:") || ip.startsWith("::"))) {
    return isBlockedIpv4(v4Match[1]);
  }

  // IPv4-mapped in hex form (::ffff:7f00:1) — URL parsing normalizes the
  // dotted form to this, so it must map back to the embedded v4 address.
  const hexMapped = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isBlockedIpv4(v4);
  }

  if (ip === "::" || ip === "::1") return true; // unspecified / loopback
  if (/^f[cd]/.test(ip)) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(ip)) return true; // fe80::/10 link-local
  if (/^fe[cdf]/.test(ip)) return true; // fec0::/10 deprecated site-local
  if (/^ff/.test(ip)) return true; // ff00::/8 multicast
  if (ip.startsWith("2001:db8")) return true; // documentation
  if (ip.startsWith("64:ff9b")) return true; // NAT64 — may embed private v4
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family === 6) return isBlockedIpv6(ip);
  return true; // not an IP — caller should have resolved first
}

// ─── Resolution (one lookup per hop; injectable for tests) ─────────────────

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

const systemResolver: Resolver = async (hostname) => {
  const rows = await dns.lookup(hostname, { all: true, verbatim: true });
  return rows.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

let resolver: Resolver = systemResolver;
let blockedCheck: (ip: string) => boolean = isBlockedIp;

/** Tests only: replace DNS resolution and/or the address policy (null restores both). */
export function __setOutboundGuardForTests(
  overrides: { resolve?: Resolver; isBlocked?: (ip: string) => boolean } | null
): void {
  resolver = overrides?.resolve ?? systemResolver;
  blockedCheck = overrides?.isBlocked ?? isBlockedIp;
}

export type UrlGuardResult =
  | { ok: true; url: URL; addresses: ResolvedAddress[] }
  | { ok: false; reason: string };

/**
 * Validate a user-supplied outbound URL. Resolves DNS ONCE and checks every returned
 * address; the validated addresses are returned so the caller connects to exactly those
 * (safeOutboundFetch pins them), which closes the DNS-rebinding window (R17-15).
 */
export async function validateOutboundUrl(raw: string): Promise<UrlGuardResult> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "Only http(s) URLs are allowed" };
  }
  if (IS_PRODUCTION() && url.protocol !== "https:" && !PRIVATE_URLS_ALLOWED()) {
    return { ok: false, reason: "Webhook URLs must use HTTPS" };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "URLs must not contain credentials" };
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  const literal = net.isIP(hostname);
  if (literal) {
    if (!PRIVATE_URLS_ALLOWED() && blockedCheck(hostname)) {
      return { ok: false, reason: "URL resolves to a disallowed address" };
    }
    return { ok: true, url, addresses: [{ address: hostname, family: literal === 6 ? 6 : 4 }] };
  }

  let addresses: ResolvedAddress[];
  try {
    addresses = await resolver(hostname);
  } catch {
    return { ok: false, reason: "Hostname could not be resolved" };
  }
  if (addresses.length === 0) {
    return { ok: false, reason: "Hostname could not be resolved" };
  }
  if (!PRIVATE_URLS_ALLOWED()) {
    for (const { address } of addresses) {
      if (blockedCheck(address)) {
        return { ok: false, reason: "URL resolves to a disallowed address" };
      }
    }
  }
  return { ok: true, url, addresses };
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const MAX_REDIRECTS_CAP = 5;

export class OutboundUrlBlockedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "OutboundUrlBlockedError";
  }
}

/** A `lookup` that always answers with the pre-validated address (no second DNS query). */
export function pinnedLookup(pinned: ResolvedAddress): net.LookupFunction {
  return ((_hostname: string, options: unknown, callback?: unknown) => {
    const cb = (typeof options === "function" ? options : callback) as (
      err: NodeJS.ErrnoException | null,
      address: string | Array<{ address: string; family: number }>,
      family?: number
    ) => void;
    const wantsAll =
      typeof options === "object" && options !== null && (options as { all?: boolean }).all;
    if (wantsAll) cb(null, [{ address: pinned.address, family: pinned.family }]);
    else cb(null, pinned.address, pinned.family);
  }) as net.LookupFunction;
}

interface HopResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  bodyText: string;
}

function headersToObject(init: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(init ?? {}).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function bodyToBuffer(body: RequestInit["body"]): Buffer | null {
  if (body === undefined || body === null) return null;
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString(), "utf8");
  throw new TypeError("safeOutboundFetch supports string, Buffer or URLSearchParams bodies");
}

/** One request to a validated URL, connected to the pinned IP with Host/SNI preserved. */
function requestPinned(
  url: URL,
  pinned: ResolvedAddress,
  method: string,
  headers: Record<string, string>,
  body: Buffer | null,
  timeoutMs: number,
  maxBodyBytes: number
): Promise<HopResult> {
  const isHttps = url.protocol === "https:";
  const lib = isHttps ? https : http;
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  return new Promise<HopResult>((resolve, reject) => {
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method,
        headers: { ...headers, ...(body ? { "content-length": String(body.length) } : {}) },
        lookup: pinnedLookup(pinned),
        // SNI and certificate checks use the real hostname, never the IP.
        ...(isHttps && !net.isIP(hostname) ? { servername: hostname } : {}),
        agent: false,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            bodyText: Buffer.concat(chunks).toString("utf8"),
          });
        };
        res.on("data", (chunk: Buffer) => {
          if (done) return;
          total += chunk.length;
          if (total >= maxBodyBytes) {
            chunks.push(chunk.subarray(0, chunk.length - (total - maxBodyBytes)));
            finish();
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", finish);
        res.on("error", () => finish());
      }
    );
    const timer = setTimeout(() => req.destroy(new Error("Outbound request timed out")), timeoutMs);
    req.on("timeout", () => req.destroy(new Error("Outbound request timed out")));
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.on("close", () => clearTimeout(timer));
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Fetch a user-supplied URL with SSRF checks applied at call time.
 *
 * - DNS is resolved once per hop; every address is validated and the connection is made
 *   to the first validated address (pinned lookup), so a resolver that answers
 *   differently on a second query (DNS rebinding) cannot redirect the connection.
 * - Redirects are not followed by default (the 3xx is returned as-is). With
 *   `maxRedirects` > 0 each hop's Location is validated and pinned again; 303 and
 *   301/302 on POST switch to a body-less GET.
 * - Response bodies are capped; a timeout applies per hop.
 * Throws OutboundUrlBlockedError when any hop fails validation.
 */
export async function safeOutboundFetch(
  rawUrl: string,
  init: RequestInit,
  opts: { timeoutMs?: number; maxBodyBytes?: number; maxRedirects?: number } = {}
): Promise<{ status: number; ok: boolean; bodyText: string; finalUrl: string; hops: number }> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const maxRedirects = Math.min(Math.max(opts.maxRedirects ?? 0, 0), MAX_REDIRECTS_CAP);
  let method = (init.method ?? "GET").toUpperCase();
  const headers = headersToObject(init.headers);
  let body = bodyToBuffer(init.body);
  let current = rawUrl;

  for (let hop = 0; ; hop++) {
    const verdict = await validateOutboundUrl(current);
    if (!verdict.ok) throw new OutboundUrlBlockedError(verdict.reason);
    const result = await requestPinned(
      verdict.url,
      verdict.addresses[0],
      method,
      headers,
      body,
      timeoutMs,
      maxBodyBytes
    );
    const location = result.headers.location;
    const isRedirect = result.status >= 300 && result.status < 400 && !!location;
    if (!isRedirect || hop >= maxRedirects) {
      return {
        status: result.status,
        ok: result.status >= 200 && result.status < 300,
        bodyText: result.bodyText,
        finalUrl: verdict.url.toString(),
        hops: hop,
      };
    }
    const next = new URL(String(location), verdict.url);
    if (next.origin !== verdict.url.origin) {
      // Never forward credentials-bearing headers to another origin.
      delete headers.authorization;
      delete headers.cookie;
    }
    if (
      result.status === 303 ||
      ((result.status === 301 || result.status === 302) && method === "POST")
    ) {
      method = "GET";
      body = null;
      delete headers["content-type"];
    }
    current = next.toString();
  }
}
