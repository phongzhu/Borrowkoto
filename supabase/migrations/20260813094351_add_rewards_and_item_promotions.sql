create schema if not exists private;

create table public.reward_program_settings (
  id boolean primary key default true check (id),
  points_per_completed_booking integer not null default 100 check (points_per_completed_booking > 0),
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

create table public.borrower_reward_accounts (
  borrower_id uuid primary key references public.profiles(id) on delete cascade,
  points_balance integer not null default 0 check (points_balance >= 0),
  lifetime_points integer not null default 0 check (lifetime_points >= 0),
  completed_borrow_count integer not null default 0 check (completed_borrow_count >= 0),
  updated_at timestamptz not null default now()
);

create table public.reward_point_transactions (
  id uuid primary key default gen_random_uuid(),
  borrower_id uuid not null references public.profiles(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  points integer not null check (points <> 0),
  transaction_type text not null check (transaction_type in ('booking_completed', 'voucher_redeemed', 'admin_adjustment')),
  description text,
  created_at timestamptz not null default now()
);

create unique index reward_point_transactions_completed_booking_uidx
  on public.reward_point_transactions(booking_id)
  where transaction_type = 'booking_completed' and booking_id is not null;
create index reward_point_transactions_borrower_idx on public.reward_point_transactions(borrower_id, created_at desc);

create table public.reward_voucher_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  points_cost integer not null check (points_cost > 0),
  discount_type text not null check (discount_type in ('fixed', 'percentage')),
  discount_value numeric(10,2) not null check (discount_value > 0),
  minimum_rental_amount numeric(10,2) not null default 0 check (minimum_rental_amount >= 0),
  validity_days integer not null default 30 check (validity_days > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.borrower_vouchers (
  id uuid primary key default gen_random_uuid(),
  borrower_id uuid not null references public.profiles(id) on delete cascade,
  voucher_id uuid not null references public.reward_voucher_catalog(id) on delete restrict,
  code text not null unique,
  points_spent integer not null check (points_spent > 0),
  discount_type text not null check (discount_type in ('fixed', 'percentage')),
  discount_value numeric(10,2) not null check (discount_value > 0),
  minimum_rental_amount numeric(10,2) not null default 0,
  status text not null default 'available' check (status in ('available', 'used', 'expired', 'cancelled')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  booking_id uuid references public.bookings(id) on delete set null
);

create index borrower_vouchers_owner_idx on public.borrower_vouchers(borrower_id, status, expires_at);

create table public.promotion_settings (
  id boolean primary key default true check (id),
  banner_slot_limit integer not null default 8 check (banner_slot_limit > 0),
  rotation_interval_seconds integer not null default 8 check (rotation_interval_seconds between 3 and 120),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

create table public.promotion_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  duration_days integer not null unique check (duration_days > 0),
  fee numeric(10,2) not null check (fee >= 0),
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.item_promotions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  lender_id uuid not null references public.profiles(id) on delete cascade,
  plan_id uuid not null references public.promotion_plans(id) on delete restrict,
  duration_days_snapshot integer not null check (duration_days_snapshot > 0),
  fee_snapshot numeric(10,2) not null check (fee_snapshot >= 0),
  status text not null default 'pending_payment' check (status in ('pending_payment', 'payment_review', 'active', 'expired', 'rejected', 'cancelled')),
  payment_reference text,
  starts_at timestamptz,
  ends_at timestamptz,
  last_displayed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id) on delete set null,
  constraint item_promotions_valid_period check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create index item_promotions_banner_rotation_idx on public.item_promotions(status, ends_at, last_displayed_at);
create index item_promotions_lender_idx on public.item_promotions(lender_id, created_at desc);
create unique index item_promotions_one_open_request_uidx on public.item_promotions(item_id)
  where status in ('pending_payment', 'payment_review', 'active');

insert into public.reward_program_settings(id, points_per_completed_booking, is_active) values (true, 100, true)
on conflict (id) do nothing;
insert into public.promotion_settings(id, banner_slot_limit, rotation_interval_seconds) values (true, 8, 8)
on conflict (id) do nothing;
insert into public.reward_voucher_catalog(name, description, points_cost, discount_type, discount_value, minimum_rental_amount, validity_days)
values
  ('₱50 rental discount', 'Save ₱50 on an eligible rental.', 300, 'fixed', 50, 250, 30),
  ('₱100 rental discount', 'Save ₱100 on an eligible rental.', 600, 'fixed', 100, 500, 30),
  ('15% rental discount', 'Save 15% on an eligible rental.', 1000, 'percentage', 15, 750, 30);
insert into public.promotion_plans(name, duration_days, fee, description, sort_order)
values
  ('3-day banner feature', 3, 49, 'Feature one listing in the rotating promotion banner for three days.', 1),
  ('7-day banner feature', 7, 99, 'Recommended introductory promotion for one listing.', 2),
  ('30-day banner feature', 30, 299, 'Extended rotating banner visibility for one listing.', 3);

alter table public.reward_program_settings enable row level security;
alter table public.borrower_reward_accounts enable row level security;
alter table public.reward_point_transactions enable row level security;
alter table public.reward_voucher_catalog enable row level security;
alter table public.borrower_vouchers enable row level security;
alter table public.promotion_settings enable row level security;
alter table public.promotion_plans enable row level security;
alter table public.item_promotions enable row level security;

create policy "Public reads active reward vouchers" on public.reward_voucher_catalog for select using (is_active);
create policy "Public reads active promotion plans" on public.promotion_plans for select using (is_active);
create policy "Users read own reward account" on public.borrower_reward_accounts for select to authenticated using ((select auth.uid()) = borrower_id);
create policy "Users read own reward history" on public.reward_point_transactions for select to authenticated using ((select auth.uid()) = borrower_id);
create policy "Users read own vouchers" on public.borrower_vouchers for select to authenticated using ((select auth.uid()) = borrower_id);
create policy "Lenders read own promotions" on public.item_promotions for select to authenticated using ((select auth.uid()) = lender_id);
create policy "Public reads active banner promotions" on public.item_promotions for select using (
  status = 'active' and starts_at <= now() and ends_at > now()
);
create policy "Lenders request promotions for own items" on public.item_promotions for insert to authenticated
with check (
  (select auth.uid()) = lender_id
  and exists (select 1 from public.items i where i.id = item_id and i.owner_id = (select auth.uid()))
  and exists (
    select 1 from public.promotion_plans pp
    where pp.id = plan_id and pp.is_active
      and pp.duration_days = duration_days_snapshot and pp.fee = fee_snapshot
  )
  and status = 'pending_payment'
);
create policy "Lenders cancel unpaid promotions" on public.item_promotions for update to authenticated
using ((select auth.uid()) = lender_id and status = 'pending_payment')
with check ((select auth.uid()) = lender_id and status in ('pending_payment', 'cancelled'));

create policy "Admins manage reward settings" on public.reward_program_settings for all to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and lower(p.role::text) = 'admin'))
with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and lower(p.role::text) = 'admin'));
create policy "Admins manage reward catalog" on public.reward_voucher_catalog for all to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and lower(p.role::text) = 'admin'))
with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and lower(p.role::text) = 'admin'));
create policy "Admins manage promotion settings" on public.promotion_settings for all to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and lower(p.role::text) = 'admin'))
with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and lower(p.role::text) = 'admin'));
create policy "Admins manage promotion plans" on public.promotion_plans for all to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and lower(p.role::text) = 'admin'))
with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and lower(p.role::text) = 'admin'));
create policy "Admins manage item promotions" on public.item_promotions for all to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and lower(p.role::text) = 'admin'))
with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and lower(p.role::text) = 'admin'));

