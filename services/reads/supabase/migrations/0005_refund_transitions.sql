-- failed sólo desde pending, void sólo desde open (revisión final F1): cierra la carrera huérfana-vs-respuesta.
create or replace function mobile.refund_read(p_read uuid, p_status text, p_error text) returns boolean
language plpgsql security definer set search_path = mobile, pg_temp as $$
declare v mobile.reads;
begin
  if p_status not in ('failed', 'void') then raise exception 'bad_status' using errcode = 'P0003'; end if;
  update mobile.reads
     set status = p_status, error = p_error,
         resolved_at = case when p_status = 'void' then now() else resolved_at end
   where id = p_read
     and status = case when p_status = 'failed' then 'pending' else 'open' end
  returning * into v;
  if not found then return false; end if;
  update mobile.wallets set credits = credits + v.credits_charged where address = v.address;
  insert into mobile.credit_events (address, delta, reason, read_id) values (v.address, v.credits_charged, 'refund', v.id);
  return true;
end $$;
revoke execute on function mobile.refund_read(uuid, text, text) from public;
