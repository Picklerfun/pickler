-- Grants for the launch schema and the two new market tables.
--
-- Drizzle emits tables, constraints and indexes but not privileges, which is why 0006 already
-- carries the grants for the other product schemas. The indexer and the API reach these
-- through the service role.
--
-- Delete is included deliberately: unwinding a reorg means removing rows a discarded branch
-- produced, and a role that can only insert cannot roll anything back.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA "launch" TO "service_role";
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "launch" TO "service_role";
    GRANT SELECT, INSERT, UPDATE, DELETE ON "market"."chain_blocks" TO "service_role";
    GRANT SELECT, INSERT, UPDATE, DELETE ON "market"."chain_events" TO "service_role";
  END IF;
END
$$;
