import { readFileSync } from "node:fs";
import { readSourceWithMessages } from "../helpers/read-source";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function readRepoFile(path: string): string {
  return readSourceWithMessages(repoRoot, path);
}

describe("command palette accessibility", () => {
  it("gives the command dialog a screen-reader title", () => {
    const commandSource = readRepoFile("client/src/components/ui/command.tsx");

    expect(commandSource).toContain("DialogTitle");
    expect(commandSource).toContain('<DialogTitle className="sr-only">{');
    expect(commandSource).toContain("Command palette");
  });
});
