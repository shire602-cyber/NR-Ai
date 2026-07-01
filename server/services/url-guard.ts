/**
 * SSRF protection for user-supplied outbound URLs (webhook endpoints).
 *
 * Policy:
 * - Only http/https. HTTPS is required in production.
 * - No credentials (user:pass@) in the URL.
 * - The hostname must not resolve to loopback, private, link-local,
 *   carrier-grade NAT, multicast, reserved, or documentation ranges
 *   (IPv4 and IPv6, including IPv4-mapped IPv6 and NAT64).
 * - DNS is re-resolved at dispatch time (not just at registration) so a
 *   record that later flips to an internal address is still rejected.
 * - Redirects are never followed (a redirect response is returned as-is),
 *   which closes the redirect-to-internal-host bypass.
 * - Response bodies are read with a hard byte cap.
 *
 * Escape hatch: WEBHOOK_ALLOW_PRIVATE_URLS=true disables the IP range checks
 * (self-hosted installs / local development against a local receiver).
 */
import dns from "node:dns/promises";
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

export type UrlGuardResult = { ok: true; url: URL } | { ok: false; reason: string };

/**
 * Validate a user-supplied outbound URL. Resolves DNS and checks every
 * returned address, so call it again immediately before dispatch — not only
 * at registration time.
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

  if (PRIVATE_URLS_ALLOWED()) {
    return { ok: true, url };
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets

  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      return { ok: false, reason: "URL resolves to a disallowed address" };
    }
    return { ok: true, url };
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    return { ok: false, reason: "Hostname could not be resolved" };
  }
  if (addresses.length === 0) {
    return { ok: false, reason: "Hostname could not be resolved" };
  }
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      return { ok: false, reason: "URL resolves to a disallowed address" };
    }
  }
  return { ok: true, url };
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

export class OutboundUrlBlockedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "OutboundUrlBlockedError";
  }
}

async function readBodyCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.byteLength;
    if (total >= maxBytes) {
      chunks.push(chunk.subarray(0, chunk.byteLength - (total - maxBytes)));
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Fetch a user-supplied URL with SSRF checks applied at call time.
 * Never follows redirects; caps the response body; enforces a timeout.
 * Throws OutboundUrlBlockedError when the URL fails validation.
 */
export async function safeOutboundFetch(
  rawUrl: string,
  init: RequestInit,
  opts: { timeoutMs?: number; maxBodyBytes?: number } = {}
): Promise<{ status: number; ok: boolean; bodyText: string }> {
  const verdict = await validateOutboundUrl(rawUrl);
  if (!verdict.ok) {
    throw new OutboundUrlBlockedError(verdict.reason);
  }

  const response = await fetch(verdict.url, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  const bodyText = await readBodyCapped(
    response,
    opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  ).catch(() => "");

  return { status: response.status, ok: response.ok, bodyText };
}
