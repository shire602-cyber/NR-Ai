#!/usr/bin/env node
// Migration tool: moves hard-coded English UI strings into a per-page,
// type-checked message table (see client/src/lib/i18n-messages.ts).
//
//   node scripts/i18n-codemod.mjs extract <file.tsx>... [--out DIR]
//       Scans each file and prints the strings that still need an Arabic value
//       ("key<TAB>English<TAB>context"). Strings whose English text is in the
//       glossary, and `locale === "ar" ? "…" : "…"` ternaries, are filled in
//       automatically.
//
//   node scripts/i18n-codemod.mjs apply <file.tsx> --ar <translations.json> [--out DIR]
//       Rewrites the file to use `tr("key")` (component), `pageMessages.t("key")`
//       (module level) or `pageMessages.marker("key")` (module-level zod schema)
//       and writes/merges the sibling `<Name>.i18n.ts` table. Aborts, changing
//       nothing, if any string lacks an Arabic value or placeholders differ.
//
// Detection rules live in scripts/lib/i18n-scan.mjs (shared with the CI gate).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { scanSource, legacyPolarityOk } from "./lib/i18n-scan.mjs";
import { moduleScopeStaticCalls } from "./lib/i18n-module-scope.mjs";
import { transform as rtlTransform } from "./rtl-codemod.mjs";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");

// ── glossary (parsed from the TS source so there is one source of truth) ─────

