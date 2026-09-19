-- What Drizzle cannot express: the `internal` helper schema, triggers, deferrable foreign keys,
-- the Supabase Auth references, the security-definer functions the web app calls, and the grants
-- that keep every table unreachable from the API roles.
--
-- Supabase objects (`auth.users`, the `anon`, `authenticated` and `service_role` roles) exist only
-- on a Supabase database. Each block below is skipped on a plain PostgreSQL database, so the same
-- migration runs in both places.

CREATE SCHEMA "internal";
--> statement-breakpoint
CREATE FUNCTION "internal"."set_updated_at"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;
--> statement-breakpoint
-- Attached to append-only tables (events, ledgers): history is never edited or deleted.
CREATE FUNCTION "internal"."reject_mutation"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
begin
  raise exception '%.% is append-only', tg_table_schema, tg_table_name using errcode = '42501';
end;
$$;
--> statement-breakpoint
CREATE FUNCTION "internal"."record_handle_release"() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
begin
  if tg_op = 'DELETE' or new.handle is distinct from old.handle then
    insert into identity.handle_history (handle, owner_kind)
    values (old.handle, case when old.user_id is not null then 'user' else 'agent' end);
  end if;
  return coalesce(new, old);
end;
$$;
--> statement-breakpoint

CREATE TRIGGER "profiles_updated_at" BEFORE UPDATE ON "identity"."profiles" FOR EACH ROW EXECUTE FUNCTION "internal"."set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "workspaces_updated_at" BEFORE UPDATE ON "identity"."workspaces" FOR EACH ROW EXECUTE FUNCTION "internal"."set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "workspace_members_updated_at" BEFORE UPDATE ON "identity"."workspace_members" FOR EACH ROW EXECUTE FUNCTION "internal"."set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "handles_release" AFTER UPDATE OF "handle" OR DELETE ON "identity"."handles" FOR EACH ROW EXECUTE FUNCTION "internal"."record_handle_release"();
--> statement-breakpoint
CREATE TRIGGER "agents_updated_at" BEFORE UPDATE ON "agents"."agents" FOR EACH ROW EXECUTE FUNCTION "internal"."set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "agent_profiles_updated_at" BEFORE UPDATE ON "agents"."agent_profiles" FOR EACH ROW EXECUTE FUNCTION "internal"."set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "agent_configs_append_only" BEFORE UPDATE OR DELETE ON "agents"."agent_configs" FOR EACH ROW EXECUTE FUNCTION "internal"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "agent_events_append_only" BEFORE UPDATE OR DELETE ON "agents"."agent_events" FOR EACH ROW EXECUTE FUNCTION "internal"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "budgets_updated_at" BEFORE UPDATE ON "budget"."budgets" FOR EACH ROW EXECUTE FUNCTION "internal"."set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "ledger_entries_append_only" BEFORE UPDATE OR DELETE ON "budget"."ledger_entries" FOR EACH ROW EXECUTE FUNCTION "internal"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "events_append_only" BEFORE UPDATE OR DELETE ON "audit"."events" FOR EACH ROW EXECUTE FUNCTION "internal"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "tokens_updated_at" BEFORE UPDATE ON "market"."tokens" FOR EACH ROW EXECUTE FUNCTION "internal"."set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "indexer_cursors_updated_at" BEFORE UPDATE ON "market"."indexer_cursors" FOR EACH ROW EXECUTE FUNCTION "internal"."set_updated_at"();
--> statement-breakpoint

-- Deferrable: an agent and its handle, or an agent and its first config, are written together.
ALTER TABLE "identity"."handles" ADD CONSTRAINT "handles_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"."agents"("id") ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "identity"."profiles" ADD CONSTRAINT "profiles_handle_owner_fkey" FOREIGN KEY ("handle", "user_id") REFERENCES "identity"."handles"("handle", "user_id") ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "agents"."agents" ADD CONSTRAINT "agents_handle_owner_fkey" FOREIGN KEY ("handle", "id") REFERENCES "identity"."handles"("handle", "agent_id") ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "agents"."agents" ADD CONSTRAINT "agents_active_config_fkey" FOREIGN KEY ("id", "active_config_version") REFERENCES "agents"."agent_configs"("agent_id", "version") DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint

