CREATE TABLE "pickler"."paper_daily_totals" (
	"account_id" text NOT NULL,
	"day" bigint NOT NULL,
	"realized" numeric(38, 18) DEFAULT '0' NOT NULL,
	"margin" numeric(38, 18) DEFAULT '0' NOT NULL,
	CONSTRAINT "paper_daily_totals_account_id_day_pk" PRIMARY KEY("account_id","day")
);
--> statement-breakpoint
ALTER TABLE "pickler"."paper_daily_totals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pickler"."paper_funding_epochs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"cutoff_at" bigint NOT NULL,
	"anchor" jsonb NOT NULL,
	"max_sequence" bigint NOT NULL,
	"cursor" bigint DEFAULT 0 NOT NULL,
	"event_cursor" bigint,
	"owner" uuid,
	"expires_at" bigint,
	"delta" numeric(38, 18) DEFAULT '0' NOT NULL,
	"committed_at" bigint,
	"error" text,
	CONSTRAINT "paper_funding_epoch_status" CHECK ("pickler"."paper_funding_epochs"."status" IN ('pending','running','committed','disputed'))
);
--> statement-breakpoint
ALTER TABLE "pickler"."paper_funding_epochs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pickler"."paper_funding_postings" (
	"account_id" text NOT NULL,
	"key" text NOT NULL,
	"epoch_id" uuid NOT NULL,
	"delta" numeric(38, 18) NOT NULL,
	"document" jsonb NOT NULL,
	CONSTRAINT "paper_funding_postings_account_id_key_pk" PRIMARY KEY("account_id","key")
);
--> statement-breakpoint
ALTER TABLE "pickler"."paper_funding_postings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pickler"."paper_position_sizeups" (
	"account_id" text NOT NULL,
	"position_id" text NOT NULL,
	"key" text NOT NULL,
	"sequence" bigserial NOT NULL,
	"at" bigint NOT NULL,
	"margin" numeric(38, 18) NOT NULL,
	CONSTRAINT "paper_position_sizeups_account_id_position_id_key_pk" PRIMARY KEY("account_id","position_id","key")
);
--> statement-breakpoint
ALTER TABLE "pickler"."paper_position_sizeups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pickler"."paper_position_totals" (
	"account_id" text NOT NULL,
	"position_id" text NOT NULL,
	"sizeup_margin" numeric(38, 18) DEFAULT '0' NOT NULL,
	"pnl" numeric(38, 18) DEFAULT '0' NOT NULL,
	CONSTRAINT "paper_position_totals_account_id_position_id_pk" PRIMARY KEY("account_id","position_id")
);
--> statement-breakpoint
ALTER TABLE "pickler"."paper_position_totals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pickler"."paper_storage" (
	"account_id" text PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'legacy' NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"phase" text DEFAULT 'positions' NOT NULL,
	"audit_at" bigint DEFAULT 0 NOT NULL,
	"exit_at" bigint DEFAULT 0 NOT NULL,
	"cursor" text,
	"original" jsonb,
	"coverage_required" bigint DEFAULT 0 NOT NULL,
	"coverage_complete" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "paper_storage_mode" CHECK ("pickler"."paper_storage"."mode" IN ('legacy','frozen','operational'))
);
--> statement-breakpoint
ALTER TABLE "pickler"."paper_storage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pickler"."paper_record_closes" (
	"account_id" text NOT NULL,
	"position_id" text NOT NULL,
	"pnl" text NOT NULL,
	CONSTRAINT "paper_record_closes_account_id_position_id_pk" PRIMARY KEY("account_id","position_id")
);
--> statement-breakpoint
ALTER TABLE "pickler"."paper_record_closes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pickler"."paper_record_facts" (
	"account_id" text NOT NULL,
	"key" text NOT NULL,
	"sequence" bigserial NOT NULL,
	"at" bigint NOT NULL,
	"kind" text NOT NULL,
	"delta" text NOT NULL,
	CONSTRAINT "paper_record_facts_account_id_key_pk" PRIMARY KEY("account_id","key")
);
--> statement-breakpoint
ALTER TABLE "pickler"."paper_record_facts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pickler"."paper_record_state" (
	"account_id" text PRIMARY KEY NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"document" jsonb NOT NULL,
	"complete" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pickler"."paper_record_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pickler"."perps_paper_attempts" ADD COLUMN "sequence" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "pickler"."perps_paper_positions" ADD COLUMN "sequence" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "pickler"."perps_paper_positions" ADD COLUMN "closed_sequence" bigint;--> statement-breakpoint
ALTER TABLE "pickler"."paper_daily_totals" ADD CONSTRAINT "paper_daily_totals_account_id_perps_paper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "pickler"."perps_paper_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."paper_funding_epochs" ADD CONSTRAINT "paper_funding_epochs_account_id_perps_paper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "pickler"."perps_paper_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."paper_funding_postings" ADD CONSTRAINT "paper_funding_postings_account_id_perps_paper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "pickler"."perps_paper_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."paper_funding_postings" ADD CONSTRAINT "paper_funding_postings_epoch_id_paper_funding_epochs_id_fk" FOREIGN KEY ("epoch_id") REFERENCES "pickler"."paper_funding_epochs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."paper_position_sizeups" ADD CONSTRAINT "paper_position_sizeups_account_id_perps_paper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "pickler"."perps_paper_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."paper_position_totals" ADD CONSTRAINT "paper_position_totals_account_id_perps_paper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "pickler"."perps_paper_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."paper_storage" ADD CONSTRAINT "paper_storage_account_id_perps_paper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "pickler"."perps_paper_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."paper_record_closes" ADD CONSTRAINT "paper_record_closes_account_id_perps_paper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "pickler"."perps_paper_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."paper_record_facts" ADD CONSTRAINT "paper_record_facts_account_id_perps_paper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "pickler"."perps_paper_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickler"."paper_record_state" ADD CONSTRAINT "paper_record_state_account_id_perps_paper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "pickler"."perps_paper_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "paper_funding_epoch_account" ON "pickler"."paper_funding_epochs" USING btree ("account_id","cutoff_at");--> statement-breakpoint
CREATE INDEX "paper_funding_postings_epoch" ON "pickler"."paper_funding_postings" USING btree ("epoch_id");--> statement-breakpoint
CREATE INDEX "paper_funding_postings_history" ON "pickler"."paper_funding_postings" USING btree ("account_id","epoch_id","key");--> statement-breakpoint
CREATE INDEX "paper_sizeup_history_sequence" ON "pickler"."paper_position_sizeups" USING btree ("account_id","sequence");--> statement-breakpoint
CREATE INDEX "paper_record_sequence" ON "pickler"."paper_record_facts" USING btree ("account_id","sequence");--> statement-breakpoint
CREATE INDEX "paper_record_chronology" ON "pickler"."paper_record_facts" USING btree ("account_id","at","key");--> statement-breakpoint
CREATE INDEX "paper_attempt_history_sequence" ON "pickler"."perps_paper_attempts" USING btree ("account_id","sequence");--> statement-breakpoint
CREATE INDEX "paper_sizeup_attempt_history" ON "pickler"."perps_paper_attempts" USING btree ("account_id",("document"->'intent'->>'symbol'),(("document"->>'createdAt')::bigint),"key") WHERE "pickler"."perps_paper_attempts"."document"->>'status'='filled' AND "pickler"."perps_paper_attempts"."document"->>'reason'='size_up';--> statement-breakpoint
CREATE INDEX "paper_attempt_pending_expiry" ON "pickler"."perps_paper_attempts" USING btree ("account_id","expires_at","key") WHERE "pickler"."perps_paper_attempts"."owner" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "perps_paper_position_sequence" ON "pickler"."perps_paper_positions" USING btree ("account_id","sequence");--> statement-breakpoint
CREATE INDEX "paper_closed_sequence" ON "pickler"."perps_paper_positions" USING btree ("account_id","closed_sequence") WHERE "pickler"."perps_paper_positions"."closed_at" IS NOT NULL;
--> statement-breakpoint
-- A converted or frozen account cannot be mutated by an older writer. The migration and
-- current repository set transaction-local trusted writer context; no browser input selects it.
CREATE FUNCTION pickler.paper_writer_fence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE aid text; storage_mode text;
BEGIN
  IF TG_TABLE_NAME='perps_paper_accounts' THEN
    aid := NEW.id;
  ELSE
    aid := NEW.account_id;
  END IF;
  SELECT mode INTO storage_mode FROM pickler.paper_storage WHERE account_id=aid;
  IF storage_mode='frozen' AND current_setting('pickler.paper_migration',true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'PAPER_MIGRATION_FROZEN' USING ERRCODE='55000';
  END IF;
  IF storage_mode='operational' AND current_setting('pickler.paper_writer',true) IS DISTINCT FROM '2'
      AND current_setting('pickler.paper_migration',true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'PAPER_WRITER_VERSION_REQUIRED' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER paper_account_writer BEFORE UPDATE ON pickler.perps_paper_accounts
FOR EACH ROW EXECUTE FUNCTION pickler.paper_writer_fence();
--> statement-breakpoint
CREATE TRIGGER paper_position_writer BEFORE INSERT OR UPDATE ON pickler.perps_paper_positions
FOR EACH ROW EXECUTE FUNCTION pickler.paper_writer_fence();
--> statement-breakpoint
CREATE TRIGGER paper_attempt_writer BEFORE INSERT OR UPDATE ON pickler.perps_paper_attempts
FOR EACH ROW EXECUTE FUNCTION pickler.paper_writer_fence();
--> statement-breakpoint
CREATE TRIGGER paper_movement_writer BEFORE INSERT OR UPDATE ON pickler.perps_paper_movements
FOR EACH ROW EXECUTE FUNCTION pickler.paper_writer_fence();
--> statement-breakpoint
REVOKE ALL ON pickler.paper_storage,pickler.paper_funding_epochs,pickler.paper_funding_postings,pickler.paper_position_totals FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON pickler.paper_storage,pickler.paper_funding_epochs,pickler.paper_funding_postings,pickler.paper_position_totals FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON pickler.paper_storage,pickler.paper_funding_epochs,pickler.paper_funding_postings,pickler.paper_position_totals FROM authenticated;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT SELECT,INSERT,UPDATE ON pickler.paper_storage,pickler.paper_funding_epochs,pickler.paper_funding_postings,pickler.paper_position_totals TO service_role;
    GRANT USAGE,SELECT ON SEQUENCE pickler.perps_paper_positions_sequence_seq TO service_role;
  END IF;
END $$;
--> statement-breakpoint
CREATE SEQUENCE pickler.paper_closed_position_seq;
--> statement-breakpoint
CREATE FUNCTION pickler.paper_close_sequence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.closed_at IS NOT NULL AND NEW.closed_sequence IS NULL THEN
    NEW.closed_sequence := nextval('pickler.paper_closed_position_seq');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER paper_closed_sequence BEFORE INSERT OR UPDATE ON pickler.perps_paper_positions
FOR EACH ROW EXECUTE FUNCTION pickler.paper_close_sequence();
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT USAGE,SELECT ON SEQUENCE pickler.paper_closed_position_seq TO service_role;
    GRANT SELECT,INSERT,UPDATE ON pickler.paper_daily_totals TO service_role;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON pickler.paper_daily_totals FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON pickler.paper_daily_totals FROM authenticated;
  END IF;
END $$;
REVOKE ALL ON pickler.paper_daily_totals FROM PUBLIC;

--> statement-breakpoint
REVOKE ALL ON pickler.paper_record_facts,pickler.paper_record_state,pickler.paper_record_closes FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON pickler.paper_record_facts,pickler.paper_record_state,pickler.paper_record_closes FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON pickler.paper_record_facts,pickler.paper_record_state,pickler.paper_record_closes FROM authenticated;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT SELECT,INSERT,UPDATE ON pickler.paper_record_facts,pickler.paper_record_state,pickler.paper_record_closes TO service_role;
    GRANT USAGE,SELECT ON SEQUENCE pickler.paper_record_facts_sequence_seq TO service_role;
  END IF;
END $$;

--> statement-breakpoint
REVOKE ALL ON pickler.paper_position_sizeups FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON pickler.paper_position_sizeups FROM anon; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON pickler.paper_position_sizeups FROM authenticated; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT SELECT,INSERT ON pickler.paper_position_sizeups TO service_role; END IF;
END $$;

--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT USAGE,SELECT ON SEQUENCE pickler.perps_paper_attempts_sequence_seq,pickler.paper_position_sizeups_sequence_seq TO service_role;
  END IF;
END $$;
