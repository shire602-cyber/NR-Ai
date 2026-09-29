import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error - plain .mjs script
import { transform } from "../../scripts/rtl-codemod.mjs";

// Every screen that has been migrated to a per-page message table (`Foo.i18n.ts`) must also
// use logical Tailwind utilities (ms-/me-/ps-/pe-/text-start/...), so it mirrors in Arabic.
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const translated = walk(join(process.cwd(), "client", "src"))
  .filter((p) => p.endsWith(".i18n.ts"))
  .map((p) => p.replace(/\.i18n\.ts$/, ".tsx"));

describe("translated screens use logical direction utilities", () => {
  it("finds translated screens", () => {
    expect(translated.length).toBeGreaterThan(0);
  });
  it.each(translated)("%s", (file) => {
    const { changes } = transform(readFileSync(file, "utf8"), file);
    expect(changes, `${file}: run \`node scripts/rtl-codemod.mjs ${file}\``).toBe(0);
  });
});
