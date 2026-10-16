CREATE TABLE "pickler"."perpl_live_orders" (
	"product_agent_id" uuid NOT NULL,
	"id" text NOT NULL,
	"sequence" bigserial NOT NULL,
	"session_id" text NOT NULL,
	"request_id" bigint NOT NULL,
	"order_type" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL,
	"filled_size" bigint DEFAULT 0 NOT NULL,
	"leverage" integer NOT NULL,
	"document" jsonb NOT NULL,
	CONSTRAINT "perpl_live_orders_product_agent_id_id_pk" PRIMARY KEY("product_agent_id","id")
);
--> statement-breakpoint
ALTER TABLE "pickler"."perpl_live_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pickler"."perpl_live_sessions" (
	"product_agent_id" uuid NOT NULL,
	"id" text NOT NULL,
	"sequence" bigserial NOT NULL,
	"request_key" text NOT NULL,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL,
	"margin_micros" text NOT NULL,
	"order_count" bigint DEFAULT 0 NOT NULL,
	"net_filled" bigint DEFAULT 0 NOT NULL,
	"opening_request_id" bigint DEFAULT 0 NOT NULL,
	"opening_leverage" integer,
	"document" jsonb NOT NULL,
	CONSTRAINT "perpl_live_sessions_product_agent_id_id_pk" PRIMARY KEY("product_agent_id","id")
);
--> statement-breakpoint
ALTER TABLE "pickler"."perpl_live_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pickler"."perpl_live_setup" (
	"product_agent_id" uuid NOT NULL,
	"id" text NOT NULL,
	"sequence" bigserial NOT NULL,
	"request_key" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL,
	"amount_micros" text NOT NULL,
	"document" jsonb NOT NULL,
	CONSTRAINT "perpl_live_setup_product_agent_id_id_pk" PRIMARY KEY("product_agent_id","id")
);
--> statement-breakpoint
ALTER TABLE "pickler"."perpl_live_setup" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pickler"."perpl_live_accounts" ADD COLUMN "storage_mode" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "pickler"."perpl_live_accounts" ADD COLUMN "operational" jsonb;--> statement-breakpoint
ALTER TABLE "pickler"."perpl_live_accounts" ADD COLUMN "revision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pickler"."perpl_live_accounts" ADD COLUMN "writer_fence" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pickler"."perpl_live_accounts" ADD COLUMN "next_due" bigint;--> statement-breakpoint
ALTER TABLE "pickler"."perpl_live_accounts" ADD COLUMN "wake_generation" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pickler"."perpl_live_accounts" ADD COLUMN "wake_owner" text;--> statement-breakpoint
ALTER TABLE "pickler"."perpl_live_accounts" ADD COLUMN "wake_expires_at" bigint;--> statement-breakpoint
ALTER TABLE "pickler"."perpl_live_accounts" ADD COLUMN "wake_published_generation" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pickler"."perpl_live_accounts" ADD COLUMN "normalization" jsonb;--> statement-breakpoint
ALTER TABLE "pickler"."perpl_live_orders" ADD CONSTRAINT "perpl_live_orders_product_agent_id_perpl_live_accounts_product_agent_id_fk" FOREIGN KEY ("product_agent_id") REFERENCES "pickler"."perpl_live_accounts"("product_agent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."perpl_live_sessions" ADD CONSTRAINT "perpl_live_sessions_product_agent_id_perpl_live_accounts_product_agent_id_fk" FOREIGN KEY ("product_agent_id") REFERENCES "pickler"."perpl_live_accounts"("product_agent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."perpl_live_setup" ADD CONSTRAINT "perpl_live_setup_product_agent_id_perpl_live_accounts_product_agent_id_fk" FOREIGN KEY ("product_agent_id") REFERENCES "pickler"."perpl_live_accounts"("product_agent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "perpl_live_order_request" ON "pickler"."perpl_live_orders" USING btree ("product_agent_id","request_id");--> statement-breakpoint
CREATE INDEX "perpl_live_order_session" ON "pickler"."perpl_live_orders" USING btree ("product_agent_id","session_id","sequence");--> statement-breakpoint
CREATE INDEX "perpl_live_order_status" ON "pickler"."perpl_live_orders" USING btree ("product_agent_id","status","sequence");--> statement-breakpoint
CREATE INDEX "perpl_live_order_history" ON "pickler"."perpl_live_orders" USING btree ("product_agent_id","sequence");--> statement-breakpoint
CREATE INDEX "perpl_live_order_day" ON "pickler"."perpl_live_orders" USING btree ("product_agent_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "perpl_live_session_key" ON "pickler"."perpl_live_sessions" USING btree ("product_agent_id","request_key");--> statement-breakpoint
CREATE INDEX "perpl_live_session_history" ON "pickler"."perpl_live_sessions" USING btree ("product_agent_id","sequence");--> statement-breakpoint
CREATE INDEX "perpl_live_session_status" ON "pickler"."perpl_live_sessions" USING btree ("product_agent_id","status","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "perpl_live_setup_key" ON "pickler"."perpl_live_setup" USING btree ("product_agent_id","request_key");--> statement-breakpoint
CREATE INDEX "perpl_live_setup_status" ON "pickler"."perpl_live_setup" USING btree ("product_agent_id","status","sequence");--> statement-breakpoint
CREATE INDEX "perpl_live_setup_history" ON "pickler"."perpl_live_setup" USING btree ("product_agent_id","sequence");--> statement-breakpoint
CREATE INDEX "perpl_live_setup_day" ON "pickler"."perpl_live_setup" USING btree ("product_agent_id","created_at");--> statement-breakpoint
CREATE INDEX "perpl_live_due" ON "pickler"."perpl_live_accounts" USING btree ("next_due","product_agent_id");--> statement-breakpoint
ALTER TABLE "pickler"."perpl_live_accounts" ADD CONSTRAINT "perpl_live_storage_mode" CHECK ("pickler"."perpl_live_accounts"."storage_mode" in ('legacy','converting','split'));
--> statement-breakpoint
CREATE FUNCTION pickler.fence_perpl_live_writer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.writer_fence >= 2 AND current_setting('pickler.perpl_writer_version',true) IS DISTINCT FROM '2' THEN
    RAISE EXCEPTION 'PERPL_WRITER_FENCED' USING ERRCODE='55000';
  END IF;
  IF OLD.storage_mode='converting' AND NEW.document IS DISTINCT FROM OLD.document THEN
    RAISE EXCEPTION 'PERPL_CONVERSION_IN_PROGRESS' USING ERRCODE='55000';
  END IF;
  IF NEW.document IS DISTINCT FROM OLD.document THEN NEW.revision=OLD.revision+1; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER fence_perpl_live_writer BEFORE UPDATE OF document,operational,storage_mode,writer_fence
ON pickler.perpl_live_accounts FOR EACH ROW EXECUTE FUNCTION pickler.fence_perpl_live_writer();
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT SELECT,INSERT,UPDATE ON pickler.perpl_live_sessions,pickler.perpl_live_orders,pickler.perpl_live_setup TO service_role;
    GRANT USAGE,SELECT ON SEQUENCE pickler.perpl_live_sessions_sequence_seq,pickler.perpl_live_orders_sequence_seq,pickler.perpl_live_setup_sequence_seq TO service_role;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON pickler.perpl_live_sessions,pickler.perpl_live_orders,pickler.perpl_live_setup FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON pickler.perpl_live_sessions,pickler.perpl_live_orders,pickler.perpl_live_setup FROM authenticated;
  END IF;
END $$;
