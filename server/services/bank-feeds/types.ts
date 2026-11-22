/**
 * Bank adapter contract (W3-C, R06-19). Adapters are pure HTTP clients: they never
 * touch the database. Amounts are integer fils (shared/money.ts), dates are YYYY-MM-DD.
 */
import type { CapabilityId } from "../../../shared/capabilities";
import type { BankFeedProviderId } from "../../../shared/validators/banking";

export interface FeedTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  consentId?: string | null;
}

export interface FeedAccount {
  externalId: string;
  name: string;
  bankName: string;
  iban: string | null;
  currency: string;
  last4: string | null;
}

export interface FeedTransaction {
  externalId: string;
  date: string;
  description: string;
  /** Signed: positive = money in, negative = money out. */
  amountFils: number;
  reference: string | null;
  balanceFils: number | null;
}

export interface FeedTransactionsResult {
  transactions: FeedTransaction[];
  /** Provider rows that could not be read (bad date / amount); never imported. */
  rejected: Array<{ externalId: string | null; reason: string }>;
}

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export interface BankFeedAdapter {
  id: BankFeedProviderId;
  capability: CapabilityId;
  label: string;
  /** Env vars present (names only). */
  isConfigured(): boolean;
  authorizeUrl(input: { state: string; redirectUri: string }): string;
  exchangeCode(input: { code: string; redirectUri: string }): Promise<FeedTokens>;
  listAccounts(tokens: FeedTokens): Promise<FeedAccount[]>;
  fetchTransactions(
    tokens: FeedTokens,
    externalAccountId: string,
    from: string,
    to: string
  ): Promise<FeedTransactionsResult>;
  /** null when the provider has no refresh (e.g. Lean entities). */
  refresh(tokens: FeedTokens): Promise<FeedTokens | null>;
}

export class BankFeedProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}
