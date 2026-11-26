import { describe, expect, it } from "vitest";

import {
  eInvoicePartner,
  appointmentGate,
  appointmentState,
} from "../../server/services/einvoice-appointment.service";

const env = {
  EINVOICE_PROVIDER: "complyance",
  EINVOICE_ASP_TERMS_URL: "https://partner.example/terms",
  EINVOICE_ASP_TERMS_VERSION: "2026-11",
} as NodeJS.ProcessEnv;

const partner = eInvoicePartner("complyance", env);
const accepted = {
  provider: "complyance",
  termsVersion: "2026-11",
  emarataxConfirmedAt: null as Date | null,
  revokedAt: null as Date | null,
};

describe("e-invoicing partner (reseller model)", () => {
  it("describes the active partner from env", () => {
    expect(partner).toMatchObject({
      provider: "complyance",
      displayName: "complyance",
      termsUrl: "https://partner.example/terms",
      termsVersion: "2026-11",
      requiresAppointment: true,
    });
    expect(eInvoicePartner(undefined, {} as NodeJS.ProcessEnv)).toMatchObject({
      provider: "mock",
      termsUrl: null,
      requiresAppointment: false,
    });
  });

  it("uses the resolved provider's terms even when the environment selects another partner", () => {
    expect(
      eInvoicePartner("acube", { ...env, EINVOICE_ASP_ACUBE_TERMS_VERSION: "acube-v1" })
    ).toMatchObject({
      provider: "acube",
      termsUrl: null,
      termsVersion: "acube-v1",
      requiresAppointment: true,
    });
  });

  it("walks not_started → awaiting_emaratax → active", () => {
    expect(appointmentState(null, partner)).toBe("not_started");
    expect(appointmentState(accepted, partner)).toBe("awaiting_emaratax");
    expect(appointmentState({ ...accepted, emarataxConfirmedAt: new Date() }, partner)).toBe(
      "active"
    );
  });

  it("asks for re-acceptance when the terms version changes, and blocks revoked or other-partner rows", () => {
    const active = { ...accepted, emarataxConfirmedAt: new Date() };
    expect(appointmentState({ ...active, termsVersion: "2026-01" }, partner)).toBe(
      "terms_outdated"
    );
    expect(appointmentState({ ...active, revokedAt: new Date() }, partner)).toBe("revoked");
    expect(appointmentState({ ...active, provider: "acube" }, partner)).toBe("not_started");
  });

  it("gates submission until the appointment is active", () => {
    expect(appointmentGate(null, partner)).toMatchObject({
      code: "EINVOICE_APPOINTMENT_REQUIRED",
      state: "not_started",
    });
    expect(appointmentGate(accepted, partner)?.state).toBe("awaiting_emaratax");
    expect(appointmentGate({ ...accepted, emarataxConfirmedAt: new Date() }, partner)).toBeNull();
  });

  it("does not gate the mock provider, which transmits nothing", () => {
    expect(appointmentGate(null, eInvoicePartner(undefined, {} as NodeJS.ProcessEnv))).toBeNull();
  });
});
