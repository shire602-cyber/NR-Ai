/**
 * Integration counters come only from rows the server returned. Nothing is
 * estimated or defaulted: with no connected platform there is no summary at all
 * (the page hides the Transactions view), and with no imported rows every
 * counter is absent rather than a made-up figure.
 */
export interface IntegrationLike {
  isActive: boolean;
  connectionStatus?: "not_connected" | "connected" | "error";
}

export interface ImportedTransactionLike {
  isReconciled: boolean;
}

export function isIntegrationConnected(integration: IntegrationLike | undefined): boolean {
  return !!integration?.isActive && integration.connectionStatus === "connected";
}

export function connectedCount(integrations: readonly IntegrationLike[] | undefined): number {
  return (integrations ?? []).filter(isIntegrationConnected).length;
}

export interface TransactionSummary {
  total: number;
  reconciled: number;
  awaitingReconciliation: number;
}

/** `null` when there is nothing real to summarise. */
export function summarizeImportedTransactions(
  rows: readonly ImportedTransactionLike[] | undefined
): TransactionSummary | null {
  const list = rows ?? [];
  if (list.length === 0) return null;
  const reconciled = list.filter((row) => row.isReconciled).length;
  return { total: list.length, reconciled, awaitingReconciliation: list.length - reconciled };
}
