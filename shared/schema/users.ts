// User types, users and auth security tables.
// Part of the shared/schema.ts barrel (R20-09); import from "@shared/schema".

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "./columns";
import { z } from "zod";
import { sql } from "drizzle-orm";

// ===========================
// User Types
// ===========================
// admin: NR Accounting staff with full access
// client: Existing NR Accounting clients (invite-only, relationship-based)
// customer: Self-signup SaaS users (tier-based pricing)
// client_portal: NRA-managed company contacts with read-only portal access
export type UserType = "admin" | "client" | "customer" | "client_portal";

// firmRole: NRA firm staff roles for internal management center access
// firm_owner: Full access to all clients in NRA center
// firm_admin: Access only to assigned client companies
// null: Regular user — no NRA features visible
export type FirmRole = "firm_owner" | "firm_admin" | null;

// Shared sliding-window state for HTTP rate limits and credential lockouts.
export const requestThrottleBuckets = pgTable(
  "request_throttle_buckets",
  {
    namespace: text("namespace").notNull(),
    keyHash: text("key_hash").notNull(),
    events: jsonb("events").$type<{ at: number; id?: string }[]>().notNull().default([]),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.namespace, t.keyHash] }),
    index("request_throttle_buckets_expiry_idx").on(t.expiresAt),
  ]
);

// ===========================
// Users
// ===========================
export const users = pgTable("users", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  userType: text("user_type").notNull().default("customer"), // admin | client | customer | client_portal
  firmRole: text("firm_role"), // firm_owner | firm_admin | null
  phone: text("phone"),
  avatarUrl: text("avatar_url"),
  emailVerified: boolean("email_verified").notNull().default(false),
  lastLoginAt: timestamp("last_login_at"),
  // W2-C (0092): bumped on password reset/change and "log out all devices".
  // Access and refresh JWTs carry the version they were issued under (`tv`)
  // and are refused once it no longer matches. Emails are stored lower-cased;
  // 0092 adds a unique index on lower(email).
  tokenVersion: integer("token_version").notNull().default(0),
  passwordChangedAt: timestamp("password_changed_at"),
  // W5-E (0109): TOTP MFA flags. The encrypted secrets (mfa_secret_enc,
  // mfa_pending_secret_enc) and the replay guard (mfa_last_used_step) are deliberately NOT
  // mapped here, so generic user reads (storage.getUser, admin lists) can never return
  // them; only server/services/mfa.service.ts touches those columns.
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  mfaEnrolledAt: timestamp("mfa_enrolled_at"),
  emailVerifiedAt: timestamp("email_verified_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users)
  .omit({
    id: true,
    passwordHash: true,
    createdAt: true,
    emailVerified: true,
    tokenVersion: true,
    passwordChangedAt: true,
    mfaEnabled: true,
    mfaEnrolledAt: true,
    emailVerifiedAt: true,
  })
  .extend({
    password: z.string().min(8, "Password must be at least 8 characters"),
  });

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type UserPublic = Omit<User, "passwordHash">;

// ===========================
// Auth security tables
// ===========================
// Blacklisted JWTs — entries are kept until token expiry, then swept.
export const tokenBlacklist = pgTable("token_blacklist", {
  tokenHash: text("token_hash").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type TokenBlacklistEntry = typeof tokenBlacklist.$inferSelect;

// Rotating refresh sessions. Raw refresh tokens only live in httpOnly cookies;
// the database stores SHA-256 digests so a DB leak cannot mint sessions.
export const refreshSessions = pgTable(
  "refresh_sessions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    replacedByTokenHash: text("replaced_by_token_hash"),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    reuseDetectedAt: timestamp("reuse_detected_at"),
    lastUsedAt: timestamp("last_used_at"),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    tokenHashIdx: index("idx_refresh_sessions_token_hash").on(table.tokenHash),
    userIdIdx: index("idx_refresh_sessions_user_id").on(table.userId),
    expiresAtIdx: index("idx_refresh_sessions_expires_at").on(table.expiresAt),
  })
);

export const insertRefreshSessionSchema = createInsertSchema(refreshSessions).omit({
  id: true,
  createdAt: true,
});

export type InsertRefreshSession = z.infer<typeof insertRefreshSessionSchema>;
export type RefreshSession = typeof refreshSessions.$inferSelect;

// External OpenID Connect identities linked to local users. Roles and access
// always come from the users table; provider claims only prove identity.
export const authIdentities = pgTable(
  "auth_identities",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // google | microsoft
    issuer: text("issuer").notNull(),
    providerSubject: text("provider_subject").notNull(),
    providerEmail: text("provider_email").notNull(),
    providerEmailVerified: boolean("provider_email_verified").notNull().default(false),
    profile: jsonb("profile"),
    linkedAt: timestamp("linked_at").defaultNow().notNull(),
    lastLoginAt: timestamp("last_login_at"),
  },
  (table) => ({
    providerSubjectUnique: unique("auth_identities_provider_subject_unique").on(
      table.provider,
      table.issuer,
      table.providerSubject
    ),
    userProviderIdx: index("idx_auth_identities_user_provider").on(table.userId, table.provider),
    providerEmailIdx: index("idx_auth_identities_provider_email").on(table.providerEmail),
  })
);

export const insertAuthIdentitySchema = createInsertSchema(authIdentities).omit({
  id: true,
  linkedAt: true,
});

export type InsertAuthIdentity = z.infer<typeof insertAuthIdentitySchema>;
export type AuthIdentity = typeof authIdentities.$inferSelect;

// One-time authorization-code state. Secrets are encrypted at rest and the
// state itself is stored only as a hash so DB rows cannot be used as callbacks.
export const oauthLoginStates = pgTable(
  "oauth_login_states",
  {
    stateHash: text("state_hash").primaryKey(),
    provider: text("provider").notNull(),
    encryptedCodeVerifier: text("encrypted_code_verifier").notNull(),
    encryptedNonce: text("encrypted_nonce").notNull(),
    nonceHash: text("nonce_hash").notNull(),
    nextPath: text("next_path").notNull().default("/dashboard"),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    providerIdx: index("idx_oauth_login_states_provider").on(table.provider),
    expiresAtIdx: index("idx_oauth_login_states_expires_at").on(table.expiresAt),
  })
);

