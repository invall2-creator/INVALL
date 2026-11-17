-- UDRON v3: flota, llibre de vols complet, edició auditada, eliminació i recuperació, gestió de l'equip.
-- Aplicar després de totes les migracions anteriors. Només afegeix taules, columnes i funcions:
-- no esborra cap dada existent i l'app anterior continua funcionant.
begin;

-- 1. Flota ------------------------------------------------------------------
create table if not exists public.aircraft (
  id uuid primary key default gen_random_uuid(),
  model text not null check (length(btrim(model)) between 1 and 100),
  serial text check (serial is null or length(serial) <= 60),
  class text check (class is null or length(class) <= 30),
  status text not null default 'operativa' check (status in ('operativa', 'manteniment', 'baixa')),
  review_interval_hours integer check (review_interval_hours is null or review_interval_hours between 1 and 5000),
  last_review date,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);
alter table public.aircraft enable row level security;

drop policy if exists aircraft_select on public.aircraft;
create policy aircraft_select on public.aircraft for select to authenticated
  using ((select public.can_log_flights()) or (select public.is_admin()));
drop policy if exists aircraft_insert on public.aircraft;
create policy aircraft_insert on public.aircraft for insert to authenticated
  with check ((select public.is_admin()));
drop policy if exists aircraft_update on public.aircraft;
create policy aircraft_update on public.aircraft for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
-- Sense política de DELETE: una aeronau es dona de baixa amb status = 'baixa' i conserva l'historial.
grant select, insert, update on public.aircraft to authenticated;

insert into public.aircraft (model, sort_order)
select v.model, v.sort_order
from (values ('DJI 3T', 1), ('DJI 4T', 2), ('DJI 30T', 3), ('DJI 300', 4), ('DJI 400', 5),
             ('DJI Avata', 6), ('DJI Avata 2', 7), ('Quantum (ala fixa)', 8)) as v(model, sort_order)
where not exists (select 1 from public.aircraft a where a.model = v.model);

-- 2. Camps nous del vol -----------------------------------------------------
alter table public.flights
  add column if not exists aircraft_id uuid references public.aircraft(id),
  add column if not exists start_time time,
  add column if not exists end_time time,
  add column if not exists place text check (place is null or length(place) <= 120),
  add column if not exists mission text check (mission is null or length(mission) <= 60),
  add column if not exists category text check (category is null or length(category) <= 60),
  add column if not exists light text not null default 'dia' check (light in ('dia', 'nit')),
  add column if not exists crew_role text not null default 'pilot' check (crew_role in ('pilot', 'observador')),
  add column if not exists takeoffs integer not null default 1 check (takeoffs between 1 and 99),
  add column if not exists incident boolean not null default false,
  add column if not exists incident_text text check (incident_text is null or length(incident_text) <= 800),
  add column if not exists updated_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id),
  add column if not exists delete_reason text check (delete_reason is null or length(delete_reason) <= 200);

create index if not exists flights_aircraft_idx on public.flights(aircraft_id);

-- Enllaça els vols antics amb l'aeronau de la flota quan el nom coincideix.
update public.flights f
set aircraft_id = a.id
from public.aircraft a
where f.aircraft_id is null
  and (a.model = f.aircraft or (f.aircraft = 'Ala fixa Quantum' and a.model = 'Quantum (ala fixa)'));

-- Validacions al servidor: data no futura, incidència descrita, nom d'aeronau coherent.
create or replace function public.check_flight_row()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  craft text;
begin
  if new.flight_date > (now() at time zone 'Europe/Madrid')::date then
    raise exception 'La data del vol no pot ser posterior a avui' using errcode = '22023';
  end if;
  if new.incident and coalesce(btrim(new.incident_text), '') = '' then
    raise exception 'Cal descriure la incidència' using errcode = '22023';
  end if;
  if new.aircraft_id is not null then
    select a.model into craft from public.aircraft a where a.id = new.aircraft_id;
    if craft is not null then new.aircraft := craft; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists flights_check_row on public.flights;
create trigger flights_check_row
before insert or update of flight_date, incident, incident_text, aircraft_id on public.flights
for each row execute function public.check_flight_row();

-- L'administració també veu els vols eliminats (per poder-los recuperar); els pilots, no.
alter policy flights_select on public.flights
using (
  (select public.is_admin()) or
  (deleted_at is null and pilot_id = (select auth.uid()) and (select public.can_log_flights()))
);

-- 3. Registre de canvis ------------------------------------------------------
create table if not exists public.flight_changes (
  id bigint generated always as identity primary key,
  flight_id uuid not null references public.flights(id) on delete cascade,
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now(),
  action text not null check (action in ('edit', 'delete', 'restore')),
  reason text check (reason is null or length(reason) <= 200),
  changes jsonb not null default '[]'::jsonb
);
create index if not exists flight_changes_flight_idx on public.flight_changes(flight_id, changed_at);
alter table public.flight_changes enable row level security;

drop policy if exists flight_changes_select on public.flight_changes;
create policy flight_changes_select on public.flight_changes for select to authenticated
  using (
    (select public.is_admin()) or
    exists (select 1 from public.flights f where f.id = flight_id and f.pilot_id = (select auth.uid()))
  );
-- Sense polítiques d'escriptura: només les funcions de sota hi escriuen.
grant select on public.flight_changes to authenticated;

