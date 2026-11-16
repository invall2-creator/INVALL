-- Execute in the Supabase SQL editor after creating your project.
-- Do not expose service_role keys in browser code.
create extension if not exists pgcrypto;
create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '',
 role text not null default 'pilot' check (role in ('pilot','admin')),
 created_at timestamptz not null default now()
);
create table if not exists public.flights (
 id uuid primary key default gen_random_uuid(),
 pilot_id uuid not null references public.profiles(id),
 flight_date date not null,
 aircraft text not null check (length(trim(aircraft)) between 1 and 100),
 duration_minutes integer not null check (duration_minutes between 1 and 1440),
 notes text check (notes is null or length(notes) <= 500),
 created_at timestamptz not null default now()
);
create index if not exists flights_pilot_date_idx on public.flights(pilot_id,flight_date desc);
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
 select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin');
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;
create or replace function public.create_pilot_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.profiles(id,display_name,role) values(new.id,coalesce(new.raw_user_meta_data->>'display_name',''),'pilot');
 return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.create_pilot_profile();
alter table public.profiles enable row level security;
alter table public.flights enable row level security;
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists flights_select on public.flights;
create policy flights_select on public.flights for select to authenticated using (pilot_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists flights_insert on public.flights;
create policy flights_insert on public.flights for insert to authenticated with check (pilot_id = (select auth.uid()));
-- No update/delete policies: records cannot be changed or deleted via browser clients.
-- No profile update policy: clients cannot grant themselves admin access.
