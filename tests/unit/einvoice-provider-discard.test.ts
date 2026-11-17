/**
 * X6a (council REQUIRED 12): docs/einvoicing-providers.md promises that discarding the provider we
 * do not sign with is "delete these files, edit these touch points, delete these locale keys".
 * This pins that list against the code.
 *
 * Why this reads source text instead of exercising behaviour: the promise is about the repository
 * layout (which files and catalog keys name a provider), not about runtime behaviour. The runtime
 * side (only the selected, configured provider is used) is covered by
 * tests/unit/einvoice-provider-registry.test.ts.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const DOC = readFileSync(join(ROOT, "docs/einvoicing-providers.md"), "utf8");

interface DiscardPlan {
  deletes: string[];
  edits: string[];
  keyPatterns: RegExp[];
}

/** Backticked first token of each bullet under `### <heading>` inside `## Discarding <name>`. */
function section(provider: string, heading: string): string[] {
  const start = DOC.indexOf(`## Discarding ${provider}`);
  expect(start, `docs: "## Discarding ${provider}" section`).toBeGreaterThan(-1);
  const end = DOC.indexOf("\n## ", start + 3);
  const body = DOC.slice(start, end === -1 ? undefined : end);
  const h = body.indexOf(`### ${heading}`);
  expect(h, `docs: "### ${heading}" under ${provider}`).toBeGreaterThan(-1);
  const next = body.indexOf("\n### ", h + 4);
  const part = body.slice(h, next === -1 ? undefined : next);
  return [...part.matchAll(/^- `([^`]+)`/gm)].map((m) => m[1]);
}

function plan(provider: string): DiscardPlan {
  const patternToRegex = (p: string) =>
    new RegExp(`^${p.replace(/\./g, "\\.").replace(/\*/g, ".*")}$`);
  return {
    deletes: section(provider, "Delete"),
    edits: section(provider, "Edit"),
    keyPatterns: section(provider, "Locale keys (en + ar)").map(patternToRegex),
  };
}

const PROVIDERS = {
  "A-Cube": { plan: plan("A-Cube"), token: /acube|a-cube/i, name: /A-Cube/ },
  Complyance: { plan: plan("Complyance"), token: /complyance/i, name: /Complyance/ },
} as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(relative(ROOT, p));
  }
  return out;
}

const SOURCES = ["server", "client/src", "shared"].flatMap((d) => walk(join(ROOT, d)));

/** Code without comments (block comments, then line comments that are not part of a URL). */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const isDeleted = (file: string, deletes: string[]) =>
  deletes.some((d) => (d.endsWith("/") ? file.startsWith(d) : file === d));

function catalog(locale: string): Record<string, string> {
  const dir = join(ROOT, "client/src/locales", locale);
  const out: Record<string, string> = {};
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")))
    Object.assign(out, JSON.parse(readFileSync(join(dir, f), "utf8")));
  return out;
}

/** Catalog keys a file names literally (t["…"] / t['…'] / k="…"). */
function keysIn(src: string, keys: Set<string>): Set<string> {
  const found = new Set<string>();
  for (const m of src.matchAll(/["'`]([a-zA-Z]+\.[A-Za-z0-9_.]+)["'`]/g))
    if (keys.has(m[1])) found.add(m[1]);
  return found;
}

describe("[X6a REQUIRED 12] the documented provider discard list is complete", () => {
  for (const [provider, { plan: p, token }] of Object.entries(PROVIDERS)) {
    describe(provider, () => {
      it("every path on its Delete and Edit lists exists", () => {
        for (const f of [...p.deletes, ...p.edits.filter((e) => !e.startsWith("."))]) {
          expect(existsSync(join(ROOT, f)), f).toBe(true);
        }
      });

      it("no source file outside its Delete/Edit lists names it in code", () => {
        const leaks = SOURCES.filter(
          (f) =>
            !isDeleted(f, p.deletes) &&
            !p.edits.includes(f) &&
            token.test(code(readFileSync(join(ROOT, f), "utf8")))
        );
        expect(leaks).toEqual([]);
      });

      it("no kept file imports a file on its Delete list", () => {
        const deletedModules = p.deletes
          .filter((d) => /\.(ts|tsx)$/.test(d))
          .map((d) => d.replace(/^.*\//, "").replace(/\.(ts|tsx)$/, ""));
        const offenders: string[] = [];
        for (const f of SOURCES) {
          if (isDeleted(f, p.deletes) || p.edits.includes(f)) continue;
          const src = readFileSync(join(ROOT, f), "utf8");
          for (const m of src.matchAll(
            /from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g
          )) {
            const spec = (m[1] ?? m[2]).replace(/^.*\//, "");
            if (deletedModules.includes(spec)) offenders.push(`${f} -> ${m[1] ?? m[2]}`);
          }
        }
        expect(offenders).toEqual([]);
      });

      it("its locale-key list covers every key that names it or is used only by its deleted files", () => {
        const en = catalog("en");
        const ar = catalog("ar");
        const all = new Set(Object.keys(en));
        const covered = (k: string) => p.keyPatterns.some((re) => re.test(k));
        const namesIt = Object.keys(en).filter(
          (k) => PROVIDERS[provider as keyof typeof PROVIDERS].name.test(en[k]) || token.test(k)
        );
        const usedByDeleted = new Set<string>();
        const usedByKept = new Set<string>();
        for (const f of SOURCES) {
          const used = keysIn(readFileSync(join(ROOT, f), "utf8"), all);
          const target = isDeleted(f, p.deletes) ? usedByDeleted : usedByKept;
          for (const k of used) target.add(k);
        }
        const onlyDeleted = [...usedByDeleted].filter((k) => !usedByKept.has(k));
        const missing = [...new Set([...namesIt, ...onlyDeleted])].filter((k) => !covered(k));
        expect(missing).toEqual([]);
        // Both catalogs carry the same provider keys, so deleting them in en + ar is symmetric.
        const enKeys = Object.keys(en).filter(covered).sort();
        const arKeys = Object.keys(ar).filter(covered).sort();
        expect(arKeys).toEqual(enKeys);
      });

      it("no kept, unedited file uses a key on its locale-key list", () => {
        const all = new Set(Object.keys(catalog("en")));
        const offenders: string[] = [];
        for (const f of SOURCES) {
          if (isDeleted(f, p.deletes) || p.edits.includes(f)) continue;
          for (const k of keysIn(readFileSync(join(ROOT, f), "utf8"), all)) {
            if (p.keyPatterns.some((re) => re.test(k))) offenders.push(`${f}: ${k}`);
          }
        }
        expect(offenders).toEqual([]);
      });
    });
  }

  it("neutral cards use einvoicing.notConnected and the workflow falls back to EINVOICE_* codes", async () => {
    const { EINVOICE_ERROR_CODES } = await import("../../server/services/einvoice/tracks");
    expect(EINVOICE_ERROR_CODES).toEqual(
      expect.arrayContaining(["EINVOICE_VALIDATION", "EINVOICE_DELIVERY_FAILED"])
    );
    const en = catalog("en");
    const ar = catalog("ar");
    for (const k of [
      "einvoicing.notConnected",
      "einvoicing.err_EINVOICE_VALIDATION",
      "einvoicing.err_EINVOICE_DELIVERY_FAILED",
    ]) {
      expect(en[k], k).toBeTruthy();
      expect(ar[k], k).toMatch(/[؀-ۿ]/);
      expect(en[k]).not.toMatch(/A-Cube|Complyance/);
    }
  });
});
