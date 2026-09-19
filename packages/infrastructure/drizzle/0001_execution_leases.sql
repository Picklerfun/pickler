CREATE TABLE "pickler"."execution_policy" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"global_limit" integer DEFAULT 5 NOT NULL,
	"tenant_limit" integer DEFAULT 2 NOT NULL,
	CONSTRAINT "singleton_policy" CHECK ("pickler"."execution_policy"."id" = 1),
	CONSTRAINT "valid_execution_limits" CHECK ("pickler"."execution_policy"."global_limit" BETWEEN 1 AND 250 AND "pickler"."execution_policy"."tenant_limit" BETWEEN 1 AND "pickler"."execution_policy"."global_limit")
);
--> statement-breakpoint
ALTER TABLE "pickler"."execution_policy" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pickler"."runs" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "pickler"."runs" ADD COLUMN "lease_expires_at" bigint;--> statement-breakpoint
INSERT INTO "pickler"."execution_policy" ("id") VALUES (1);
--> statement-breakpoint
-- Stop all old executors before applying this migration. Preserve their partial evidence.
UPDATE "pickler"."runs" SET "status" = 'failed', "error" = 'INTERRUPTED', "finished_at" = floor(extract(epoch from clock_timestamp()) * 1000)::bigint WHERE "status" = 'running';
--> statement-breakpoint
CREATE INDEX "expired_leases" ON "pickler"."runs" USING btree ("lease_expires_at") WHERE "pickler"."runs"."status" = 'running';--> statement-breakpoint
ALTER TABLE "pickler"."runs" ADD CONSTRAINT "running_requires_lease" CHECK ("pickler"."runs"."status" <> 'running' OR ("pickler"."runs"."lease_owner" IS NOT NULL AND "pickler"."runs"."lease_expires_at" IS NOT NULL));
