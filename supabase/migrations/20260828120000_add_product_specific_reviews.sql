begin;

alter table public.reviews
  add column if not exists item_id uuid references public.items(id) on delete cascade;

update public.reviews review
set item_id = booking.item_id
from public.bookings booking
where booking.id = review.booking_id
  and review.item_id is null;

alter table public.reviews
  alter column item_id set not null;

create index if not exists reviews_item_created_at_idx
  on public.reviews(item_id, created_at desc);

create index if not exists reviews_item_reviewer_idx
  on public.reviews(item_id, reviewer_id);

comment on column public.reviews.item_id is
  'The exact marketplace item reviewed. It must match the review booking.';

create or replace function public.enforce_product_review_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_row public.bookings%rowtype;
begin
  select *
  into booking_row
  from public.bookings
  where id = new.booking_id;

  if not found then
    raise exception 'Review booking does not exist.';
  end if;

  if booking_row.status <> 'completed' then
    raise exception 'Reviews can only be submitted for completed bookings.';
  end if;

  if new.item_id is null then
    new.item_id := booking_row.item_id;
  elsif new.item_id <> booking_row.item_id then
    raise exception 'Review item must match the booking item.';
  end if;

  if new.reviewer_id = booking_row.owner_id then
    if new.reviewer_role <> 'owner'
       or new.reviewee_id <> booking_row.borrower_id then
      raise exception 'An item owner cannot publish a borrower product review.';
    end if;
  elsif new.reviewer_id = booking_row.borrower_id then
    if new.reviewer_role <> 'borrower'
       or new.reviewee_id <> booking_row.owner_id then
      raise exception 'A borrower review must review the item owner.';
    end if;
  else
    raise exception 'Reviewer must belong to the completed booking.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_product_review_booking_trigger on public.reviews;
create trigger enforce_product_review_booking_trigger
before insert or update of booking_id, item_id, reviewer_id, reviewee_id, reviewer_role
on public.reviews
for each row
execute function public.enforce_product_review_booking();

-- Seed two borrower comments per currently available product for the demo
-- marketplace. Reviewers are selected only from active, registry-managed,
-- Enrolled students with an institutional email, and never from the owner of
-- the reviewed item. The tagged bookings keep this data easy to audit.
with eligible_students as materialized (
  select profile.id
  from public.profiles profile
  join public.nub_student_registry registry
    on registry.auth_user_id = profile.id
  where profile.role = 'user'
    and profile.account_status = 'active'
    and profile.nub_registry_managed = true
    and registry.status = 'active'
    and registry.school_status = 'Enrolled'
    and lower(btrim(registry.email)) like '%@students.nu-baliwag.edu.ph'
), available_items as materialized (
  select item.id,
         item.owner_id,
         item.title,
         coalesce(item.rental_price_per_day, 0) as rental_price_per_day,
         coalesce(item.security_deposit, 0) as security_deposit
  from public.items item
  join public.profiles owner_profile
    on owner_profile.id = item.owner_id
   and owner_profile.account_status = 'active'
  where item.is_active = true
    and item.status = 'available'
), existing_counts as (
  select review.item_id, count(*)::integer as review_count
  from public.reviews review
  where review.reviewer_role = 'borrower'
  group by review.item_id
), available_candidates as (
  select item.id as item_id,
         item.owner_id,
         item.title,
         item.rental_price_per_day,
         item.security_deposit,
         student.id as reviewer_id,
         row_number() over (
           partition by item.id
           order by md5(item.id::text || student.id::text)
         ) as reviewer_slot
  from available_items item
  cross join eligible_students student
  where student.id <> item.owner_id
    and not exists (
      select 1
      from public.reviews review
      where review.item_id = item.id
        and review.reviewer_id = student.id
        and review.reviewer_role = 'borrower'
    )
), reviews_to_seed as materialized (
  select candidate.*
  from available_candidates candidate
  left join existing_counts existing
    on existing.item_id = candidate.item_id
  where candidate.reviewer_slot <= greatest(0, 2 - coalesce(existing.review_count, 0))
), inserted_bookings as (
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
         seed.reviewer_id,
         seed.owner_id,
         now() - interval '35 days' - (seed.reviewer_slot * interval '3 days'),
         now() - interval '34 days' - (seed.reviewer_slot * interval '3 days'),
         now() - interval '35 days' - (seed.reviewer_slot * interval '3 days'),
         now() - interval '34 days' - (seed.reviewer_slot * interval '3 days'),
         1,
         seed.rental_price_per_day,
         seed.rental_price_per_day,
         seed.security_deposit,
         seed.rental_price_per_day + seed.security_deposit,
         '[Borrow Ko ''To demo product-review seed]',
         'completed',
         now() - interval '38 days' - (seed.reviewer_slot * interval '3 days'),
         now() - interval '33 days' - (seed.reviewer_slot * interval '3 days'),
         0
  from reviews_to_seed seed
  returning id, item_id, borrower_id, owner_id
)
insert into public.reviews (
  booking_id,
  item_id,
  reviewer_id,
  reviewee_id,
  reviewer_role,
  rating,
  review_text,
  created_at
)
select booking.id,
       booking.item_id,
       booking.borrower_id,
       booking.owner_id,
       'borrower',
       case when seed.reviewer_slot % 2 = 0 then 4 else 5 end,
       case
         when seed.reviewer_slot % 2 = 0 then
           format('%s was useful for schoolwork and easy to use. It was clean, complete, and ready at the agreed pickup time.', seed.title)
         else
           format('%s matched the listing and was in good condition. Pickup was straightforward and the owner communicated clearly.', seed.title)
       end,
       now() - interval '32 days' - (seed.reviewer_slot * interval '3 days')
from inserted_bookings booking
join reviews_to_seed seed
  on seed.item_id = booking.item_id
 and seed.reviewer_id = booking.borrower_id;

commit;
