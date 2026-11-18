-- Esborrat definitiu de pilots bloquejats o eliminats.
-- S'esborra el compte d'accés (correu, contrasenya, sessions). Es conserva
-- només el nom al perfil perquè els seus vols continuïn al llibre.

alter table public.profiles drop constraint if exists profiles_approval_status_check;
alter table public.profiles add constraint profiles_approval_status_check
  check (approval_status in ('pending', 'approved', 'blocked', 'removed', 'purged'));

-- El perfil ha de sobreviure a l'esborrat del compte d'accés.
alter table public.profiles drop constraint if exists profiles_id_fkey;

-- Les referències d'auditoria queden buides en lloc d'impedir l'esborrat.
alter table public.profiles drop constraint if exists profiles_removed_by_fkey;
alter table public.profiles add constraint profiles_removed_by_fkey
  foreign key (removed_by) references auth.users(id) on delete set null;
alter table public.flights drop constraint if exists flights_deleted_by_fkey;
alter table public.flights add constraint flights_deleted_by_fkey
  foreign key (deleted_by) references auth.users(id) on delete set null;
alter table public.flight_changes alter column changed_by drop not null;
alter table public.flight_changes drop constraint if exists flight_changes_changed_by_fkey;
alter table public.flight_changes add constraint flight_changes_changed_by_fkey
  foreign key (changed_by) references auth.users(id) on delete set null;

create or replace function public.purge_member(target_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'Cal ser administrador' using errcode = '42501';
  end if;
  if target_id = (select auth.uid()) then
    raise exception 'No et pots esborrar a tu mateix' using errcode = '22023';
  end if;
  update public.profiles
  set approval_status = 'purged',
      removed_at = coalesce(removed_at, now()),
      removed_by = (select auth.uid())
  where id = target_id and role = 'pilot' and approval_status in ('blocked', 'removed');
  if not found then return false; end if;
  delete from auth.users where id = target_id;
  return true;
end;
$$;
revoke all on function public.purge_member(uuid) from public, anon;
grant execute on function public.purge_member(uuid) to authenticated;

-- Els esborrats continuen a la llista (sense correu) perquè els seus vols tinguin nom.
drop function if exists public.list_team();
create function public.list_team()
returns table(id uuid, display_name text, email text, role text, approval_status text, email_confirmed boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, u.email::text, p.role, p.approval_status, coalesce(u.email_confirmed_at is not null, false)
  from public.profiles p
  left join auth.users u on u.id = p.id
  where (select public.is_admin())
  order by p.id;
$$;
revoke all on function public.list_team() from public, anon;
grant execute on function public.list_team() to authenticated;
