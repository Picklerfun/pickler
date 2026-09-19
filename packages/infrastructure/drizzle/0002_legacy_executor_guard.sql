-- Refuse upgrade while a legacy executor still owns the database session lock.
DO $$ BEGIN
  IF NOT pg_try_advisory_xact_lock(761204, 1) THEN
    RAISE EXCEPTION 'Stop legacy Pickler executors before migrating execution leases';
  END IF;
END $$;
--> statement-breakpoint
-- A restarted legacy recover()/finish() must not terminate another executor's valid lease.
CREATE FUNCTION "pickler"."protect_execution_owner"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'running' AND NEW.status <> 'running'
    AND OLD.lease_expires_at > floor(extract(epoch from clock_timestamp()) * 1000)::bigint
    AND current_setting('pickler.execution_owner', true) IS DISTINCT FROM OLD.lease_owner THEN
    RAISE EXCEPTION 'Execution owner required for active lease';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "protect_execution_owner" BEFORE UPDATE ON "pickler"."runs"
FOR EACH ROW EXECUTE FUNCTION "pickler"."protect_execution_owner"();
