# Archive

Historical audit, teardown, verdict and agent-handoff documents moved out of the repository root
and `docs/` (R20-12). They are kept for provenance only: they overlap, describe past states of the
product, and may contradict each other and the current code. Do not treat anything here as current
guidance; the live docs are `AGENTS.md`, `docs/*.md` and `tests/db/README.md`.

## `root/` — former repository-root documents

| File | Title |
| --- | --- |
| `COMPETITIVE_AUDIT_2026.md` | Muhasib.ai Global Competitive Audit |
| `Digits-Platform-Research.md` | Digits (digits.com) — Comprehensive Platform Research |
| `accounting-software-navigation-research.md` | Accounting Software Navigation Research |
| `muhasibaisource20260611-audit.md` | Source audit of the 2026-06-11 source archive |
| `Muhasib-Teardown-2026-08-07.md` | End-to-End Teardown (1) |
| `Muhasib-Rebuild-Plan.md` | The Rebuild Plan |
| `Muhasib-Fixes-Implemented.md` | What Actually Changed |
| `Muhasib-Verification-Report.md` | Verification Report |
| `Muhasib-Teardown-2-2026-08-13.md` | Second Teardown |
| `Muhasib-Blind-Modules-Closed.md` | Issue #3 Closed — The Eleven Blind Modules |
| `Muhasib-Teardown-3-and-Launch-Verdict.md` | Third Teardown & Launch Verdict |
| `Muhasib-Teardown-4-2026-08-16.md` | Fourth System-Wide Teardown & Launch Verdict |
| `Muhasib-Systemwide-Test-and-Launch-Verdict.md` | System-Wide Test & Launch Verdict |
| `Muhasib-Launch-Readiness-Audit-Fable5.md` | Launch Readiness Audit (Live Production) |
| `Muhasib-Reaudit-Verification-Fable5.md` | Live Re-Audit Verification (post-fix) |
| `test-report.md` | NRA Management Center — Phase 0 & Phase 1 Test Report |
| `Muhasib-Netmara-Accounting-System-Review.{docx,pdf}` | Netmara accounting system review |
| `Muhasib-Netmara-Audit-and-Competitive-Roadmap.{docx,pdf}` | Netmara audit and competitive roadmap |

## `codex/` — agent hand-off and deploy prompts (formerly `docs/CODEX_*`)

`CODEX_DEPLOY_AUTOPILOT_LEARNING.md`, `CODEX_DEPLOY_NOW.md`, `CODEX_DEPLOY_OPTIONAL_HARDENING.md`,
`CODEX_DEPLOY_RECEIPT_AUTOMATION.md`, `CODEX_DEPLOY_VOLUME_PERMS.md`, `CODEX_HANDOFF.md`,
`CODEX_STORAGE_SETUP.md`, `CODEX_TASK_PROMPT.md`, `fable5-launch-readiness.prompt.md`.

## `teardown-evidence/` and `artifacts/`

Scripts and notes produced during the teardowns (`teardown-evidence/`, formerly at the root) and an
earlier agent's planning artefacts (`artifacts/`, formerly at the root). Excluded from lint, tsc,
tests and Prettier.

The marketing sites that used to live at the root are now under `sites/` (also excluded from every
tool) and are not product code.
