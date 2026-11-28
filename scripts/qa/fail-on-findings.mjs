// Shared exit decision for the read-only QA finders (opt-in `--fail-on-findings`).
//
// Default behaviour of every finder is unchanged (exit 0 for a completed report). With the flag,
// a run that reports at least one actionable finding exits 1, so the release rehearsal gate can
// fail on findings and not just on crashes. Exit 2 stays reserved for usage errors.

export const FAIL_ON_FINDINGS_FLAG = "--fail-on-findings";

export function failOnFindingsRequested(argv) {
  return argv.includes(FAIL_ON_FINDINGS_FLAG);
}

/** Total of the actionable finding lists (informational lists are not passed in). */
export function countFindings(lists) {
  return Object.values(lists).reduce((sum, list) => sum + list.length, 0);
}

/**
 * Exit code for a finished report: 1 only when the flag is set and `lists` holds a finding.
 * `lists` maps a finding name to its rows. Writes a one-line summary to stderr when failing.
 */
export function findingsExitCode(argv, lists, script) {
  if (!failOnFindingsRequested(argv)) return 0;
  const total = countFindings(lists);
  if (total === 0) return 0;
  const detail = Object.entries(lists)
    .filter(([, list]) => list.length > 0)
    .map(([name, list]) => `${name}=${list.length}`)
    .join(", ");
  console.error(
    `${script}: ${total} finding(s) (${detail}); failing because ${FAIL_ON_FINDINGS_FLAG} is set`
  );
  return 1;
}
