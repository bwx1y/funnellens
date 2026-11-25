CREATE TYPE "public"."explanation_state" AS ENUM('PENDING', 'READY', 'FALLBACK', 'UNAVAILABLE');--> statement-breakpoint
CREATE TYPE "public"."wa_channel" AS ENUM('OPENWA', 'CLOUD');--> statement-breakpoint
ALTER TYPE "public"."lead_stage" ADD VALUE 'CLOSING' BEFORE 'CLOSED';--> statement-breakpoint
ALTER TABLE "wa_phone" DROP CONSTRAINT "wa_phone_session_id_wa_session_id_fk";
--> statement-breakpoint
DROP INDEX "uq_wa_phone_session_phone";--> statement-breakpoint
ALTER TABLE "wa_phone" ALTER COLUMN "session_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "is_selected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "wa_phone" ADD COLUMN "status" "message_status";--> statement-breakpoint
ALTER TABLE "wa_phone" ADD CONSTRAINT "wa_phone_session_id_wa_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."wa_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_phone" ADD CONSTRAINT "wa_phone_phone_unique" UNIQUE("phone");