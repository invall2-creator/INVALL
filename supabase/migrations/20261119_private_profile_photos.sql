begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 524288, array['image/jpeg'])
on conflict (id) do nothing;

create policy "Users read their profile photo" on storage.objects
for select to authenticated
using (bucket_id = 'profile-photos' and name = (select auth.uid())::text || '/avatar.jpg');

create policy "Users upload their profile photo" on storage.objects
for insert to authenticated
with check (bucket_id = 'profile-photos' and name = (select auth.uid())::text || '/avatar.jpg');

create policy "Users replace their profile photo" on storage.objects
for update to authenticated
using (bucket_id = 'profile-photos' and name = (select auth.uid())::text || '/avatar.jpg')
with check (bucket_id = 'profile-photos' and name = (select auth.uid())::text || '/avatar.jpg');

create policy "Users remove their profile photo" on storage.objects
for delete to authenticated
using (bucket_id = 'profile-photos' and name = (select auth.uid())::text || '/avatar.jpg');

commit;
