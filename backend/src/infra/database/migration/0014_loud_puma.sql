CREATE TYPE "public"."alert_level" AS ENUM('INFO', 'WARNING', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."alert_status" AS ENUM('ACTIVE', 'DONE', 'SNOOZED');--> statement-breakpoint
CREATE TYPE "public"."insight_level" AS ENUM('account', 'campaign', 'adset', 'ad');--> statement-breakpoint
CREATE TYPE "public"."lead_stage" AS ENUM('CHAT_STARTED', 'REPLIED', 'QUALIFIED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."lead_temperature" AS ENUM('COLD', 'WARM', 'HOT');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('INBOUND', 'OUTBOUND');--> statement-breakpoint
CREATE TYPE "public"."sync_run_status" AS ENUM('RUNNING', 'SUCCESS', 'FAILED');