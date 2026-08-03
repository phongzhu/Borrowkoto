alter table public.item_purchase_requests enable row level security;

drop policy if exists "Participants can view purchase requests" on public.item_purchase_requests;
drop policy if exists "Buyers can create purchase requests" on public.item_purchase_requests;
drop policy if exists "Participants can update purchase requests" on public.item_purchase_requests;
drop policy if exists "Admins can manage purchase requests" on public.item_purchase_requests;

create policy "Participants can view purchase requests"
on public.item_purchase_requests
for select
to authenticated
using (
  buyer_id = auth.uid()
  or seller_id = auth.uid()
);

create policy "Buyers can create purchase requests"
on public.item_purchase_requests
for insert
to authenticated
with check (
  buyer_id = auth.uid()
);

create policy "Participants can update purchase requests"
on public.item_purchase_requests
for update
to authenticated
using (
  buyer_id = auth.uid()
  or seller_id = auth.uid()
)
with check (
  buyer_id = auth.uid()
  or seller_id = auth.uid()
);

create policy "Admins can manage purchase requests"
on public.item_purchase_requests
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
