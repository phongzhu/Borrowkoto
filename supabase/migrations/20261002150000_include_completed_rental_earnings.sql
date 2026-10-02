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
        or (
          lower(transaction.transaction_type::text) = 'payment'
          and lower(coalesce(transaction.notes, '')) like 'rental fee payment for %'
        )
      )
    group by transaction.booking_id
  )
  select coalesce(round(sum(coalesce(nullif(transaction.rental_income, 0), booking.rental_income)), 2), 0)::numeric
  from completed_bookings booking
  left join settled_rental_transactions transaction on transaction.booking_id = booking.id;
$$;

notify pgrst, 'reload schema';
