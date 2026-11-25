import { describe, expect, it } from "vitest";
import { matchesAssetSearch } from "../../client/src/lib/fixed-asset-search";

const van = {
  asset_name: "Delivery Van",
  asset_name_ar: "شاحنة توصيل",
  asset_number: "FA-0007",
  serial_number: null,
  category: "Vehicles",
  location: "Dubai warehouse",
};

describe("matchesAssetSearch", () => {
  it("ignores surrounding whitespace and case", () => {
    expect(matchesAssetSearch(van, "  delivery  ")).toBe(true);
  });
  it("matches the Arabic category label the reader sees", () => {
    expect(matchesAssetSearch(van, "المركبات", "المركبات")).toBe(true);
    expect(matchesAssetSearch(van, "المركبات")).toBe(false);
  });
  it("matches Arabic name, number and location", () => {
    expect(matchesAssetSearch(van, "شاحنة")).toBe(true);
    expect(matchesAssetSearch(van, "fa-0007")).toBe(true);
    expect(matchesAssetSearch(van, "warehouse")).toBe(true);
  });
  it("blank query matches everything; unrelated text matches nothing", () => {
    expect(matchesAssetSearch(van, "   ")).toBe(true);
    expect(matchesAssetSearch(van, "zzz")).toBe(false);
  });
});
