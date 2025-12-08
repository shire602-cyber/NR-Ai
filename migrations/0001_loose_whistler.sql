CREATE TABLE "activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"company_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"description" text NOT NULL,
	"metadata" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "admin_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid,
	"prompt" text NOT NULL,
	"response" text NOT NULL,
	"model" text DEFAULT 'gpt-3.5-turbo' NOT NULL,
	"system_prompt" text,
	"tokens_used" integer,
	"response_time" integer,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"company_id" uuid,
	"session_id" text,
	"event_type" text NOT NULL,
	"event_name" text NOT NULL,
	"page_url" text,
	"page_title" text,
	"properties" text,
	"value" real,
	"referrer" text,
	"device_type" text,
	"browser" text,
	"os" text,
	"country" text,
	"language" text,
	"duration" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anomaly_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"type" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"related_entity_type" text,
	"related_entity_id" uuid,
	"duplicate_of_id" uuid,
	"ai_confidence" real,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp,
	"resolution_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"details" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"backup_type" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"accounts_count" integer DEFAULT 0,
	"journal_entries_count" integer DEFAULT 0,
	"invoices_count" integer DEFAULT 0,
	"receipts_count" integer DEFAULT 0,
	"vat_returns_count" integer DEFAULT 0,
	"data_snapshot" text,
	"checksum" text,
	"size_bytes" integer DEFAULT 0,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"bank_account_id" uuid,
	"transaction_date" timestamp NOT NULL,
	"description" text NOT NULL,
	"amount" real NOT NULL,
	"reference" text,
	"category" text,
	"is_reconciled" boolean DEFAULT false NOT NULL,
	"matched_journal_entry_id" uuid,
	"matched_receipt_id" uuid,
	"matched_invoice_id" uuid,
	"match_confidence" real,
	"import_source" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"budget_amount" real DEFAULT 0 NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_flow_forecasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"forecast_date" timestamp NOT NULL,
	"forecast_type" text NOT NULL,
	"predicted_inflow" real DEFAULT 0 NOT NULL,
	"predicted_outflow" real DEFAULT 0 NOT NULL,
	"predicted_balance" real DEFAULT 0 NOT NULL,
	"confidence_level" real,
	"factors" text,
	"generated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"content" text NOT NULL,
	"is_pinned" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"title" text NOT NULL,
	"title_ar" text,
	"description" text,
	"category" text NOT NULL,
	"priority" text DEFAULT 'medium',
	"status" text DEFAULT 'pending',
	"due_date" timestamp NOT NULL,
	"reminder_date" timestamp,
	"reminder_sent" boolean DEFAULT false,
	"is_recurring" boolean DEFAULT false,
	"recurrence_pattern" text,
	"completed_at" timestamp,
	"completed_by" uuid,
	"assigned_to" uuid,
	"created_by" uuid,
	"related_document_id" uuid,
	"related_vat_return_id" uuid,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"email" text,
	"phone" text,
	"trn_number" text,
	"address" text,
	"city" text,
	"country" text DEFAULT 'UAE',
	"contact_person" text,
	"payment_terms" integer DEFAULT 30,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"category" text NOT NULL,
	"description" text,
	"file_url" text NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer,
	"mime_type" text,
	"expiry_date" timestamp,
	"reminder_days" integer DEFAULT 30,
	"reminder_sent" boolean DEFAULT false,
	"tags" text,
	"is_archived" boolean DEFAULT false,
	"uploaded_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ecommerce_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp,
	"shop_domain" text,
	"api_key" text,
	"webhook_secret" text,
	"last_sync_at" timestamp,
	"sync_status" text DEFAULT 'never',
	"sync_error" text,
	"settings" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ecommerce_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"transaction_type" text NOT NULL,
	"amount" real NOT NULL,
	"currency" text DEFAULT 'AED' NOT NULL,
	"customer_name" text,
	"customer_email" text,
	"description" text,
	"status" text NOT NULL,
	"platform_fees" real,
	"net_amount" real,
	"transaction_date" timestamp NOT NULL,
	"metadata" text,
	"is_reconciled" boolean DEFAULT false NOT NULL,
	"journal_entry_id" uuid,
	"invoice_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engagements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"account_manager_id" uuid,
	"engagement_type" text DEFAULT 'full_service' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp,
	"monthly_fee" real,
	"billing_cycle" text DEFAULT 'monthly',
	"payment_terms" integer DEFAULT 30,
	"services_included" text,
	"special_instructions" text,
	"onboarding_completed" boolean DEFAULT false,
	"onboarding_completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_usage_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feature_name" text NOT NULL,
	"period" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"total_users" integer DEFAULT 0 NOT NULL,
	"total_sessions" integer DEFAULT 0 NOT NULL,
	"total_events" integer DEFAULT 0 NOT NULL,
	"avg_duration" real,
	"conversion_rate" real,
	"error_rate" real,
	"calculated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_kpis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kpi_type" text NOT NULL,
	"period" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"value" real NOT NULL,
	"previous_value" real,
	"change_percent" real,
	"trend" text,
	"benchmark" real,
	"calculated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fta_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"sender" text,
	"received_at" timestamp NOT NULL,
	"body_text" text,
	"body_html" text,
	"email_type" text,
	"priority" text DEFAULT 'normal',
	"is_read" boolean DEFAULT false,
	"is_archived" boolean DEFAULT false,
	"is_starred" boolean DEFAULT false,
	"has_attachments" boolean DEFAULT false,
	"attachments" text,
	"ai_summary" text,
	"action_required" boolean DEFAULT false,
	"action_description" text,
	"action_due_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "help_tips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tip_key" text NOT NULL,
	"title" text NOT NULL,
	"title_ar" text,
	"content" text NOT NULL,
	"content_ar" text,
	"page_context" text NOT NULL,
	"target_element" text,
	"tip_type" text DEFAULT 'tooltip' NOT NULL,
	"order" integer DEFAULT 0,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "help_tips_tip_key_unique" UNIQUE("tip_key")
);
--> statement-breakpoint
CREATE TABLE "integration_syncs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"integration_type" text NOT NULL,
	"sync_type" text NOT NULL,
	"data_type" text NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"record_count" integer,
	"external_id" text,
	"external_url" text,
	"error_message" text,
	"synced_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"company_id" uuid,
	"role" text DEFAULT 'client' NOT NULL,
	"user_type" text DEFAULT 'client' NOT NULL,
	"token" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"thread_id" uuid,
	"subject" text,
	"content" text NOT NULL,
	"sender_id" uuid NOT NULL,
	"recipient_id" uuid,
	"is_read" boolean DEFAULT false,
	"read_at" timestamp,
	"attachment_url" text,
	"attachment_name" text,
	"message_type" text DEFAULT 'general',
	"is_archived" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"title_ar" text,
	"summary" text,
	"summary_ar" text,
	"content" text,
	"content_ar" text,
	"source" text NOT NULL,
	"source_url" text,
	"category" text NOT NULL,
	"image_url" text,
	"published_at" timestamp NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"related_entity_type" text,
	"related_entity_id" uuid,
	"action_url" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp,
	"is_dismissed" boolean DEFAULT false NOT NULL,
	"scheduled_for" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"custom_slug" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"referrer_reward_type" text DEFAULT 'credit',
	"referrer_reward_value" real DEFAULT 0,
	"referee_reward_type" text DEFAULT 'discount',
	"referee_reward_value" real DEFAULT 0,
	"total_referrals" integer DEFAULT 0 NOT NULL,
	"successful_referrals" integer DEFAULT 0 NOT NULL,
	"total_rewards_earned" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	CONSTRAINT "referral_codes_code_unique" UNIQUE("code"),
	CONSTRAINT "referral_codes_custom_slug_unique" UNIQUE("custom_slug")
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referral_code_id" uuid NOT NULL,
	"referrer_id" uuid NOT NULL,
	"referee_id" uuid,
	"referee_email" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"referrer_reward_status" text DEFAULT 'pending',
	"referee_reward_status" text DEFAULT 'pending',
	"referrer_reward_amount" real,
	"referee_reward_amount" real,
	"qualification_criteria" text,
	"qualified_at" timestamp,
	"rewarded_at" timestamp,
	"signup_source" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "regulatory_news" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"title_ar" text,
	"summary" text NOT NULL,
	"summary_ar" text,
	"content" text,
	"content_ar" text,
	"category" text NOT NULL,
	"source" text,
	"source_url" text,
	"effective_date" timestamp,
	"importance" text DEFAULT 'normal' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"published_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"reminder_setting_id" uuid,
	"reminder_type" text NOT NULL,
	"related_entity_type" text NOT NULL,
	"related_entity_id" uuid NOT NULL,
	"recipient_email" text,
	"recipient_phone" text,
	"channel" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"error_message" text,
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"opened_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"reminder_type" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"days_before_due" integer,
	"days_after_due" integer,
	"repeat_interval_days" integer,
	"max_reminders" integer DEFAULT 3,
	"send_email" boolean DEFAULT true NOT NULL,
	"send_sms" boolean DEFAULT false NOT NULL,
	"send_in_app" boolean DEFAULT true NOT NULL,
	"email_subject" text,
	"email_template" text,
	"sms_template" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_invoice_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" real DEFAULT 1 NOT NULL,
	"unit_price" real NOT NULL,
	"vat_rate" real DEFAULT 0.05 NOT NULL,
	"amount" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"invoice_date" timestamp NOT NULL,
	"due_date" timestamp NOT NULL,
	"subtotal" real DEFAULT 0 NOT NULL,
	"vat_amount" real DEFAULT 0 NOT NULL,
	"total" real DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"paid_amount" real DEFAULT 0,
	"paid_at" timestamp,
	"payment_method" text,
	"payment_reference" text,
	"period_start" timestamp,
	"period_end" timestamp,
	"description" text,
	"notes" text,
	"pdf_url" text,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"description" text,
	"description_ar" text,
	"price_monthly" real NOT NULL,
	"price_yearly" real,
	"currency" text DEFAULT 'AED' NOT NULL,
	"features" text,
	"max_companies" integer DEFAULT 1,
	"max_users" integer DEFAULT 1,
	"max_invoices_per_month" integer,
	"max_receipts_per_month" integer,
	"ai_credits_per_month" integer DEFAULT 100,
	"has_whatsapp_integration" boolean DEFAULT false,
	"has_advanced_reports" boolean DEFAULT false,
	"has_api_access" boolean DEFAULT false,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"plan_id" text NOT NULL,
	"plan_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_period_start" timestamp NOT NULL,
	"current_period_end" timestamp NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"max_users" integer DEFAULT 1,
	"max_invoices" integer DEFAULT 50,
	"max_receipts" integer DEFAULT 100,
	"ai_credits_remaining" integer DEFAULT 100,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_return_archive" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"return_type" text NOT NULL,
	"period_label" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"filing_date" timestamp NOT NULL,
	"fta_reference_number" text,
	"tax_amount" real DEFAULT 0,
	"payment_status" text DEFAULT 'paid',
	"file_url" text,
	"file_name" text,
	"notes" text,
	"filed_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"description" text NOT NULL,
	"merchant" text,
	"amount" real,
	"suggested_account_id" uuid,
	"suggested_category" text,
	"ai_confidence" real,
	"ai_reason" text,
	"was_accepted" boolean,
	"user_selected_account_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"company_id" uuid,
	"feedback_type" text NOT NULL,
	"category" text,
	"page_context" text,
	"rating" integer,
	"title" text,
	"message" text NOT NULL,
	"screenshot" text,
	"browser_info" text,
	"status" text DEFAULT 'new' NOT NULL,
	"assigned_to" text,
	"response_message" text,
	"responded_at" timestamp,
	"allow_contact" boolean DEFAULT true NOT NULL,
	"contact_email" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_onboarding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"has_completed_welcome" boolean DEFAULT false NOT NULL,
	"has_created_company" boolean DEFAULT false NOT NULL,
	"has_setup_chart_of_accounts" boolean DEFAULT false NOT NULL,
	"has_created_first_invoice" boolean DEFAULT false NOT NULL,
	"has_uploaded_first_receipt" boolean DEFAULT false NOT NULL,
	"has_viewed_reports" boolean DEFAULT false NOT NULL,
	"has_explored_ai" boolean DEFAULT false NOT NULL,
	"has_configured_reminders" boolean DEFAULT false NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"total_steps" integer DEFAULT 8 NOT NULL,
	"is_onboarding_complete" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp,
	"show_tips" boolean DEFAULT true NOT NULL,
	"show_tour" boolean DEFAULT true NOT NULL,
	"dismissed_tips" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"billing_cycle" text DEFAULT 'monthly' NOT NULL,
	"current_period_start" timestamp NOT NULL,
	"current_period_end" timestamp NOT NULL,
	"cancelled_at" timestamp,
	"trial_ends_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vat_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"due_date" timestamp NOT NULL,
	"tax_year_end" timestamp,
	"vat_stagger" text DEFAULT 'quarterly',
	"status" text DEFAULT 'draft' NOT NULL,
	"box1a_abu_dhabi_amount" real DEFAULT 0 NOT NULL,
	"box1a_abu_dhabi_vat" real DEFAULT 0 NOT NULL,
	"box1a_abu_dhabi_adj" real DEFAULT 0 NOT NULL,
	"box1b_dubai_amount" real DEFAULT 0 NOT NULL,
	"box1b_dubai_vat" real DEFAULT 0 NOT NULL,
	"box1b_dubai_adj" real DEFAULT 0 NOT NULL,
	"box1c_sharjah_amount" real DEFAULT 0 NOT NULL,
	"box1c_sharjah_vat" real DEFAULT 0 NOT NULL,
	"box1c_sharjah_adj" real DEFAULT 0 NOT NULL,
	"box1d_ajman_amount" real DEFAULT 0 NOT NULL,
	"box1d_ajman_vat" real DEFAULT 0 NOT NULL,
	"box1d_ajman_adj" real DEFAULT 0 NOT NULL,
	"box1e_umm_al_quwain_amount" real DEFAULT 0 NOT NULL,
	"box1e_umm_al_quwain_vat" real DEFAULT 0 NOT NULL,
	"box1e_umm_al_quwain_adj" real DEFAULT 0 NOT NULL,
	"box1f_ras_al_khaimah_amount" real DEFAULT 0 NOT NULL,
	"box1f_ras_al_khaimah_vat" real DEFAULT 0 NOT NULL,
	"box1f_ras_al_khaimah_adj" real DEFAULT 0 NOT NULL,
	"box1g_fujairah_amount" real DEFAULT 0 NOT NULL,
	"box1g_fujairah_vat" real DEFAULT 0 NOT NULL,
	"box1g_fujairah_adj" real DEFAULT 0 NOT NULL,
	"box2_tourist_refund_amount" real DEFAULT 0 NOT NULL,
	"box2_tourist_refund_vat" real DEFAULT 0 NOT NULL,
	"box3_reverse_charge_amount" real DEFAULT 0 NOT NULL,
	"box3_reverse_charge_vat" real DEFAULT 0 NOT NULL,
	"box4_zero_rated_amount" real DEFAULT 0 NOT NULL,
	"box5_exempt_amount" real DEFAULT 0 NOT NULL,
	"box6_imports_amount" real DEFAULT 0 NOT NULL,
	"box6_imports_vat" real DEFAULT 0 NOT NULL,
	"box7_imports_adj_amount" real DEFAULT 0 NOT NULL,
	"box7_imports_adj_vat" real DEFAULT 0 NOT NULL,
	"box8_total_amount" real DEFAULT 0 NOT NULL,
	"box8_total_vat" real DEFAULT 0 NOT NULL,
	"box8_total_adj" real DEFAULT 0 NOT NULL,
	"box9_expenses_amount" real DEFAULT 0 NOT NULL,
	"box9_expenses_vat" real DEFAULT 0 NOT NULL,
	"box9_expenses_adj" real DEFAULT 0 NOT NULL,
	"box10_reverse_charge_amount" real DEFAULT 0 NOT NULL,
	"box10_reverse_charge_vat" real DEFAULT 0 NOT NULL,
	"box11_total_amount" real DEFAULT 0 NOT NULL,
	"box11_total_vat" real DEFAULT 0 NOT NULL,
	"box11_total_adj" real DEFAULT 0 NOT NULL,
	"box12_total_due_tax" real DEFAULT 0 NOT NULL,
	"box13_recoverable_tax" real DEFAULT 0 NOT NULL,
	"box14_payable_tax" real DEFAULT 0 NOT NULL,
	"box1_sales_standard" real DEFAULT 0 NOT NULL,
	"box2_sales_other_emirates" real DEFAULT 0 NOT NULL,
	"box3_sales_tax_exempt" real DEFAULT 0 NOT NULL,
	"box4_sales_exempt" real DEFAULT 0 NOT NULL,
	"box5_total_output_tax" real DEFAULT 0 NOT NULL,
	"box6_expenses_standard" real DEFAULT 0 NOT NULL,
	"box7_expenses_tourist_refund" real DEFAULT 0 NOT NULL,
	"box8_total_input_tax" real DEFAULT 0 NOT NULL,
	"box9_net_tax" real DEFAULT 0 NOT NULL,
	"adjustment_amount" real DEFAULT 0,
	"adjustment_reason" text,
	"submitted_by" uuid,
	"submitted_at" timestamp,
	"fta_reference_number" text,
	"payment_status" text DEFAULT 'unpaid',
	"payment_amount" real,
	"payment_date" timestamp,
	"notes" text,
	"declarant_name" text,
	"declarant_position" text,
	"declaration_date" timestamp,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"source" text DEFAULT 'landing_page' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"phone_number_id" text,
	"access_token" text,
	"webhook_verify_token" text,
	"business_account_id" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"wa_message_id" text NOT NULL,
	"from_number" text NOT NULL,
	"to_number" text,
	"message_type" text NOT NULL,
	"content" text,
	"media_url" text,
	"media_id" text,
	"direction" text DEFAULT 'inbound' NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"receipt_id" uuid,
	"error_message" text,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "sub_type" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "is_vat_account" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "vat_type" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "is_system_account" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "is_archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "company_type" text DEFAULT 'customer' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "legal_structure" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "industry" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "registration_number" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "business_address" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "website_url" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "trn_vat_number" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "tax_registration_type" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "vat_filing_frequency" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "tax_registration_date" timestamp;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "corporate_tax_id" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "emirate" text DEFAULT 'dubai';--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "invoice_show_logo" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "invoice_show_address" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "invoice_show_phone" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "invoice_show_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "invoice_show_website" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "invoice_custom_title" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "invoice_footer_note" text;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "vat_supply_type" text DEFAULT 'standard_rated';--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "entry_number" text NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "reversed_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "reversal_reason" text;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "posted_by" uuid;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "posted_at" timestamp;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "is_reconciled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "reconciled_at" timestamp;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "reconciled_by" uuid;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "bank_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "payment_account_id" uuid;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "posted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "journal_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "user_type" text DEFAULT 'customer' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_settings" ADD CONSTRAINT "admin_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anomaly_alerts" ADD CONSTRAINT "anomaly_alerts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anomaly_alerts" ADD CONSTRAINT "anomaly_alerts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backups" ADD CONSTRAINT "backups_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backups" ADD CONSTRAINT "backups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_account_id_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_matched_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("matched_journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_matched_receipt_id_receipts_id_fk" FOREIGN KEY ("matched_receipt_id") REFERENCES "public"."receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_matched_invoice_id_invoices_id_fk" FOREIGN KEY ("matched_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_flow_forecasts" ADD CONSTRAINT "cash_flow_forecasts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_tasks" ADD CONSTRAINT "compliance_tasks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_tasks" ADD CONSTRAINT "compliance_tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_tasks" ADD CONSTRAINT "compliance_tasks_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_tasks" ADD CONSTRAINT "compliance_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_tasks" ADD CONSTRAINT "compliance_tasks_related_document_id_documents_id_fk" FOREIGN KEY ("related_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_tasks" ADD CONSTRAINT "compliance_tasks_related_vat_return_id_vat_returns_id_fk" FOREIGN KEY ("related_vat_return_id") REFERENCES "public"."vat_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecommerce_integrations" ADD CONSTRAINT "ecommerce_integrations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecommerce_transactions" ADD CONSTRAINT "ecommerce_transactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecommerce_transactions" ADD CONSTRAINT "ecommerce_transactions_integration_id_ecommerce_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."ecommerce_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecommerce_transactions" ADD CONSTRAINT "ecommerce_transactions_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecommerce_transactions" ADD CONSTRAINT "ecommerce_transactions_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_account_manager_id_users_id_fk" FOREIGN KEY ("account_manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_kpis" ADD CONSTRAINT "financial_kpis_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fta_emails" ADD CONSTRAINT "fta_emails_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_syncs" ADD CONSTRAINT "integration_syncs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referral_code_id_referral_codes_id_fk" FOREIGN KEY ("referral_code_id") REFERENCES "public"."referral_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referee_id_users_id_fk" FOREIGN KEY ("referee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_logs" ADD CONSTRAINT "reminder_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_logs" ADD CONSTRAINT "reminder_logs_reminder_setting_id_reminder_settings_id_fk" FOREIGN KEY ("reminder_setting_id") REFERENCES "public"."reminder_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_settings" ADD CONSTRAINT "reminder_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_invoice_lines" ADD CONSTRAINT "service_invoice_lines_service_invoice_id_service_invoices_id_fk" FOREIGN KEY ("service_invoice_id") REFERENCES "public"."service_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_invoices" ADD CONSTRAINT "service_invoices_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_invoices" ADD CONSTRAINT "service_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_invoices" ADD CONSTRAINT "service_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_return_archive" ADD CONSTRAINT "tax_return_archive_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_return_archive" ADD CONSTRAINT "tax_return_archive_filed_by_users_id_fk" FOREIGN KEY ("filed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_classifications" ADD CONSTRAINT "transaction_classifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_classifications" ADD CONSTRAINT "transaction_classifications_suggested_account_id_accounts_id_fk" FOREIGN KEY ("suggested_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_classifications" ADD CONSTRAINT "transaction_classifications_user_selected_account_id_accounts_id_fk" FOREIGN KEY ("user_selected_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_feedback" ADD CONSTRAINT "user_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_feedback" ADD CONSTRAINT "user_feedback_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_onboarding" ADD CONSTRAINT "user_onboarding_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_returns" ADD CONSTRAINT "vat_returns_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_returns" ADD CONSTRAINT "vat_returns_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_returns" ADD CONSTRAINT "vat_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_configs" ADD CONSTRAINT "whatsapp_configs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversed_entry_id_journal_entries_id_fk" FOREIGN KEY ("reversed_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_reconciled_by_users_id_fk" FOREIGN KEY ("reconciled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_account_id_accounts_id_fk" FOREIGN KEY ("payment_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_company_id_code_unique" UNIQUE("company_id","code");