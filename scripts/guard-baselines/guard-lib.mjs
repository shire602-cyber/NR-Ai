// Shared engine for baseline-ratchet source guards (check-raw-body.mjs,
// check-ledger-writes.mjs).
//
// A guard is a list of named regexes run over every source file. Today's
// offenders are recorded per file and per pattern in a committed JSON
// baseline. The guard fails when any file has MORE matches than its
// baseline (new offenders, or a new offender inside a baselined file). When
// counts drop, it asks for the baseline to be lowered (`--update`), so the
// ratchet only ever tightens until the baseline is empty.
//
// CLI flags understood by every guard:
//   --root <dir>       tree to scan (default: repo root)
//   --baseline <file>  baseline JSON (default: the guard's committed file)
//   --update           rewrite the baseline from the current tree
//   --json             machine-readable result on stdout

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

export function parseArgs(argv) {
  const out = { root: null, baseline: null, update: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") out.root = argv[++i];
    else if (a === "--baseline") out.baseline = argv[++i];
    else if (a === "--update") out.update = true;
    else if (a === "--json") out.json = true;
  }
  return out;
}

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".claude", ".claire", "coverage"]);

export function walk(dir, files) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(name) && !/\.(test|spec)\.[mc]?[jt]sx?$/.test(name)) {
      files.push(full);
    }
  }
}

function lineOf(content, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * @param {{ root: string, dirs: string[], patterns: {id: string, re: RegExp, hint: string}[],
 *           isAllowed?: (relPath: string) => boolean }} cfg
 * @returns {{ counts: Record<string, Record<string, number>>,
 *             hits: {file: string, line: number, pattern: string, text: string}[] }}
 */
export function scan(cfg) {
  const files = [];
  for (const d of cfg.dirs) walk(join(cfg.root, d), files);
  const counts = {};
  const hits = [];
  for (const full of files.sort()) {
    const rel = relative(cfg.root, full).split(sep).join("/");
    if (cfg.isAllowed && cfg.isAllowed(rel)) continue;
    const content = readFileSync(full, "utf8");
    for (const p of cfg.patterns) {
      const re = new RegExp(p.re.source, p.re.flags.includes("g") ? p.re.flags : p.re.flags + "g");
      let m;
      while ((m = re.exec(content))) {
        if (p.accept && !p.accept(content, m, { rel, root: cfg.root })) {
          if (m[0].length === 0) re.lastIndex++;
          continue;
        }
        (counts[rel] ??= {})[p.id] = (counts[rel]?.[p.id] ?? 0) + 1;
        hits.push({
          file: rel,
          line: lineOf(content, m.index),
          pattern: p.id,
          text: m[0].replace(/\s+/g, " ").slice(0, 120),
        });
        if (m[0].length === 0) re.lastIndex++;
      }
    }
  }
  return { counts, hits };
}

export function loadBaseline(path) {
  if (!existsSync(path)) return { files: {} };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return { files: parsed.files ?? {} };
}

export function compare(counts, baseline) {
  const regressions = [];
  const improvements = [];
  const keys = new Set([...Object.keys(counts), ...Object.keys(baseline.files)]);
  for (const file of keys) {
    const now = counts[file] ?? {};
    const base = baseline.files[file] ?? {};
    for (const id of new Set([...Object.keys(now), ...Object.keys(base)])) {
      const n = now[id] ?? 0;
      const b = base[id] ?? 0;
      if (n > b) regressions.push({ file, pattern: id, now: n, baseline: b });
      else if (n < b) improvements.push({ file, pattern: id, now: n, baseline: b });
    }
  }
  return { regressions, improvements };
}

export function writeBaseline(path, counts, description) {
  const files = {};
  for (const file of Object.keys(counts).sort()) {
    files[file] = Object.fromEntries(Object.entries(counts[file]).sort());
  }
  const total = Object.values(files).reduce(
    (a, byPattern) => a + Object.values(byPattern).reduce((x, y) => x + y, 0),
    0
  );
  writeFileSync(path, JSON.stringify({ description, total, files }, null, 2) + "\n");
}

/** Run a guard end-to-end; returns the process exit code. */
export function runGuard({ name, argv, defaultRoot, defaultBaseline, description, scanCfg }) {
  const args = parseArgs(argv);
  const root = args.root ?? defaultRoot;
  const baselinePath = args.baseline ?? defaultBaseline;
  const { counts, hits } = scan({ ...scanCfg, root });

  if (args.update) {
    writeBaseline(baselinePath, counts, description);
    console.log(`${name}: baseline updated (${hits.length} recorded occurrence(s)).`);
    return 0;
  }

  const baseline = loadBaseline(baselinePath);
  const { regressions, improvements } = compare(counts, baseline);

  if (args.json) {
    console.log(JSON.stringify({ ok: regressions.length === 0, regressions, improvements }));
    return regressions.length ? 1 : 0;
  }

  if (regressions.length) {
    console.error(`${name}: FAILED — new occurrence(s) beyond the committed baseline:`);
    for (const r of regressions) {
      const pat = scanCfg.patterns.find((p) => p.id === r.pattern);
      console.error(`  ${r.file}: ${r.pattern} ${r.baseline} -> ${r.now}  (${pat?.hint ?? ""})`);
      for (const h of hits.filter((x) => x.file === r.file && x.pattern === r.pattern)) {
        console.error(`      L${h.line}: ${h.text}`);
      }
    }
    return 1;
  }
  if (improvements.length) {
    console.log(
      `${name}: OK — ${improvements.length} baseline entr(ies) improved; run with --update to ratchet the baseline down.`
    );
  } else {
    console.log(`${name}: OK (${hits.length} baselined occurrence(s), none new).`);
  }
  return 0;
}
