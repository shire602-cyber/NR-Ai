import { describe, expect, it } from "vitest";
import { ALL_SCOPES as SERVER_SCOPES } from "../../../server/api-v1/keys";
import {
  ALL_SCOPES,
  SCOPE_PRESETS,
  buildCreateKeyBody,
  matchingPreset,
  toggleScope,
  validateKeyForm,
} from "./api-scopes";

describe("scope catalogue", () => {
  it("is identical to the server's list", () => {
    expect([...ALL_SCOPES].sort()).toEqual([...SERVER_SCOPES].sort());
  });
});

describe("toggleScope", () => {
  it("granting write also grants read", () => {
    expect(toggleScope([], "write:invoices", true)).toEqual(["read:invoices", "write:invoices"]);
  });
  it("revoking read also revokes write", () => {
    expect(toggleScope(["read:invoices", "write:invoices", "read:items"], "read:invoices", false)).toEqual(["read:items"]);
  });
  it("revoking write keeps read", () => {
    expect(toggleScope(["read:invoices", "write:invoices"], "write:invoices", false)).toEqual(["read:invoices"]);
  });
  it("does not mutate its input and keeps catalogue order", () => {
    const input = ["read:items"];
    const out = toggleScope(input, "read:contacts", true);
    expect(input).toEqual(["read:items"]);
    expect(out).toEqual(["read:contacts", "read:items"]);
  });
});

describe("presets", () => {
  it("recognises an exact preset", () => {
    expect(matchingPreset([...SCOPE_PRESETS.readOnly])).toBe("readOnly");
    expect(matchingPreset([...ALL_SCOPES])).toBe("fullAccess");
    expect(matchingPreset(["read:items"])).toBeNull();
  });
  it("read-only grants no write scope", () => {
    expect(SCOPE_PRESETS.readOnly.some((s) => s.startsWith("write:"))).toBe(false);
  });
});

describe("key form", () => {
  const ok = { name: "ERP sync", scopes: ["read:invoices"], expiresInDays: 90, ratePerMinute: 60, ratePerDay: 5000 };
  it("accepts a valid form", () => {
    expect(validateKeyForm(ok)).toEqual([]);
  });
  it("flags every problem", () => {
    expect(validateKeyForm({ name: " ", scopes: [], expiresInDays: 0, ratePerMinute: 601, ratePerDay: 0 })).toEqual(["name", "scopes", "perMinute", "perDay"]);
    expect(validateKeyForm({ ...ok, ratePerMinute: 1.5 })).toEqual(["perMinute"]);
  });
  it("omits expiry for never", () => {
    expect(buildCreateKeyBody({ ...ok, expiresInDays: 0 })).not.toHaveProperty("expiresInDays");
    expect(buildCreateKeyBody(ok).expiresInDays).toBe(90);
    expect(buildCreateKeyBody({ ...ok, name: "  trimmed " }).name).toBe("trimmed");
  });
});
