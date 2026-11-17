#!/usr/bin/env node
// Guard: fail on NEW direct journal writes outside the ledger kernel.
//
// Journal entries/lines must be written through one place (server/ledger/) so
// balance, period-lock, numbering, posted-entry immutability and audit rules
// are enforced once. Outside server/ledger/ the guard flags:
//   - Drizzle .insert / .update / .delete on journalEntries or journalLines
//     (drafts are deleted with deleteDraft and edited with updateDraftEntry;
//     posted entries are reversed or voided, never edited or deleted),
//   - transitionRow(...) on the journal tables (status changes go through the
//     kernel's postDraft / voidEntry / reverseEntry),
//   - raw SQL INSERT INTO / UPDATE / DELETE FROM / TRUNCATE on journal_entries
//     or journal_lines,
//   - new storage.createJournalEntry call sites.
// The committed baseline (scripts/guard-baselines/ledger-writes.json) is 0 and
// may only move down.
//
// Usage: node scripts/check-ledger-writes.mjs [--root dir] [--baseline file] [--update] [--json]

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runGuard } from "./guard-baselines/guard-lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const JOURNAL_TABLE = String.raw`(?:\w+\.)?journal(?:Entries|Lines)\b`;

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
    id: "update-journal-tables",
    re: new RegExp(String.raw`\.update\(\s*` + JOURNAL_TABLE, "g"),
    hint: "posted entries are immutable: edit drafts with updateDraftEntry, else reverse/void",
  },
  {
    id: "delete-journal-tables",
    re: new RegExp(String.raw`\.delete\(\s*` + JOURNAL_TABLE, "g"),
    hint: "delete drafts with deleteDraft; reverse or void posted entries",
  },
  {
    id: "transition-journal-rows",
    re: new RegExp(String.raw`transitionRow\s*(?:<[^>]*>)?\(\s*[\w.]+\s*,\s*` + JOURNAL_TABLE, "g"),
    hint: "change journal status through postDraft / voidEntry / reverseEntry",
  },
  {
    id: "raw-sql-journal-write",
    re: /\b(?:DELETE\s+FROM|UPDATE|INSERT\s+INTO|TRUNCATE(?:\s+TABLE)?)\s+(?:ONLY\s+)?(?:"?public"?\.)?"?journal_(?:entries|lines)\b/gi,
    hint: "no raw SQL writes to journal_entries / journal_lines outside server/ledger/",
  },
  {
    id: "storage-create-journal-entry",
    re: /storage\.createJournalEntry\(/g,
    hint: "call the ledger service instead of storage.createJournalEntry",
  },
];

// WP7: the storage bypass methods (updateJournalEntry, deleteJournalEntry,
// createJournalLine, ...) are gone, so only the kernel itself is exempt.
const isAllowed = (rel) => rel.startsWith("server/ledger/");

const code = runGuard({
  name: "check-ledger-writes",
  argv: process.argv.slice(2),
  defaultRoot: root,
  defaultBaseline: join(root, "scripts", "guard-baselines", "ledger-writes.json"),
  description:
    "Ratchet: direct journal writes (insert/update/delete, transitionRow, raw SQL) outside server/ledger/. Kept at 0; regenerate with `node scripts/check-ledger-writes.mjs --update` only after removing call sites.",
  scanCfg: { dirs: ["server"], patterns: LEDGER_WRITE_PATTERNS, isAllowed },
});
process.exit(code);
