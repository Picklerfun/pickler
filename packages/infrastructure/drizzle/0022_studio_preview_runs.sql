ALTER TYPE "agents"."agent_status" ADD VALUE 'draft';--> statement-breakpoint
CREATE TABLE "pickler"."preview_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"preview_run_id" text NOT NULL,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pickler"."preview_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pickler"."preview_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"tenant_id" text NOT NULL,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL,
	"started_at" bigint,
	"finished_at" bigint,
	"expires_at" bigint NOT NULL,
	"lease_owner" text,
	"lease_expires_at" bigint,
	"config" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"decision" jsonb,
	"error" text,
	"adopted_at" bigint,
	"adopted_agent_id" text,
	CONSTRAINT "preview_run_status" CHECK ("pickler"."preview_runs"."status" in ('queued','running','completed','failed','cancelled')),
	CONSTRAINT "preview_running_requires_lease" CHECK ("pickler"."preview_runs"."status" <> 'running' OR ("pickler"."preview_runs"."lease_owner" IS NOT NULL AND "pickler"."preview_runs"."lease_expires_at" IS NOT NULL)),
	CONSTRAINT "preview_adoption_consistent" CHECK (("pickler"."preview_runs"."adopted_at" IS NULL) = ("pickler"."preview_runs"."adopted_agent_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "pickler"."preview_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pickler"."preview_events" ADD CONSTRAINT "preview_events_preview_run_id_preview_runs_id_fk" FOREIGN KEY ("preview_run_id") REFERENCES "pickler"."preview_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."preview_runs" ADD CONSTRAINT "preview_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "identity"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "preview_run_events" ON "pickler"."preview_events" USING btree ("preview_run_id","id");--> statement-breakpoint
CREATE INDEX "preview_runs_user_created" ON "pickler"."preview_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "preview_runs_queued" ON "pickler"."preview_runs" USING btree ("created_at","id") WHERE "pickler"."preview_runs"."status" = 'queued';