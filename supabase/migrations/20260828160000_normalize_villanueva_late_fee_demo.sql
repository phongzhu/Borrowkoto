begin;

-- The requested demo booking was exercised through the previous return flow,
-- which completed it and created deposit-split fee rows. Reset only this
-- explicitly tagged demo record so it cleanly demonstrates the new workflow.
with target_booking as materialized (
  select booking.id, booking.borrower_id
  from public.bookings booking
  join public.nub_student_registry registry
    on registry.auth_user_id = booking.borrower_id
  where lower(btrim(registry.email)) = 'villanuevacam@students.nu-baliwag.edu.ph'
    and booking.borrower_message = '[Borrow Ko ''To demo late-fee seed for villanuevacam]'
  limit 1
), deleted_reward as (
  delete from public.reward_point_transactions transaction
  using target_booking booking
  where transaction.booking_id = booking.id
    and transaction.transaction_type = 'booking_completed'
  returning transaction.borrower_id, transaction.points
), removed_reward_totals as (
  select borrower_id,
         sum(points)::integer as points,
         count(*)::integer as completed_count
  from deleted_reward
  group by borrower_id
)
update public.borrower_reward_accounts account
set points_balance = greatest(0, account.points_balance - removed.points),
    lifetime_points = greatest(0, account.lifetime_points - removed.points),
    completed_borrow_count = greatest(0, account.completed_borrow_count - removed.completed_count),
    updated_at = now()
from removed_reward_totals removed
where account.borrower_id = removed.borrower_id;

with target_booking as materialized (
  select booking.id
  from public.bookings booking
  join public.nub_student_registry registry
    on registry.auth_user_id = booking.borrower_id
  where lower(btrim(registry.email)) = 'villanuevacam@students.nu-baliwag.edu.ph'
    and booking.borrower_message = '[Borrow Ko ''To demo late-fee seed for villanuevacam]'
  limit 1
)
delete from public.payment_transactions transaction
using target_booking booking
where transaction.booking_id = booking.id
  and transaction.transaction_type in ('late_fee_owner_share', 'late_fee_admin_share');

with target_booking as materialized (
  select booking.id
  from public.bookings booking
  join public.nub_student_registry registry
    on registry.auth_user_id = booking.borrower_id
  where lower(btrim(registry.email)) = 'villanuevacam@students.nu-baliwag.edu.ph'
    and booking.borrower_message = '[Borrow Ko ''To demo late-fee seed for villanuevacam]'
  limit 1
)
update public.bookings booking
set status = 'overdue',
    updated_at = now()
from target_booking target
where booking.id = target.id;

with target_booking as materialized (
  select booking.id,
         booking.borrower_id,
         booking.owner_id,
         booking.rental_price_per_day,
         coalesce(booking.approved_end, booking.requested_end) as due_at
  from public.bookings booking
  join public.nub_student_registry registry
    on registry.auth_user_id = booking.borrower_id
  where lower(btrim(registry.email)) = 'villanuevacam@students.nu-baliwag.edu.ph'
    and booking.borrower_message = '[Borrow Ko ''To demo late-fee seed for villanuevacam]'
  limit 1
), admin_payee as materialized (
  select profile.id
  from public.profiles profile
  where profile.role = 'admin'
  order by profile.created_at
  limit 1
), fee as materialized (
  select booking.*,
         greatest(1, ceil(extract(epoch from (now() - booking.due_at)) / 86400.0)::integer) as days_late,
         round(
           booking.rental_price_per_day
             * greatest(1, ceil(extract(epoch from (now() - booking.due_at)) / 86400.0)::integer),
           2
         ) as total
  from target_booking booking
), transactions as (
  select fee.id as booking_id,
         fee.borrower_id as payer_id,
         fee.owner_id as payee_id,
         'late_fee_owner_share'::public.transaction_type as transaction_type,
         round(fee.total * 0.70, 2) as amount,
         format('Late fee: %s day(s) overdue at PHP %s per day. Owner share 70%%.', fee.days_late, fee.rental_price_per_day) as notes,
         format('paymongo:late_fee:owner:%s', fee.id) as reference_number
  from fee

  union all

  select fee.id,
         fee.borrower_id,
         admin.id,
         'late_fee_admin_share'::public.transaction_type,
         fee.total - round(fee.total * 0.70, 2),
         format('Late fee: %s day(s) overdue at PHP %s per day. Admin share 30%%.', fee.days_late, fee.rental_price_per_day),
         format('paymongo:late_fee:admin:%s', fee.id)
  from fee
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
select booking_id,
       payer_id,
       payee_id,
       transaction_type,
       amount,
       'paymongo',
       'pending',
       reference_number,
       now(),
       notes
from transactions
where amount > 0;

commit;
