import { createLogger } from '../config/logger';
import { getEnv } from '../config/env';

const log = createLogger('open-banking');

// Provider interface
export interface BankProvider {
  name: string;
  getAuthUrl(companyId: string, redirectUrl: string): Promise<string>;
  handleCallback(code: string, state: string): Promise<BankTokens>;
  fetchAccounts(accessToken: string): Promise<BankAccountInfo[]>;
  fetchTransactions(accessToken: string, accountId: string, fromDate: Date, toDate: Date): Promise<BankTransactionData[]>;
  fetchBalance(accessToken: string, accountId: string): Promise<BankBalanceData>;
  refreshToken(refreshToken: string): Promise<BankTokens>;
}

export interface BankTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  consentId?: string;
}

export interface BankAccountInfo {
  externalId: string;
  iban: string;
  bankName: string;
  accountType: string;
  currency: string;
  last4: string;
}

export interface BankTransactionData {
  externalId: string;
  date: Date;
  description: string;
  amount: number; // positive = credit, negative = debit
  reference?: string;
  category?: string;
  balance?: number;
}

export interface BankBalanceData {
  available: number;
  current: number;
  currency: string;
  asOf: Date;
}

// Wio Bank provider implementation
class WioBankProvider implements BankProvider {
  name = 'wio';

  private get baseUrl(): string {
    const env = getEnv();
    return (env as any).WIO_API_BASE_URL || 'https://api.business.wio.io';
  }

  private get clientId(): string {
    const env = getEnv();
    return (env as any).WIO_CLIENT_ID || '';
  }

  private get clientSecret(): string {
    const env = getEnv();
    return (env as any).WIO_CLIENT_SECRET || '';
  }

