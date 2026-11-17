begin;

-- Accounts provisioned by the administrator before this migration keep their access.
alter table public.profiles
  add column if not exists approval_status text not null default 'approved'
    check (approval_status in ('pending', 'approved', 'blocked'));
alter table public.profiles alter column approval_status set default 'pending';

create or replace function public.create_pilot_profile()
returns trigger
language plpgsql security definer set search_path = ''
as $profile$
begin
  insert into public.profiles(id, display_name, role)
  values (new.id, left(btrim(coalesce(new.raw_user_meta_data->>'display_name', '')), 120), 'pilot');
  return new;
end;
$profile$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin' and approval_status = 'approved'
  );
$$;

create or replace function public.can_log_flights()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and approval_status = 'approved'
  );
$$;

revoke all on function public.can_log_flights() from public, anon;
grant execute on function public.can_log_flights() to authenticated;

drop policy if exists flights_select on public.flights;
create policy flights_select on public.flights for select to authenticated
  using ((select public.is_admin()) or
         (pilot_id = (select auth.uid()) and (select public.can_log_flights())));

drop policy if exists flights_insert on public.flights;
create policy flights_insert on public.flights for insert to authenticated
  with check (pilot_id = (select auth.uid()) and (select public.can_log_flights()));

create or replace function public.list_pilots()
returns table (id uuid, display_name text, email text, approval_status text, email_confirmed boolean)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.display_name, u.email::text, p.approval_status, u.email_confirmed_at is not null
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.role = 'pilot' and (select public.is_admin())
  order by p.id;
$$;

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
  where p.id = target_id and p.role = 'pilot' and u.id = p.id
    and (new_status = 'blocked' or u.email_confirmed_at is not null);
  if not found then
    raise exception 'Pilot not found or email not confirmed' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.list_pilots() from public, anon;
revoke all on function public.set_pilot_approval(uuid, text) from public, anon;
grant execute on function public.list_pilots() to authenticated;
grant execute on function public.set_pilot_approval(uuid, text) to authenticated;

commit;
