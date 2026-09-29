// Finds `pageMessages.t(...)` calls evaluated ONCE at module load (no enclosing
// function). Those strings do not follow a language switch, so the codemod turns
// such module-level constants into functions (see i18n-codemod.mjs "lazify").
import ts from "typescript";
import { insideZodCall } from "./i18n-scan.mjs";

export function moduleScopeStaticCalls(text, fileName = "file.tsx") {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits = [];
  const walk = (n, inFn) => {
    const fn = ts.isFunctionLike(n) || ts.isClassLike(n);
    if (
      !inFn &&
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.expression.getText(sf) === "pageMessages" &&
      n.expression.name.text === "t"
    ) {
      hits.push({ node: n, zod: insideZodCall(n), line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 });
    }
    ts.forEachChild(n, (c) => walk(c, inFn || fn));
  };
  walk(sf, false);
  return { hits, sf };
}
