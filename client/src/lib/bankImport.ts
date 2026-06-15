export interface ExtractedBankTransaction {
  date: string;
  description: string;
  amount: number | string;
  reference?: string | null;
  balance?: number | string | null;
}

export function csvCell(value: string | number | null | undefined): string {
  const raw = value == null ? "" : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

export function rowsToCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function extractedTransactionsToBankCsv(transactions: ExtractedBankTransaction[]): string {
  const rows: Array<Array<string | number | null | undefined>> = [
    ["Date", "Description", "Reference", "Debit", "Credit", "Balance"],
  ];

  for (const transaction of transactions) {
    const amount = Number(transaction.amount);
    if (!transaction.date || !transaction.description || Number.isNaN(amount)) continue;

    rows.push([
      transaction.date,
      transaction.description,
      transaction.reference ?? "",
      amount < 0 ? Math.abs(amount).toFixed(2) : "",
      amount > 0 ? amount.toFixed(2) : "",
      transaction.balance == null ? "" : String(transaction.balance),
    ]);
  }

  return rowsToCsv(rows);
}
