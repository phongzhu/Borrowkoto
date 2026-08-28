begin;

-- Give every active reviewed listing one upcoming accepted booking so its
-- reserved dates are visible in the public availability calendar and the
-- booking appears in both the borrower and owner Booking Details screens.
--
-- The seed is idempotent and uses only active, enrolled, registry-managed
-- students with an institutional NU Baliwag email. An item owner can never be
-- selected as the borrower for their own listing.
with reviewed_items as materialized (
  select item.id as item_id,
         item.owner_id,
         item.created_at,
         coalesce(item.pickup_time, time '09:00') as pickup_time,
         coalesce(item.return_time, time '18:00') as return_time,
         coalesce(item.rental_price_per_day, 0) as rental_price_per_day,
         coalesce(item.security_deposit, 0) as security_deposit,
         row_number() over (order by item.created_at, item.id) as item_slot
  from public.items item
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
), eligible_reviewers as materialized (
  select review.item_id,
         review.reviewer_id as borrower_id,
         row_number() over (
           partition by review.item_id
           order by review.created_at, md5(review.item_id::text || review.reviewer_id::text)
         ) as reviewer_slot
  from public.reviews review
  join reviewed_items item
    on item.item_id = review.item_id
   and item.owner_id <> review.reviewer_id
  join public.profiles borrower_profile
    on borrower_profile.id = review.reviewer_id
   and borrower_profile.role = 'user'
   and borrower_profile.account_status = 'active'
   and borrower_profile.nub_registry_managed = true
  join public.nub_student_registry registry
    on registry.auth_user_id = review.reviewer_id
   and registry.status = 'active'
   and registry.school_status = 'Enrolled'
   and lower(btrim(registry.email)) like '%@students.nu-baliwag.edu.ph'
  where review.reviewer_role = 'borrower'
), bookings_to_seed as materialized (
  select item.*,
         reviewer.borrower_id,
         (timezone('Asia/Manila', now())::date + 7 + (item.item_slot - 1)::integer) as booking_day
  from reviewed_items item
  join eligible_reviewers reviewer
    on reviewer.item_id = item.item_id
   and reviewer.reviewer_slot = 1
  where not exists (
    select 1
    from public.bookings booking
    where booking.item_id = item.item_id
      and booking.borrower_message = '[Borrow Ko ''To demo calendar-booking seed]'
  )
    and not exists (
      select 1
      from public.bookings booking
      where booking.item_id = item.item_id
        and booking.status in ('pending', 'accepted', 'for_pickup', 'active', 'return_pending', 'overdue', 'disputed')
        and coalesce(booking.approved_end, booking.requested_end) > now()
    )
)
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
select seed.item_id,
       seed.borrower_id,
       seed.owner_id,
       (seed.booking_day + seed.pickup_time) at time zone 'Asia/Manila',
       ((seed.booking_day + 1) + seed.return_time) at time zone 'Asia/Manila',
       (seed.booking_day + seed.pickup_time) at time zone 'Asia/Manila',
       ((seed.booking_day + 1) + seed.return_time) at time zone 'Asia/Manila',
       1,
       seed.rental_price_per_day,
       seed.rental_price_per_day,
       seed.security_deposit,
       seed.rental_price_per_day + seed.security_deposit,
       '[Borrow Ko ''To demo calendar-booking seed]',
       'accepted',
       now(),
       now(),
       0
from bookings_to_seed seed;

commit;
