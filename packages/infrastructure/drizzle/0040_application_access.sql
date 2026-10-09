-- The bridge from an invited application to the studio (docs/specs/landing-trade-v1.md §7, R5):
-- inviting enables research access for an account that already carries the email, and an account
-- created afterwards claims its invite as it onboards. auth.users is Supabase's, so the lookup
-- runs as dynamic SQL and is skipped where that table does not exist (the Docker PostgreSQL).
CREATE OR REPLACE FUNCTION "growth"."review_application"(p_waitlist_id bigint, p_status text, p_note text, p_reviewer text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
declare
  v_row growth.applications%rowtype;
  v_email text;
begin
  if p_status not in ('invited', 'rejected') then
    raise exception 'review_application: status must be invited or rejected, got %', p_status using errcode = '22023';
  end if;
  if p_reviewer is null or btrim(p_reviewer) = '' then
    raise exception 'review_application: reviewer required' using errcode = '22023';
  end if;
  update growth.applications
     set status = p_status,
         reviewed_at = now(),
         reviewed_by = btrim(p_reviewer),
         decision_note = nullif(btrim(coalesce(p_note, '')), ''),
         invited_at = case when p_status = 'invited' then coalesce(invited_at, now()) else invited_at end
   where waitlist_id = p_waitlist_id
   returning * into v_row;
  if not found then
    return null;
  end if;
  if p_status = 'invited' and to_regclass('auth.users') is not null then
    select w.email into v_email from growth.waitlist w where w.id = p_waitlist_id;
    execute $q$
      insert into pickler.research_access (user_id, enabled, updated_at)
      select u.id, true, clock_timestamp() from auth.users u where lower(u.email) = $1
      on conflict (user_id) do update set enabled = true, updated_at = clock_timestamp()
    $q$ using v_email;
  end if;
  return to_jsonb(v_row);
end;
$$;--> statement-breakpoint
-- An account claims the invite sent to its email: true when one was there to claim.
CREATE FUNCTION "growth"."claim_invite"(p_user_id uuid, p_email text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
declare
  v_invited boolean;
begin
  if p_user_id is null or p_email is null then
    return false;
  end if;
  select exists (
    select 1 from growth.applications a
    join growth.waitlist w on w.id = a.waitlist_id
    where a.status = 'invited' and w.email = lower(btrim(p_email))
  ) into v_invited;
  if not v_invited then
    return false;
  end if;
  insert into pickler.research_access (user_id, enabled, updated_at)
  values (p_user_id, true, clock_timestamp())
  on conflict (user_id) do update set enabled = true, updated_at = clock_timestamp();
  return true;
end;
$$;--> statement-breakpoint
-- The status of the application under an email, or null when there is none.
CREATE FUNCTION "growth"."application_status_for"(p_email text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  select a.status
  from growth.applications a
  join growth.waitlist w on w.id = a.waitlist_id
  where w.email = lower(btrim(p_email))
  limit 1
$$;--> statement-breakpoint
-- Only the trusted backend may call identity-bearing security-definer operations.
REVOKE ALL ON FUNCTION growth.review_application(bigint, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION growth.claim_invite(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION growth.application_status_for(text) FROM PUBLIC;
--> statement-breakpoint
do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if to_regrole(v_role) is not null then
      execute format('revoke all on function growth.review_application(bigint, text, text, text) from %I', v_role);
      execute format('revoke all on function growth.claim_invite(uuid, text) from %I', v_role);
      execute format('revoke all on function growth.application_status_for(text) from %I', v_role);
    end if;
  end loop;
  if to_regrole('service_role') is not null then
    grant execute on function growth.review_application(bigint, text, text, text) to service_role;
    grant execute on function growth.claim_invite(uuid, text) to service_role;
    grant execute on function growth.application_status_for(text) to service_role;
  end if;
end $$;
