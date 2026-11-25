/**
 * X5 (J1 D6): a queue item (alias `q`) still needs review only while its bank line is open.
 * A line that was reconciled / matched, excluded or deleted in bank reconciliation has been
 * dealt with there, so its suggestion is no longer pending (nothing is rewritten on read).
 */
export const AI_QUEUE_STILL_OPEN_SQL = `NOT EXISTS (
  SELECT 1 FROM bank_transactions bt_done
   WHERE bt_done.id = q.bank_transaction_id
     AND (bt_done.is_reconciled = true OR bt_done.match_status = 'matched'
          OR bt_done.excluded_at IS NOT NULL OR bt_done.deleted_at IS NOT NULL))`;
