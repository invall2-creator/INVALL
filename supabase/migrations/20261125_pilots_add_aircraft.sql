-- Qualsevol pilot autoritzat pot afegir una aeronau nova a la flota des del formulari de vol.
-- Editar-la (estat, número de sèrie, revisions) continua sent cosa de l'administració.
begin;
alter policy aircraft_insert on public.aircraft
  with check ((select public.can_log_flights()) or (select public.is_admin()));
commit;
