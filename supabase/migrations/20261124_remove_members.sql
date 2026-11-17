-- Eliminar usuaris sense perdre el llibre de vols.
-- L'usuari queda fora de l'equip, no pot tornar a entrar (compte bloquejat a Supabase Auth i sessions tancades),
-- però el seu perfil i els seus vols es conserven. L'administració el pot restaurar.
begin;

alter table public.profiles drop constraint if exists profiles_approval_status_check;
alter table public.profiles add constraint profiles_approval_status_check
  check (approval_status in ('pending', 'approved', 'blocked', 'removed'));
alter table public.profiles
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid references auth.users(id);

-- Un usuari eliminat no es pot aprovar ni ascendir per error: primer s'ha de restaurar.
create or replace function public.set_pilot_approval(target_id uuid, new_status text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;
  if new_status is null or new_status not in ('approved', 'blocked') then
    raise exception 'Invalid approval status' using errcode = '22023';
  end if;
  update public.profiles p
  set approval_status = new_status
  from auth.users u
  where p.id = target_id and p.role = 'pilot' and u.id = p.id and p.approval_status <> 'removed'
    and (new_status = 'blocked' or u.email_confirmed_at is not null);
  if not found then
    raise exception 'Pilot not found or email not confirmed' using errcode = '22023';
  end if;
end;
$$;

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
  where id = target_id and approval_status not in ('blocked', 'removed');
  return found;
end;
$$;

create or replace function public.remove_member(target_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'Cal ser administrador' using errcode = '42501';
  end if;
  if target_id = (select auth.uid()) then
    raise exception 'No et pots eliminar a tu mateix' using errcode = '22023';
  end if;
  -- Només pilots: per eliminar un administrador, primer cal treure-li el rol.
  update public.profiles
  set approval_status = 'removed', removed_at = now(), removed_by = (select auth.uid())
  where id = target_id and role = 'pilot' and approval_status <> 'removed';
  if not found then return false; end if;
  update auth.users set banned_until = 'infinity' where id = target_id;
  delete from auth.sessions where user_id = target_id;
  return true;
end;
$$;

create or replace function public.restore_member(target_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'Cal ser administrador' using errcode = '42501';
  end if;
  update public.profiles
  set approval_status = 'approved', removed_at = null, removed_by = null
  where id = target_id and approval_status = 'removed';
  if not found then return false; end if;
  update auth.users set banned_until = null where id = target_id;
  return true;
end;
$$;

revoke all on function public.remove_member(uuid) from public, anon;
revoke all on function public.restore_member(uuid) from public, anon;
grant execute on function public.remove_member(uuid) to authenticated;
grant execute on function public.restore_member(uuid) to authenticated;

commit;
