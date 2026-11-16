// The Arabic crawl's --all mode (tests/e2e/arabic-runtime-crawl.mjs) visits every authenticated
// route in client/src/App.tsx. This pins its route lists to the router so a new route cannot
// ship unvisited. Source inspection is intentional: the route table is declarative JSX that
// cannot be enumerated without mounting the whole app.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error - plain .mjs module without type declarations
import * as launch from "../e2e/launch-routes.mjs";

const appSource = readFileSync("client/src/App.tsx", "utf8");
const appRoutes = [...appSource.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]);

describe("arabic crawl --all route coverage", () => {
  it("covers every App.tsx route (visited, param-resolved, public or deliberately skipped)", () => {
    const covered = new Set<string>([
      ...launch.ALL_AUTH_ROUTES,
      ...launch.ADMIN_ROUTES,
      ...launch.FIRM_ROUTES,
      ...Object.keys(launch.PARAM_ROUTES),
      ...launch.ALL_CRAWL_SKIPPED,
      ...launch.PUBLIC_ROUTES.map((route: string) => route.split("?")[0]),
      "/pricing",
      "/trust",
      "/help",
      "/migration-guides",
      "/services",
      "/demo",
      "/privacy",
      "/terms",
      "/cookies",
      "/login",
      "/register",
      "/forgot-password",
      "/reset-password",
    ]);
    const missing = appRoutes.filter((route) => !covered.has(route));
    expect(missing).toEqual([]);
  });

  it("lists no route the router does not define", () => {
    const known = new Set(appRoutes);
    const stale = [
      ...launch.ALL_AUTH_ROUTES,
      ...launch.ADMIN_ROUTES,
      ...launch.FIRM_ROUTES,
      ...Object.keys(launch.PARAM_ROUTES),
    ].filter((route: string) => route !== "/onboarding" && !known.has(route));
    expect(stale).toEqual([]);
  });
});
