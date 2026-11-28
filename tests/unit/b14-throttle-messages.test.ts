// @vitest-environment jsdom
/**
 * B14 (Fable final review): rate-limit and lockout sentences were English in Arabic mode.
 * The server now names each sentence by catalog key (`messageKey`); the sign-in and reset
 * forms show that catalog entry in the reader's language.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { serverErrorMessage } from "../../client/src/lib/validation-messages";
import { limiterProfiles } from "../../server/middleware/rateLimit";

const catalog = (lang: "en" | "ar", ns: string) =>
  JSON.parse(readFileSync(`client/src/locales/${lang}/${ns}.json`, "utf8")) as Record<
    string,
    string
  >;

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

describe("B14 throttle messages", () => {
  it("every limiter messageKey exists in the English and Arabic catalogs", () => {
    const keys = Object.values(limiterProfiles)
      .map((p) => (p as { messageKey?: string }).messageKey)
      .filter((k): k is string => Boolean(k));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const ns = key.split(".")[0];
      expect(catalog("en", ns)[key], key).toBeTruthy();
      expect(catalog("ar", ns)[key], key).toMatch(/[؀-ۿ]/);
    }
  });

  it("auth throttle sentences live in a namespace public auth pages load", () => {
    // /login and /forgot-password load marketing, components and shell (+ a few extras),
    // never `forms`, so the auth keys must be `components.*`.
    for (const name of [
      "loginLocked",
      "codesLocked",
      "resetRequestsLimited",
      "resetAttemptsLocked",
      "failedAttemptsLocked",
      "linkRequestsLimited",
      "authRateLimited",
    ]) {
      expect(catalog("ar", "components")[`components.authErrors.${name}`]).toMatch(/[؀-ۿ]/);
    }
  });

  it("shows the named sentence in Arabic and English, and falls back to the server text", () => {
    const body = {
      message: "Too many reset requests for this email. Please wait before trying again.",
      code: "RATE_LIMITED",
      messageKey: "components.authErrors.resetRequestsLimited",
    };
    useI18n.setState({ locale: "ar" });
    const ar = serverErrorMessage(body, "fallback");
    expect(ar).toMatch(/[؀-ۿ]/);
    expect(ar).not.toMatch(/[A-Za-z]/);
    useI18n.setState({ locale: "en" });
    expect(serverErrorMessage(body, "fallback")).toMatch(/^Too many reset requests/);
    expect(serverErrorMessage({ message: "Plain server text" }, "fallback")).toBe(
      "Plain server text"
    );
    expect(serverErrorMessage(undefined, "fallback")).toBe("fallback");
  });
});
