// Stored bytes per company, for the storage cap (X6b) and the subscription usage meter.
// Counts what customers upload: receipt images kept in the database and journal attachments.
import { pq } from "./connectors/pq";

export async function companyStorageBytes(companyId: string): Promise<number> {
  const { rows } = await pq<{ bytes: string | null }>(
    `SELECT (SELECT COALESCE(SUM(octet_length(image_data)), 0) FROM receipts WHERE company_id = $1)
          + (SELECT COALESCE(SUM(size_bytes), 0) FROM journal_attachments WHERE company_id = $1)
            AS bytes`,
    [companyId]
  );
  return Number(rows[0]?.bytes ?? 0);
}
