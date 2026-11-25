CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX "idx_leads_name_trgm" ON "leads" USING gin ("name" gin_trgm_ops);
