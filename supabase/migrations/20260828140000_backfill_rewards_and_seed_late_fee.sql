begin;

-- Backfill reward points for completed bookings that were inserted directly
-- as completed and therefore did not pass through the status-update trigger.
-- Only newly inserted ledger rows are reflected in account balances, keeping
-- the operation safe to rerun without awarding duplicate points.
with active_reward_setting as materialized (
  select points_per_completed_booking
  from public.reward_program_settings
  where id = true
    and is_active = true
), inserted_rewards as (
  insert into public.reward_point_transactions (
    borrower_id,
    booking_id,
    points,
    transaction_type,
    description,
    created_at
  )
  select booking.borrower_id,
         booking.id,
         setting.points_per_completed_booking,
         'booking_completed',
         'Points earned from a completed rental',
         coalesce(booking.updated_at, booking.created_at, now())
  from public.bookings booking
  cross join active_reward_setting setting
  where booking.status = 'completed'
    and not exists (
      select 1
      from public.reward_point_transactions transaction
      where transaction.booking_id = booking.id
        and transaction.transaction_type = 'booking_completed'
    )
  on conflict do nothing
  returning borrower_id, points
), borrower_totals as (
  select borrower_id,
         sum(points)::integer as awarded_points,
         count(*)::integer as completed_bookings
  from inserted_rewards
  group by borrower_id
)
insert into public.borrower_reward_accounts (
  borrower_id,
  points_balance,
  lifetime_points,
  completed_borrow_count,
  updated_at
)
select borrower_id,
       awarded_points,
       awarded_points,
       completed_bookings,
       now()
from borrower_totals
on conflict (borrower_id) do update
set points_balance = public.borrower_reward_accounts.points_balance + excluded.points_balance,
    lifetime_points = public.borrower_reward_accounts.lifetime_points + excluded.lifetime_points,
    completed_borrow_count = public.borrower_reward_accounts.completed_borrow_count + excluded.completed_borrow_count,
    updated_at = now();

-- Create one auditable overdue booking for the requested active NUB student.
-- The booking ended more than one day ago, so the application calculates a
-- two-day late fee immediately and continues accruing it until payment.
with target_student as materialized (
  select registry.auth_user_id as borrower_id
  from public.nub_student_registry registry
  join public.profiles profile
    on profile.id = registry.auth_user_id
   and profile.role = 'user'
   and profile.account_status = 'active'
   and profile.nub_registry_managed = true
  where lower(btrim(registry.email)) = 'villanuevacam@students.nu-baliwag.edu.ph'
    and registry.status = 'active'
    and registry.school_status = 'Enrolled'
  limit 1
), candidate_item as materialized (
  select item.id as item_id,
         item.owner_id,
         coalesce(item.rental_price_per_day, 0) as rental_price_per_day,
         coalesce(item.security_deposit, 0) as security_deposit
  from public.items item
  join target_student student
    on student.borrower_id <> item.owner_id
  join public.profiles owner_profile
    on owner_profile.id = item.owner_id
   and owner_profile.account_status = 'active'
  where item.is_active = true
    and item.status = 'available'
    and exists (
      select 1
      from public.reviews review
      where review.item_id = item.id
        and review.reviewer_role = 'borrower'
    )
  order by case when item.title = 'Protractor Set' then 0 else 1 end,
           item.created_at,
           item.id
  limit 1
), inserted_late_booking as (
  insert into public.bookings (
    item_id,
    borrower_id,
    owner_id,
    requested_start,
    requested_end,
    approved_start,
    approved_end,
    rental_days,
    rental_price_per_day,
    rental_fee_total,
    security_deposit,
    total_due,
    borrower_message,
    status,
    created_at,
    updated_at,
    voucher_discount_amount
  )
  select item.item_id,
         student.borrower_id,
         item.owner_id,
         now() - interval '2 days 2 hours',
         now() - interval '1 day 1 hour',
         now() - interval '2 days 2 hours',
         now() - interval '1 day 1 hour',
         1,
         item.rental_price_per_day,
         item.rental_price_per_day,
         item.security_deposit,
         item.rental_price_per_day + item.security_deposit,
         '[Borrow Ko ''To demo late-fee seed for villanuevacam]',
         'overdue',
         now() - interval '3 days',
         now(),
         0
  from candidate_item item
  cross join target_student student
  where not exists (
    select 1
    from public.bookings booking
    where booking.borrower_id = student.borrower_id
      and booking.borrower_message = '[Borrow Ko ''To demo late-fee seed for villanuevacam]'
  )
  returning id, borrower_id, owner_id, rental_price_per_day, approved_end
), admin_payee as materialized (
  select profile.id as payee_id
  from public.profiles profile
  where profile.role = 'admin'
  order by profile.created_at
  limit 1
), late_fee_amounts as materialized (
  select booking.*,
         greatest(
           1,
           ceil(extract(epoch from (now() - booking.approved_end)) / 86400.0)::integer
         ) as days_late,
         round(
           booking.rental_price_per_day * greatest(
             1,
             ceil(extract(epoch from (now() - booking.approved_end)) / 86400.0)::integer
           ),
           2
         ) as total_late_fee
  from inserted_late_booking booking
), late_fee_transactions as (
  select booking.id as booking_id,
         booking.borrower_id as payer_id,
         booking.owner_id as payee_id,
         'late_fee_owner_share'::public.transaction_type as transaction_type,
         round(booking.total_late_fee * 0.70, 2) as amount,
         format(
           'Late fee: %s day(s) overdue at PHP %s per day. Owner share 70%%.',
           booking.days_late,
           booking.rental_price_per_day
         ) as notes,
         format('paymongo:late_fee:owner:%s', booking.id) as reference_number
  from late_fee_amounts booking

  union all

  select booking.id,
         booking.borrower_id,
         admin.payee_id,
         'late_fee_admin_share'::public.transaction_type,
         booking.total_late_fee - round(booking.total_late_fee * 0.70, 2),
         format(
           'Late fee: %s day(s) overdue at PHP %s per day. Admin share 30%%.',
           booking.days_late,
           booking.rental_price_per_day
         ),
         format('paymongo:late_fee:admin:%s', booking.id)
  from late_fee_amounts booking
  cross join admin_payee admin
)
insert into public.payment_transactions (
  booking_id,
  payer_id,
  payee_id,
  transaction_type,
  amount,
  payment_method,
  status,
  reference_number,
  transaction_at,
  notes
)
select transaction.booking_id,
       transaction.payer_id,
       transaction.payee_id,
       transaction.transaction_type,
       transaction.amount,
       'paymongo',
       'pending',
       transaction.reference_number,
       now(),
       transaction.notes
from late_fee_transactions transaction
where transaction.amount > 0
  and not exists (
    select 1
    from public.payment_transactions existing
    where existing.reference_number = transaction.reference_number
  );

commit;
