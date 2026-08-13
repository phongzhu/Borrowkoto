alter table public.item_promotions
  add column if not exists paymongo_checkout_session_id text unique,
  add column if not exists paid_at timestamptz;

create table public.promotion_payments (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null unique references public.item_promotions(id) on delete restrict,
  lender_id uuid not null references public.profiles(id) on delete restrict,
  item_id uuid not null references public.items(id) on delete restrict,
  paymongo_checkout_session_id text not null unique,
  paymongo_payment_id text unique,
  amount numeric(10,2) not null check (amount > 0),
  currency text not null default 'PHP' check (currency = 'PHP'),
  status text not null default 'paid' check (status in ('paid', 'refunded')),
  paid_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index promotion_payments_paid_at_idx on public.promotion_payments(paid_at desc);
create index promotion_payments_lender_idx on public.promotion_payments(lender_id, paid_at desc);

alter table public.promotion_payments enable row level security;

create policy "Lenders read own promotion payments" on public.promotion_payments
for select to authenticated using ((select auth.uid()) = lender_id);

create policy "Admins read promotion payments" on public.promotion_payments
for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and lower(p.role::text) = 'admin')
);

grant select on table public.promotion_payments to authenticated;
