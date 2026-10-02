CREATE TABLE "pickler"."advice_calls" (
	"job_id" uuid NOT NULL,
	"lane" text NOT NULL,
	"model" text NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"reserved_micros" numeric(30, 0) NOT NULL,
	"cost_micros" numeric(30, 0),
	"input_tokens" bigint,
	"output_tokens" bigint,
	"started_at" bigint,
	"finished_at" bigint,
	"request_hash" text,
	CONSTRAINT "advice_calls_job_id_lane_pk" PRIMARY KEY("job_id","lane"),
	CONSTRAINT "advice_lane" CHECK ("pickler"."advice_calls"."lane" in ('jev','deepseek','web','web-fallback')),
	CONSTRAINT "advice_call_status" CHECK ("pickler"."advice_calls"."status" in ('reserved','started','completed','released')),
	CONSTRAINT "advice_amounts" CHECK ("pickler"."advice_calls"."reserved_micros" >= 0 AND ("pickler"."advice_calls"."cost_micros" is null OR "pickler"."advice_calls"."cost_micros" >= 0))
);
--> statement-breakpoint
ALTER TABLE "pickler"."advice_calls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pickler"."advice_events" (
	"job_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"at" bigint NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "advice_events_job_id_sequence_pk" PRIMARY KEY("job_id","sequence")
);
--> statement-breakpoint
ALTER TABLE "pickler"."advice_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pickler"."advice_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"public_agent_id" uuid NOT NULL,
	"tenant_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"request_key" text NOT NULL,
	"symbol" text NOT NULL,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL,
	"started_at" bigint,
	"finished_at" bigint,
	"config_version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"policy" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"lease_owner" uuid,
	"lease_expires_at" bigint,
	CONSTRAINT "advice_symbol" CHECK ("pickler"."advice_jobs"."symbol" in ('BTC','ETH')),
	CONSTRAINT "advice_status" CHECK ("pickler"."advice_jobs"."status" in ('queued','running','completed','failed')),
	CONSTRAINT "advice_completion" CHECK (("pickler"."advice_jobs"."status" = 'completed') = ("pickler"."advice_jobs"."result" is not null)),
	CONSTRAINT "advice_lease" CHECK ("pickler"."advice_jobs"."status" <> 'running' OR ("pickler"."advice_jobs"."lease_owner" is not null AND "pickler"."advice_jobs"."lease_expires_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "pickler"."advice_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pickler"."advice_calls" ADD CONSTRAINT "advice_calls_job_id_advice_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "pickler"."advice_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."advice_events" ADD CONSTRAINT "advice_events_job_id_advice_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "pickler"."advice_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."advice_jobs" ADD CONSTRAINT "advice_jobs_public_agent_id_product_agents_product_agent_id_fk" FOREIGN KEY ("public_agent_id") REFERENCES "pickler"."product_agents"("product_agent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."advice_jobs" ADD CONSTRAINT "advice_jobs_tenant_id_agent_id_agents_tenant_id_id_fk" FOREIGN KEY ("tenant_id","agent_id") REFERENCES "pickler"."agents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "advice_request_identity" ON "pickler"."advice_jobs" USING btree ("user_id","public_agent_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "advice_user_active" ON "pickler"."advice_jobs" USING btree ("user_id") WHERE "pickler"."advice_jobs"."status" in ('queued','running');--> statement-breakpoint
CREATE UNIQUE INDEX "advice_agent_active" ON "pickler"."advice_jobs" USING btree ("tenant_id","agent_id") WHERE "pickler"."advice_jobs"."status" in ('queued','running');--> statement-breakpoint
CREATE INDEX "advice_pending" ON "pickler"."advice_jobs" USING btree ("created_at") WHERE "pickler"."advice_jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "advice_history" ON "pickler"."advice_jobs" USING btree ("public_agent_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "pickler"."advice_jobs"."status" = 'completed';
--> statement-breakpoint
-- Private backend access only. These tables have no public Data API policies.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON pickler.advice_jobs, pickler.advice_calls, pickler.advice_events TO service_role;
  END IF;
END
$$;
