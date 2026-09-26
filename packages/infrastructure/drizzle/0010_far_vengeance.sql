CREATE TABLE "pickler"."trading_attempts" (
	"run_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"reason" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pickler"."trading_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pickler"."trading_accounts" ADD COLUMN "enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pickler"."trading_attempts" ADD CONSTRAINT "trading_attempts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "pickler"."runs"("id") ON DELETE no action ON UPDATE no action;