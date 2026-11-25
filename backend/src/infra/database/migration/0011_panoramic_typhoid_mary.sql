CREATE TABLE "meta_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"meta_user_id" varchar(64) NOT NULL,
	"meta_user_name" varchar(200),
	"access_token" text NOT NULL,
	"scopes" text[] NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meta_connection_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "meta_connection" ADD CONSTRAINT "meta_connection_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_connection" ADD CONSTRAINT "meta_connection_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;