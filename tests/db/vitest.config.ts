import { defineConfig } from "vitest/config";
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "../..");
const dbCoverageThresholds = (
  JSON.parse(
    fs.readFileSync(path.resolve(root, "tests/helpers/coverage-ratchet.json"), "utf8")
  ) as { db?: Record<string, number> }
).db;

// `npm run test:db` — real-Postgres suites. Each test file gets its own
// database cloned from a template migrated once per run (global-setup.ts).
export default defineConfig({
  root,
  test: {
    globals: true,
    environment: "node",
    include: ["tests/db/**/*.test.ts", "tests/integration/credit-note-consolidation.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", ".claude/**", "sites/**"],
    globalSetup: ["tests/db/global-setup.ts"],
    setupFiles: ["tests/db/setup-env.ts"],
    pool: "forks",
    // Every worker boots the full app + a pg pool; keep the fan-out modest on
    // shared 4-core boxes. Override with --maxWorkers.
    maxWorkers: Number(process.env.HARNESS_MAX_WORKERS || 2),
    testTimeout: 120_000,
    hookTimeout: 300_000,
    teardownTimeout: 60_000,
    // R20-14: `npm run test:db -- --coverage` measures the real-Postgres suites over the
    // same source set as the unit run (thresholds: tests/helpers/coverage-ratchet.json "db").
    coverage: {
      provider: "v8",
      include: ["server/**/*.ts", "shared/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.spec.ts", "server/vite.ts"],
      reportsDirectory: "coverage/db",
      thresholds: dbCoverageThresholds,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(root, "client/src"),
      "@shared": path.resolve(root, "shared"),
    },
  },
});
