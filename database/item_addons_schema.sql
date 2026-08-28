create table public.item_addons (
  id uuid not null default gen_random_uuid (),
  item_id uuid not null,
  addon_name text not null,
  description text null,
  price numeric(10, 2) not null default 0,
  pricing_type text not null default 'per_rental',
  quantity integer not null default 1,
  is_required boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  image_url text null,
  constraint item_addons_pkey primary key (id),
  constraint item_addons_item_id_fkey foreign key (item_id) references public.items (id) on delete cascade,
  constraint item_addons_price_check check ((price >= (0)::numeric)),
  constraint item_addons_quantity_check check ((quantity >= 1)),
  constraint item_addons_pricing_type_check check ((pricing_type = any (array['per_rental'::text, 'per_day'::text, 'per_quantity'::text])))
) tablespace pg_default;

create index if not exists idx_item_addons_item_id on public.item_addons using btree (item_id) tablespace pg_default;

create index if not exists idx_item_addons_item_active on public.item_addons using btree (item_id, is_active) tablespace pg_default;

create trigger trg_item_addons_set_updated_at before
update on public.item_addons for each row
execute function set_updated_at ();
