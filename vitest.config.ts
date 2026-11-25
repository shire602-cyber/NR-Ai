import { defineConfig } from "vitest/config";
import fs from "fs";
import path from "path";

// Coverage thresholds live in a committed ratchet file so raising them is a
// one-line, reviewable change. Plan: 25% after wave 3, 40% after wave 4, 50%
// at the end (see tests/helpers/coverage-ratchet.json). Never lower them.
const coverageRatchet = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "tests/helpers/coverage-ratchet.json"), "utf8")
) as { thresholds: { statements: number; branches: number; functions: number; lines: number } };

export default defineConfig({
  // R20-14: tsconfig keeps `jsx: preserve` for Vite; client behaviour tests render real
  // components, so tests transform JSX with the automatic runtime.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    globals: true,
    environment: "node",
    // Scope test discovery to our own source trees. Without this, vitest
    // walks every sibling .claude/worktrees/*/node_modules and tries to
    // execute third-party package test files (pino, thread-stream,
    // pdfme/pdf-lib…), which all fail because their devDependencies
    // aren't installed in our tree.
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.spec.ts",
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "client/src/**/*.test.ts",
      "client/src/**/*.spec.ts",
      "shared/**/*.test.ts",
      "shared/**/*.spec.ts",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "backend",
      "frontend",
      ".claude/**",
      "sites/**",
      // Real-Postgres suites run under `npm run test:db` (tests/db/vitest.config.ts).
      "tests/db/**",
      "tests/integration/credit-note-consolidation.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["server/**/*.ts", "shared/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.spec.ts", "server/vite.ts"],
      // Baseline ratchet from the 2026-06-13 clean audit. Raise these as
      // integration and route-level coverage lands; do not lower them
      // without updating the production-readiness evidence.
      thresholds: coverageRatchet.thresholds,
    },
    setupFiles: ["./tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client/src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
});
