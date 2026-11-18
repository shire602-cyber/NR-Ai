/**
 * D2 (N8): the chart of accounts disables "Set parent" exactly where the server refuses it: on a
 * sub-account that is a control account only through a control parent.
 */
import { describe, expect, it } from "vitest";
import { parentLocked } from "../../client/src/lib/account-hierarchy";

const acc = (
  id: string,
  code: string,
  parentId: string | null = null,
  extra: Record<string, unknown> = {}
) => ({ id, code, nameEn: code, type: "asset", parentId, ...extra });

describe("D2 N8 parentLocked", () => {
  const all = [
    acc("ar", "1040"),
    acc("sub", "1041", "ar"),
    acc("subsub", "1041.1", "sub"),
    acc("hdr", "1000"),
    acc("cash", "1020", "hdr"),
    acc("vat", "1055", null, { isVatAccount: true, vatType: "input" }),
    acc("vatsub", "1056", "vat"),
  ];
  const byId = (id: string) => all.find((a) => a.id === id)!;

  it("[N8] locks the parent of a control sub-account (at any depth)", () => {
    expect(parentLocked(byId("sub"), all)).toBe(true);
    expect(parentLocked(byId("subsub"), all)).toBe(true);
    expect(parentLocked(byId("vatsub"), all)).toBe(true);
  });

  it("[N8] leaves control accounts themselves and plain accounts free to group", () => {
    expect(parentLocked(byId("ar"), all)).toBe(false);
    expect(parentLocked(byId("vat"), all)).toBe(false);
    expect(parentLocked(byId("cash"), all)).toBe(false);
  });
});
