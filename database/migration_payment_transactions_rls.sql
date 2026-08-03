alter table public.payment_transactions enable row level security;

drop policy if exists "Participants can view payment transactions" on public.payment_transactions;
drop policy if exists "Payers can create payment transactions" on public.payment_transactions;
drop policy if exists "Participants can update payment transactions" on public.payment_transactions;
drop policy if exists "Admins can manage payment transactions" on public.payment_transactions;

create policy "Participants can view payment transactions"
on public.payment_transactions
for select
to authenticated
using (
  payer_id = auth.uid()
  or payee_id = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('admin', 'super_admin')
  )
);

create policy "Payers can create payment transactions"
on public.payment_transactions
for insert
to authenticated
with check (
  payer_id = auth.uid()
  or payee_id = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('admin', 'super_admin')
  )
);

create policy "Participants can update payment transactions"
on public.payment_transactions
for update
to authenticated
using (
  payer_id = auth.uid()
  or payee_id = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('admin', 'super_admin')
  )
)
with check (
  payer_id = auth.uid()
  or payee_id = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('admin', 'super_admin')
  )
);

create policy "Admins can manage payment transactions"
on public.payment_transactions
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
