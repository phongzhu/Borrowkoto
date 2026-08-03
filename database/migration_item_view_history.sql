create table if not exists public.item_view_history (
  id uuid not null default gen_random_uuid(),
  item_id uuid not null,
  viewer_id uuid not null default auth.uid(),
  viewed_date date not null default ((now() at time zone 'Asia/Manila')::date),
  viewed_at timestamp with time zone not null default now(),
  last_viewed_at timestamp with time zone not null default now(),
  view_count integer not null default 1,
  constraint item_view_history_pkey primary key (id),
  constraint item_view_history_item_id_fkey
    foreign key (item_id)
    references public.items (id)
    on delete cascade,
  constraint item_view_history_viewer_id_fkey
    foreign key (viewer_id)
    references public.profiles (id)
    on delete cascade,
  constraint item_view_history_view_count_check
    check (view_count >= 1),
  constraint item_view_history_unique_daily_view
    unique (item_id, viewer_id, viewed_date)
);

create index if not exists idx_item_view_history_item_id
on public.item_view_history using btree (item_id);

create index if not exists idx_item_view_history_viewer_id
on public.item_view_history using btree (viewer_id);

create index if not exists idx_item_view_history_viewed_date
on public.item_view_history using btree (viewed_date);

create index if not exists idx_item_view_history_item_date
on public.item_view_history using btree (item_id, viewed_date);

create or replace function public.record_item_view(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'User must be logged in to record item view.';
  end if;

  if not exists (
    select 1
    from public.items i
    where i.id = p_item_id
      and i.owner_id <> current_user_id
      and i.is_active = true
  ) then
    return;
  end if;

  insert into public.item_view_history (
    item_id,
    viewer_id,
    viewed_date,
    viewed_at,
    last_viewed_at,
    view_count
  )
  values (
    p_item_id,
    current_user_id,
    ((now() at time zone 'Asia/Manila')::date),
    now(),
    now(),
    1
  )
  on conflict (item_id, viewer_id, viewed_date)
  do update set
    view_count = public.item_view_history.view_count + 1,
    last_viewed_at = now();
end;
$$;

grant execute on function public.record_item_view(uuid) to authenticated;

alter table public.item_view_history enable row level security;

drop policy if exists "Users can view their own item view history" on public.item_view_history;
drop policy if exists "Owners can view views on their own items" on public.item_view_history;
drop policy if exists "Users can insert their own item views" on public.item_view_history;
drop policy if exists "Users can update their own item views" on public.item_view_history;
drop policy if exists "Admins can manage item view history" on public.item_view_history;

create policy "Users can view their own item view history"
on public.item_view_history
for select
to authenticated
using (
  viewer_id = auth.uid()
);

create policy "Owners can view views on their own items"
on public.item_view_history
for select
to authenticated
using (
  exists (
    select 1
    from public.items i
    where i.id = item_view_history.item_id
      and i.owner_id = auth.uid()
  )
);

create policy "Users can insert their own item views"
on public.item_view_history
for insert
to authenticated
with check (
  viewer_id = auth.uid()
  and exists (
    select 1
    from public.items i
    where i.id = item_view_history.item_id
      and i.owner_id <> auth.uid()
      and i.is_active = true
  )
);

create policy "Users can update their own item views"
on public.item_view_history
for update
to authenticated
using (
  viewer_id = auth.uid()
)
with check (
  viewer_id = auth.uid()
);

create policy "Admins can manage item view history"
on public.item_view_history
for all
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('admin', 'super_admin')
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('admin', 'super_admin')
  )
);

create or replace view public.item_daily_view_counts as
select
  i.owner_id,
  ivh.item_id,
  i.title as item_title,
  ivh.viewed_date,
  sum(ivh.view_count) as total_views,
  count(distinct ivh.viewer_id) as unique_viewers
from public.item_view_history ivh
join public.items i
  on i.id = ivh.item_id
group by
  i.owner_id,
  ivh.item_id,
  i.title,
  ivh.viewed_date;

create or replace view public.item_weekly_view_counts as
select
  i.owner_id,
  ivh.item_id,
  i.title as item_title,
  date_trunc('week', ivh.viewed_date::timestamp)::date as week_start,
  sum(ivh.view_count) as total_views,
  count(distinct ivh.viewer_id) as unique_viewers
from public.item_view_history ivh
join public.items i
  on i.id = ivh.item_id
group by
  i.owner_id,
  ivh.item_id,
  i.title,
  date_trunc('week', ivh.viewed_date::timestamp)::date;
