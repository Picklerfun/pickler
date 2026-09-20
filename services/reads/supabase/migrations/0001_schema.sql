-- Esquema mobile · Ask (spec 2026-09-19-mobile-ask §2.1). Sólo el rol de las funciones lo usa; sin RLS ni grants a anon/authenticated.
create table mobile.agents (
  id text primary key,
  handle text not null unique,
  name text not null,
  owner text not null,
  persona text not null,
  price_credits int not null default 1 check (price_credits > 0),
  active boolean not null default true,
  sort int not null default 100,
  created_at timestamptz not null default now()
);

create table mobile.wallets (
  address text primary key check (address = lower(address)),
  credits int not null default 20 check (credits >= 0),
  created_at timestamptz not null default now()
);

create table mobile.credit_events (
  id bigserial primary key,
  address text not null references mobile.wallets(address),
  delta int not null,
  reason text not null check (reason in ('grant', 'charge', 'refund')),
  read_id uuid,
  created_at timestamptz not null default now()
);

create table mobile.reads (
  id uuid primary key default gen_random_uuid(),
  address text not null references mobile.wallets(address),
  agent_id text not null references mobile.agents(id),
  market_id int not null,
  symbol text not null,
  level_bps int not null check (level_bps in (250, 100, 50, -50, -100)),
  horizon_min int not null check (horizon_min in (60, 240, 720, 1440)),
  price_decimals int not null,
  mark_at_request bigint not null,
  target bigint not null,
  question text not null,
  status text not null default 'pending'
    check (status in ('pending', 'open', 'right', 'wrong', 'void', 'failed')),
  probability numeric(4,3),
  reasons jsonb,
  limits text,
  model text,
  latency_ms int,
  usage jsonb,
  credits_charged int not null,
  error text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  resolved_at timestamptz,
  mark_at_resolution bigint,
  outcome boolean,
  brier numeric(5,4)
);
create index reads_address_created on mobile.reads (address, created_at desc);
create index reads_open_expires on mobile.reads (expires_at) where status = 'open';
create index reads_pending_created on mobile.reads (created_at) where status = 'pending';

create table mobile.reminders (
  id uuid primary key default gen_random_uuid(),
  address text not null references mobile.wallets(address),
  read_id uuid references mobile.reads(id),
  market_id int not null,
  symbol text not null,
  level_bps int not null,
  horizon_min int not null,
  price_decimals int not null,
  target bigint not null,
  side text not null check (side in ('long', 'short')),
  kind text not null check (kind in ('pre', 'expiry')),
  fire_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'sent', 'failed')),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index reminders_due on mobile.reminders (fire_at) where status = 'scheduled';

create table mobile.devices (
  address text primary key references mobile.wallets(address),
  token text not null,
  env text not null check (env in ('sandbox', 'production')),
  updated_at timestamptz not null default now()
);

create view mobile.agent_records as
select a.id, a.handle, a.name, a.owner, a.price_credits, a.sort,
       count(r.id) filter (where r.status in ('open', 'right', 'wrong')) as reads,
       count(r.id) filter (where r.status in ('right', 'wrong')) as resolved,
       count(r.id) filter (where r.status = 'right') as right_count,
       avg(r.brier) filter (where r.status in ('right', 'wrong')) as brier_avg
from mobile.agents a
left join mobile.reads r on r.agent_id = a.id
where a.active
group by a.id;

-- Wallet con 20 créditos iniciales (evento grant); devuelve el saldo actual.
create function mobile.ensure_wallet(p_address text) returns int
language plpgsql security definer set search_path = mobile, pg_temp as $$
declare v_credits int;
begin
  insert into mobile.wallets (address) values (p_address) on conflict (address) do nothing;
  if found then
    insert into mobile.credit_events (address, delta, reason) values (p_address, 20, 'grant');
  end if;
  select credits into v_credits from mobile.wallets where address = p_address;
  return v_credits;
end $$;

-- Cobro + insert de la read en una transacción. Errores: unknown_agent (P0001), no_credits (P0002).
create function mobile.request_read(
  p_address text, p_agent text, p_market int, p_symbol text, p_level int, p_horizon int,
  p_pd int, p_mark bigint, p_target bigint, p_question text, p_expires timestamptz
) returns mobile.reads
language plpgsql security definer set search_path = mobile, pg_temp as $$
declare v_price int; v_read mobile.reads;
begin
  perform mobile.ensure_wallet(p_address);
  select price_credits into v_price from mobile.agents where id = p_agent and active;
  if v_price is null then raise exception 'unknown_agent' using errcode = 'P0001'; end if;
  perform 1 from mobile.wallets where address = p_address for update;
  update mobile.wallets set credits = credits - v_price where address = p_address and credits >= v_price;
  if not found then raise exception 'no_credits' using errcode = 'P0002'; end if;
  insert into mobile.reads (address, agent_id, market_id, symbol, level_bps, horizon_min, price_decimals,
                            mark_at_request, target, question, credits_charged, expires_at)
  values (p_address, p_agent, p_market, p_symbol, p_level, p_horizon, p_pd,
          p_mark, p_target, p_question, v_price, p_expires)
  returning * into v_read;
  insert into mobile.credit_events (address, delta, reason, read_id) values (p_address, -v_price, 'charge', v_read.id);
  return v_read;
end $$;

-- Reembolso idempotente: sólo desde pending/open; p_status es 'failed' o 'void'.
create function mobile.refund_read(p_read uuid, p_status text, p_error text) returns boolean
language plpgsql security definer set search_path = mobile, pg_temp as $$
declare v mobile.reads;
begin
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
