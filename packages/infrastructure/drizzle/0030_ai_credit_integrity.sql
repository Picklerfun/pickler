-- Backend-only purchased credits. No public Supabase Data API access or price seeding.
CREATE FUNCTION billing.ai_credit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AI credit history and pricing are immutable' USING ERRCODE = '23514';
END
$$;
--> statement-breakpoint
CREATE TRIGGER ai_credit_ledger_immutable BEFORE UPDATE OR DELETE ON billing.ai_credit_ledger
FOR EACH ROW EXECUTE FUNCTION billing.ai_credit_immutable();
--> statement-breakpoint
CREATE TRIGGER ai_credit_pricing_immutable BEFORE UPDATE OR DELETE ON billing.ai_credit_pricing_versions
FOR EACH ROW EXECUTE FUNCTION billing.ai_credit_immutable();
--> statement-breakpoint
CREATE TRIGGER ai_credit_payment_immutable BEFORE UPDATE OR DELETE ON billing.ai_credit_payment_events
FOR EACH ROW EXECUTE FUNCTION billing.ai_credit_immutable();
--> statement-breakpoint
CREATE FUNCTION billing.ai_credit_project() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE billing.ai_credit_accounts
  SET balance_units = balance_units + NEW.balance_delta_units,
      reserved_units = reserved_units + NEW.reserved_delta_units,
      status = CASE WHEN balance_units + NEW.balance_delta_units < 0 THEN 'blocked' ELSE 'active' END,
      version = version + 1,
      updated_at = clock_timestamp()
  WHERE id = NEW.account_id;
  IF NEW.kind <> 'adjustment' AND EXISTS (
    SELECT 1 FROM billing.ai_credit_accounts WHERE id = NEW.account_id AND balance_units < 0
  ) AND NEW.balance_delta_units < 0 THEN
    RAISE EXCEPTION 'Ordinary credit charges cannot increase a deficit' USING ERRCODE = '23514';
  END IF;
  IF NEW.kind = 'reserve' AND NEW.reserved_delta_units > 0 AND EXISTS (
    SELECT 1 FROM billing.ai_credit_accounts
    WHERE id = NEW.account_id AND reserved_units > GREATEST(balance_units, 0)
  ) THEN
    RAISE EXCEPTION 'Shared credit balance exhausted' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER ai_credit_ledger_project AFTER INSERT ON billing.ai_credit_ledger
FOR EACH ROW EXECUTE FUNCTION billing.ai_credit_project();
--> statement-breakpoint
CREATE FUNCTION billing.ai_credit_projection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.balance_units <> 0 OR NEW.reserved_units <> 0 OR NEW.version <> 0 OR NEW.status <> 'active' THEN
      RAISE EXCEPTION 'New credit accounts start at zero' USING ERRCODE = '23514';
    END IF;
  ELSIF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'Credit projections may only change through ledger postings' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER ai_credit_account_projection_guard BEFORE INSERT OR UPDATE ON billing.ai_credit_accounts
FOR EACH ROW EXECUTE FUNCTION billing.ai_credit_projection_guard();
--> statement-breakpoint
CREATE FUNCTION billing.ai_credit_operation_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pickler.perps_checks c
    JOIN pickler.product_agents m ON m.product_agent_id = c.product_agent_id
    JOIN identity.workspaces w ON w.id = m.workspace_id
    JOIN billing.ai_credit_accounts a ON a.id = NEW.account_id
    WHERE c.id = NEW.check_id AND c.product_agent_id = NEW.product_agent_id
      AND c.tenant_id = NEW.tenant_id AND c.agent_id = NEW.runtime_agent_id
      AND m.tenant_id = NEW.tenant_id AND m.runtime_agent_id = NEW.runtime_agent_id
      AND m.workspace_id = NEW.workspace_id AND w.owner_user_id = a.user_id
      AND c.config_version = NEW.config_version
  ) THEN
    RAISE EXCEPTION 'Credit operation identity mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER ai_credit_operation_identity BEFORE INSERT ON billing.ai_credit_operations
FOR EACH ROW EXECUTE FUNCTION billing.ai_credit_operation_identity();
--> statement-breakpoint
-- Quotes and operation identities are frozen; only their lifecycle fields may change.
CREATE FUNCTION billing.ai_credit_frozen_fields() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'ai_credit_purchases' THEN
    IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
      RAISE EXCEPTION 'Purchase quote is immutable' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'ai_credit_operations' THEN
    IF (to_jsonb(NEW) - ARRAY['status','charged_units','finished_at']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','charged_units','finished_at']) OR OLD.status <> 'active' THEN
      RAISE EXCEPTION 'Operation identity or terminal result is immutable' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'ai_credit_call_allocations' THEN
    IF (to_jsonb(NEW) - ARRAY['status','charged_units','request_sha256','started_at']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','charged_units','request_sha256','started_at'])
       OR (OLD.request_sha256 IS NOT NULL AND NEW.request_sha256 IS DISTINCT FROM OLD.request_sha256)
       OR OLD.status IN ('settled','released') THEN
      RAISE EXCEPTION 'Call attribution or terminal result is immutable' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'ai_credit_agent_limits' THEN
    IF NEW.account_id <> OLD.account_id OR NEW.product_agent_id <> OLD.product_agent_id
       OR NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'Credit limit identity/version mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER ai_credit_purchase_frozen BEFORE UPDATE ON billing.ai_credit_purchases
FOR EACH ROW EXECUTE FUNCTION billing.ai_credit_frozen_fields();
--> statement-breakpoint
CREATE TRIGGER ai_credit_operation_frozen BEFORE UPDATE ON billing.ai_credit_operations
FOR EACH ROW EXECUTE FUNCTION billing.ai_credit_frozen_fields();
--> statement-breakpoint
CREATE TRIGGER ai_credit_allocation_frozen BEFORE UPDATE ON billing.ai_credit_call_allocations
FOR EACH ROW EXECUTE FUNCTION billing.ai_credit_frozen_fields();
--> statement-breakpoint
CREATE TRIGGER ai_credit_limit_frozen BEFORE UPDATE ON billing.ai_credit_agent_limits
FOR EACH ROW EXECUTE FUNCTION billing.ai_credit_frozen_fields();
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    ALTER TABLE billing.ai_credit_accounts ADD CONSTRAINT ai_credit_account_auth_user
      FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA billing FROM anon;
    REVOKE ALL ON ALL TABLES IN SCHEMA billing FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON SCHEMA billing FROM authenticated;
    REVOKE ALL ON ALL TABLES IN SCHEMA billing FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA billing TO service_role;
    GRANT SELECT, INSERT ON billing.ai_credit_pricing_versions, billing.ai_credit_payment_events,
      billing.ai_credit_ledger TO service_role;
    GRANT SELECT, INSERT, UPDATE ON billing.ai_credit_accounts, billing.ai_credit_purchases,
      billing.ai_credit_operations, billing.ai_credit_call_allocations, billing.ai_credit_agent_limits TO service_role;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA billing TO service_role;
  END IF;
END
$$;
