CREATE TABLE "pickler"."live_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"run_id" text,
	"request_key" text NOT NULL,
	"submit_key" text,
	"origin" text NOT NULL,
	"status" text NOT NULL,
	"market_id" text NOT NULL,
	"config_version" integer NOT NULL,
	"preview" jsonb NOT NULL,
	"budget_micros" integer NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"order_hash" text,
	"reason" text,
	"fill" jsonb,
	"lease_owner" text,
	"lease_expires_at" bigint,
	CONSTRAINT "live_budget_bound" CHECK ("pickler"."live_orders"."budget_micros" > 0 AND "pickler"."live_orders"."budget_micros" <= 5000000),
	CONSTRAINT "live_origin" CHECK ("pickler"."live_orders"."origin" in ('manual','agent')),
	CONSTRAINT "live_status" CHECK ("pickler"."live_orders"."status" in ('prepared','queued','submitting','unknown','settled','not_filled','failed','expired'))
);
--> statement-breakpoint
ALTER TABLE "pickler"."live_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pickler"."trading_accounts" (
	"tenant_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"wallet" text NOT NULL,
	"signer" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "trading_accounts_tenant_id_agent_id_pk" PRIMARY KEY("tenant_id","agent_id")
);
--> statement-breakpoint
ALTER TABLE "pickler"."trading_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pickler"."live_orders" ADD CONSTRAINT "live_orders_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "pickler"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."live_orders" ADD CONSTRAINT "live_orders_tenant_id_agent_id_trading_accounts_tenant_id_agent_id_fk" FOREIGN KEY ("tenant_id","agent_id") REFERENCES "pickler"."trading_accounts"("tenant_id","agent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."trading_accounts" ADD CONSTRAINT "trading_accounts_tenant_id_agent_id_agents_tenant_id_id_fk" FOREIGN KEY ("tenant_id","agent_id") REFERENCES "pickler"."agents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "live_request_identity" ON "pickler"."live_orders" USING btree ("tenant_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "live_run_identity" ON "pickler"."live_orders" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "live_hash_identity" ON "pickler"."live_orders" USING btree ("order_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "one_live_origin" ON "pickler"."live_orders" USING btree ("tenant_id","agent_id","origin") WHERE "pickler"."live_orders"."status" in ('queued','submitting','unknown','settled');--> statement-breakpoint
CREATE UNIQUE INDEX "one_live_position" ON "pickler"."live_orders" USING btree ("tenant_id","agent_id","market_id") WHERE "pickler"."live_orders"."status" in ('queued','submitting','unknown','settled');--> statement-breakpoint
CREATE UNIQUE INDEX "one_trading_wallet" ON "pickler"."trading_accounts" USING btree ("wallet");