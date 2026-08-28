alter table public.item_addons
  add column if not exists quantity integer not null default 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'item_addons_quantity_check'
      and conrelid = 'public.item_addons'::regclass
  ) then
    alter table public.item_addons
      add constraint item_addons_quantity_check check (quantity >= 1);
  end if;
end
$$;

comment on column public.item_addons.quantity is
  'Maximum number of this add-on that may be included in a booking.';
