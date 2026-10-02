-- resolve-reads cada minuto (D3, D19, P13). El secreto vive en Vault (mobile_cron_secret), nunca aquí.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'mobile-resolve-reads',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://yvdipvcrpbqvofayteqf.supabase.co/functions/v1/resolve-reads',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mobile_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) as request_id;
  $$
);
