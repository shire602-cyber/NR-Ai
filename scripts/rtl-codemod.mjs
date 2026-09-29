#!/usr/bin/env node
// RTL migration: rewrites PHYSICAL Tailwind direction utilities in class strings to their
// LOGICAL equivalents (Tailwind >= 3.3), so a screen mirrors correctly in Arabic without
// relying on the global [dir="rtl"] override sheet, and marks code-like values as LTR.
//
//   ml-2 -> ms-2      mr-2 -> me-2      pl-4 -> ps-4      pr-4 -> pe-4
//   text-left -> text-start   text-right -> text-end
//   left-0 -> start-0   right-0 -> end-0
//   border-l -> border-s  border-r -> border-e  rounded-l -> rounded-s  rounded-r -> rounded-e
//   rounded-tl/tr/bl/br -> rounded-ss/se/es/ee     float-left/right -> float-start/end
//
// Left alone on purpose: `left-1/2` centring next to `-translate-x-1/2`, `space-x-*`
// (rtl.css handles it), and lucide chevron/arrow icons (rtl.css mirrors `.lucide-*` already).
// Elements styled `font-mono` (TRN, IBAN, invoice numbers) get dir="ltr" so they never reorder.
//
//   node scripts/rtl-codemod.mjs <file.tsx>...        rewrite in place
//   node scripts/rtl-codemod.mjs --check <file>...    exit 1 if anything would change

import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

const PAIRS = [
  [/^(ml)-/, "ms-"], [/^(mr)-/, "me-"], [/^(pl)-/, "ps-"], [/^(pr)-/, "pe-"],
  [/^text-left$/, "text-start"], [/^text-right$/, "text-end"],
  [/^left-/, "start-"], [/^right-/, "end-"],
  [/^border-l(?=$|-)/, "border-s"], [/^border-r(?=$|-)/, "border-e"],
  [/^rounded-l(?=$|-)/, "rounded-s"], [/^rounded-r(?=$|-)/, "rounded-e"],
  [/^rounded-tl(?=$|-)/, "rounded-ss"], [/^rounded-tr(?=$|-)/, "rounded-se"],
  [/^rounded-bl(?=$|-)/, "rounded-es"], [/^rounded-br(?=$|-)/, "rounded-ee"],
  [/^float-left$/, "float-start"], [/^float-right$/, "float-end"],
];

/** Convert one class token, keeping variants (`md:`), important (`!`) and negative (`-`) prefixes. */
export function logicalToken(token, { keepPositional = false } = {}) {
  const m = /^((?:[\w\[\]\-.&>*=]+:)*)(!?)(-?)(.*)$/.exec(token);
  if (!m) return token;
  const [, variants, bang, neg, core] = m;
  for (const [re, replacement] of PAIRS) {
    if (!re.test(core)) continue;
    if (keepPositional && /^(left|right)-/.test(core)) return token;
    return `${variants}${bang}${neg}${core.replace(re, replacement)}`;
  }
  return token;
}

const CLASSISH = /^[\w!:\-/[\].%#(),&>*_='"]+$/;

export function logicalClasses(text) {
  if (!/(?:^|[\s:!-])(?:ml|mr|pl|pr|left|right|text-left|text-right|border-[lr]|rounded-(?:[lr]|tl|tr|bl|br)|float-(?:left|right))(?:-|\s|$)/.test(text)) return text;
  const tokens = text.split(/(\s+)/);
  const real = tokens.filter((t) => t.trim() !== "");
  if (!real.every((t) => CLASSISH.test(t) || /^\$\{/.test(t))) return text;
  const centring = /translate-x/.test(text); // `left-1/2 -translate-x-1/2`: symmetric trick, keep physical
  return tokens.map((t) => (t.trim() === "" ? t : logicalToken(t, { keepPositional: centring }))).join("");
}

export function transform(source, fileName = "file.tsx") {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeNode(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const next = logicalClasses(node.text);
      if (next !== node.text) {
        const raw = node.getText(sf);
        edits.push({ start: node.getStart(sf) + 1, end: node.end - 1, text: raw.slice(1, -1).replace(node.text, next) });
        if (!raw.slice(1, -1).includes(node.text)) edits.pop(); // escaped content: leave alone
      }
    } else if (ts.isTemplateExpression(node)) {
      const parts = [node.head, ...node.templateSpans.map((s) => s.literal)];
      for (const part of parts) {
        const next = logicalClasses(part.text);
        if (next !== part.text) {
          const raw = part.getText(sf);
          const inner = raw.slice(1, raw.endsWith("${") ? -2 : -1);
          if (inner === part.text) edits.push({ start: part.getStart(sf) + 1, end: part.getStart(sf) + 1 + inner.length, text: next });
        }
      }
    }
    // font-mono => dir="ltr" (unless the element already sets dir or aligns text itself)
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
      const cls = attrs.find((a) => a.name.getText(sf) === "className");
      const hasDir = attrs.some((a) => a.name.getText(sf) === "dir");
      const clsText = cls?.initializer?.getText(sf) ?? "";
      if (!hasDir && /\bfont-mono\b/.test(clsText) && !/\b(text-(left|right|start|end|center)|block|flex|grid)\b/.test(clsText) && /^[a-z]/.test(node.tagName.getText(sf))) {
        edits.push({ start: node.tagName.end, end: node.tagName.end, text: ' dir="ltr"' });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  let out = source;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { out, changes: edits.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  let failed = false;
  for (const file of args.filter((a) => a.endsWith(".tsx"))) {
    const src = readFileSync(file, "utf8");
    const { out, changes } = transform(src, file);
    if (changes === 0) continue;
    if (check) {
      console.error(`${file}: ${changes} physical direction class(es)`);
      failed = true;
    } else {
      writeFileSync(file, out);
      console.log(`${file}: ${changes} change(s)`);
    }
  }
  if (failed) process.exit(1);
}
