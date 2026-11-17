begin;

alter table public.flights add column if not exists deleted_at timestamptz;

alter policy flights_select on public.flights
using (
  deleted_at is null and (
    (select public.is_admin()) or
    (pilot_id = (select auth.uid()) and (select public.can_log_flights()))
  )
);

alter policy flights_insert on public.flights
with check (
  deleted_at is null and pilot_id = (select auth.uid()) and (select public.can_log_flights())
);

create or replace function public.remove_own_flight(target_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.flights
  set deleted_at = now()
  where id = target_id and pilot_id = (select auth.uid())
    and deleted_at is null and (select public.can_log_flights());
  return found;
end;
$$;

revoke all on function public.remove_own_flight(uuid) from public, anon;
grant execute on function public.remove_own_flight(uuid) to authenticated;

commit;