  async getAuthUrl(companyId: string, redirectUrl: string): Promise<string> {
    // OAuth 2.0 authorization code flow with FAPI 2.0 profile
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: redirectUrl,
      scope: 'accounts transactions balances',
      state: companyId,
    });
    return `${this.baseUrl}/oauth2/authorize?${params.toString()}`;
  }

  async handleCallback(code: string, state: string): Promise<BankTokens> {
    const response = await fetch(`${this.baseUrl}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      log.error({ status: response.status, error }, 'Wio token exchange failed');
      throw new Error('Failed to exchange authorization code');
    }

    const data = await response.json() as any;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000),
      consentId: data.consent_id,
    };
  }

  async fetchAccounts(accessToken: string): Promise<BankAccountInfo[]> {
    const response = await fetch(`${this.baseUrl}/open-banking/v1/accounts`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) throw new Error('Failed to fetch accounts');
    const data = await response.json() as any;

    return (data.accounts || []).map((acc: any) => ({
      externalId: acc.accountId || acc.id,
      iban: acc.iban || '',
      bankName: 'Wio Bank',
      accountType: acc.accountType || 'current',
      currency: acc.currency || 'AED',
      last4: (acc.iban || '').slice(-4),
    }));
  }

  async fetchTransactions(accessToken: string, accountId: string, fromDate: Date, toDate: Date): Promise<BankTransactionData[]> {
    const params = new URLSearchParams({
      fromDate: fromDate.toISOString().split('T')[0],
      toDate: toDate.toISOString().split('T')[0],
    });

    const response = await fetch(
      `${this.baseUrl}/open-banking/v1/accounts/${accountId}/transactions?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!response.ok) throw new Error('Failed to fetch transactions');
    const data = await response.json() as any;

    return (data.transactions || []).map((tx: any) => ({
      externalId: tx.transactionId || tx.id,
      date: new Date(tx.bookingDate || tx.date),
      description: tx.description || tx.remittanceInfo || '',
      amount: tx.creditDebitIndicator === 'Credit' ? Math.abs(tx.amount) : -Math.abs(tx.amount),
      reference: tx.reference || tx.endToEndId || '',
      balance: tx.runningBalance,
    }));
  }

  async fetchBalance(accessToken: string, accountId: string): Promise<BankBalanceData> {
    const response = await fetch(
      `${this.baseUrl}/open-banking/v1/accounts/${accountId}/balances`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!response.ok) throw new Error('Failed to fetch balance');
    const data = await response.json() as any;
    const balance = data.balances?.[0] || {};

    return {
      available: balance.amount?.available || 0,
      current: balance.amount?.current || balance.amount?.booked || 0,
      currency: balance.currency || 'AED',
      asOf: new Date(),
    };
  }

  async refreshToken(refreshToken: string): Promise<BankTokens> {
    const response = await fetch(`${this.baseUrl}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });

    if (!response.ok) throw new Error('Failed to refresh token');
    const data = await response.json() as any;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000),
    };
  }
}

// Lean Technologies provider (UAE aggregator)
class LeanProvider implements BankProvider {
  name = 'lean';

  private get baseUrl(): string {
    const env = getEnv();
    return (env as any).LEAN_API_BASE_URL || 'https://api.leantech.me/v1';
  }

  private get appToken(): string {
    const env = getEnv();
    return (env as any).LEAN_APP_TOKEN || '';
  }

  // ... implement similarly with Lean Technologies API patterns
  // Lean uses a different auth flow (entity linking via their SDK)

  async getAuthUrl(companyId: string, redirectUrl: string): Promise<string> {
    // Lean uses their frontend SDK for entity linking, not a redirect URL
    // This returns a placeholder — actual implementation uses Lean's JS SDK on the client
    return `https://cdn.leantech.me/link/loader.html?app_token=${this.appToken}&redirect_uri=${encodeURIComponent(redirectUrl)}&state=${companyId}`;
  }

  async handleCallback(code: string, _state: string): Promise<BankTokens> {
    // Lean returns an entity_id after linking, not a traditional OAuth code
    return {
      accessToken: code, // entity_id from Lean
      refreshToken: '',
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // Lean entities don't expire
    };
  }

  async fetchAccounts(accessToken: string): Promise<BankAccountInfo[]> {
    const response = await fetch(`${this.baseUrl}/identity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'lean-app-token': this.appToken,
      },
      body: JSON.stringify({ entity_id: accessToken }),
    });

    if (!response.ok) throw new Error('Failed to fetch Lean accounts');
    const data = await response.json() as any;

    return (data.results?.accounts || []).map((acc: any) => ({
      externalId: acc.account_id,
      iban: acc.iban || '',
      bankName: acc.institution?.name || 'Unknown Bank',
      accountType: acc.type || 'current',
      currency: acc.currency || 'AED',
      last4: (acc.iban || acc.account_number || '').slice(-4),
    }));
  }

  async fetchTransactions(accessToken: string, accountId: string, fromDate: Date, toDate: Date): Promise<BankTransactionData[]> {
    const response = await fetch(`${this.baseUrl}/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'lean-app-token': this.appToken,
      },
      body: JSON.stringify({
        entity_id: accessToken,
        account_id: accountId,
        start_date: fromDate.toISOString().split('T')[0],
        end_date: toDate.toISOString().split('T')[0],
      }),
    });

    if (!response.ok) throw new Error('Failed to fetch Lean transactions');
    const data = await response.json() as any;

    return (data.results || []).map((tx: any) => ({
      externalId: tx.transaction_id,
      date: new Date(tx.date),
      description: tx.description || '',
      amount: tx.type === 'credit' ? Math.abs(tx.amount) : -Math.abs(tx.amount),
      reference: tx.reference || '',
    }));
  }

  async fetchBalance(accessToken: string, accountId: string): Promise<BankBalanceData> {
    const response = await fetch(`${this.baseUrl}/balance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'lean-app-token': this.appToken,
      },
      body: JSON.stringify({ entity_id: accessToken, account_id: accountId }),
    });

    if (!response.ok) throw new Error('Failed to fetch Lean balance');
    const data = await response.json() as any;

    return {
      available: data.results?.available_balance || 0,
      current: data.results?.current_balance || 0,
      currency: data.results?.currency || 'AED',
      asOf: new Date(),
    };
  }

  async refreshToken(_refreshToken: string): Promise<BankTokens> {
    // Lean entities don't expire — no refresh needed
    throw new Error('Lean entities do not require token refresh');
  }
}

// Provider registry
const providers: Record<string, BankProvider> = {
  wio: new WioBankProvider(),
  lean: new LeanProvider(),
};

export function getBankProvider(name: string): BankProvider | null {
  return providers[name] || null;
}

export function getAvailableProviders(): string[] {
  const env = getEnv() as any;
  const available: string[] = [];
  if (env.WIO_CLIENT_ID) available.push('wio');
  if (env.LEAN_APP_TOKEN) available.push('lean');
  return available;
}

export function isOpenBankingConfigured(): boolean {
  return getAvailableProviders().length > 0;
}

/**
 * Check if a token needs refresh (expires within 5 minutes)
 */
export function tokenNeedsRefresh(expiresAt: Date | null): boolean {
  if (!expiresAt) return true;
  return new Date() >= new Date(expiresAt.getTime() - 5 * 60 * 1000);
}
