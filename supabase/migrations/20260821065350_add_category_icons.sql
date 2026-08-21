alter table public.categories
  add column if not exists icon_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'category-icons',
  'category-icons',
  true,
  1048576,
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Admins can upload category icons"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'category-icons'
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and lower(p.role::text) = 'admin'
  )
);

create policy "Admins can update category icons"
on storage.objects for update to authenticated
using (
  bucket_id = 'category-icons'
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and lower(p.role::text) = 'admin'
  )
)
with check (
  bucket_id = 'category-icons'
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and lower(p.role::text) = 'admin'
  )
);

create policy "Admins can delete category icons"
on storage.objects for delete to authenticated
using (
  bucket_id = 'category-icons'
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and lower(p.role::text) = 'admin'
  )
);
