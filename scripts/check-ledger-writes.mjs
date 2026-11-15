#!/usr/bin/env node
// Guard: fail on NEW direct journal writes outside the ledger module.
//
// Journal entries/lines must be written through one place (server/ledger/,
// plus the legacy server/storage.ts) so balance, period-lock, numbering and
// audit rules are enforced once. Today's direct call sites are recorded in
// scripts/guard-baselines/ledger-writes.json; later waves move them behind
// the ledger service and ratchet the baseline down with --update.
//
// Usage: node scripts/check-ledger-writes.mjs [--root dir] [--baseline file] [--update] [--json]

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runGuard } from "./guard-baselines/guard-lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const LEDGER_WRITE_PATTERNS = [
  {
    id: "insert-journal-entries",
    re: /\.insert\(\s*(?:\w+\.)?journalEntries\b/g,
    hint: "insert journal entries through server/ledger/",
  },
  {
    id: "insert-journal-lines",
    re: /\.insert\(\s*(?:\w+\.)?journalLines\b/g,
    hint: "insert journal lines through server/ledger/",
  },
  {
    id: "storage-create-journal-entry",
    re: /storage\.createJournalEntry\(/g,
    hint: "call the ledger service instead of storage.createJournalEntry",
  },
];

const isAllowed = (rel) => rel.startsWith("server/ledger/") || rel === "server/storage.ts";

const code = runGuard({
  name: "check-ledger-writes",
  argv: process.argv.slice(2),
  defaultRoot: root,
  defaultBaseline: join(root, "scripts", "guard-baselines", "ledger-writes.json"),
  description:
    "Ratchet: direct journal writes outside server/ledger/ and server/storage.ts. Burn down to empty; regenerate with `node scripts/check-ledger-writes.mjs --update` only after removing call sites.",
  scanCfg: { dirs: ["server"], patterns: LEDGER_WRITE_PATTERNS, isAllowed },
});
process.exit(code);
