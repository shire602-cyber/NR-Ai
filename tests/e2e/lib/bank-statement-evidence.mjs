export const BANK_STATEMENT_PROBE = "CSV statement upload and reconciliation";

const outcome = (check, field) => (check ? (check[field] === true ? "pass" : "fail") : "not-run");

export function bankStatementEvidence(routeChecks, fixtureProbes) {
  return {
    reconciliationPageVisit: outcome(
      routeChecks.find((route) => route.href === "/bank-reconciliation"),
      "ok"
    ),
    uploadAndReconcile: outcome(
      fixtureProbes.find((probe) => probe.name === BANK_STATEMENT_PROBE),
      "passed"
    ),
  };
}

export function bankStatementReportRow(evidence) {
  const visit = {
    pass: "The crawl opened Bank reconciliation.",
    fail: "The Bank reconciliation page visit failed.",
    "not-run": "The Bank reconciliation page visit was not run.",
  }[evidence.reconciliationPageVisit];
  const [status, workflow] = {
    pass: ["Pass", "The fixture uploaded a CSV statement and verified a reconciled transaction."],
    fail: ["Fail", "The fixture did not verify CSV upload and reconciliation."],
    "not-run": [
      evidence.reconciliationPageVisit === "pass" ? "Visit only" : "Review",
      "CSV upload and reconciliation require a functional run.",
    ],
  }[evidence.uploadAndReconcile];
  return ["Bank statements and rules", status, `${visit} ${workflow}`];
}
