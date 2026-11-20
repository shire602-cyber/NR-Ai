/**
 * INTEGRATE-F9: the exact payloads the client sends to the F9 strict-body routes must parse against
 * the strict schemas (an unknown key would be a 400).
 */
import { describe, expect, it } from "vitest";
import {
  adminCreateInvitationBody,
  adminImportClientsBody,
  adminImportPreviewBody,
  adminUpdateUserBody,
  upsertAdminSettingBody,
} from "../../shared/validators/admin";
import {
  aiGlCorrectBody,
  billingCheckoutBody,
  contactsClearBody,
  contactsImportBody,
  ocrProcessBody,
  onboardingPatchBody,
  sheetsCustomExportBody,
  sheetsExportBody,
  sheetsImportBody,
  whatsappLogMessageBody,
} from "../../shared/validators/route-bodies";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("client payloads vs F9 strict schemas", () => {
  it.each([
    ["admin settings", upsertAdminSettingBody, { key: "system.defaultCurrency", value: "AED" }],
    ["admin settings bool", upsertAdminSettingBody, { key: "k", value: "true" }],
    [
      "admin user patch",
      adminUpdateUserBody,
      { name: "A", email: "a@example.com", isAdmin: false },
    ],
    [
      "invitation",
      adminCreateInvitationBody,
      { email: "a@example.com", companyId: uuid, role: "client", userType: "customer" },
    ],
    [
      "invitation no company",
      adminCreateInvitationBody,
      { email: "a@example.com", role: "staff", userType: "client" },
    ],
    ["import preview", adminImportPreviewBody, { fileData: "AAAA", fileName: "x.xlsx" }],
    [
      "import clients",
      adminImportClientsBody,
      { data: [{ Name: "x", extra: 1 }], createInvitations: true },
    ],
    ["ai-gl correct", aiGlCorrectBody, { accountId: uuid }],
    ["billing", billingCheckoutBody, { planId: uuid, billingCycle: "yearly" }],
    ["contacts import", contactsImportBody, { contacts: [{ name: "x" }] }],
    ["contacts clear", contactsClearBody, { confirm: "DELETE ALL" }],
    ["ocr", ocrProcessBody, { imageData: "data:image/png;base64,AA", companyId: uuid }],
    ["onboarding", onboardingPatchBody, { tourDismissed: true }],
    ["sheets export", sheetsExportBody, { companyId: uuid }],
    ["sheets import", sheetsImportBody, { companyId: uuid, sheetUrl: "https://docs.google.com/x" }],
    [
      "sheets custom",
      sheetsCustomExportBody,
      { companyId: uuid, title: "T", sheets: [{ name: "S", headers: ["a"], rows: [["1"]] }] },
    ],
    ["whatsapp log", whatsappLogMessageBody, { to: "+971500000000", message: "hi" }],
  ])("%s", (_n, schema, payload) => {
    expect((schema as any).safeParse(payload).success).toBe(true);
  });
});
