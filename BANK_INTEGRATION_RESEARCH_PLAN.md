# Bank Integration Research Plan

## Goal

Define the safest and most commercially useful path for live bank feeds without implementing bank connectivity in the production-hardening batch.

## Research Questions

- Coverage: Compare Plaid, Finicity, TrueLayer, Lean, Tarabut Gateway, Yapily, and UAE bank-specific APIs for UAE/GCC coverage, OAuth support, refresh cadence, transaction history depth, and sandbox quality.
- Consent UX: Document the user consent flow, reconnection flow, revoked-consent handling, MFA/OTP expectations, and required disclosures.
- Data Model: Map provider institutions, accounts, balances, transactions, pending transactions, refresh status, webhooks, and reconciliation links onto the existing `bank_accounts` and `bank_transactions` model.
- Security: Review token storage, encryption-at-rest needs, least-privilege scopes, webhook signing, replay protection, provider IP allowlists, audit logging, and incident response.
- Product Fit: Compare the resulting scope against Digits' public positioning: bank feeds, real-time dashboards, transaction questions, AI bookkeeping, month-end close, and accounting-system sync.
- Cost and Operations: Capture provider pricing, per-connection costs, support burden, failure modes, SLA, data retention, and manual fallback workflow.

## Recommended Output

- Provider scorecard with UAE/GCC coverage as the primary weighting.
- Proposed v1 architecture and sequence diagram.
- Migration/API plan for connected bank accounts.
- Risk register and security review checklist.
- Implementation estimate split into discovery, provider sandbox, production pilot, and general availability.

## Explicit Non-Goals

- No provider SDK is added in this batch.
- No customer bank credentials, access tokens, or refresh tokens are stored until the provider/security decision is complete.
- No direct bank-feed UI is shipped without sandbox validation and legal/privacy review.
