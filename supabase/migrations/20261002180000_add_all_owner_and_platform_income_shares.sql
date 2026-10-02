-- Keep late fees on the same 85/15 lender/platform split as other marketplace earnings.
create or replace function private.normalize_late_fee_share_transaction()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if lower(new.transaction_type::text) = 'late_fee_owner_share'
     and lower(coalesce(new.notes, '')) like '%owner share 70%' then
    new.amount := round(new.amount * 0.85 / 0.70, 2);
    new.notes := regexp_replace(new.notes, 'Owner share 70%', 'Owner share 85%', 'i');
  elsif lower(new.transaction_type::text) = 'late_fee_admin_share'
     and lower(coalesce(new.notes, '')) like '%admin share 30%' then
    new.amount := round(new.amount * 0.15 / 0.30, 2);
    new.notes := regexp_replace(new.notes, 'Admin share 30%', 'Admin share 15%', 'i');
  end if;
  return new;
end;
$$;

drop trigger if exists normalize_late_fee_share_transaction on public.payment_transactions;
create trigger normalize_late_fee_share_transaction
before insert on public.payment_transactions
for each row execute function private.normalize_late_fee_share_transaction();

with late_fee_rows as (
  select transaction.id,
         transaction.transaction_type::text as transaction_type,
         sum(transaction.amount) over (
           partition by transaction.booking_id,
             transaction.payment_method,
             transaction.status,
             regexp_replace(coalesce(transaction.reference_number, transaction.id::text), ':(owner|admin):', ':share:', 'i')
         ) as gross_amount,
         count(*) over (
           partition by transaction.booking_id,
             transaction.payment_method,
             transaction.status,
             regexp_replace(coalesce(transaction.reference_number, transaction.id::text), ':(owner|admin):', ':share:', 'i')
         ) as share_count
  from public.payment_transactions transaction
  where lower(transaction.transaction_type::text) in ('late_fee_owner_share', 'late_fee_admin_share')
), normalized_late_fee_rows as (
  select id,
         case
           when share_count < 2 then null
           when lower(transaction_type) = 'late_fee_owner_share' then round(gross_amount * 0.85, 2)
           else gross_amount - round(gross_amount * 0.85, 2)
         end as amount
  from late_fee_rows
)
update public.payment_transactions transaction
set amount = normalized.amount,
    notes = case
      when lower(transaction.transaction_type::text) = 'late_fee_owner_share'
        then regexp_replace(transaction.notes, 'Owner share 70%', 'Owner share 85%', 'i')
      else regexp_replace(transaction.notes, 'Admin share 30%', 'Admin share 15%', 'i')
    end
from normalized_late_fee_rows normalized
where normalized.id = transaction.id
  and normalized.amount is not null;

