CREATE TABLE "wa_phone" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid,
	"phone" varchar NOT NULL,
	"phone_name" varchar,
	"status" "message_status",
	CONSTRAINT "wa_phone_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
ALTER TABLE "wa_message" DROP CONSTRAINT "wa_message_session_id_wa_session_id_fk";
--> statement-breakpoint
ALTER TABLE "wa_message" ADD COLUMN "phone_id" uuid;--> statement-breakpoint
ALTER TABLE "wa_phone" ADD CONSTRAINT "wa_phone_session_id_wa_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."wa_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_message" ADD CONSTRAINT "wa_message_phone_id_wa_phone_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."wa_phone"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_message" DROP COLUMN "session_id";--> statement-breakpoint
ALTER TABLE "wa_message" DROP COLUMN "phone";--> statement-breakpoint
ALTER TABLE "wa_message" DROP COLUMN "phone_name";