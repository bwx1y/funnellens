CREATE TABLE "ad_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"currency" varchar(3) NOT NULL,
	"currency_offset" integer DEFAULT 100 NOT NULL,
	"timezone_name" text NOT NULL,
	"account_status" integer,
	"business_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_creatives" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"name" text,
	"object_type" text,
	"status" text,
	"video_id" text,
	"video_length_seconds" numeric(10, 2),
	"video_permalink_url" text,
	"image_url" text,
	"thumbnail_url" text,
	"object_story_id" text,
	"body" text,
	"title" text,
	"call_to_action_type" text,
	"url_tags" text,
	"created_time" timestamp with time zone,
	"updated_time" timestamp with time zone,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "ad_insight_actions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"insight_daily_id" bigint NOT NULL,
	"action_type" text NOT NULL,
	"count" numeric(20, 4) DEFAULT '0' NOT NULL,
	"value_minor" bigint,
	"cost_per_action_minor" bigint
);
--> statement-breakpoint
CREATE TABLE "ad_insights_breakdown_daily" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"level" "insight_level" NOT NULL,
	"entity_id" text NOT NULL,
	"campaign_id" text,
	"adset_id" text,
	"ad_id" text,
	"date" date NOT NULL,
	"attribution_window" text NOT NULL,
	"publisher_platform" text,
	"platform_position" text,
	"impression_device" text,
	"age" text,
	"gender" text,
	"country" text,
	"region" text,
	"breakdown_hash" text NOT NULL,
	"spend_minor" bigint DEFAULT 0 NOT NULL,
	"impressions" bigint DEFAULT 0 NOT NULL,
	"reach" bigint,
	"clicks" bigint DEFAULT 0 NOT NULL,
	"inline_link_clicks" bigint,
	"actions" jsonb,
	"action_values" jsonb
);
--> statement-breakpoint
CREATE TABLE "ad_insights_daily" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"level" "insight_level" NOT NULL,
	"entity_id" text NOT NULL,
	"campaign_id" text,
	"adset_id" text,
	"ad_id" text,
	"date" date NOT NULL,
	"attribution_window" text DEFAULT '7d_click' NOT NULL,
	"currency" varchar(3) NOT NULL,
	"currency_offset" integer DEFAULT 100 NOT NULL,
	"spend_minor" bigint DEFAULT 0 NOT NULL,
	"impressions" bigint DEFAULT 0 NOT NULL,
	"reach" bigint,
	"frequency" numeric(14, 6),
	"clicks" bigint DEFAULT 0 NOT NULL,
	"inline_link_clicks" bigint,
	"unique_clicks" bigint,
	"ctr" numeric(14, 8),
	"cpc_minor" bigint,
	"cpm_minor" bigint,
	"actions" jsonb,
	"action_values" jsonb,
	"cost_per_action_type" jsonb,
	"video_play_actions" bigint,
	"video_30_sec_watched_actions" bigint,
	"video_thruplay_watched_actions" bigint,
	"video_p25_watched_actions" bigint,
	"video_p50_watched_actions" bigint,
	"video_p75_watched_actions" bigint,
	"video_p100_watched_actions" bigint,
	"video_avg_time_watched_seconds" numeric(14, 4),
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_final" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text,
	"effective_status" text,
	"optimization_goal" text,
	"billing_event" text,
	"bid_strategy" text,
	"bid_amount_minor" bigint,
	"daily_budget_minor" bigint,
	"lifetime_budget_minor" bigint,
	"targeting" jsonb,
	"start_time" timestamp with time zone,
	"end_time" timestamp with time zone,
	"created_time" timestamp with time zone,
	"updated_time" timestamp with time zone,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "ads" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"adset_id" text NOT NULL,
	"creative_id" text,
	"name" text NOT NULL,
	"status" text,
	"effective_status" text,
	"created_time" timestamp with time zone,
	"updated_time" timestamp with time zone,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"objective" text,
	"status" text,
	"effective_status" text,
	"buying_type" text,
	"daily_budget_minor" bigint,
	"lifetime_budget_minor" bigint,
	"budget_remaining_minor" bigint,
	"start_time" timestamp with time zone,
	"stop_time" timestamp with time zone,
	"created_time" timestamp with time zone,
	"updated_time" timestamp with time zone,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"lead_id" bigint NOT NULL,
	"direction" "message_direction" NOT NULL,
	"body" text,
	"sent_at" timestamp with time zone NOT NULL,
	"replied_at" timestamp with time zone,
	"response_seconds" integer,
	"topic" text,
	"sentiment" text
);
--> statement-breakpoint
CREATE TABLE "creative_tags" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"creative_id" text NOT NULL,
	"tag_type" text NOT NULL,
	"tag_value" text NOT NULL,
	"source" text NOT NULL,
	"confidence" numeric(5, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insight_alerts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"rule_key" text NOT NULL,
	"level" "alert_level" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"metric" text,
	"entity_type" text,
	"entity_id" text,
	"impact_minor" bigint,
	"impact_caption" text,
	"confidence" text,
	"sample_size" bigint,
	"route" text,
	"status" "alert_status" DEFAULT 'ACTIVE' NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"wa_phone_id" uuid,
	"external_id" text,
	"name" text,
	"phone_hash" text,
	"phone_masked" text,
	"email_hash" text,
	"campaign_id" text,
	"adset_id" text,
	"ad_id" text,
	"creative_id" text,
	"source_platform" text,
	"source_position" text,
	"score" integer,
	"temperature" "lead_temperature",
	"stage" "lead_stage" DEFAULT 'CHAT_STARTED' NOT NULL,
	"sentiment" text,
	"signals" jsonb,
	"first_message" text,
	"first_seen_at" timestamp with time zone,
	"first_replied_at" timestamp with time zone,
	"qualified_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"deal_value_minor" bigint,
	"currency" varchar(3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"resource" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "sync_run_status" DEFAULT 'RUNNING' NOT NULL,
	"rows_upserted" bigint,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "tracking_health_daily" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"date" date NOT NULL,
	"event_name" text NOT NULL,
	"browser_count" bigint,
	"server_count" bigint,
	"dedup_rate" numeric(14, 6),
	"match_quality" numeric(5, 2),
	"status" text,
	"raw" jsonb
);
--> statement-breakpoint
ALTER TABLE "meta_connection" DROP CONSTRAINT "meta_connection_user_id_unique";--> statement-breakpoint
ALTER TABLE "wa_phone" DROP CONSTRAINT "wa_phone_phone_unique";--> statement-breakpoint
ALTER TABLE "user_tokens" DROP CONSTRAINT "user_tokens_userId_users_id_fk";
--> statement-breakpoint
ALTER TABLE "wa_phone" DROP CONSTRAINT "wa_phone_session_id_wa_session_id_fk";
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "wa_phone" ALTER COLUMN "session_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "wa_session" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "wa_session" ALTER COLUMN "status" SET DEFAULT 'created';--> statement-breakpoint
ALTER TABLE "wa_session" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_tokens" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_account_id_ad_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_insight_actions" ADD CONSTRAINT "ad_insight_actions_insight_daily_id_ad_insights_daily_id_fk" FOREIGN KEY ("insight_daily_id") REFERENCES "public"."ad_insights_daily"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_insights_breakdown_daily" ADD CONSTRAINT "ad_insights_breakdown_daily_account_id_ad_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_insights_breakdown_daily" ADD CONSTRAINT "ad_insights_breakdown_daily_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_insights_breakdown_daily" ADD CONSTRAINT "ad_insights_breakdown_daily_adset_id_ad_sets_id_fk" FOREIGN KEY ("adset_id") REFERENCES "public"."ad_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_insights_breakdown_daily" ADD CONSTRAINT "ad_insights_breakdown_daily_ad_id_ads_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."ads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_insights_daily" ADD CONSTRAINT "ad_insights_daily_account_id_ad_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_insights_daily" ADD CONSTRAINT "ad_insights_daily_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_insights_daily" ADD CONSTRAINT "ad_insights_daily_adset_id_ad_sets_id_fk" FOREIGN KEY ("adset_id") REFERENCES "public"."ad_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_insights_daily" ADD CONSTRAINT "ad_insights_daily_ad_id_ads_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."ads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_sets" ADD CONSTRAINT "ad_sets_account_id_ad_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_sets" ADD CONSTRAINT "ad_sets_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_account_id_ad_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_adset_id_ad_sets_id_fk" FOREIGN KEY ("adset_id") REFERENCES "public"."ad_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_creative_id_ad_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."ad_creatives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_account_id_ad_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_tags" ADD CONSTRAINT "creative_tags_creative_id_ad_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."ad_creatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_alerts" ADD CONSTRAINT "insight_alerts_account_id_ad_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_account_id_ad_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_wa_phone_id_wa_phone_id_fk" FOREIGN KEY ("wa_phone_id") REFERENCES "public"."wa_phone"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_adset_id_ad_sets_id_fk" FOREIGN KEY ("adset_id") REFERENCES "public"."ad_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_ad_id_ads_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."ads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_creative_id_ad_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."ad_creatives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_account_id_ad_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_health_daily" ADD CONSTRAINT "tracking_health_daily_account_id_ad_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ad_accounts_tenant_id" ON "ad_accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_ad_creatives_account_id" ON "ad_creatives" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ad_insight_actions_type" ON "ad_insight_actions" USING btree ("insight_daily_id","action_type");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ad_insights_breakdown_daily" ON "ad_insights_breakdown_daily" USING btree ("account_id","level","entity_id","date","attribution_window","breakdown_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ad_insights_daily" ON "ad_insights_daily" USING btree ("account_id","level","entity_id","date","attribution_window");--> statement-breakpoint
CREATE INDEX "idx_insights_daily_account_date" ON "ad_insights_daily" USING btree ("account_id","date");--> statement-breakpoint
CREATE INDEX "idx_insights_daily_campaign_date" ON "ad_insights_daily" USING btree ("campaign_id","date");--> statement-breakpoint
CREATE INDEX "idx_insights_daily_ad_date" ON "ad_insights_daily" USING btree ("ad_id","date");--> statement-breakpoint
CREATE INDEX "idx_ad_sets_account_id" ON "ad_sets" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_ads_account_id" ON "ads" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_campaigns_account_id" ON "campaigns" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_creative_tags_item" ON "creative_tags" USING btree ("creative_id","tag_type","tag_value","source");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_leads_account_external" ON "leads" USING btree ("account_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tracking_health_daily_event" ON "tracking_health_daily" USING btree ("account_id","date","event_name");--> statement-breakpoint
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_phone" ADD CONSTRAINT "wa_phone_session_id_wa_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."wa_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_session" ADD CONSTRAINT "wa_session_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_meta_connection_tenant_meta_user" ON "meta_connection" USING btree ("tenant_id","meta_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wa_phone_session_phone" ON "wa_phone" USING btree ("session_id","phone");--> statement-breakpoint
ALTER TABLE "user_tokens" DROP COLUMN "is_used";--> statement-breakpoint
ALTER TABLE "user_tokens" DROP COLUMN "userId";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "is_verified";--> statement-breakpoint
ALTER TABLE "wa_phone" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");