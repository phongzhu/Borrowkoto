alter table public.borrower_vouchers
  drop constraint if exists borrower_vouchers_status_check;

alter table public.borrower_vouchers
  add constraint borrower_vouchers_status_check
  check (status in ('available', 'reserved', 'used', 'expired', 'cancelled'));

alter table public.bookings
  add column if not exists borrower_voucher_id uuid references public.borrower_vouchers(id) on delete set null,
  add column if not exists voucher_discount_amount numeric(10,2) not null default 0 check (voucher_discount_amount >= 0);

create index if not exists bookings_borrower_voucher_idx
  on public.bookings(borrower_voucher_id)
  where borrower_voucher_id is not null;

create or replace function public.reserve_reward_voucher_for_booking(
  requested_voucher_id uuid,
  requested_booking_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  selected_voucher public.borrower_vouchers;
  selected_booking public.bookings;
  discount_amount numeric(10,2);
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;

  select * into selected_booking
  from public.bookings
  where id = requested_booking_id and borrower_id = caller_id
  for update;

  if not found or selected_booking.status <> 'pending' then
    raise exception 'The voucher can only be applied to your pending booking';
  end if;

  if selected_booking.borrower_voucher_id is not null then
    raise exception 'This booking already has a voucher';
  end if;

  select * into selected_voucher
  from public.borrower_vouchers
  where id = requested_voucher_id and borrower_id = caller_id
  for update;

  if not found or selected_voucher.status <> 'available' then
    raise exception 'This voucher is not available';
  end if;

  if selected_voucher.expires_at <= now() then
    update public.borrower_vouchers set status = 'expired' where id = selected_voucher.id;
    raise exception 'This voucher has expired';
  end if;

  if selected_booking.rental_fee_total < selected_voucher.minimum_rental_amount then
    raise exception 'The rental amount does not meet this voucher minimum';
  end if;

  discount_amount := case selected_voucher.discount_type
    when 'percentage' then round(selected_booking.rental_fee_total * selected_voucher.discount_value / 100, 2)
    else selected_voucher.discount_value
  end;
  discount_amount := least(discount_amount, selected_booking.rental_fee_total, selected_booking.total_due);

  update public.borrower_vouchers
  set booking_id = selected_booking.id, status = 'reserved'
  where id = selected_voucher.id;

  update public.bookings
  set borrower_voucher_id = selected_voucher.id,
      voucher_discount_amount = discount_amount,
      total_due = greatest(0, total_due - discount_amount)
  where id = selected_booking.id;

  return discount_amount;
end;
$$;

revoke all on function public.reserve_reward_voucher_for_booking(uuid, uuid) from public, anon;
grant execute on function public.reserve_reward_voucher_for_booking(uuid, uuid) to authenticated;

create or replace function private.finalize_booking_reward_voucher()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.borrower_voucher_id is null or new.status is not distinct from old.status then
    return new;
  end if;

  if new.status in ('cancelled', 'rejected') then
    update public.borrower_vouchers
    set booking_id = null, status = 'available'
    where id = new.borrower_voucher_id and borrower_id = new.borrower_id and status = 'reserved';
  elsif old.status = 'pending' and new.status <> 'pending' then
    update public.borrower_vouchers
    set status = 'used', used_at = now()
    where id = new.borrower_voucher_id and borrower_id = new.borrower_id and status = 'reserved';
  end if;

  return new;
end;
$$;

revoke all on function private.finalize_booking_reward_voucher() from public, anon, authenticated;
drop trigger if exists finalize_booking_reward_voucher on public.bookings;
create trigger finalize_booking_reward_voucher
after update of status on public.bookings
for each row execute function private.finalize_booking_reward_voucher();
