begin;

create policy "Approved pilots read their personal flight backups" on storage.objects
for select to authenticated
using (
  bucket_id = 'flight-backups'
  and (select public.can_log_flights())
  and storage.foldername(name) = array[(select auth.uid())::text, 'personal']
);

create policy "Approved pilots upload their personal flight backups" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'flight-backups'
  and (select public.can_log_flights())
  and storage.foldername(name) = array[(select auth.uid())::text, 'personal']
  and storage.extension(name) = 'xlsx'
);

commit;
