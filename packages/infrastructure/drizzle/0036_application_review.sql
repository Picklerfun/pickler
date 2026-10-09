ALTER TABLE "growth"."applications" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "growth"."applications" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "growth"."applications" ADD COLUMN "decision_note" text;--> statement-breakpoint
ALTER TABLE "growth"."applications" ADD COLUMN "invited_at" timestamp with time zone;--> statement-breakpoint
-- The one write that changes an application's status: an operator's decision, with a name on it.
CREATE FUNCTION "growth"."review_application"(p_waitlist_id bigint, p_status text, p_note text, p_reviewer text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
declare
  v_row growth.applications%rowtype;
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
  return to_jsonb(v_row);
end;
$$;--> statement-breakpoint
do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function growth.review_application(bigint, text, text, text) to service_role;
  end if;
end $$;
