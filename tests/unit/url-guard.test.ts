/**
 * SSRF guard for user-supplied outbound URLs (services/url-guard.ts).
 *
 * Webhook endpoints are attacker-controllable URLs the server fetches, so the
 * guard must reject loopback/private/link-local/metadata targets — as IP
 * literals, via DNS, in IPv6 forms, and via IPv4-mapped IPv6 — while allowing
 * ordinary public HTTPS endpoints.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isBlockedIp, validateOutboundUrl } from "../../server/services/url-guard";

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  WEBHOOK_ALLOW_PRIVATE_URLS: process.env.WEBHOOK_ALLOW_PRIVATE_URLS,
};

beforeEach(() => {
  delete process.env.WEBHOOK_ALLOW_PRIVATE_URLS;
});

afterEach(() => {
  if (originalEnv.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalEnv.NODE_ENV;
  if (originalEnv.WEBHOOK_ALLOW_PRIVATE_URLS === undefined)
    delete process.env.WEBHOOK_ALLOW_PRIVATE_URLS;
  else process.env.WEBHOOK_ALLOW_PRIVATE_URLS = originalEnv.WEBHOOK_ALLOW_PRIVATE_URLS;
});

describe("isBlockedIp", () => {
  it("blocks loopback, private, link-local, CGNAT, and reserved IPv4", () => {
    for (const ip of [
      "127.0.0.1",
      "127.255.255.254",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "100.64.1.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "198.18.0.1",
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("allows ordinary public IPv4", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "52.95.110.1", "172.15.0.1", "172.32.0.1"]) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });

  it("blocks IPv6 loopback, unique-local, link-local, multicast, and mapped-private", () => {
    for (const ip of [
      "::1",
      "::",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "ff02::1",
      "2001:db8::1",
      "64:ff9b::a00:1", // NAT64
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
      "::ffff:169.254.169.254",
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("allows public IPv6", () => {
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedIp("::ffff:8.8.8.8")).toBe(false);
  });
});

describe("validateOutboundUrl", () => {
  it("rejects malformed URLs and non-http(s) schemes", async () => {
    expect((await validateOutboundUrl("not a url")).ok).toBe(false);
    expect((await validateOutboundUrl("ftp://example.com/x")).ok).toBe(false);
    expect((await validateOutboundUrl("file:///etc/passwd")).ok).toBe(false);
    expect((await validateOutboundUrl("gopher://example.com")).ok).toBe(false);
  });

  it("rejects URLs with embedded credentials", async () => {
    const verdict = await validateOutboundUrl("https://user:pass@example.com/hook");
    expect(verdict.ok).toBe(false);
  });

  it("rejects IP-literal URLs pointing at internal targets", async () => {
    for (const url of [
      "https://127.0.0.1/hook",
      "https://10.0.0.5/hook",
      "https://192.168.1.10:8443/hook",
      "https://169.254.169.254/latest/meta-data/",
      "https://[::1]/hook",
      "https://[fd00::1]/hook",
      "https://[::ffff:127.0.0.1]/hook",
    ]) {
      const verdict = await validateOutboundUrl(url);
      expect(verdict.ok, url).toBe(false);
    }
  });

  it("rejects hostnames that resolve to loopback (localhost)", async () => {
    const verdict = await validateOutboundUrl("https://localhost/hook");
    expect(verdict.ok).toBe(false);
  });

  it("rejects unresolvable hostnames", async () => {
    const verdict = await validateOutboundUrl("https://definitely-not-a-real-host.invalid/hook");
    expect(verdict.ok).toBe(false);
  });

  it("requires HTTPS in production", async () => {
    process.env.NODE_ENV = "production";
    const verdict = await validateOutboundUrl("http://example.com/hook");
    expect(verdict.ok).toBe(false);
  });

  it("allows private targets when WEBHOOK_ALLOW_PRIVATE_URLS=true (self-hosted)", async () => {
    process.env.WEBHOOK_ALLOW_PRIVATE_URLS = "true";
    const verdict = await validateOutboundUrl("http://127.0.0.1:9999/hook");
    expect(verdict.ok).toBe(true);
  });
});
