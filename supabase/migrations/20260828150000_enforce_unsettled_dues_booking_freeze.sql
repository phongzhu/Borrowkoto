begin;

create schema if not exists private;

create or replace function private.borrower_has_unsettled_dues(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.bookings booking
      where booking.borrower_id = p_user_id
        and booking.status in ('accepted', 'for_pickup', 'active', 'overdue')
        and coalesce(booking.approved_end, booking.requested_end) < now()
    )
    or exists (
      select 1
      from public.payment_transactions transaction
      where transaction.payer_id = p_user_id
        and transaction.transaction_type in ('late_fee_owner_share', 'late_fee_admin_share')
        and coalesce(transaction.amount, 0) > 0
        and lower(coalesce(transaction.status::text, '')) not in ('recorded', 'paid', 'completed', 'settled')
    )
    or exists (
      select 1
      from public.damage_claims claim
      where claim.borrower_id = p_user_id
        and claim.status in ('approved', 'awaiting_payment')
        and greatest(
          coalesce(claim.amount_due, 0),
          coalesce(claim.admin_approved_amount, 0),
          coalesce(claim.claimed_amount, 0)
        ) > 0
    );
$$;

create or replace function public.user_has_unsettled_dues(p_user_id uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
begin
  if p_user_id is null then
    return false;
  end if;

  if v_caller_id is not null
     and v_caller_id <> p_user_id
     and not exists (
       select 1
       from public.profiles profile
       where profile.id = v_caller_id
         and profile.role = 'admin'
     ) then
    raise exception 'You may only check unsettled dues for your own account.'
      using errcode = '42501';
  end if;

  return private.borrower_has_unsettled_dues(p_user_id);
end;
$$;

create or replace function public.block_booking_when_borrower_has_unsettled_dues()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.borrower_has_unsettled_dues(new.borrower_id) then
    raise exception 'Your account is temporarily frozen. Settle all late fees and approved damage charges before borrowing another item.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_block_booking_with_unsettled_dues on public.bookings;

create trigger trg_block_booking_with_unsettled_dues
before insert on public.bookings
for each row
execute function public.block_booking_when_borrower_has_unsettled_dues();

revoke all on function public.user_has_unsettled_dues(uuid) from public;
grant execute on function public.user_has_unsettled_dues(uuid) to authenticated, service_role;

comment on function public.user_has_unsettled_dues(uuid) is
  'Returns true when the borrower has an overdue return, unpaid late-fee transaction, or approved unpaid damage claim.';

comment on trigger trg_block_booking_with_unsettled_dues on public.bookings is
  'Prevents new bookings while the borrower has unsettled late fees or approved damage charges.';

commit;