-- Supabase Auth owns `auth.users`; on a plain PostgreSQL database these references are skipped.
DO $$
begin
  if to_regclass('auth.users') is null then
    return;
  end if;
  alter table identity.profiles add constraint profiles_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade;
  alter table identity.handles add constraint handles_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade;
  alter table identity.wallet_links add constraint wallet_links_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade;
  alter table identity.workspaces add constraint workspaces_owner_user_id_fkey foreign key (owner_user_id) references auth.users (id) on delete restrict;
  alter table identity.workspace_members add constraint workspace_members_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade;
  alter table identity.workspace_members add constraint workspace_members_invited_by_fkey foreign key (invited_by) references auth.users (id) on delete set null;
  alter table identity.api_keys add constraint api_keys_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;
  alter table agents.agents add constraint agents_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;
  alter table agents.agent_configs add constraint agent_configs_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;
end;
$$;
--> statement-breakpoint

-- A handle is available when it is well formed, unused, and out of its release cooldown.
CREATE FUNCTION "identity"."handle_available"(p_handle text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  select p_handle ~ '^[a-z0-9_]{3,15}$'
     and not exists (select 1 from identity.handles where handle = p_handle)
     and not exists (select 1 from identity.handle_history where handle = p_handle and released_at > now() - interval '30 days');
$$;
--> statement-breakpoint
-- Registers the handle and the profile together. Returns 'created', 'handle_taken' or 'user_has_profile'.
CREATE FUNCTION "identity"."create_profile"(p_user_id uuid, p_display_name text, p_handle text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
declare
  violated text;
begin
  if exists (select 1 from identity.profiles where user_id = p_user_id) then
    return 'user_has_profile';
  end if;
  if not identity.handle_available(p_handle) then
    return 'handle_taken';
  end if;
  insert into identity.handles (handle, user_id) values (p_handle, p_user_id);
  insert into identity.profiles (user_id, display_name, handle) values (p_user_id, p_display_name, p_handle);
  return 'created';
exception
  when unique_violation then
    get stacked diagnostics violated = constraint_name;
    return case when violated in ('handles_pkey', 'profiles_handle_key') then 'handle_taken' else 'user_has_profile' end;
end;
$$;
--> statement-breakpoint

-- New seats get an apply token; repeats return the place in line only.
CREATE FUNCTION "growth"."join_waitlist"(p_email text, p_referral_code text DEFAULT null) RETURNS table (line_position bigint, already_joined boolean, apply_token uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
declare
  normalized text := lower(btrim(p_email));
  entry growth.waitlist%rowtype;
  referrer_id bigint;
  inserted boolean := false;
begin
  select w.id into referrer_id from growth.waitlist w where w.referral_code = lower(btrim(p_referral_code));

  insert into growth.waitlist (email, referred_by) values (normalized, referrer_id)
  on conflict (email) do nothing
  returning * into entry;

  if entry.id is null then
    select * into entry from growth.waitlist w where w.email = normalized;
  else
    inserted := true;
  end if;

  return query
    select
      (select count(*) from growth.waitlist w where w.id <= entry.id),
      not inserted,
      case when inserted then entry.apply_token end;
end;
$$;
--> statement-breakpoint
CREATE FUNCTION "growth"."applicant_by_token"(p_token uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  select jsonb_build_object(
    'email', w.email,
    'linePosition', (select count(*) from growth.waitlist x where x.id <= w.id),
    'referralCode', w.referral_code,
    'referrals', (
      select count(*) from growth.waitlist r
      join growth.applications ra on ra.waitlist_id = r.id
      where r.referred_by = w.id
    ),
    'application', (
      select jsonb_build_object(
        'agentName', a.agent_name, 'ticker', a.ticker, 'xHandle', a.x_handle, 'category', a.category,
        'personality', a.personality, 'edge', a.edge, 'whyYou', a.why_you, 'submittedAt', a.submitted_at
      )
      from growth.applications a where a.waitlist_id = w.id
    )
  )
  from growth.waitlist w
  where w.apply_token = p_token;
$$;
--> statement-breakpoint
CREATE FUNCTION "growth"."ticker_available"(p_ticker text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  select not exists (select 1 from market.tokens where ticker = p_ticker and status <> 'failed')
     and not exists (select 1 from growth.applications where ticker = p_ticker);
$$;
--> statement-breakpoint
-- Returns 'submitted', 'not_found', 'already_submitted', 'ticker_taken' or 'handle_taken'.
CREATE FUNCTION "growth"."submit_application"(p_token uuid, p_agent_name text, p_ticker text, p_x_handle text, p_category text, p_personality text, p_edge text, p_why_you text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
declare
  seat_id bigint;
  violated text;
begin
  select id into seat_id from growth.waitlist where apply_token = p_token;
  if seat_id is null then
    return 'not_found';
  end if;
  if exists (select 1 from growth.applications where waitlist_id = seat_id) then
    return 'already_submitted';
  end if;
  if exists (select 1 from market.tokens where ticker = p_ticker and status <> 'failed') then
    return 'ticker_taken';
  end if;

  insert into growth.applications (waitlist_id, agent_name, ticker, x_handle, category, personality, edge, why_you)
  values (seat_id, btrim(p_agent_name), p_ticker, p_x_handle, p_category, p_personality, btrim(p_edge), btrim(p_why_you));
  return 'submitted';
exception
  when unique_violation then
    get stacked diagnostics violated = constraint_name;
    return case
      when violated = 'applications_ticker_key' then 'ticker_taken'
      when violated = 'applications_x_handle_key' then 'handle_taken'
      else 'already_submitted'
    end;
end;
$$;
--> statement-breakpoint

-- Grants. Only the service role reads these schemas, and only the privileges it needs. Without the
-- Supabase roles (plain PostgreSQL) the owner keeps its default access and this block is skipped.
DO $$
begin
  if to_regrole('service_role') is null then
    return;
  end if;

  revoke all on schema internal, identity, agents, budget, audit, growth, market from public;
  if to_regrole('anon') is not null then
    revoke all on schema internal, identity, agents, budget, audit, growth, market from anon, authenticated;
    revoke all on all functions in schema identity, growth from public, anon, authenticated;
  end if;

  grant usage on schema internal, identity, agents, budget, audit, growth, market to service_role;

  grant select, insert, update on all tables in schema identity to service_role;
  grant delete on identity.workspace_members, identity.wallet_links to service_role;
  grant select, insert, update, delete on identity.handles to service_role;
  grant select on identity.handle_history to service_role;

  grant select, insert, update on agents.agents, agents.agent_profiles, agents.agent_credentials to service_role;
  grant select, insert on agents.agent_configs, agents.agent_events to service_role;

  grant select, insert, update on budget.budgets to service_role;
  grant select, insert on budget.ledger_entries to service_role;

  grant select, insert on audit.events to service_role;
  grant select, insert, update, delete on audit.idempotency_keys to service_role;

  grant select on growth.waitlist, growth.applications to service_role;
  grant execute on function growth.join_waitlist(text, text) to service_role;
  grant execute on function growth.applicant_by_token(uuid) to service_role;
  grant execute on function growth.ticker_available(text) to service_role;
  grant execute on function growth.submit_application(uuid, text, text, text, text, text, text, text) to service_role;
  grant execute on function identity.handle_available(text) to service_role;
  grant execute on function identity.create_profile(uuid, text, text) to service_role;

  -- Log-derived rows are never edited, only removed when their block is reorganized away.
  grant select, insert, update on market.tokens, market.pools, market.fee_splits, market.holders, market.candles, market.indexer_cursors to service_role;
  grant delete on market.fee_splits, market.holders to service_role;
  grant select, insert, delete on market.trades, market.fee_payouts to service_role;
end;
$$;
