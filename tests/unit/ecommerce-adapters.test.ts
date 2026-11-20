/**
 * W5-B (R19-03, R19-09, R19-14): pure parts of the e-commerce adapters and the
 * OAuth contract of the accounting / POS connector skeletons (mocked HTTP).
 */
import { afterEach, describe, expect, it } from "vitest";
import { normaliseShopDomain } from "../../server/services/ecommerce/shopify";
import { minorToMajor } from "../../server/services/ecommerce/stripe-payouts";
import { setEcommerceHttpClient } from "../../server/services/ecommerce/http";
import {
  ConnectorNotConfiguredError,
  buildAuthorizeUrl,
  connectorStatuses,
  exchangeAuthorizationCode,
  refreshAccessToken,
} from "../../server/services/connectors/oauth";

afterEach(() => setEcommerceHttpClient(null));

const XERO_ENV = {
  XERO_CLIENT_ID: "cid",
  XERO_CLIENT_SECRET: "csecret",
  XERO_REDIRECT_URI: "https://app.example.com/oauth/xero",
};

describe("W5-B e-commerce adapters", () => {
  it("[R19-03] shop domains are normalised to *.myshopify.com and anything else is refused", () => {
    expect(normaliseShopDomain("oud-house")).toBe("oud-house.myshopify.com");
    expect(normaliseShopDomain("https://Oud-House.myshopify.com/admin")).toBe(
      "oud-house.myshopify.com"
    );
    expect(normaliseShopDomain("evil.example.com")).toBeNull();
    expect(normaliseShopDomain("169.254.169.254")).toBeNull();
  });

  it("[R19-14] Stripe minor units convert exactly (zero-decimal currencies untouched)", () => {
    expect(minorToMajor(10500, "aed")).toBe("105.00");
    expect(minorToMajor(-336, "AED")).toBe("-3.36");
    expect(minorToMajor(1, "aed")).toBe("0.01");
    expect(minorToMajor(500, "JPY")).toBe("500");
  });
});

describe("W5-B accounting / POS connectors (OAuth skeletons)", () => {
  it("[R19-09] every connector reports requires_external until its app is registered — never live", () => {
    const statuses = connectorStatuses({});
    expect(statuses.map((s) => s.id).sort()).toEqual([
      "foodics",
      "quickbooks",
      "salla",
      "xero",
      "zoho_books",
    ]);
    expect(statuses.every((s) => s.status === "requires_external")).toBe(true);
    expect(connectorStatuses(XERO_ENV).find((s) => s.id === "xero")!.status).toBe("sandbox");
    expect(() => buildAuthorizeUrl("xero", {})).toThrow(ConnectorNotConfiguredError);
  });

  it("[R19-14] authorize URL and code / refresh exchange follow the OAuth 2.0 contract", async () => {
    const { url, state } = buildAuthorizeUrl("xero", XERO_ENV);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://login.xero.com/identity/connect/authorize");
    expect(u.searchParams.get("client_id")).toBe("cid");
    expect(u.searchParams.get("redirect_uri")).toBe(XERO_ENV.XERO_REDIRECT_URI);
    expect(u.searchParams.get("state")).toBe(state);
    expect(u.searchParams.get("scope")).toContain("offline_access");

    const seen: Array<{ url: string; body: string; auth: string }> = [];
    setEcommerceHttpClient(async (reqUrl, init) => {
      seen.push({ url: reqUrl, body: init.body ?? "", auth: init.headers.Authorization });
      return {
        status: 200,
        headers: {},
        body: { access_token: "at", refresh_token: "rt", expires_in: 1800 },
      };
    });
    const tokens = await exchangeAuthorizationCode("xero", "code123", XERO_ENV);
    expect(tokens).toMatchObject({ accessToken: "at", refreshToken: "rt" });
    expect(seen[0].url).toBe("https://identity.xero.com/connect/token");
    expect(new URLSearchParams(seen[0].body).get("grant_type")).toBe("authorization_code");
    expect(new URLSearchParams(seen[0].body).get("code")).toBe("code123");
    expect(seen[0].auth).toBe(`Basic ${Buffer.from("cid:csecret").toString("base64")}`);
    await refreshAccessToken("xero", "rt", XERO_ENV);
    expect(new URLSearchParams(seen[1].body).get("grant_type")).toBe("refresh_token");

    setEcommerceHttpClient(async () => ({
      status: 400,
      headers: {},
      body: { error: "invalid_grant" },
    }));
    await expect(exchangeAuthorizationCode("xero", "bad", XERO_ENV)).rejects.toThrow(/HTTP 400/);
  });
});
