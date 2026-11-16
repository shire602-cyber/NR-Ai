// Source inspection is intentional: jsdom does not apply Tailwind/CSS, so physical-direction
// class usage and rtl.css rules can only be linted from source text; the runtime RTL behaviour is
// covered by client-behaviour.test.ts and the Playwright RTL crawl.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");

// Physical-direction utilities that must not appear in the shared shell: they
// do not mirror in dir="rtl". Use logical equivalents (ps/pe, ms/me, start/end,
// border-s/e, text-start/end) instead.
const PHYSICAL_CLASS =
  /(?<![\w:-])(?:-?(?:ml|mr|pl|pr|left|right)-[\w./[\]-]+|text-left|text-right|border-l(?:-\d)?|border-r(?:-\d)?|rounded-[lr](?:-\w+)?|rounded-t[lr]|rounded-b[lr]|-?translate-x-[\w/[\]-]+)(?![\w])/g;

const SHELL_FILES = [
  "client/src/components/layout/AppSidebar.tsx",
  "client/src/components/layout/PortalLayout.tsx",
  "client/src/components/layout/RouteGuard.tsx",
  "client/src/components/layout/TabbedHub.tsx",
  "client/src/components/MobileNav.tsx",
  "client/src/components/Onboarding.tsx",
  "client/src/components/SkipLink.tsx",
];

function classNameLines(source: string): string[] {
  return source.split("\n").filter((line) => /className|cn\(/.test(line));
}

describe("RTL shell layout", () => {
  it("R18-01: the sidebar follows the locale side and rtl.css does not flip it a second time", () => {
    const sidebar = read("client/src/components/layout/AppSidebar.tsx");
    const rtlCss = read("client/src/styles/rtl.css");

    // The shadcn sidebar anchors itself from its `side` prop.
    expect(sidebar).toContain('<Sidebar side={isRTL ? "right" : "left"}>');

    // The generic physical `.right-0 { left: 0 }` swap used to move the fixed
    // container back to the left edge; the exemption restores its own anchor.
    expect(rtlCss).toContain('[dir="rtl"] [data-slot="sidebar-container"].right-0');
    expect(rtlCss).toMatch(
      /\[dir="rtl"\] \[data-slot="sidebar-container"\]\.right-0 \{\s*right: 0;\s*left: auto;/
    );
  });

  it("R18-01: RTL no longer reserves a root scrollbar gutter that shrinks the sidebar's containing block", () => {
    const rtlCss = read("client/src/styles/rtl.css");
    expect(rtlCss).not.toMatch(/\[dir="rtl"\]\s*\{\s*scrollbar-gutter:\s*stable/);
    expect(rtlCss).toMatch(/\[dir="rtl"\]\s*\{\s*scrollbar-gutter:\s*auto/);
  });

  it("R18-11: Arabic text is not letter-spaced (it breaks cursive joining)", () => {
    const rtlCss = read("client/src/styles/rtl.css");
    expect(rtlCss).toMatch(/\[dir="rtl"\] \[class\*="tracking-"\]\s*\{\s*letter-spacing:\s*normal/);
  });

  it("R18-01: shell components use CSS logical properties instead of left/right utilities", () => {
    for (const file of SHELL_FILES) {
      const offenders = classNameLines(read(file)).flatMap(
        (line) => line.match(PHYSICAL_CLASS) ?? []
      );
      expect(offenders, `${file} uses physical direction classes`).toEqual([]);
    }
    // App.tsx owns the header/banner shell; check only its className lines.
    const appOffenders = classNameLines(read("client/src/App.tsx")).flatMap(
      (line) => line.match(PHYSICAL_CLASS) ?? []
    );
    expect(appOffenders).toEqual([]);
  });

  it("R18-01: directional arrows in the shell are mirrored in RTL", () => {
    expect(read("client/src/App.tsx")).toContain("rtl:rotate-180");
    expect(read("client/src/components/Onboarding.tsx")).toContain("rtl:rotate-180");
  });

  it("R18-01: the portal layout border and sign-out icon spacing are logical", () => {
    const portal = read("client/src/components/layout/PortalLayout.tsx");
    expect(portal).toContain("border-e");
    expect(portal).toContain("me-2");
    expect(portal).not.toMatch(/border-r\b/);
  });

  it("R13-36: RTLProvider keeps <html dir/lang> in sync with the locale and loads the Arabic fonts", () => {
    const provider = read("client/src/components/RTLProvider.tsx");
    expect(provider).toContain('html.dir = isRTL ? "rtl" : "ltr"');
    expect(provider).toContain("html.lang = locale");
    // D2: one Arabic face (Noto Sans Arabic) pairs with Geist; Cairo is no longer loaded.
    expect(provider).toContain("@fontsource/noto-sans-arabic");
    expect(provider).not.toContain("@fontsource/cairo");
  });

  it("R18-11: the Playwright RTL crawl asserts sidebar edge and content overlap on 20 pages", () => {
    const crawl = read("tests/e2e/a11y-crawl.mjs");
    expect(crawl).toContain('process.argv.includes("--rtl")');
    expect(crawl).toContain("layout.clientWidth - layout.sidebarWidth - 1");
    expect(crawl).toContain("rtl-main-overlaps-sidebar");
    // F7: the route list is shared with the Arabic runtime crawl (tests/e2e/launch-routes.mjs).
    expect(crawl).toContain("...LAUNCH_ROUTES");
    expect(crawl).toContain("workspace=${workspace}");
    const routes = read("tests/e2e/launch-routes.mjs");
    expect((routes.match(/^\s+"\//gm) ?? []).length).toBeGreaterThanOrEqual(20);
  });
});
