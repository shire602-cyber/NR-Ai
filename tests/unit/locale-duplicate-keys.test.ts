import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error plain .mjs guard script without type declarations
import {
  findDuplicateKeys,
  scanLocaleDuplicates,
} from "../../scripts/check-locale-duplicate-keys.mjs";

// The locale guard must see a repeated key even though JSON.parse hides it (the last one wins).
// This is a unit test of the guard itself plus a run against the real client/src/locales tree.

const repo = resolve(__dirname, "../..");
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "locale-dupes-"));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

describe("findDuplicateKeys", () => {
  it("returns nothing for a clean catalog", () => {
    expect(findDuplicateKeys('{ "a.b": "x", "a.c": "y" }')).toEqual([]);
  });

  it("reports a repeated top-level key with its line", () => {
    const dupes = findDuplicateKeys('{\n  "a": "one",\n  "b": "two",\n  "a": "three"\n}');
    expect(dupes).toEqual([{ key: "a", line: 4, path: "" }]);
  });

  it("reports repeats inside nested objects and arrays, not the same key in sibling objects", () => {
    expect(findDuplicateKeys('{ "x": { "k": 1 }, "y": { "k": 2 } }')).toEqual([]);
    expect(findDuplicateKeys('{ "x": { "k": 1, "k": 2 } }')).toEqual([
      { key: "k", line: 1, path: "x" },
    ]);
    expect(findDuplicateKeys('{ "l": [ { "k": 1, "k": 2 } ] }')).toHaveLength(1);
  });

  it("treats escaped spellings of the same key as a repeat (real file with a literal backslash-u escape)", () => {
    // Written to disk as backslash, u, 0, 0, 6, 1 (not the letter a), so the escape path runs.
    const dir = fixture({ "en/esc.json": '{ "a": 1, "\\u0061": 2 }' });
    const body = readFileSync(join(dir, "en", "esc.json"), "utf8");
    expect(body).toContain(String.fromCharCode(92) + "u0061");
    expect(findDuplicateKeys(body)).toHaveLength(1);
    expect(scanLocaleDuplicates(dir)).toHaveLength(1);
  });

  it("is not fooled by a key text inside a value or escaped quotes", () => {
    expect(findDuplicateKeys('{ "a": "\\"a\\": 1", "b": "a" }')).toEqual([]);
  });

  it("throws on malformed JSON instead of passing it", () => {
    expect(() => findDuplicateKeys('{ "a": 1,, }')).toThrow(/Invalid JSON/);
    expect(() => findDuplicateKeys('{ "a": 1 } x')).toThrow(/Invalid JSON/);
  });
});

describe("check-locale-duplicate-keys script", () => {
  const run = (dir: string) =>
    spawnSync(
      process.execPath,
      [join(repo, "scripts", "check-locale-duplicate-keys.mjs"), "--root", dir],
      { encoding: "utf8" }
    );

  it("fails and names the file, line and key when a catalog repeats a key", () => {
    const dir = fixture({
      "en/common.json": '{\n  "common.save": "Save",\n  "common.save": "Store"\n}',
      "ar/common.json": '{ "common.save": "حفظ" }',
    });
    expect(scanLocaleDuplicates(dir)).toHaveLength(1);
    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/common\.json:3\s+"common\.save"/);
  });

  it("names the file when a catalog is malformed JSON", () => {
    const dir = fixture({ "en/broken.json": '{ "a": 1,, }' });
    expect(() => scanLocaleDuplicates(dir)).toThrow(/broken\.json/);
    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/broken\.json/);
  });

  it("passes on a clean tree", () => {
    const dir = fixture({ "en/a.json": '{ "a": "1" }', "ar/a.json": '{ "a": "١" }' });
    expect(run(dir).status).toBe(0);
  });

  it("the real client/src/locales tree has no duplicate keys", () => {
    expect(scanLocaleDuplicates(join(repo, "client", "src", "locales"))).toEqual([]);
  });
});