-- 4. Funcions ---------------------------------------------------------------
create or replace function public.update_flight(target_id uuid, patch jsonb, change_reason text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  old_row public.flights;
  new_row public.flights;
  diff jsonb;
begin
  if coalesce(btrim(change_reason), '') = '' then
    raise exception 'Cal indicar el motiu del canvi' using errcode = '22023';
  end if;

  select * into old_row from public.flights where id = target_id for update;
  if not found or old_row.deleted_at is not null then return false; end if;
  if not ((select public.is_admin()) or
          (old_row.pilot_id = (select auth.uid()) and (select public.can_log_flights()))) then
    return false;
  end if;

  update public.flights set
    flight_date = (patch->>'flight_date')::date,
    start_time = nullif(patch->>'start_time', '')::time,
    end_time = nullif(patch->>'end_time', '')::time,
    duration_minutes = (patch->>'duration_minutes')::integer,
    aircraft_id = nullif(patch->>'aircraft_id', '')::uuid,
    aircraft = coalesce(nullif(btrim(patch->>'aircraft'), ''), old_row.aircraft),
    place = nullif(btrim(patch->>'place'), ''),
    mission = nullif(btrim(patch->>'mission'), ''),
    category = nullif(btrim(patch->>'category'), ''),
    light = coalesce(nullif(patch->>'light', ''), 'dia'),
    crew_role = coalesce(nullif(patch->>'crew_role', ''), 'pilot'),
    takeoffs = coalesce((patch->>'takeoffs')::integer, 1),
    incident = coalesce((patch->>'incident')::boolean, false),
    incident_text = nullif(btrim(patch->>'incident_text'), ''),
    notes = nullif(btrim(patch->>'notes'), ''),
    updated_at = now()
  where id = target_id
  returning * into new_row;

  select coalesce(jsonb_agg(jsonb_build_object('field', o.key, 'from', o.value, 'to', n.value) order by o.key), '[]'::jsonb)
  into diff
  from jsonb_each(to_jsonb(old_row)) o
  join jsonb_each(to_jsonb(new_row)) n on n.key = o.key
  where o.key in ('flight_date', 'start_time', 'end_time', 'duration_minutes', 'aircraft', 'place', 'mission',
                  'category', 'light', 'crew_role', 'takeoffs', 'incident', 'incident_text', 'notes')
    and o.value is distinct from n.value;

  if diff <> '[]'::jsonb then
    insert into public.flight_changes (flight_id, changed_by, action, reason, changes)
    values (target_id, (select auth.uid()), 'edit', left(btrim(change_reason), 200), diff);
  end if;
  return true;
end;
$$;

create or replace function public.remove_flight(target_id uuid, change_reason text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(btrim(change_reason), '') = '' then
    raise exception 'Cal indicar el motiu' using errcode = '22023';
  end if;
  update public.flights
  set deleted_at = now(), deleted_by = (select auth.uid()), delete_reason = left(btrim(change_reason), 200)
  where id = target_id and deleted_at is null
    and ((select public.is_admin()) or (pilot_id = (select auth.uid()) and (select public.can_log_flights())));
  if not found then return false; end if;
  insert into public.flight_changes (flight_id, changed_by, action, reason)
  values (target_id, (select auth.uid()), 'delete', left(btrim(change_reason), 200));
  return true;
end;
$$;

create or replace function public.restore_flight(target_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if not (select public.is_admin()) then return false; end if;
  update public.flights set deleted_at = null, deleted_by = null, delete_reason = null, updated_at = now()
  where id = target_id and deleted_at is not null;
  if not found then return false; end if;
  insert into public.flight_changes (flight_id, changed_by, action, reason)
  values (target_id, (select auth.uid()), 'restore', 'Vol recuperat');
  return true;
end;
$$;

-- Tot l'equip (pilots i administradors) per a la vista d'administració.
create or replace function public.list_team()
returns table (id uuid, display_name text, email text, role text, approval_status text, email_confirmed boolean)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.display_name, u.email::text, p.role, p.approval_status, u.email_confirmed_at is not null
  from public.profiles p
  join auth.users u on u.id = p.id
  where (select public.is_admin())
  order by p.id;
$$;

-- Nomenar o treure administradors des de l'app (no es pot treure el rol a un mateix).
create or replace function public.set_member_role(target_id uuid, new_role text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'Cal ser administrador' using errcode = '42501';
  end if;
  if new_role not in ('pilot', 'admin') then
    raise exception 'Rol no vàlid' using errcode = '22023';
  end if;
  if target_id = (select auth.uid()) then
    raise exception 'No et pots canviar el rol a tu mateix' using errcode = '22023';
  end if;
  update public.profiles set role = new_role, approval_status = 'approved'
  where id = target_id and approval_status <> 'blocked';
  return found;
end;
$$;

revoke all on function public.update_flight(uuid, jsonb, text) from public, anon;
revoke all on function public.remove_flight(uuid, text) from public, anon;
revoke all on function public.restore_flight(uuid) from public, anon;
revoke all on function public.list_team() from public, anon;
revoke all on function public.set_member_role(uuid, text) from public, anon;
revoke all on function public.check_flight_row() from public, anon, authenticated;
grant execute on function public.update_flight(uuid, jsonb, text) to authenticated;
grant execute on function public.remove_flight(uuid, text) to authenticated;
grant execute on function public.restore_flight(uuid) to authenticated;
grant execute on function public.list_team() to authenticated;
grant execute on function public.set_member_role(uuid, text) to authenticated;

commit;
