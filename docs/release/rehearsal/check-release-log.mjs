/* global process, console */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function assertReleaseCompleted(log) {
  let guard;
  let completed = false;
  for (const line of log.split(/\r?\n/)) {
    if (!line.trimStart().startsWith("{")) continue;
    const record = JSON.parse(line);
    if (record.msg === "Critical schema guard completed") {
      if (
        guard ||
        record.failed !== 0 ||
        !Number.isInteger(record.ok) ||
        record.ok <= 0 ||
        record.mode !== "schema-only"
      ) {
        throw new Error("Expected exactly one successful critical schema guard");
      }
      guard = record;
    }
    if (record.msg === "Production migration completed" && guard) completed = true;
  }
  if (!completed) throw new Error("Missing successful schema guard or release completion");
  return guard;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(assertReleaseCompleted(readFileSync(process.argv[2], "utf8"))));
}
