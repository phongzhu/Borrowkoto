create table if not exists public.item_subcategories (
  id uuid not null default gen_random_uuid(),
  item_id uuid not null,
  subcategory_id uuid not null,
  created_at timestamp with time zone not null default now(),
  constraint item_subcategories_pkey primary key (id),
  constraint item_subcategories_item_id_fkey
    foreign key (item_id)
    references public.items (id)
    on delete cascade,
  constraint item_subcategories_subcategory_id_fkey
    foreign key (subcategory_id)
    references public.categories (id)
    on delete restrict,
  constraint item_subcategories_unique unique (item_id, subcategory_id)
);

create index if not exists idx_item_subcategories_item_id
on public.item_subcategories using btree (item_id);

create index if not exists idx_item_subcategories_subcategory_id
on public.item_subcategories using btree (subcategory_id);

create or replace function public.validate_item_subcategory_parent()
returns trigger
language plpgsql
as $$
declare
  item_main_category uuid;
  subcategory_parent uuid;
begin
  select category_id
  into item_main_category
  from public.items
  where id = new.item_id;

  select parent_category_id
  into subcategory_parent
  from public.categories
  where id = new.subcategory_id;

  if subcategory_parent is null then
    raise exception 'Only subcategories can be added. The selected category has no parent category.';
  end if;

  if subcategory_parent <> item_main_category then
    raise exception 'Subcategory must belong to the item main category.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_item_subcategory_parent
on public.item_subcategories;

create trigger trg_validate_item_subcategory_parent
before insert or update
on public.item_subcategories
for each row
execute function public.validate_item_subcategory_parent();
