export interface DemoActivityCounts {
  invoices: number;
  receipts: number;
  journalEntries: number;
  bankTransactions: number;
}

export function hasTransactionalActivity(counts: DemoActivityCounts): boolean {
  return Object.values(counts).some((count) => count > 0);
}

export function demoDataBlockedMessage(counts: DemoActivityCounts): string {
  const labels: Array<[keyof DemoActivityCounts, string, string]> = [
    ["invoices", "invoice", "invoices"],
    ["receipts", "receipt", "receipts"],
    ["journalEntries", "journal entry", "journal entries"],
    ["bankTransactions", "bank transaction", "bank transactions"],
  ];

  const populated = labels
    .filter(([key]) => counts[key] > 0)
    .map(([key, singular, plural]) => `${counts[key]} ${counts[key] === 1 ? singular : plural}`);

  return populated.length
    ? `Demo data can only be added before transactional activity exists. Found ${populated.join(", ")}.`
    : "Demo data can be added.";
}
