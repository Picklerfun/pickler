-- Custom SQL migration file, put your code below! --
-- Private backend state only; no Supabase Data API access or public execution policy.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON pickler.perpl_live_accounts FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON pickler.perpl_live_accounts FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON pickler.perpl_live_accounts TO service_role;
  END IF;
END $$;
REVOKE ALL ON pickler.perpl_live_accounts FROM PUBLIC;
