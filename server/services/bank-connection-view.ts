// What a bank connection looks like to a client: never a token, a consent id or the provider's entity id.
// Every route that returns a connection goes through toPublicBankConnection.

export interface PublicBankConnection {
  id: string;
  companyId: string;
  provider: string;
  connectionType: string;
  bankName: string | null;
  accountName: string | null;
  bankAccountId: string | null;
  externalAccountId: string | null;
  accountNumberLast4: string | null;
  iban: string | null;
  autoSync: boolean;
  status: string;
  lastError: string | null;
  lastSyncedAt: Date | string | null;
  environment: string | null;
  consecutiveFailures: number;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}

type ConnectionLike = Record<string, any>;

export function toPublicBankConnection(connection: ConnectionLike): PublicBankConnection {
  return {
    id: connection.id,
    companyId: connection.companyId,
    provider: connection.provider ?? "manual",
    connectionType: connection.connectionType ?? "statement",
    bankName: connection.bankName ?? null,
    accountName: connection.accountName ?? null,
    bankAccountId: connection.bankAccountId ?? null,
    externalAccountId: connection.externalAccountId ?? null,
    accountNumberLast4: connection.accountNumberLast4 ?? null,
    iban: connection.iban ?? null,
    autoSync: connection.autoSync === true,
    status: connection.status ?? "active",
    lastError: connection.lastError ?? null,
    lastSyncedAt: connection.lastSyncedAt ?? null,
    environment: connection.environment ?? null,
    consecutiveFailures: Number(connection.consecutiveFailures ?? 0),
    createdAt: connection.createdAt ?? null,
    updatedAt: connection.updatedAt ?? null,
  };
}
