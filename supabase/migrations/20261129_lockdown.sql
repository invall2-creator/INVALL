-- Tancament de seguretat: els visitants sense sessió no poden tocar res,
-- els pilots només poden afegir vols seus i tota la resta passa per
-- funcions que comproven que qui ho demana és l'administració.

-- 1. Visitants sense sessió (anon): cap permís sobre taules ni funcions.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon, public;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon, public;

-- 2. Usuaris amb sessió: només el mínim que fa servir l'app.
revoke all on public.profiles, public.flights, public.flight_changes, public.app_sessions,
  public.aircraft, public.rooftops from authenticated;
grant select on public.profiles to authenticated;           -- RLS: el propi perfil o l'administració
grant select on public.flights to authenticated;            -- RLS: els vols propis o l'administració
grant insert (pilot_id, flight_date, start_time, end_time, duration_minutes, aircraft_id, aircraft,
  place, mission, category, light, crew_role, takeoffs, incident, incident_text, notes)
  on public.flights to authenticated;                       -- RLS: només vols propis i pilots autoritzats
grant select on public.flight_changes, public.app_sessions to authenticated;   -- RLS: administració
grant select, insert, update, delete on public.aircraft, public.rooftops to authenticated; -- RLS: escriure només administració

-- 3. Funcions antigues que ja no fa servir l'app (editaven o esborraven sense deixar rastre).
drop function if exists public.edit_own_flight(uuid, date, text, integer, text);
drop function if exists public.remove_own_flight(uuid);
drop function if exists public.list_pilots();

-- 4. Funcions que pot cridar un usuari amb sessió (cadascuna comprova permisos per dins).
do $$
declare f text;
begin
  foreach f in array array[
    'public.can_log_flights()', 'public.is_admin()', 'public.heartbeat(uuid)', 'public.list_team()',
    'public.update_flight(uuid, jsonb, text)', 'public.remove_flight(uuid, text)', 'public.restore_flight(uuid)',
    'public.set_pilot_approval(uuid, text)', 'public.set_member_role(uuid, text)',
    'public.remove_member(uuid)', 'public.restore_member(uuid)', 'public.purge_member(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function public.create_pilot_profile() from public, anon, authenticated;
revoke all on function public.check_flight_row() from public, anon, authenticated;

-- 5. No es pot donar rol a un compte esborrat o pendent de confirmar.
create or replace function public.set_member_role(target_id uuid, new_role text)
returns boolean
language plpgsql
security definer
set search_path = ''
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
  update public.profiles set role = new_role
  where id = target_id and approval_status = 'approved';
  return found;
end;
$$;
