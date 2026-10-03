CREATE TABLE "pickler"."perps_checks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_agent_id" uuid NOT NULL,
	"tenant_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"trigger" text NOT NULL,
	"request_key" text,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL,
	"started_at" bigint,
	"finished_at" bigint,
	"config_version" integer,
	"inputs" jsonb,
	"decision" jsonb,
	"outcome" text,
	"outcome_text" text,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cost_micros" numeric(30, 0),
	"error" text,
	"lease_owner" uuid,
	"lease_expires_at" bigint,
	CONSTRAINT "perps_checks_trigger" CHECK ("pickler"."perps_checks"."trigger" in ('hourly','manual','exits','owner','system')),
	CONSTRAINT "perps_checks_status" CHECK ("pickler"."perps_checks"."status" in ('queued','running','finished')),
	CONSTRAINT "perps_checks_outcome" CHECK ("pickler"."perps_checks"."outcome" is null OR "pickler"."perps_checks"."outcome" in ('entered','exited','held','blocked','proposed','skipped','failed','system')),
	CONSTRAINT "perps_checks_finished" CHECK (("pickler"."perps_checks"."status" = 'finished') = ("pickler"."perps_checks"."outcome" is not null)),
	CONSTRAINT "perps_checks_lease" CHECK ("pickler"."perps_checks"."status" <> 'running' OR ("pickler"."perps_checks"."lease_owner" is not null AND "pickler"."perps_checks"."lease_expires_at" is not null)),
	CONSTRAINT "perps_checks_cost" CHECK ("pickler"."perps_checks"."cost_micros" is null OR "pickler"."perps_checks"."cost_micros" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pickler"."perps_checks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pickler"."perps_proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"check_id" uuid NOT NULL,
	"product_agent_id" uuid NOT NULL,
	"tenant_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"instrument" text NOT NULL,
	"side" text NOT NULL,
	"margin" numeric(38, 18) NOT NULL,
	"leverage" integer NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"decided_at" bigint,
	"position_id" text,
	CONSTRAINT "perps_proposals_instrument" CHECK ("pickler"."perps_proposals"."instrument" in ('BTC','ETH')),
	CONSTRAINT "perps_proposals_side" CHECK ("pickler"."perps_proposals"."side" in ('long','short')),
	CONSTRAINT "perps_proposals_kind" CHECK ("pickler"."perps_proposals"."kind" in ('enter','size_up')),
	CONSTRAINT "perps_proposals_status" CHECK ("pickler"."perps_proposals"."status" in ('pending','approved','skipped','expired')),
	CONSTRAINT "perps_proposals_amounts" CHECK ("pickler"."perps_proposals"."margin" > 0 AND "pickler"."perps_proposals"."leverage" >= 1)
);
--> statement-breakpoint
ALTER TABLE "pickler"."perps_proposals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pickler"."perps_paper_positions" ADD COLUMN "check_id" uuid;--> statement-breakpoint
ALTER TABLE "pickler"."perps_paper_positions" ADD COLUMN "config_version" integer;--> statement-breakpoint
ALTER TABLE "pickler"."perps_paper_positions" ADD COLUMN "leverage" integer;--> statement-breakpoint
ALTER TABLE "pickler"."perps_paper_positions" ADD COLUMN "margin" numeric(38, 18);--> statement-breakpoint
ALTER TABLE "pickler"."perps_paper_positions" ADD COLUMN "stop_price" numeric(38, 18);--> statement-breakpoint
ALTER TABLE "pickler"."perps_paper_positions" ADD COLUMN "take_profit_price" numeric(38, 18);--> statement-breakpoint
ALTER TABLE "pickler"."perps_paper_positions" ADD COLUMN "exit_due_at" bigint;--> statement-breakpoint
ALTER TABLE "pickler"."perps_paper_positions" ADD COLUMN "close_reason" text;--> statement-breakpoint
ALTER TABLE "pickler"."perps_checks" ADD CONSTRAINT "perps_checks_product_agent_id_product_agents_product_agent_id_fk" FOREIGN KEY ("product_agent_id") REFERENCES "pickler"."product_agents"("product_agent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."perps_checks" ADD CONSTRAINT "perps_checks_tenant_id_agent_id_agents_tenant_id_id_fk" FOREIGN KEY ("tenant_id","agent_id") REFERENCES "pickler"."agents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."perps_proposals" ADD CONSTRAINT "perps_proposals_check_id_perps_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "pickler"."perps_checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."perps_proposals" ADD CONSTRAINT "perps_proposals_product_agent_id_product_agents_product_agent_id_fk" FOREIGN KEY ("product_agent_id") REFERENCES "pickler"."product_agents"("product_agent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."perps_proposals" ADD CONSTRAINT "perps_proposals_tenant_id_agent_id_agents_tenant_id_id_fk" FOREIGN KEY ("tenant_id","agent_id") REFERENCES "pickler"."agents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "perps_checks_feed" ON "pickler"."perps_checks" USING btree ("product_agent_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "perps_checks_day" ON "pickler"."perps_checks" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "perps_checks_request" ON "pickler"."perps_checks" USING btree ("product_agent_id","request_key") WHERE "pickler"."perps_checks"."request_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "perps_checks_agent_active" ON "pickler"."perps_checks" USING btree ("tenant_id","agent_id") WHERE "pickler"."perps_checks"."status" in ('queued','running');--> statement-breakpoint
CREATE INDEX "perps_proposals_expiry" ON "pickler"."perps_proposals" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "perps_proposals_agent" ON "pickler"."perps_proposals" USING btree ("product_agent_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "perps_paper_exit_due" ON "pickler"."perps_paper_positions" USING btree ("exit_due_at") WHERE "pickler"."perps_paper_positions"."closed_at" is null;--> statement-breakpoint
ALTER TABLE "pickler"."perps_paper_positions" ADD CONSTRAINT "perps_paper_close_reason" CHECK ("pickler"."perps_paper_positions"."close_reason" is null OR "pickler"."perps_paper_positions"."close_reason" in ('stop','take_profit','time','brief','owner','stop_all','day_loss'));--> statement-breakpoint
-- Drizzle emits no privileges. Like the other private runtime tables (0012/0013 perps paper, 0025
-- advice), RLS is on with no Data API policy; only the backend reaches them. Checks and proposals
-- change state (queued → running → finished, pending → decided), so the service role may update.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON pickler.perps_checks, pickler.perps_proposals TO service_role;
  END IF;
END
$$;