create or replace function private.owner_withdrawable_rental_earnings(p_owner_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with completed_bookings as (
    select booking.id,
           coalesce(
             nullif(booking.rental_fee_total, 0),
             nullif(round(coalesce(booking.rental_price_per_day, 0) * coalesce(booking.rental_days, 0), 2), 0),
             0
           )::numeric as rental_income
    from public.bookings booking
    where booking.owner_id = p_owner_id
      and lower(booking.status::text) in ('completed', 'returned', 'done', 'closed')
  ),
  settled_rental_transactions as (
    select transaction.booking_id,
           round(sum(transaction.amount), 2)::numeric as rental_income
    from public.payment_transactions transaction
    where transaction.payee_id = p_owner_id
      and lower(transaction.status::text) in ('recorded', 'paid', 'completed', 'succeeded', 'settled')
      and (
        lower(transaction.transaction_type::text) in ('rental_fee_payment', 'rental_payment', 'rent_payment')
        or (lower(transaction.transaction_type::text) = 'payment'
          and lower(coalesce(transaction.notes, '')) like 'rental fee payment for %')
      )
    group by transaction.booking_id
  ),
  owner_income as (
    select coalesce(nullif(payment.rental_income, 0), booking.rental_income) as amount
    from completed_bookings booking
    left join settled_rental_transactions payment on payment.booking_id = booking.id

    union all

    select transaction.amount
    from public.payment_transactions transaction
    where transaction.payee_id = p_owner_id
      and lower(transaction.transaction_type::text) = 'late_fee_owner_share'
      and lower(transaction.status::text) in ('recorded', 'paid', 'completed', 'succeeded', 'settled')

    union all

    select round(transaction.amount * 0.85, 2)
    from public.payment_transactions transaction
    where transaction.payee_id = p_owner_id
      and lower(transaction.status::text) in ('recorded', 'paid', 'completed', 'succeeded', 'settled')
      and (
        lower(transaction.transaction_type::text) = 'damage_payment'
        or (lower(transaction.transaction_type::text) = 'payment'
          and lower(coalesce(transaction.notes, '')) like 'damage claim payment for booking %')
      )

    union all

    select transaction.amount
    from public.payment_transactions transaction
    where transaction.payee_id = p_owner_id
      and lower(transaction.status::text) in ('recorded', 'paid', 'completed', 'succeeded', 'settled')
      and (
        lower(transaction.transaction_type::text) in ('purchase_payment', 'item_purchase_payment', 'purchase')
        or (lower(transaction.transaction_type::text) = 'payment'
          and lower(coalesce(transaction.notes, '')) like 'purchase payment for item request %')
      )
  )
  select coalesce(round(sum(amount), 2), 0)::numeric from owner_income;
$$;

create or replace function private.admin_withdrawable_platform_commission(p_admin_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with platform_fees as (
    select coalesce(sum(transaction.amount), 0) as amount
    from public.payment_transactions transaction
    where transaction.payee_id = p_admin_id
      and lower(transaction.status::text) in ('recorded', 'paid', 'completed', 'succeeded', 'settled')
      and (
        lower(transaction.transaction_type::text) in ('platform_fee', 'commission_fee', 'service_fee')
        or lower(coalesce(transaction.notes, '')) like '%platform commission fee%'
      )
  ),
  late_fee_shares as (
    select coalesce(sum(transaction.amount), 0) as amount
    from public.payment_transactions transaction
    where transaction.payee_id = p_admin_id
      and lower(transaction.transaction_type::text) = 'late_fee_admin_share'
      and lower(transaction.status::text) in ('recorded', 'paid', 'completed', 'succeeded', 'settled')
  ),
  damage_shares as (
    select coalesce(round(sum(transaction.amount * 0.15), 2), 0) as amount
    from public.payment_transactions transaction
    where p_admin_id = (
        select profile.id from public.profiles profile
        where lower(profile.role::text) = 'admin'
        order by profile.created_at
        limit 1
      )
      and lower(transaction.status::text) in ('recorded', 'paid', 'completed', 'succeeded', 'settled')
      and (
        lower(transaction.transaction_type::text) = 'damage_payment'
        or (lower(transaction.transaction_type::text) = 'payment'
          and lower(coalesce(transaction.notes, '')) like 'damage claim payment for booking %')
      )
  )
  select coalesce(round(platform_fees.amount + late_fee_shares.amount + damage_shares.amount, 2), 0)::numeric
  from platform_fees cross join late_fee_shares cross join damage_shares;
$$;

create or replace function public.get_admin_platform_withdrawal_breakdown()
returns table(rental_commission numeric, product_commission numeric, late_fee_share numeric, damaged_item_share numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null or not exists (
    select 1 from public.profiles profile
    where profile.id = current_user_id and lower(profile.role::text) = 'admin'
  ) then
    raise exception 'Only admins can view platform earnings.';
  end if;

  select
    coalesce(sum(transaction.amount) filter (where lower(coalesce(transaction.notes, '')) not like '%item purchase request%'), 0),
    coalesce(sum(transaction.amount) filter (where lower(coalesce(transaction.notes, '')) like '%item purchase request%'), 0)
  into rental_commission, product_commission
  from public.payment_transactions transaction
  where transaction.payee_id = current_user_id
    and lower(transaction.status::text) in ('recorded', 'paid', 'completed', 'succeeded', 'settled')
    and (
      lower(transaction.transaction_type::text) in ('platform_fee', 'commission_fee', 'service_fee')
      or lower(coalesce(transaction.notes, '')) like '%platform commission fee%'
    );

  select coalesce(sum(transaction.amount), 0)
  into late_fee_share
  from public.payment_transactions transaction
  where transaction.payee_id = current_user_id
    and lower(transaction.transaction_type::text) = 'late_fee_admin_share'
    and lower(transaction.status::text) in ('recorded', 'paid', 'completed', 'succeeded', 'settled');

  select coalesce(round(sum(transaction.amount * 0.15), 2), 0)
  into damaged_item_share
  from public.payment_transactions transaction
  where current_user_id = (
      select profile.id from public.profiles profile
      where lower(profile.role::text) = 'admin'
      order by profile.created_at
      limit 1
    )
    and lower(transaction.status::text) in ('recorded', 'paid', 'completed', 'succeeded', 'settled')
    and (
      lower(transaction.transaction_type::text) = 'damage_payment'
      or (lower(transaction.transaction_type::text) = 'payment'
        and lower(coalesce(transaction.notes, '')) like 'damage claim payment for booking %')
    );
  return next;
end;
$$;

revoke all on function public.get_admin_platform_withdrawal_breakdown() from public, anon;
grant execute on function public.get_admin_platform_withdrawal_breakdown() to authenticated;

notify pgrst, 'reload schema';