create or replace function private.award_completed_booking_points()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  awarded_points integer;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    select points_per_completed_booking into awarded_points
    from public.reward_program_settings where id = true and is_active;
    if coalesce(awarded_points, 0) > 0 then
      insert into public.reward_point_transactions(borrower_id, booking_id, points, transaction_type, description)
      values (new.borrower_id, new.id, awarded_points, 'booking_completed', 'Points earned from a completed rental')
      on conflict do nothing;
      if found then
        insert into public.borrower_reward_accounts(borrower_id, points_balance, lifetime_points, completed_borrow_count)
        values (new.borrower_id, awarded_points, awarded_points, 1)
        on conflict (borrower_id) do update set
          points_balance = public.borrower_reward_accounts.points_balance + excluded.points_balance,
          lifetime_points = public.borrower_reward_accounts.lifetime_points + excluded.lifetime_points,
          completed_borrow_count = public.borrower_reward_accounts.completed_borrow_count + 1,
          updated_at = now();
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.award_completed_booking_points() from public, anon, authenticated;
drop trigger if exists award_completed_booking_points on public.bookings;
create trigger award_completed_booking_points after update of status on public.bookings
for each row execute function private.award_completed_booking_points();

create or replace function public.redeem_reward_voucher(requested_voucher_id uuid)
returns public.borrower_vouchers
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  catalog public.reward_voucher_catalog;
  account public.borrower_reward_accounts;
  issued public.borrower_vouchers;
begin
  if caller_id is null then raise exception 'Authentication required'; end if;
  select * into catalog from public.reward_voucher_catalog where id = requested_voucher_id and is_active for update;
  if not found then raise exception 'Voucher is unavailable'; end if;
  select * into account from public.borrower_reward_accounts where borrower_id = caller_id for update;
  if coalesce(account.points_balance, 0) < catalog.points_cost then raise exception 'Not enough reward points'; end if;
  update public.borrower_reward_accounts set points_balance = points_balance - catalog.points_cost, updated_at = now() where borrower_id = caller_id;
  insert into public.reward_point_transactions(borrower_id, points, transaction_type, description)
  values (caller_id, -catalog.points_cost, 'voucher_redeemed', 'Redeemed ' || catalog.name);
  insert into public.borrower_vouchers(borrower_id, voucher_id, code, points_spent, discount_type, discount_value, minimum_rental_amount, expires_at)
  values (caller_id, catalog.id, 'BKT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)), catalog.points_cost, catalog.discount_type, catalog.discount_value, catalog.minimum_rental_amount, now() + make_interval(days => catalog.validity_days))
  returning * into issued;
  return issued;
end;
$$;
revoke all on function public.redeem_reward_voucher(uuid) from public, anon;
grant execute on function public.redeem_reward_voucher(uuid) to authenticated;

create or replace view public.active_item_promotions
with (security_invoker = true)
as
select p.id, p.item_id, p.lender_id, p.starts_at, p.ends_at, p.last_displayed_at
from public.item_promotions p
join public.items i on i.id = p.item_id
where p.status = 'active' and p.starts_at <= now() and p.ends_at > now() and i.is_active = true;

grant select on public.reward_voucher_catalog, public.promotion_plans to anon, authenticated;
grant select on public.item_promotions, public.active_item_promotions to anon;
grant select on public.borrower_reward_accounts, public.reward_point_transactions, public.borrower_vouchers, public.item_promotions, public.active_item_promotions to authenticated;
grant insert, update on public.item_promotions to authenticated;
