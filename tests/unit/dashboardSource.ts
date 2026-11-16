import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Dashboard page is a thin shell (client/src/pages/Dashboard.tsx) over
 * client/src/pages/dashboard/ (model hook + section components). Source-level
 * assertions read the shell and every dashboard/ module as one source.
 */
export function readDashboardSource(repoRoot = process.cwd(), withCatalogs = false): string {
  const pagesDir = join(repoRoot, "client", "src", "pages");
  const parts = [readFileSync(join(pagesDir, "Dashboard.tsx"), "utf8")];
  const dir = join(pagesDir, "dashboard");
  for (const name of readdirSync(dir).sort()) {
    if (/\.tsx?$/.test(name)) parts.push(readFileSync(join(dir, name), "utf8"));
  }
  // Copy moved into the en catalogs (S6a): text assertions can opt in to follow it.
  if (!withCatalogs) return parts.join("\n");
  const localeDir = join(repoRoot, "client", "src", "locales", "en");
  for (const name of readdirSync(localeDir).sort()) {
    if (name.endsWith(".json")) parts.push(readFileSync(join(localeDir, name), "utf8"));
  }
  return parts.join("\n");
}
