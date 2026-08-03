create table if not exists public.saved_rent_items (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  item_id uuid not null,
  desired_quantity integer not null default 1,
  note text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint saved_rent_items_pkey primary key (id),
  constraint saved_rent_items_user_id_fkey
    foreign key (user_id)
    references public.profiles (id)
    on delete cascade,
  constraint saved_rent_items_item_id_fkey
    foreign key (item_id)
    references public.items (id)
    on delete cascade,
  constraint saved_rent_items_unique
    unique (user_id, item_id),
  constraint saved_rent_items_desired_quantity_check
    check (desired_quantity >= 1)
);

create index if not exists idx_saved_rent_items_user_id
on public.saved_rent_items using btree (user_id);

create index if not exists idx_saved_rent_items_item_id
on public.saved_rent_items using btree (item_id);

create index if not exists idx_saved_rent_items_created_at
on public.saved_rent_items using btree (created_at);

drop trigger if exists trg_saved_rent_items_set_updated_at
on public.saved_rent_items;

create trigger trg_saved_rent_items_set_updated_at
before update
on public.saved_rent_items
for each row
execute function public.set_updated_at();

create or replace function public.validate_saved_rent_item_quantity()
returns trigger
language plpgsql
as $$
declare
  available_quantity integer;
begin
  select quantity
  into available_quantity
  from public.items
  where id = new.item_id;

  if available_quantity is null then
    raise exception 'Item does not exist.';
  end if;

  if new.desired_quantity > available_quantity then
    raise exception 'Desired quantity cannot be greater than available item quantity.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_saved_rent_item_quantity
on public.saved_rent_items;

create trigger trg_validate_saved_rent_item_quantity
before insert or update
on public.saved_rent_items
for each row
execute function public.validate_saved_rent_item_quantity();

alter table public.saved_rent_items enable row level security;

drop policy if exists "Users can view their own saved rent items" on public.saved_rent_items;
drop policy if exists "Users can insert their own saved rent items" on public.saved_rent_items;
drop policy if exists "Users can update their own saved rent items" on public.saved_rent_items;
drop policy if exists "Users can delete their own saved rent items" on public.saved_rent_items;

create policy "Users can view their own saved rent items"
on public.saved_rent_items
for select
to authenticated
using (
  user_id = auth.uid()
);

create policy "Users can insert their own saved rent items"
on public.saved_rent_items
for insert
to authenticated
with check (
  user_id = auth.uid()
);

create policy "Users can update their own saved rent items"
on public.saved_rent_items
for update
to authenticated
using (
  user_id = auth.uid()
)
with check (
  user_id = auth.uid()
);

create policy "Users can delete their own saved rent items"
on public.saved_rent_items
for delete
to authenticated
using (
  user_id = auth.uid()
);
