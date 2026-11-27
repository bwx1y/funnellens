CREATE TYPE "public"."message_status" AS ENUM('COLD', 'HOT', 'WARM');--> statement-breakpoint
CREATE TABLE "wa_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid,
	"status" "message_status",
	"phone" varchar,
	"phone_name" varchar,
	"context" text
);
--> statement-breakpoint
ALTER TABLE "wa_message" ADD CONSTRAINT "wa_message_session_id_wa_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."wa_session"("id") ON DELETE no action ON UPDATE no action;