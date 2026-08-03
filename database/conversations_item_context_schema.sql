alter table public.conversations
add column if not exists item_id uuid null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'conversations_item_id_fkey'
  ) then
    alter table public.conversations
    add constraint conversations_item_id_fkey
    foreign key (item_id) references public.items (id) on delete cascade;
  end if;
end
$$;

update public.conversations as conversations
set item_id = bookings.item_id
from public.bookings as bookings
where conversations.booking_id = bookings.id
  and conversations.item_id is null;

alter table public.conversations
alter column booking_id drop not null;

alter table public.conversations
alter column item_id set not null;

create index if not exists idx_conversations_item_id
on public.conversations using btree (item_id);
