import { describe, it, expect } from "vitest";
import { computeDeviceHash, networkPrefix, parseUserAgent } from "../../server/services/sessions";

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CHROME_MAC_121 = CHROME_MAC.replace("120.0.0.0", "121.0.0.0");
const FIREFOX_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0";

describe("parseUserAgent", () => {
  it("reads browser major and OS", () => {
    expect(parseUserAgent(CHROME_MAC)).toEqual({ browser: "chrome120", os: "macos" });
    expect(parseUserAgent(FIREFOX_WIN)).toEqual({ browser: "firefox121", os: "windows" });
    expect(parseUserAgent(undefined)).toEqual({ browser: "other", os: "other" });
  });
});

describe("networkPrefix", () => {
  it("collapses IPv4 to /24", () => {
    expect(networkPrefix("203.0.113.77")).toBe("203.0.113.0/24");
    expect(networkPrefix("::ffff:203.0.113.5")).toBe("203.0.113.0/24");
  });
  it("collapses IPv6 to /48", () => {
    expect(networkPrefix("2001:db8:abcd:12::1")).toBe("2001:db8:abcd::/48");
    expect(networkPrefix("2001:0db8:abcd:0012:0000:0000:0000:0001")).toBe("2001:db8:abcd::/48");
  });
  it("handles unknowns", () => {
    expect(networkPrefix(undefined)).toBe("unknown");
    expect(networkPrefix("nonsense")).toBe("unknown");
  });
});

describe("computeDeviceHash", () => {
  it("is stable within a /24 and the same browser major", () => {
    expect(computeDeviceHash("u1", CHROME_MAC, "203.0.113.5")).toBe(computeDeviceHash("u1", CHROME_MAC, "203.0.113.200"));
  });
  it("changes with the user, browser, OS or network", () => {
    const base = computeDeviceHash("u1", CHROME_MAC, "203.0.113.5");
    expect(computeDeviceHash("u2", CHROME_MAC, "203.0.113.5")).not.toBe(base);
    expect(computeDeviceHash("u1", CHROME_MAC_121, "203.0.113.5")).not.toBe(base);
    expect(computeDeviceHash("u1", FIREFOX_WIN, "203.0.113.5")).not.toBe(base);
    expect(computeDeviceHash("u1", CHROME_MAC, "198.51.100.5")).not.toBe(base);
  });
});
