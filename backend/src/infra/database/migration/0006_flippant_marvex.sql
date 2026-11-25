CREATE TYPE "public"."session-status" AS ENUM('created', 'initializing', 'qr_ready', 'authenticating', 'ready', 'disconnected', 'action_required', 'failed');--> statement-breakpoint
CREATE TABLE "wa_session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(150) NOT NULL,
	"phone_number" varchar,
	"phone_name" varchar,
	"status" "session-status"
);
