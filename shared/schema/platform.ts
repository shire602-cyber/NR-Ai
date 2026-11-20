// Onboarding, help tips, referrals, feedback, analytics, admin settings.
// Part of the shared/schema.ts barrel (R20-09); import from "@shared/schema".

import {
  bigint,
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { z } from "zod";
import { sql } from "drizzle-orm";
import { createInsertSchema, money } from "./columns";
import { users } from "./users";
import { companies } from "./companies";

// ===========================
// User Onboarding Progress
// ===========================
export const userOnboarding = pgTable(
  "user_onboarding",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Onboarding steps completed
    hasCompletedWelcome: boolean("has_completed_welcome").notNull().default(false),
    hasCreatedCompany: boolean("has_created_company").notNull().default(false),
    hasSetupChartOfAccounts: boolean("has_setup_chart_of_accounts").notNull().default(false),
    hasCreatedFirstInvoice: boolean("has_created_first_invoice").notNull().default(false),
    hasUploadedFirstReceipt: boolean("has_uploaded_first_receipt").notNull().default(false),
    hasViewedReports: boolean("has_viewed_reports").notNull().default(false),
    hasExploredAI: boolean("has_explored_ai").notNull().default(false),
    hasConfiguredReminders: boolean("has_configured_reminders").notNull().default(false),
    // Progress tracking
    currentStep: integer("current_step").notNull().default(0),
    totalSteps: integer("total_steps").notNull().default(8),
    isOnboardingComplete: boolean("is_onboarding_complete").notNull().default(false),
    completedAt: timestamp("completed_at"),
    // UI preferences
    showTips: boolean("show_tips").notNull().default(true),
    showTour: boolean("show_tour").notNull().default(true),
    // R18-03: set once when the welcome tour is shown/dismissed so it appears at
    // most once per user (column added by migration 0089).
    tourDismissedAt: timestamp("tour_dismissed_at"),
    dismissedTips: text("dismissed_tips"), // JSON array of dismissed tip IDs
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("idx_user_onboarding_user_id").on(table.userId),
  })
);

export const insertUserOnboardingSchema = createInsertSchema(userOnboarding).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUserOnboarding = z.infer<typeof insertUserOnboardingSchema>;
export type UserOnboarding = typeof userOnboarding.$inferSelect;

// ===========================
// Help Tips (contextual help)
// ===========================
export const helpTips = pgTable("help_tips", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tipKey: text("tip_key").notNull().unique(), // Unique identifier for the tip location
  title: text("title").notNull(),
  titleAr: text("title_ar"),
  content: text("content").notNull(),
  contentAr: text("content_ar"),
  pageContext: text("page_context").notNull(), // dashboard | invoices | receipts | journal | reports | settings
  targetElement: text("target_element"), // CSS selector for element to highlight
  tipType: text("tip_type").notNull().default("tooltip"), // tooltip | popover | modal | tour_step
  order: integer("order").default(0), // For tour ordering
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertHelpTipSchema = createInsertSchema(helpTips).omit({
  id: true,
  createdAt: true,
});

export type InsertHelpTip = z.infer<typeof insertHelpTipSchema>;
export type HelpTip = typeof helpTips.$inferSelect;

// ===========================
// Referral Codes
// ===========================
export const referralCodes = pgTable("referral_codes", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(), // Unique referral code
  customSlug: text("custom_slug").unique(), // User-friendly custom slug
  isActive: boolean("is_active").notNull().default(true),
  // Reward configuration
  referrerRewardType: text("referrer_reward_type").default("credit"), // credit | discount | subscription_days
  referrerRewardValue: money("referrer_reward_value").default(0),
  refereeRewardType: text("referee_reward_type").default("discount"), // credit | discount | trial_extension
  refereeRewardValue: money("referee_reward_value").default(0),
  // Tracking
  totalReferrals: integer("total_referrals").notNull().default(0),
  successfulReferrals: integer("successful_referrals").notNull().default(0),
  totalRewardsEarned: money("total_rewards_earned").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
});

export const insertReferralCodeSchema = createInsertSchema(referralCodes).omit({
  id: true,
  createdAt: true,
});

export type InsertReferralCode = z.infer<typeof insertReferralCodeSchema>;
export type ReferralCode = typeof referralCodes.$inferSelect;

// ===========================
// Referrals (tracking sign-ups)
// ===========================
export const referrals = pgTable("referrals", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  referralCodeId: uuid("referral_code_id")
    .notNull()
    .references(() => referralCodes.id, { onDelete: "cascade" }),
  referrerId: uuid("referrer_id")
    .notNull()
    .references(() => users.id),
  refereeId: uuid("referee_id").references(() => users.id), // Null until they sign up
  refereeEmail: text("referee_email"), // Email before sign-up
  status: text("status").notNull().default("pending"), // pending | signed_up | qualified | rewarded | expired
  // Reward tracking
  referrerRewardStatus: text("referrer_reward_status").default("pending"), // pending | credited | used
  refereeRewardStatus: text("referee_reward_status").default("pending"),
  referrerRewardAmount: money("referrer_reward_amount"),
  refereeRewardAmount: money("referee_reward_amount"),
  // Qualification criteria
  qualificationCriteria: text("qualification_criteria"), // JSON with criteria met
  qualifiedAt: timestamp("qualified_at"),
  rewardedAt: timestamp("rewarded_at"),
  // Tracking
  signupSource: text("signup_source"), // link | email | social
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
});

