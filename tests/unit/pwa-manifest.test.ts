import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const publicDir = join(process.cwd(), "client", "public");
const manifest = JSON.parse(readFileSync(join(publicDir, "manifest.json"), "utf8"));

function pngSize(file: string): { width: number; height: number } {
  const buf = readFileSync(file);
  // PNG signature (8 bytes) + IHDR length/type (8 bytes) then width/height as uint32 BE
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("PWA manifest", () => {
  it("references only icon files that exist on disk", () => {
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      const file = join(publicDir, icon.src.replace(/^\//, ""));
      expect(existsSync(file), `${icon.src} is missing from client/public`).toBe(true);
    }
  });

  it("declares the real pixel size of every icon", () => {
    for (const icon of manifest.icons) {
      const { width, height } = pngSize(join(publicDir, icon.src.replace(/^\//, "")));
      expect(icon.sizes, icon.src).toBe(`${width}x${height}`);
      expect(icon.type).toBe("image/png");
    }
  });

  it("offers the 192 and 512 icons Chrome requires for installability", () => {
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  it("is bilingual-safe: English default language with automatic direction", () => {
    expect(manifest.lang).toBe("en");
    expect(manifest.dir).toBe("auto");
  });

  it("only claims a maskable purpose separately from 'any'", () => {
    for (const icon of manifest.icons) {
      // Combined "any maskable" makes launchers crop non-padded artwork.
      expect(icon.purpose ?? "any").not.toBe("any maskable");
    }
  });

  it("index.html and the service worker only reference existing icons", () => {
    const sources = [
      readFileSync(join(process.cwd(), "client", "index.html"), "utf8"),
      readFileSync(join(publicDir, "sw.js"), "utf8"),
    ].join("\n");
    for (const m of sources.matchAll(/["'](\/[A-Za-z0-9_\-/]*(?:icon|favicon)[A-Za-z0-9_\-]*\.png)["']/g)) {
      expect(existsSync(join(publicDir, m[1].replace(/^\//, ""))), `${m[1]} missing`).toBe(true);
    }
  });
});
