CREATE TABLE "pickler"."paper_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"run_id" text NOT NULL,
	"market_id" text NOT NULL,
	"outcome_id" text NOT NULL,
	"request_key" text NOT NULL,
	"config_version" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL,
	"finished_at" bigint,
	"reason" text,
	"fill" jsonb,
	"snapshot" jsonb NOT NULL,
	"lease_owner" text,
	"lease_expires_at" bigint,
	CONSTRAINT "paper_status" CHECK ("pickler"."paper_orders"."status" in ('pending','filled','not_filled','failed','interrupted')),
	CONSTRAINT "paper_pending_lease" CHECK ("pickler"."paper_orders"."status" <> 'pending' OR ("pickler"."paper_orders"."lease_owner" IS NOT NULL AND "pickler"."paper_orders"."lease_expires_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "pickler"."paper_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pickler"."paper_orders" ADD CONSTRAINT "paper_orders_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "pickler"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."paper_orders" ADD CONSTRAINT "paper_orders_tenant_id_agent_id_agents_tenant_id_id_fk" FOREIGN KEY ("tenant_id","agent_id") REFERENCES "pickler"."agents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_paper_attempt_per_run" ON "pickler"."paper_orders" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "paper_request_identity" ON "pickler"."paper_orders" USING btree ("tenant_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "one_open_paper_position" ON "pickler"."paper_orders" USING btree ("tenant_id","agent_id","market_id") WHERE "pickler"."paper_orders"."status" in ('pending', 'filled');