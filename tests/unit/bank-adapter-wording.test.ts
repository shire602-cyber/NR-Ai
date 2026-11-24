import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("bank statement operator wording", () => {
  it.each([
    "server/config/env.ts",
    "server/routes/bank.routes.ts",
    "server/services/bank-feeds/index.ts",
    "server/services/email-intake.ts",
    "shared/validators/banking.ts",
  ])("keeps retired wording out of log messages and comments in %s", (file) => {
    // Source inspection covers comments and private logs that the API does not expose.
    // The existing logger context and slash-delimited paths are machine identifiers.
    const source = readFileSync(file, "utf8").replace('createLogger("bank-feeds")', "");
    expect(source).not.toMatch(/(?<![\w/])(?:bank[\s-]+feeds?|open[\s-]+banking)(?![\w/])/iu);
  });
});
