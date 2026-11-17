-- Terrats: llocs des d'on s'opera (abans al mapa de Google My Maps "TERRATS").
-- Les dades de contacte només les veuen els pilots autoritzats; només l'administració les modifica.
-- Les dades NO es guarden al repositori (és públic): s'importen directament a Supabase.
begin;

create table if not exists public.rooftops (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 150),
  street text check (street is null or length(street) <= 200),
  town text check (town is null or length(town) <= 100),
  province text check (province is null or length(province) <= 60),
  contact text check (contact is null or length(contact) <= 200),
  phones text check (phones is null or length(phones) <= 200),
  email text check (email is null or length(email) <= 200),
  hours text check (hours is null or length(hours) <= 200),
  notes text check (notes is null or length(notes) <= 1000),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
alter table public.rooftops enable row level security;

drop policy if exists rooftops_select on public.rooftops;
create policy rooftops_select on public.rooftops for select to authenticated
  using ((select public.can_log_flights()) or (select public.is_admin()));
drop policy if exists rooftops_insert on public.rooftops;
create policy rooftops_insert on public.rooftops for insert to authenticated
  with check ((select public.is_admin()));
drop policy if exists rooftops_update on public.rooftops;
create policy rooftops_update on public.rooftops for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists rooftops_delete on public.rooftops;
create policy rooftops_delete on public.rooftops for delete to authenticated
  using ((select public.is_admin()));

revoke all on public.rooftops from anon;
revoke all on public.rooftops from authenticated;
grant select, insert, update, delete on public.rooftops to authenticated;

commit;
