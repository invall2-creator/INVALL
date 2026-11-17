-- Connexions: mentre l'app és oberta i visible, envia un senyal cada minut (heartbeat).
-- L'hora la posa el servidor; ningú no pot falsejar-la des del navegador.
-- Només l'administració pot consultar les connexions. Es guarden 90 dies.
begin;

create table if not exists public.app_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists app_sessions_user_idx on public.app_sessions(user_id, last_seen_at desc);
create index if not exists app_sessions_seen_idx on public.app_sessions(last_seen_at desc);
alter table public.app_sessions enable row level security;

drop policy if exists app_sessions_admin_select on public.app_sessions;
create policy app_sessions_admin_select on public.app_sessions for select to authenticated
  using ((select public.is_admin()));
revoke all on public.app_sessions from anon, authenticated;
grant select on public.app_sessions to authenticated;

create or replace function public.heartbeat(session_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then return; end if;
  if not ((select public.can_log_flights()) or (select public.is_admin())) then return; end if;
  insert into public.app_sessions (id, user_id) values (session_id, me)
  on conflict (id) do update set last_seen_at = now()
    where public.app_sessions.user_id = me;
  delete from public.app_sessions where user_id = me and last_seen_at < now() - interval '90 days';
end;
$$;

revoke all on function public.heartbeat(uuid) from public, anon;
grant execute on function public.heartbeat(uuid) to authenticated;

commit;
