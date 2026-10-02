import { describe, expect, it } from "vitest";
import { MAX_EDGE, SKIP_BELOW_BYTES, jpegName, shouldDownscale, targetSize } from "./image-downscale";

describe("targetSize", () => {
  it("caps the long edge at 2000 and keeps the aspect ratio", () => {
    expect(targetSize(4032, 3024)).toEqual({ width: 2000, height: 1500 });
    expect(targetSize(3024, 4032)).toEqual({ width: 1500, height: 2000 });
  });
  it("never enlarges", () => {
    expect(targetSize(1200, 800)).toEqual({ width: 1200, height: 800 });
    expect(targetSize(MAX_EDGE, MAX_EDGE)).toEqual({ width: MAX_EDGE, height: MAX_EDGE });
  });
  it("keeps at least one pixel on extreme ratios and survives bad input", () => {
    expect(targetSize(40000, 1)).toEqual({ width: 2000, height: 1 });
    expect(targetSize(0, 100)).toEqual({ width: 1, height: 1 });
    expect(targetSize(Number.NaN, 100)).toEqual({ width: 1, height: 1 });
  });
  it("honours a custom limit", () => {
    expect(targetSize(1000, 500, 500)).toEqual({ width: 500, height: 250 });
  });
});

describe("shouldDownscale", () => {
  it("re-encodes big photos", () => {
    expect(shouldDownscale({ type: "image/jpeg", size: 5_000_000 }, 4032, 3024)).toBe(true);
  });
  it("leaves small, already-fitting images alone", () => {
    expect(shouldDownscale({ type: "image/jpeg", size: SKIP_BELOW_BYTES - 1 }, 1200, 900)).toBe(false);
  });
  it("re-encodes a heavy image even if its pixels fit", () => {
    expect(shouldDownscale({ type: "image/png", size: 4_000_000 }, 1800, 1800)).toBe(true);
  });
  it("never touches PDFs or formats it cannot decode", () => {
    expect(shouldDownscale({ type: "application/pdf", size: 9_000_000 }, 0, 0)).toBe(false);
    expect(shouldDownscale({ type: "image/heic", size: 9_000_000 }, 4000, 3000)).toBe(false);
  });
});

describe("jpegName", () => {
  it("swaps the extension", () => {
    expect(jpegName("IMG_0042.PNG")).toBe("IMG_0042.jpg");
    expect(jpegName("a.b.webp")).toBe("a.b.jpg");
    expect(jpegName("noext")).toBe("noext.jpg");
    expect(jpegName(".png")).toBe("photo.jpg");
  });
});
