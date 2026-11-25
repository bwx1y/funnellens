-- F-01.2: the workspace role set becomes ADMIN/VIEWER. `MANAGER` was only ever a read-only
-- collaborator, so every existing row keeps its access as ADMIN before the value disappears.
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'VIEWER';
--> statement-breakpoint
UPDATE "users" SET "role" = 'ADMIN' WHERE "role" = 'MANAGER';
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE text;
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'VIEWER'::text;
--> statement-breakpoint
DROP TYPE "public"."role";
--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('ADMIN', 'VIEWER');
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'VIEWER'::"public"."role";
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE "public"."role" USING "role"::"public"."role";
