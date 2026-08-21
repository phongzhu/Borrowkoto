alter table public.items
  add column if not exists pickup_time time without time zone not null default time '09:00:00',
  add column if not exists return_time time without time zone not null default time '18:00:00';

comment on column public.items.pickup_time is 'Daily local time from which a borrower may claim the item.';
comment on column public.items.return_time is 'Daily local deadline by which a borrower must return the item.';
