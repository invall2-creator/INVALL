-- Flota: només l'administració afegeix, edita i esborra aeronaus.
-- Si s'esborra una aeronau, els vols es conserven amb el nom de l'aeronau (columna flights.aircraft).
begin;

alter policy aircraft_insert on public.aircraft
  with check ((select public.is_admin()));

drop policy if exists aircraft_delete on public.aircraft;
create policy aircraft_delete on public.aircraft for delete to authenticated
  using ((select public.is_admin()));
grant delete on public.aircraft to authenticated;

alter table public.flights drop constraint if exists flights_aircraft_id_fkey;
alter table public.flights add constraint flights_aircraft_id_fkey
  foreign key (aircraft_id) references public.aircraft(id) on delete set null;

commit;
