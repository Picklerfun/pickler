-- Las funciones security definer sólo las llama el rol de las funciones (service role / postgres): nada para PUBLIC.
revoke execute on function mobile.ensure_wallet(text) from public;
revoke execute on function mobile.request_read(text, text, int, text, int, int, int, bigint, bigint, text, timestamptz) from public;
revoke execute on function mobile.refund_read(uuid, text, text) from public;

-- refund_read sólo acepta los dos estados de reembolso.
create or replace function mobile.refund_read(p_read uuid, p_status text, p_error text) returns boolean
language plpgsql security definer set search_path = mobile, pg_temp as $$
declare v mobile.reads;
begin
  if p_status not in ('failed', 'void') then raise exception 'bad_status' using errcode = 'P0003'; end if;
  update mobile.reads
     set status = p_status, error = p_error,
         resolved_at = case when p_status = 'void' then now() else resolved_at end
   where id = p_read and status in ('pending', 'open')
  returning * into v;
  if not found then return false; end if;
  update mobile.wallets set credits = credits + v.credits_charged where address = v.address;
  insert into mobile.credit_events (address, delta, reason, read_id) values (v.address, v.credits_charged, 'refund', v.id);
  return true;
end $$;
revoke execute on function mobile.refund_read(uuid, text, text) from public;
