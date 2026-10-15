CREATE TABLE "pickler"."advice_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"user_id" uuid NOT NULL,
	"public_agent_id" uuid NOT NULL,
	"request_key" text NOT NULL,
	"payer" text NOT NULL,
	"pay_to" text NOT NULL,
	"amount_micro_ausd" bigint NOT NULL,
	"nonce" text NOT NULL,
	"valid_before" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"tx_hash" text,
	"block_number" bigint,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advice_payments_status" CHECK ("pickler"."advice_payments"."status" IN ('pending','settled','failed','refund_owed'))
);
--> statement-breakpoint
ALTER TABLE "pickler"."advice_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agents"."agents" ADD COLUMN "advice_price_micro_ausd" bigint;--> statement-breakpoint
ALTER TABLE "pickler"."advice_payments" ADD CONSTRAINT "advice_payments_job_id_advice_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "pickler"."advice_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."advice_payments" ADD CONSTRAINT "advice_payments_public_agent_id_product_agents_product_agent_id_fk" FOREIGN KEY ("public_agent_id") REFERENCES "pickler"."product_agents"("product_agent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "advice_payments_nonce_key" ON "pickler"."advice_payments" USING btree ("nonce");--> statement-breakpoint
CREATE UNIQUE INDEX "advice_payments_tx_key" ON "pickler"."advice_payments" USING btree ("tx_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "advice_payments_request_key" ON "pickler"."advice_payments" USING btree ("user_id","public_agent_id","request_key");--> statement-breakpoint
ALTER TABLE "agents"."agents" ADD CONSTRAINT "agents_advice_price_bounds" CHECK ("agents"."agents"."advice_price_micro_ausd" IS NULL OR "agents"."agents"."advice_price_micro_ausd" BETWEEN 100000 AND 100000000);--> statement-breakpoint
-- Private backend access only. This table has no public Data API policies.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON pickler.advice_payments TO service_role;
  END IF;
END
$$;
