begin;

create or replace function public.edit_own_flight(
  target_id uuid,
  new_date date,
  new_aircraft text,
  new_duration integer,
  new_notes text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.flights
  set flight_date = new_date,
      aircraft = btrim(new_aircraft),
      duration_minutes = new_duration,
      notes = nullif(btrim(new_notes), '')
  where id = target_id and pilot_id = (select auth.uid())
    and deleted_at is null and (select public.can_log_flights());
  return found;
end;
$$;

revoke all on function public.edit_own_flight(uuid, date, text, integer, text) from public, anon;
grant execute on function public.edit_own_flight(uuid, date, text, integer, text) to authenticated;

commit;
