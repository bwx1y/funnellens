CREATE TABLE "insight_reviews" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"alert_id" bigint NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_insight_reviews_status" CHECK ("insight_reviews"."status" in ('read', 'done', 'active'))
);
--> statement-breakpoint
CREATE TABLE "insight_review_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"insight_review_id" bigint NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_insight_review_history_from_status" CHECK ("insight_review_history"."from_status" is null or "insight_review_history"."from_status" in ('read', 'done', 'active')),
	CONSTRAINT "chk_insight_review_history_to_status" CHECK ("insight_review_history"."to_status" in ('read', 'done', 'active'))
);
--> statement-breakpoint
ALTER TABLE "lead_assessments" ADD COLUMN "topic" text;--> statement-breakpoint
ALTER TABLE "lead_assessments" ADD COLUMN "response_type" text;--> statement-breakpoint
ALTER TABLE "lead_assessments" ADD COLUMN "mood" text;--> statement-breakpoint
ALTER TABLE "lead_assessments" ADD COLUMN "quote" text;--> statement-breakpoint
ALTER TABLE "lead_assessments" ADD COLUMN "reply_minutes" integer;--> statement-breakpoint
ALTER TABLE "lead_assessments" ADD COLUMN "prior_level" "lead_temperature";--> statement-breakpoint
ALTER TABLE "insight_reviews" ADD CONSTRAINT "insight_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_reviews" ADD CONSTRAINT "insight_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_reviews" ADD CONSTRAINT "insight_reviews_alert_id_insight_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."insight_alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_review_history" ADD CONSTRAINT "insight_review_history_insight_review_id_insight_reviews_id_fk" FOREIGN KEY ("insight_review_id") REFERENCES "public"."insight_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_review_history" ADD CONSTRAINT "insight_review_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_insight_reviews_user_alert" ON "insight_reviews" USING btree ("user_id","alert_id");--> statement-breakpoint
CREATE INDEX "idx_insight_reviews_alert" ON "insight_reviews" USING btree ("alert_id");--> statement-breakpoint
CREATE INDEX "idx_insight_review_history_review_changed" ON "insight_review_history" USING btree ("insight_review_id","changed_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "lead_assessments" ADD CONSTRAINT "chk_lead_assessments_mood" CHECK ("lead_assessments"."mood" is null or "lead_assessments"."mood" in ('positif', 'netral', 'negatif'));