begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('flight-backups', 'flight-backups', false, 20971520,
  array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

create policy "Administrators read their flight backups" on storage.objects
for select to authenticated
using (
  bucket_id = 'flight-backups'
  and (select public.is_admin())
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Administrators upload their flight backups" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'flight-backups'
  and (select public.is_admin())
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and storage.extension(name) = 'xlsx'
);

commit;
