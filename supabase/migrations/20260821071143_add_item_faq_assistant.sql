create table if not exists public.item_faqs (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  question text not null check (char_length(trim(question)) between 3 and 180),
  answer text not null check (char_length(trim(answer)) between 1 and 1000),
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists item_faqs_item_id_idx on public.item_faqs(item_id, sort_order);
alter table public.item_faqs enable row level security;

grant select, insert, update, delete on public.item_faqs to authenticated;

create policy "Authenticated users can read active listing FAQs"
on public.item_faqs for select to authenticated
using (
  is_active = true
  and exists (select 1 from public.items i where i.id = item_id and i.is_active = true)
);

create policy "Owners can create listing FAQs"
on public.item_faqs for insert to authenticated
with check (
  exists (select 1 from public.items i where i.id = item_id and i.owner_id = (select auth.uid()))
);

create policy "Owners can update listing FAQs"
on public.item_faqs for update to authenticated
using (exists (select 1 from public.items i where i.id = item_id and i.owner_id = (select auth.uid())))
with check (exists (select 1 from public.items i where i.id = item_id and i.owner_id = (select auth.uid())));

create policy "Owners can delete listing FAQs"
on public.item_faqs for delete to authenticated
using (exists (select 1 from public.items i where i.id = item_id and i.owner_id = (select auth.uid())));
