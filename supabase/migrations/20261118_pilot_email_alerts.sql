begin;

-- Apply after 20261117_pilot_approval.sql. Configure values through Supabase Vault.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
create schema if not exists invall_private;
revoke all on schema invall_private from public, anon, authenticated;

create table if not exists invall_private.pilot_alerts (
  pilot_id uuid primary key references auth.users(id) on delete cascade,
  queued_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0,
  request_id bigint,
  last_status integer,
  accepted_at timestamptz
);

create or replace function invall_private.queue_pilot_alert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null then
    insert into invall_private.pilot_alerts(pilot_id)
    select id from public.profiles
    where id = new.id and role = 'pilot' and approval_status = 'pending'
    on conflict (pilot_id) do nothing;
  end if;
  return new;
end;
$$;

-- The profile trigger runs first on INSERT because Postgres orders triggers by name.
drop trigger if exists queue_invall_pilot_alert on auth.users;
create trigger queue_invall_pilot_alert
after insert or update of email_confirmed_at on auth.users
for each row execute function invall_private.queue_pilot_alert();

-- Include confirmed requests already waiting when the feature is installed.
insert into invall_private.pilot_alerts(pilot_id)
select p.id from public.profiles p join auth.users u on u.id = p.id
where p.role = 'pilot' and p.approval_status = 'pending' and u.email_confirmed_at is not null
on conflict (pilot_id) do nothing;

create or replace function invall_private.send_pilot_alerts()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  api_key text;
  sender text;
  recipient text;
  queued record;
  next_request_id bigint;
begin
  select max(decrypted_secret) filter (where name = 'invall_resend_api_key'),
         max(decrypted_secret) filter (where name = 'invall_alert_from'),
         max(decrypted_secret) filter (where name = 'invall_alert_to')
  into api_key, sender, recipient
  from vault.decrypted_secrets
  where name in ('invall_resend_api_key', 'invall_alert_from', 'invall_alert_to');

  if coalesce(btrim(api_key), '') = '' or coalesce(btrim(sender), '') = ''
    or coalesce(btrim(recipient), '') = '' then
    return;
  end if;

  update invall_private.pilot_alerts a
  set last_status = r.status_code,
      accepted_at = case when r.status_code between 200 and 299 then now() end,
      request_id = null
  from net._http_response r
  where a.request_id = r.id and a.accepted_at is null;

  for queued in
    select a.pilot_id from invall_private.pilot_alerts a
    join public.profiles p on p.id = a.pilot_id
    where a.accepted_at is null and a.next_attempt_at <= now() and a.attempts < 6
      and p.role = 'pilot' and p.approval_status = 'pending'
    order by a.queued_at
    limit 10
    for update of a skip locked
  loop
    select net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || api_key,
        'Content-Type', 'application/json',
        'Idempotency-Key', 'invall-pilot-approval/' || queued.pilot_id::text
      ),
      body := jsonb_build_object(
        'from', sender,
        'to', jsonb_build_array(recipient),
        'subject', 'INVALL · Sol·licitud de pilot pendent',
        'text', 'Hi ha una sol·licitud pendent. Entra amb el teu compte d’administrador i obre Comptes de pilots per aprovar o denegar l’accés: https://invall2-creator.github.io/INVALL/'
      ),
      timeout_milliseconds := 8000
    ) into next_request_id;

    update invall_private.pilot_alerts
    set request_id = next_request_id, attempts = attempts + 1, next_attempt_at = now() + interval '5 minutes'
    where pilot_id = queued.pilot_id;
  end loop;
end;
$$;

revoke all on function invall_private.queue_pilot_alert() from public, anon, authenticated;
revoke all on function invall_private.send_pilot_alerts() from public, anon, authenticated;

select cron.schedule('invall-pilot-email-alerts', '* * * * *',
  $$select invall_private.send_pilot_alerts()$$);

commit;