// W5-B (0106, R19-11): referral rewards ledger. Applied as a Stripe credit on the referred
// customer's first paid invoice; recorded here (status "ledgered") when Stripe is not configured.
export const billingCredits = pgTable("billing_credits", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  referralId: uuid("referral_id").references(() => referrals.id, { onDelete: "set null" }),
  beneficiary: text("beneficiary").notNull().default("referee"), // referee | referrer
  source: text("source").notNull().default("referral"),
  kind: text("kind").notNull().default("credit"), // credit | percent_off
  amountFils: bigint("amount_fils", { mode: "number" }).notNull().default(0),
  percentOff: numeric("percent_off", { precision: 5, scale: 2 }),
  currency: text("currency").notNull().default("AED"),
  status: text("status").notNull().default("ledgered"), // ledgered | applied_stripe | applied
  stripeRef: text("stripe_ref"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  appliedAt: timestamp("applied_at"),
});
export type BillingCredit = typeof billingCredits.$inferSelect;

export const insertReferralSchema = createInsertSchema(referrals).omit({
  id: true,
  createdAt: true,
});

export type InsertReferral = z.infer<typeof insertReferralSchema>;
export type Referral = typeof referrals.$inferSelect;

// ===========================
// User Feedback
// ===========================
export const userFeedback = pgTable("user_feedback", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
  feedbackType: text("feedback_type").notNull(), // bug | feature_request | improvement | praise | complaint | nps | survey
  category: text("category"), // ui | performance | feature | billing | support | other
  pageContext: text("page_context"), // Which page they were on
  rating: integer("rating"), // 1-5 or 0-10 for NPS
  title: text("title"),
  message: text("message").notNull(),
  screenshot: text("screenshot"), // Base64 or URL
  browserInfo: text("browser_info"), // JSON with browser/device info
  // Response tracking
  status: text("status").notNull().default("new"), // new | reviewed | in_progress | resolved | wont_fix
  assignedTo: text("assigned_to"),
  responseMessage: text("response_message"),
  respondedAt: timestamp("responded_at"),
  // Contact preference
  allowContact: boolean("allow_contact").notNull().default(true),
  contactEmail: text("contact_email"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserFeedbackSchema = createInsertSchema(userFeedback).omit({
  id: true,
  createdAt: true,
});

export type InsertUserFeedback = z.infer<typeof insertUserFeedbackSchema>;
export type UserFeedback = typeof userFeedback.$inferSelect;

// ===========================
// Analytics Events
// ===========================
export const analyticsEvents = pgTable("analytics_events", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
  sessionId: text("session_id"),
  eventType: text("event_type").notNull(), // page_view | click | feature_use | error | conversion | search
  eventName: text("event_name").notNull(), // Specific event identifier
  pageUrl: text("page_url"),
  pageTitle: text("page_title"),
  // Event-specific data
  properties: text("properties"), // JSON with event properties
  value: real("value"), // Numeric value if applicable
  // Context
  referrer: text("referrer"),
  deviceType: text("device_type"), // desktop | mobile | tablet
  browser: text("browser"),
  os: text("os"),
  country: text("country"),
  language: text("language"),
  // Timing
  duration: integer("duration"), // Time spent in ms
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAnalyticsEventSchema = createInsertSchema(analyticsEvents).omit({
  id: true,
  createdAt: true,
});

export type InsertAnalyticsEvent = z.infer<typeof insertAnalyticsEventSchema>;
export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;

// ===========================
// Feature Usage Metrics (aggregated)
// ===========================
export const featureUsageMetrics = pgTable("feature_usage_metrics", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  featureName: text("feature_name").notNull(),
  period: text("period").notNull(), // daily | weekly | monthly
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  totalUsers: integer("total_users").notNull().default(0),
  totalSessions: integer("total_sessions").notNull().default(0),
  totalEvents: integer("total_events").notNull().default(0),
  avgDuration: real("avg_duration"), // Average time spent
  conversionRate: real("conversion_rate"), // If applicable
  errorRate: real("error_rate"),
  calculatedAt: timestamp("calculated_at").defaultNow().notNull(),
});

export const insertFeatureUsageMetricSchema = createInsertSchema(featureUsageMetrics).omit({
  id: true,
  calculatedAt: true,
});

export type InsertFeatureUsageMetric = z.infer<typeof insertFeatureUsageMetricSchema>;
export type FeatureUsageMetric = typeof featureUsageMetrics.$inferSelect;

// ===========================
// Admin Settings (Platform-wide)
// ===========================
export const adminSettings = pgTable("admin_settings", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  category: text("category").notNull(), // system | features | integrations | notifications
  description: text("description"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: uuid("updated_by").references(() => users.id),
});

export const insertAdminSettingSchema = createInsertSchema(adminSettings).omit({
  id: true,
  updatedAt: true,
});

export type InsertAdminSetting = z.infer<typeof insertAdminSettingSchema>;
export type AdminSetting = typeof adminSettings.$inferSelect;