export const insertOAuthLoginStateSchema = createInsertSchema(oauthLoginStates).omit({
  createdAt: true,
});

export type InsertOAuthLoginState = z.infer<typeof insertOAuthLoginStateSchema>;
export type OAuthLoginState = typeof oauthLoginStates.$inferSelect;

/** Browser-bound, one-time mailbox proof for a completed Microsoft callback. */
export const oauthMailboxChallenges = pgTable(
  "oauth_mailbox_challenges",
  {
    challengeHash: text("challenge_hash").primaryKey(),
    id: uuid("id")
      .notNull()
      .unique()
      .default(sql`gen_random_uuid()`),
    codeHash: text("code_hash").notNull(),
    issuer: text("issuer").notNull(),
    providerSubject: text("provider_subject").notNull(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    nextPath: text("next_path").notNull(),
    expectedUserId: uuid("expected_user_id").references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
  },
  (table) => ({
    expiresAtIdx: index("idx_oauth_mailbox_challenges_expires_at").on(table.expiresAt),
  })
);

// One-time tokens issued by /auth/forgot-password and consumed by /auth/reset-password.
// Successful resets delete the token. usedAt is retained to reject redeemed legacy rows.
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email"), // Normalized mailbox that received the link. Unbound tokens are rejected.
    tokenHash: text("token_hash").notNull().unique(), // SHA-256 of the token; raw token only ever lives in the email
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    tokenHashIdx: index("idx_password_reset_token_hash").on(table.tokenHash),
    userIdIdx: index("idx_password_reset_user_id").on(table.userId),
  })
);

export const insertPasswordResetTokenSchema = createInsertSchema(passwordResetTokens).omit({
  id: true,
  createdAt: true,
});

export type InsertPasswordResetToken = z.infer<typeof insertPasswordResetTokenSchema>;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

// Email-verification tokens — issued on registration.
export const emailVerificationTokens = pgTable("email_verification_tokens", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  email: text("email"), // Legacy tokens without an address cannot verify an account.
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect;
