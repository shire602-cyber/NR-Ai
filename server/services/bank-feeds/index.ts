import { eq, isNotNull, isNull, or } from "drizzle-orm";
import { db } from "../../db";
import { DomainError } from "../../errors";
import { BANK_RECONCILIATION_COPY } from "../../../shared/bank-reconciliation-copy";
import {
  bankConnections,
  bankFeedOauthStates,
  type BankConnection,
} from "../../../shared/schema";

/** Remove retired credentials and invalidate outstanding returns while preserving statement history. */
export async function retireAutomaticBanking(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(bankConnections)
      .set({
        autoSync: false,
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        consentId: null,
      })
      .where(
        or(
          eq(bankConnections.autoSync, true),
          isNotNull(bankConnections.accessToken),
          isNotNull(bankConnections.refreshToken),
          isNotNull(bankConnections.tokenExpiresAt),
          isNotNull(bankConnections.consentId)
        )
      );
    await tx
      .update(bankFeedOauthStates)
      .set({ usedAt: new Date() })
      .where(isNull(bankFeedOauthStates.usedAt));
  });
}

export function retiredBankingError(): DomainError {
  return new DomainError("BANK_FEED_NOT_SUPPORTED", 410, undefined, BANK_RECONCILIATION_COPY.en);
}

/** Public view of a historical connection. */
export function sanitizeConnection(connection: BankConnection) {
  const {
    accessToken: _access,
    refreshToken: _refresh,
    tokenExpiresAt: _expiry,
    consentId: _consent,
    ...rest
  } = connection;
  void _access;
  void _refresh;
  void _expiry;
  void _consent;
  return {
    ...rest,
    provider: "manual",
    connectionType: "statement",
    hasToken: false,
    autoSync: false,
    lastError: rest.lastError ? BANK_RECONCILIATION_COPY.en : null,
  };
}
