DROP TABLE "wa_message" CASCADE;--> statement-breakpoint
ALTER TABLE "wa_phone" DROP COLUMN "status";--> statement-breakpoint
DROP TYPE "public"."message_status";