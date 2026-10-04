CREATE TABLE "pickler"."perps_check_calls" (
	"check_id" uuid NOT NULL,
	"key" text NOT NULL,
	"plan" jsonb NOT NULL,
	"status" text NOT NULL,
	"reserved_micros" numeric(30, 0) NOT NULL,
	"cost_micros" numeric(30, 0),
	"request_sha256" text,
	"request_bytes" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"started_at" bigint,
	"finished_at" bigint,
	CONSTRAINT "perps_check_calls_status" CHECK ("pickler"."perps_check_calls"."status" in ('reserved','started','completed','unknown','skipped')),
	CONSTRAINT "perps_check_calls_amounts" CHECK ("pickler"."perps_check_calls"."reserved_micros" >= 0 AND ("pickler"."perps_check_calls"."cost_micros" IS NULL OR ("pickler"."perps_check_calls"."cost_micros" >= 0 AND "pickler"."perps_check_calls"."cost_micros" <= "pickler"."perps_check_calls"."reserved_micros")))
);
--> statement-breakpoint
ALTER TABLE "pickler"."perps_check_calls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pickler"."perps_check_evidence" (
	"check_id" uuid NOT NULL,
	"key" text NOT NULL,
	"sha256" text NOT NULL,
	"document" jsonb NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pickler"."perps_check_evidence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pickler"."perps_check_reservations" (
	"check_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"config_version" integer NOT NULL,
	"day" text NOT NULL,
	"strategy" jsonb NOT NULL,
	"policy" jsonb NOT NULL,
	"reserved_micros" numeric(30, 0) NOT NULL,
	"accounted_micros" numeric(30, 0) NOT NULL,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "perps_check_reservations_status" CHECK ("pickler"."perps_check_reservations"."status" in ('active','closed','unknown')),
	CONSTRAINT "perps_check_reservations_amounts" CHECK ("pickler"."perps_check_reservations"."reserved_micros" >= 0 AND "pickler"."perps_check_reservations"."accounted_micros" >= 0 AND "pickler"."perps_check_reservations"."accounted_micros" <= "pickler"."perps_check_reservations"."reserved_micros")
);
--> statement-breakpoint
ALTER TABLE "pickler"."perps_check_reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pickler"."perps_check_calls" ADD CONSTRAINT "perps_check_calls_check_id_perps_check_reservations_check_id_fk" FOREIGN KEY ("check_id") REFERENCES "pickler"."perps_check_reservations"("check_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."perps_check_evidence" ADD CONSTRAINT "perps_check_evidence_check_id_perps_check_reservations_check_id_fk" FOREIGN KEY ("check_id") REFERENCES "pickler"."perps_check_reservations"("check_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."perps_check_reservations" ADD CONSTRAINT "perps_check_reservations_check_id_perps_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "pickler"."perps_checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."perps_check_reservations" ADD CONSTRAINT "perps_check_reservations_tenant_id_agent_id_agents_tenant_id_id_fk" FOREIGN KEY ("tenant_id","agent_id") REFERENCES "pickler"."agents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "perps_check_calls_identity" ON "pickler"."perps_check_calls" USING btree ("check_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "perps_check_evidence_identity" ON "pickler"."perps_check_evidence" USING btree ("check_id","key");--> statement-breakpoint
CREATE INDEX "perps_check_reservations_day" ON "pickler"."perps_check_reservations" USING btree ("tenant_id","agent_id","day");--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON pickler.perps_check_reservations, pickler.perps_check_calls TO service_role;
    GRANT SELECT, INSERT ON pickler.perps_check_evidence TO service_role;
  END IF;
END
$$;