function loadGlossary() {
  const src = readFileSync(join(root, "client/src/lib/i18n-glossary.ts"), "utf8");
  const map = new Map();
  const norm = (t) => t.trim().replace(/[:：…]+$|\.{3}$/g, "").trim().toLowerCase();
  for (const m of src.matchAll(/^\s*g\("((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)"/gm)) {
    const key = norm(JSON.parse(`"${m[1]}"`));
    if (!map.has(key)) map.set(key, JSON.parse(`"${m[2]}"`));
  }
  return { lookup: (en) => map.get(norm(en)), norm };
}

// ── keys ─────────────────────────────────────────────────────────────────────

function makeKey(english, used) {
  const words = (english.replace(/\{\w+\}/g, " ").match(/[A-Za-z0-9]+/g) ?? []).slice(0, 6);
  let key = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join("");
  if (!key) key = "text";
  if (/^\d/.test(key)) key = `n${key}`;
  key = key.slice(0, 48);
  let candidate = key;
  let n = 2;
  while (used.has(candidate) && used.get(candidate) !== english) candidate = `${key}${n++}`;
  used.set(candidate, english);
  return candidate;
}

// ── component detection ──────────────────────────────────────────────────────

function functionName(fn) {
  if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
  let p = fn.parent;
  while (p && (ts.isParenthesizedExpression(p) || (ts.isCallExpression(p) && p.arguments.includes(fn)))) p = p.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  return null;
}

function isComponent(fn) {
  const isFn = ts.isFunctionDeclaration(fn) || ts.isArrowFunction(fn) || ts.isFunctionExpression(fn);
  if (!isFn || !fn.body || !ts.isBlock(fn.body)) return false;
  const name = functionName(fn);
  if (name) return /^[A-Z]/.test(name);
  // export default function () {}
  return ts.isFunctionDeclaration(fn) && fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
}

/** The enclosing component (needs a hook), or null for module-level code. */
function enclosingComponent(node) {
  let cur = node.parent;
  while (cur) {
    if (
      (ts.isFunctionDeclaration(cur) || ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) &&
      isComponent(cur)
    )
      return cur;
    cur = cur.parent;
  }
  return null;
}

// ── existing .i18n.ts (merge on re-run) ─────────────────────────────────────

function loadExistingTable(path) {
  if (!existsSync(path)) return { en: {}, ar: {} };
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const captured = { en: {}, ar: {} };
  const fakeRequire = () => ({ defineMessages: (_id, en, ar) => { captured.en = en; captured.ar = ar; return {}; } });
  new Function("exports", "require", js)(exports, fakeRequire);
  return captured;
}

// ── shared analysis ─────────────────────────────────────────────────────────

function analyse(file) {
  const text = readFileSync(file, "utf8");
  const scan = scanSource(text, file);
  const base = basename(file).replace(/\.tsx$/, "");
  const tablePath = join(dirname(file), `${base}.i18n.ts`);
  const existing = loadExistingTable(tablePath);
  const used = new Map(Object.entries(existing.en).map(([k, v]) => [k, v]));
  const glossary = loadGlossary();

  const entries = new Map(); // key -> { en, ar?, contexts:Set }
  for (const [k, v] of Object.entries(existing.en)) entries.set(k, { en: v, ar: existing.ar[k], contexts: new Set(), existing: true });

  const work = [];
  for (const item of [...scan.items.filter((i) => i.kind !== "manual"), ...scan.legacy.filter((l) => !ts.isTemplateExpression(l.whenTrue) && !ts.isTemplateExpression(l.whenFalse) && legacyPolarityOk(l, scan.sourceFile))]) {
    const key = makeKey(item.text, used);
    const entry = entries.get(key) ?? { en: item.text, contexts: new Set() };
    if (item.kind === "legacy" && !entry.ar) entry.ar = item.ar;
    entry.contexts.add(item.context ?? "ternary");
    entries.set(key, entry);
    work.push({ ...item, key });
  }
  return { text, scan, base, tablePath, entries, work, glossary };
}

// `{count}` may be omitted from the Arabic zero/one/two forms ("فاتورة واحدة", "فاتورتان").
const placeholdersOf = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((n) => n !== "count").sort().join(",");

// ── extract ──────────────────────────────────────────────────────────────────

function extract(files) {
  let missingTotal = 0;
  for (const file of files) {
    const a = analyse(resolve(file));
    const missing = [];
    for (const [key, e] of a.entries) {
      if (e.ar) continue;
      const g = a.glossary.lookup(e.en);
      if (g) e.ar = g;
      else missing.push([key, e]);
    }
    for (const it of a.scan.items.filter((i) => i.kind === "manual")) console.log(`MANUAL\tline ${it.line}\t${it.text}`);
    console.log(`## ${relative(root, resolve(file))}  items=${a.work.length} unique=${a.entries.size} missingAr=${missing.length}`);
    for (const [key, e] of missing) console.log(e.en.split(/\s+/).length <= 2 ? `${key}\t${e.en}\t${[...e.contexts].slice(0, 2).join(",")}` : `${key}\t${e.en}`);
    // natural-language literals in value position that MAY be identifiers/persisted values
    const risky = a.scan.items.filter(
      (i) => i.verdict === "natural" && !/^prop:(metric|signal|currentLabel|previousLabel|statusLabel|reviewReason|badge|cta|title|description|label|header|detail|summary|body|error)$/.test(i.context)
    );
    for (const it of risky.slice(0, 40)) console.log(`REVIEW\t${it.line}\t${it.context}\t${it.text.slice(0, 60)}`);
    if (risky.length > 40) console.log(`REVIEW\t... ${risky.length - 40} more`);
    missingTotal += missing.length;
  }
  console.log(`# total missing: ${missingTotal}`);
}

// ── apply ────────────────────────────────────────────────────────────────────

function apply(file, arPath) {
  const path = resolve(file);
  const a = analyse(path);
  const provided = arPath && existsSync(arPath) ? JSON.parse(readFileSync(arPath, "utf8")) : {};

  const missing = [];
  const mismatched = [];
  for (const [key, e] of a.entries) {
    if (!e.ar) e.ar = provided[key] ?? a.glossary.lookup(e.en);
    if (!e.ar) missing.push(`${key}\t${e.en}`);
    else if (placeholdersOf(e.en) !== placeholdersOf(e.ar)) mismatched.push(`${key}\t${e.en}\t=> ${e.ar}`);
  }
  if (missing.length || mismatched.length) {
    if (mismatched.length) console.error(`placeholder mismatch (${mismatched.length}):\n${mismatched.join("\n")}`);
    if (missing.length) console.error(`missing Arabic (${missing.length}):\n${missing.join("\n")}`);
    process.exit(2);
  }

  const source = a.text;
  const sf = a.scan.sourceFile;
  // the translator variable is `tr`, unless that name is already a real identifier here
  let tr = "tr";
  if (!/const tr = pageMessages/.test(source)) {
    const taken = new Set();
    const walkIds = (n) => {
      if (ts.isIdentifier(n)) {
        const p = n.parent;
        const isTag = p && (ts.isJsxOpeningElement(p) || ts.isJsxClosingElement(p) || ts.isJsxSelfClosingElement(p)) && p.tagName === n;
        const isMember = p && ((ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n));
        if (!isTag && !isMember) taken.add(n.text);
      }
      ts.forEachChild(n, walkIds);
    };
    walkIds(sf);
    if (taken.has("tr")) tr = taken.has("trl") ? "trx" : "trl";
  }
  const edits = [];
  const hookFns = new Set();

  // choose the translator expression per work item
  const accepted = [];
  for (const item of a.work.sort((x, y) => x.start - y.start)) {
    if (accepted.some((p) => item.start >= p.start && item.end <= p.end)) continue;
    accepted.push(item);
  }

  for (const item of accepted) {
    const anchor = item.node ?? findNodeAt(sf, item.start);
    const comp = anchor ? enclosingComponent(anchor) : findComponentAt(sf, item.start);
    const params = item.params?.length
      ? `, { ${item.params.map((p) => (p.name === p.code ? p.name : `${p.name}: ${p.code}`)).join(", ")} }`
      : "";
    let call;
    if (item.zod && !comp) call = `pageMessages.marker("${item.key}"${params})`;
    else if (comp) {
      hookFns.add(comp);
      call = `${tr}("${item.key}"${params})`;
    } else call = `pageMessages.t("${item.key}"${params})`;

    let replacement = call;
    let start = item.start;
    let end = item.end;
    if (item.kind === "run") {
      replacement = `{${call}}`;
      if (item.leadingSpace) replacement = `{" "}${replacement}`;
      if (item.trailingSpace) replacement = `${replacement}{" "}`;
    } else if (item.node && item.node.parent && ts.isJsxAttribute(item.node.parent) && item.node.parent.initializer === item.node) {
      replacement = `{${call}}`;
    }
    edits.push({ start, end, text: replacement });
  }

  // hook + import
  for (const fn of hookFns) {
    const body = fn.body;
    edits.push({ start: body.getStart(sf) + 1, end: body.getStart(sf) + 1, text: `\n  const ${tr} = pageMessages.useT();\n` });
  }
  const importLine = `import { messages as pageMessages } from "./${a.base}.i18n";\n`;
  const alreadyImported = source.includes(`./${a.base}.i18n"`);
  if (!alreadyImported) {
    let lastImportEnd = 0;
    for (const st of sf.statements) if (ts.isImportDeclaration(st)) lastImportEnd = st.end;
    edits.push({ start: lastImportEnd, end: lastImportEnd, text: `\n${importLine}` });
  }

  let out = source;
  for (const e of edits.sort((x, y) => y.start - x.start || y.end - x.end)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  writeFileSync(path, out);

  // table
  const en = {};
  const ar = {};
  for (const [key, e] of a.entries) {
    en[key] = e.en;
    ar[key] = e.ar;
  }
  const lines = (obj) => Object.entries(obj).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n");
  const table =
    `import { defineMessages } from "@/lib/i18n-messages";\n\n` +
    `export const messages = defineMessages(\n  ${JSON.stringify(a.base)},\n  {\n${lines(en)}\n  },\n  {\n${lines(ar)}\n  }\n);\n`;
  writeFileSync(a.tablePath, table);

  execFileSync("npx", ["prettier", "--write", path, a.tablePath], { cwd: root, stdio: "pipe" });
  console.log(`${relative(root, path)}: ${accepted.length} strings -> ${a.entries.size} keys, ${hookFns.size} component hook(s)`);
}

function findNodeAt(sf, pos) {
  let found = null;
  const walk = (n) => {
    if (n.getStart(sf) <= pos && pos < n.end) {
      found = n;
      ts.forEachChild(n, walk);
    }
  };
  walk(sf);
  return found;
}
function findComponentAt(sf, pos) {
  const n = findNodeAt(sf, pos);
  return n ? enclosingComponent(n) : null;
}

// ── addkeys: append hand-written entries (plurals, manual fixes) to a table ───

function addKeys(file, jsonPath) {
  const path = resolve(file);
  const base = basename(path).replace(/\.tsx$/, "");
  const tablePath = join(dirname(path), `${base}.i18n.ts`);
  const existing = loadExistingTable(tablePath);
  const add = JSON.parse(readFileSync(jsonPath, "utf8")); // { key: [en, ar] }
  // Compact plural spec: { "base": { "plural": { "en": [one, other], "ar": [zero, one, two, few, many, other] } } }
  for (const [base, spec] of Object.entries({ ...add })) {
    if (!spec.plural) continue;
    delete add[base];
    const { en, ar } = spec.plural;
    const cats = ["zero", "one", "two", "few", "many", "other"];
    cats.forEach((c, i) => {
      add[`${base}_${c}`] = [c === "one" ? en[0] : en[1], ar[i]];
    });
  }
  for (const [key, [en, ar]] of Object.entries(add)) {
    if (placeholdersOf(en) !== placeholdersOf(ar)) {
      console.error(`placeholder mismatch for ${key}`);
      process.exit(2);
    }
    existing.en[key] = en;
    existing.ar[key] = ar;
  }
  const lines = (obj) => Object.entries(obj).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n");
  writeFileSync(
    tablePath,
    `import { defineMessages } from "@/lib/i18n-messages";\n\nexport const messages = defineMessages(\n  ${JSON.stringify(base)},\n  {\n${lines(existing.en)}\n  },\n  {\n${lines(existing.ar)}\n  }\n);\n`
  );
  execFileSync("npx", ["prettier", "--write", tablePath], { cwd: root, stdio: "pipe" });
  console.log(`${relative(root, tablePath)}: +${Object.keys(add).length} keys`);
}

// ── prune: drop table keys the page no longer references ─────────────────────

function prune(file) {
  const path = resolve(file);
  const base = basename(path).replace(/\.tsx$/, "");
  const tablePath = join(dirname(path), `${base}.i18n.ts`);
  if (!existsSync(tablePath)) return;
  const source = readFileSync(path, "utf8");
  const used = new Set([...source.matchAll(/(?:\btr[lx]?|pageMessages\.(?:t|marker)|\.plural)\(\s*"([A-Za-z0-9_]+)"/g)].map((m) => m[1]));
  const existing = loadExistingTable(tablePath);
  const keep = (key) => used.has(key) || source.includes(`"${key}"`) || [...used].some((u) => key.startsWith(`${u}_`) && /_(zero|one|two|few|many|other)$/.test(key));
  const en = {};
  const ar = {};
  let dropped = 0;
  for (const key of Object.keys(existing.en)) {
    if (keep(key)) {
      en[key] = existing.en[key];
      ar[key] = existing.ar[key];
    } else dropped += 1;
  }
  if (!dropped) return;
  const lines = (obj) => Object.entries(obj).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n");
  writeFileSync(
    tablePath,
    `import { defineMessages } from "@/lib/i18n-messages";\n\nexport const messages = defineMessages(\n  ${JSON.stringify(base)},\n  {\n${lines(en)}\n  },\n  {\n${lines(ar)}\n  }\n);\n`
  );
  execFileSync("npx", ["prettier", "--write", tablePath], { cwd: root, stdio: "pipe" });
  console.log(`${relative(root, tablePath)}: pruned ${dropped} unused key(s)`);
}

// ── lazify: module-level constants holding translated text become functions ──
// `const PLANS = [{ name: pageMessages.t("x") }]` is evaluated once at import and would
// never follow a language switch, so it becomes `const getPlans = () => [...]` and every
// reference `PLANS` becomes `getPlans()` (called during render).

function markerize(file) {
  const path = resolve(file);
  const text = readFileSync(path, "utf8");
  const { hits } = moduleScopeStaticCalls(text, path);
  const zodHits = hits.filter((h) => h.zod);
  if (!zodHits.length) return;
  let out = text;
  for (const h of zodHits.sort((a, b) => b.node.getStart() - a.node.getStart())) {
    const nameNode = h.node.expression.name;
    out = out.slice(0, nameNode.getStart()) + "marker" + out.slice(nameNode.end);
  }
  writeFileSync(path, out);
  console.log(`${relative(root, path)}: ${zodHits.length} zod message(s) -> marker`);
}

function lazify(file) {
  const path = resolve(file);
  const text = readFileSync(path, "utf8");
  const { hits, sf } = moduleScopeStaticCalls(text, path);
  if (!hits.length) return;
  const pascal = (name) => {
    const parts = name.split(/[_\s]+/).filter(Boolean);
    return parts.map((p) => (p === p.toUpperCase() ? p[0] + p.slice(1).toLowerCase() : p[0].toUpperCase() + p.slice(1))).join("");
  };
  const edits = [];
  const skipped = [];
  const taken = new Set();
  const collect = (n) => { if (ts.isIdentifier(n)) taken.add(n.text); ts.forEachChild(n, collect); };
  collect(sf);

  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st) || st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (st.declarationList.declarations.length !== 1) continue;
    const decl = st.declarationList.declarations[0];
    if (!decl.initializer || !ts.isIdentifier(decl.name)) continue;
    if (!hits.some((h) => h.node.pos >= decl.initializer.pos && h.node.end <= decl.initializer.end)) continue;
    const name = decl.name.text;
    const fnName = `get${pascal(name)}`;
    if (taken.has(fnName)) { skipped.push(`${name}: ${fnName} already exists`); continue; }
    // references
    const refs = [];
    let typeQuery = false;
    const walk = (n) => {
      if (ts.isIdentifier(n) && n.text === name && n !== decl.name) {
        const p = n.parent;
        if ((ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n) || ts.isBindingElement(p) && p.propertyName === n) return;
        if (ts.isTypeQueryNode(p)) typeQuery = true;
        else if (ts.isShorthandPropertyAssignment(p)) refs.push({ node: n, shorthand: true });
        else refs.push({ node: n });
      }
      ts.forEachChild(n, walk);
    };
    walk(sf);
    if (typeQuery) { skipped.push(`${name}: used in a type position (typeof ${name})`); continue; }
    const init = decl.initializer.getText(sf);
    const type = decl.type ? `: ${decl.type.getText(sf)}` : "";
    edits.push({ start: st.getStart(sf), end: st.end, text: `const ${fnName} = ()${type} => (${init});` });
    for (const r of refs) {
      const inside = r.node.pos >= st.pos && r.node.end <= st.end;
      if (inside) continue; // self reference inside its own initializer: leave
      edits.push({ start: r.node.getStart(sf), end: r.node.end, text: r.shorthand ? `${name}: ${fnName}()` : `${fnName}()` });
    }
    taken.add(fnName);
  }
  let out = text;
  // drop edits nested inside another edit (references inside a rewritten declaration)
  const kept = edits.filter((e, i) => !edits.some((o, j) => j !== i && o.start <= e.start && o.end >= e.end && (o.end - o.start) > (e.end - e.start)));
  for (const e of kept.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  if (out !== text) {
    writeFileSync(path, out);
    execFileSync("npx", ["prettier", "--write", path], { cwd: root, stdio: "pipe" });
  }
  console.log(`${relative(root, path)}: lazified ${kept.filter((e) => e.text.startsWith("const ")).length} constant(s)${skipped.length ? `; skipped: ${skipped.join("; ")}` : ""}`);
}

// ── finish: everything that follows `apply` (zod markers, lazy constants, prune, RTL classes) ──

function finish(file) {
  markerize(file);
  lazify(file);
  prune(file);
  const path = resolve(file);
  const { out, changes } = rtlTransform(readFileSync(path, "utf8"), path);
  if (changes) writeFileSync(path, out);
  execFileSync("npx", ["prettier", "--write", path], { cwd: root, stdio: "pipe" });
  console.log(`${relative(root, path)}: finished (rtl changes: ${changes})`);
}

// ── cli ──────────────────────────────────────────────────────────────────────

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : null);
const files = rest.filter((x, i) => x.endsWith(".tsx") && rest[i - 1] !== "--ar" && rest[i - 1] !== "--out" && rest[i - 1] !== "--json");
if (cmd === "extract") extract(files);
else if (cmd === "apply") apply(files[0], flag("--ar"));
else if (cmd === "addkeys") addKeys(files[0], flag("--json"));
else if (cmd === "prune") files.forEach(prune);
else if (cmd === "lazify") files.forEach(lazify);
else if (cmd === "markerize") files.forEach(markerize);
else if (cmd === "finish") files.forEach(finish);
else {
  console.error("usage: i18n-codemod.mjs extract|apply <file.tsx> [--ar translations.json]");
  process.exit(1);
}
void mkdirSync;
