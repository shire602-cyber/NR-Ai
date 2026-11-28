import type { EcommerceIntegration } from "../../../shared/schema";

/** The platform refused the credentials (HTTP 401/403). */
export class PlatformAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformAuthError";
  }
}

/** The platform answered with an unexpected status or shape. */
export class PlatformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformError";
  }
}

export interface SyncCounts {
  imported: number;
  skipped: number;
  documents: number;
  pending: number;
}

export interface RecordTransactionInput {
  externalId: string;
  transactionType: string;
  amount: string; // major units, signed
  currency: string;
  customerName?: string | null;
  customerEmail?: string | null;
  description?: string | null;
  status: string;
  transactionDate: string; // ISO
  platformFees?: string | null;
  netAmount?: string | null;
  metadata?: Record<string, unknown>;
}

export interface StoredTransaction {
  id: string;
  externalId: string;
  transactionDate: Date;
  metadata: Record<string, unknown>;
}

export interface AdapterContext {
  companyId: string;
  actorUserId: string | null;
  integration: EcommerceIntegration;
  credentials: { accessToken: string | null; apiKey: string | null };
  /** Insert once; false when this external id was already imported. */
  recordTransaction(input: RecordTransactionInput): Promise<string | null>;
  linkDocument(externalId: string, invoiceId: string, status?: string): Promise<void>;
  linkBankTransaction(externalId: string, bankTransactionId: string): Promise<void>;
  documentFor(externalId: string): Promise<{ id: string; status: string } | null>;
  pendingRefunds(): Promise<StoredTransaction[]>;
}
