// @vitest-environment jsdom
/**
 * CL-B: the signed-in "Change password" card in Settings -> Security. It validates the
 * policy rules locally, posts { currentPassword, newPassword } to the existing
 * /api/auth/change-password endpoint, shows the server's refusal, and speaks Arabic in ar.
 */
import { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  byTestId,
  flush,
  formHarnessQueryClientMock,
  renderPage,
  resetHarness,
  submit,
  type,
  unmountPage,
} from "./helpers/form-harness";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";

const securityFetch = vi.fn();

vi.mock("../../client/src/lib/queryClient", () => formHarnessQueryClientMock());
vi.mock("../../client/src/lib/securityApi", () => ({
  securityFetch: (...args: unknown[]) => securityFetch(...args),
  SecurityApiError: class SecurityApiError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly code: string | null
    ) {
      super(message);
    }
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});
beforeEach(() => {
  resetHarness();
  securityFetch.mockReset();
  useI18n.setState({ locale: "en" });
});
afterEach(async () => {
  await unmountPage();
  useI18n.setState({ locale: "en" });
});

async function fill(current: string, next: string, confirm: string) {
  await type(byTestId("input-current-password"), current);
  await type(byTestId("input-new-password"), next);
  await type(byTestId("input-confirm-new-password"), confirm);
  await submit(byTestId("button-change-password"));
}

const errorText = () => byTestId("change-password-error")?.textContent ?? "";

describe("[CL-B] Settings -> Security change password", () => {
  it("posts the current and new password to the existing endpoint and clears the form", async () => {
    securityFetch.mockResolvedValue({ message: "ok", token: "t" });
    const { ChangePasswordCard } =
      await import("../../client/src/pages/security/ChangePasswordCard");
    await renderPage(ChangePasswordCard);
    await fill("Old-Passw0rd!", "Brand9NewSecret!", "Brand9NewSecret!");
    expect(securityFetch).toHaveBeenCalledWith("POST", "/api/auth/change-password", {
      currentPassword: "Old-Passw0rd!",
      newPassword: "Brand9NewSecret!",
    });
    expect(errorText()).toBe("");
    expect((byTestId("input-current-password") as HTMLInputElement).value).toBe("");
    expect((byTestId("input-new-password") as HTMLInputElement).value).toBe("");
  });

  it("refuses weak, mismatched and unchanged passwords before any request", async () => {
    const { ChangePasswordCard } =
      await import("../../client/src/pages/security/ChangePasswordCard");
    await renderPage(ChangePasswordCard);
    await fill("Old-Passw0rd!", "short", "short");
    expect(errorText()).toMatch(/at least 8/i);
    await fill("Old-Passw0rd!", "alllowercase1", "alllowercase1");
    expect(errorText()).toMatch(/upper case/i);
    await fill("Old-Passw0rd!", "Brand9NewSecret!", "Different9Secret!");
    expect(errorText()).toMatch(/do not match/i);
    await fill("Old-Passw0rd!", "Old-Passw0rd!", "Old-Passw0rd!");
    expect(errorText()).toMatch(/different from the current/i);
    expect(securityFetch).not.toHaveBeenCalled();
  });

  it("shows the server's refusal for a wrong current password", async () => {
    const { SecurityApiError } = await import("../../client/src/lib/securityApi");
    securityFetch.mockRejectedValue(
      new SecurityApiError("Current password is incorrect", 400, "CURRENT_PASSWORD_INVALID")
    );
    const { ChangePasswordCard } =
      await import("../../client/src/pages/security/ChangePasswordCard");
    await renderPage(ChangePasswordCard);
    await fill("Wrong-Passw0rd!", "Brand9NewSecret!", "Brand9NewSecret!");
    expect(errorText()).toMatch(/current password is incorrect/i);
  });

  it("is fully Arabic in the Arabic UI", async () => {
    const { ChangePasswordCard } =
      await import("../../client/src/pages/security/ChangePasswordCard");
    await renderPage(ChangePasswordCard);
    await act(async () => useI18n.setState({ locale: "ar" }));
    await flush();
    const card = byTestId("card-change-password")!;
    expect(card.textContent).toMatch(/[؀-ۿ]/);
    expect(card.textContent).not.toMatch(/[A-Za-z]/);
    await fill("x", "short", "short");
    expect(errorText()).toMatch(/[؀-ۿ]/);
    expect(errorText()).not.toMatch(/[A-Za-z]/);
  });
});
