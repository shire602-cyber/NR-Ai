/**
 * Defect 14 (firm speed): what the browser downloads on first load.
 *
 * Source-inspection of the build output, on purpose: chunking is decided by the bundler, so the
 * only place to see it is the emitted files (skipped when `npm run build` has not run). It reads
 * the static import graph of the emitted chunks, i.e. exactly the files the browser fetches
 * before the first render, without starting a browser.
 *
 *  - The firm document (`firm.html`, `FIRM_BUILD=1`) loads the app and both landing screens from
 *    one entry chunk plus a handful of vendor chunks (it used to be ~45 shared chunks, each a
 *    round trip on a phone), and none of the heavy lazy vendors.
 *  - The app shell no longer imports framer-motion (a decorative page fade moved to CSS).
 *  - The public, portal and no-login pages never reach the firm build, and the main document
 *    never references it.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const dist = join(process.cwd(), "dist/public");
const built = existsSync(join(dist, "firm.html")) && existsSync(join(dist, "index.html"));

type Graph = Map<string, string[]>;

function readGraph(dir: string): Graph {
  const graph: Graph = new Map();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
    const code = readFileSync(join(dir, file), "utf8");
    const deps = new Set<string>();
    for (const m of code.matchAll(
      /(?:import|export)[^"'();]*?from\s*["']\.\/([^"']+\.js)["']|(?:^|[;}\n])import\s*["']\.\/([^"']+\.js)["']/g
    )) {
      deps.add(m[1] ?? m[2]);
    }
    graph.set(file, [...deps]);
  }
  return graph;
}

function closure(graph: Graph, start: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...start];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file) || !graph.has(file)) continue;
    seen.add(file);
    queue.push(...graph.get(file)!);
  }
  return seen;
}

function gz(dir: string, files: Iterable<string>): number {
  let total = 0;
  for (const f of files) total += gzipSync(readFileSync(join(dir, f))).length;
  return total;
}

describe.skipIf(!built)("first-load chunks (build output)", () => {
  const firmHtml = built ? readFileSync(join(dist, "firm.html"), "utf8") : "";
  const mainHtml = built ? readFileSync(join(dist, "index.html"), "utf8") : "";

  it("the firm document starts from one entry chunk and preloads a short, fixed list of vendors", () => {
    const entry = /<script type="module"[^>]*src="\/firm-assets\/([^"]+\.js)"/.exec(firmHtml)?.[1];
    expect(entry).toBeTruthy();
    const preloads = [
      ...firmHtml.matchAll(/rel="modulepreload"[^>]*href="\/firm-assets\/([^"]+\.js)"/g),
    ].map((m) => m[1]);
    const graph = readGraph(join(dist, "firm-assets"));
    const files = closure(graph, [entry!]);
    // Entry + vendors. Not asserted as an exact number (a vendor split may change) but it must stay
    // an order of magnitude below the ~45 chunks the shared-chunk layout needed.
    expect(files.size).toBeLessThanOrEqual(14);
    expect(preloads.length).toBeLessThanOrEqual(13);
    for (const preload of preloads) expect(files.has(preload)).toBe(true);
    const heavy = [...files].filter((f) =>
      /vendor-(motion|socketio|pdf|pdfjs|pdf-worker|tesseract|html2canvas|dompurify)|reportCatalog|marketing/.test(
        f
      )
    );
    expect(heavy).toEqual([]);
    // Generous ceiling (about 15% above today's ~410 KB gzip of JS): catches an accidental eager
    // import of a large module, not normal growth.
    expect(gz(join(dist, "firm-assets"), files)).toBeLessThan(480 * 1024);
  });

  it("the main document and the public, portal and no-login roots never load the firm build", () => {
    expect(mainHtml).not.toContain("firm-assets");
    const graph = readGraph(join(dist, "assets"));
    const names = [
      "index",
      "PublicApp",
      "PortalApp",
      "CustomerPortal",
      "PublicInvoiceView",
      "EInvoicingApprove",
    ];
    for (const name of names) {
      const start = [...graph.keys()].filter((f) => f.startsWith(`${name}-`));
      expect(start.length, name).toBeGreaterThan(0);
      for (const file of closure(graph, start)) expect(file).not.toMatch(/firm-/);
    }
  });

  it("the signed-in app shell does not import framer-motion", () => {
    for (const dir of ["assets", "firm-assets"]) {
      const graph = readGraph(join(dist, dir));
      const start = [...graph.keys()].filter((f) => /^(index|firm|App)-/.test(f));
      expect(start.length).toBeGreaterThan(0);
      const files = closure(graph, start);
      expect([...files].filter((f) => f.startsWith("vendor-motion"))).toEqual([]);
    }
  });
});
