import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Reads a source file for "does the UI still mention X" assertions. Translated
 * pages keep their visible strings in a sibling `<Name>.i18n.ts` message table,
 * so the table is appended: the assertion still proves the copy ships, whichever
 * file it now lives in.
 */
export function readSourceWithMessages(root: string, path: string): string {
  const source = readFileSync(join(root, path), "utf8");
  const tablePath = path.replace(/\.tsx?$/, ".i18n.ts");
  if (tablePath === path || !existsSync(join(root, tablePath))) return source;
  return `${source}\n${readFileSync(join(root, tablePath), "utf8")}`;
}
