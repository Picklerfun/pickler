CREATE TABLE "pickler"."provider_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"retrieved_at" text NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pickler"."provider_cache" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pickler"."provider_quotas" (
	"key" text NOT NULL,
	"window_start" text NOT NULL,
	"used" integer NOT NULL,
	CONSTRAINT "provider_quotas_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
ALTER TABLE "pickler"."provider_quotas" ENABLE ROW LEVEL SECURITY;