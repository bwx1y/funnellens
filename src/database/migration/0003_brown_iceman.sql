ALTER TABLE "users" ALTER COLUMN "is_verified" SET DATA TYPE datetime;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "is_verified" DROP DEFAULT;