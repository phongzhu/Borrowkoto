begin;

create or replace function public.prepare_late_fee_settlement(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid;
  v_booking public.bookings%rowtype;
  v_caller_id uuid := auth.uid();
  v_days_late integer;
  v_deposit_applied numeric(12, 2);
  v_deposit_admin numeric(12, 2);
  v_deposit_owner numeric(12, 2);
  v_due_at timestamptz;
  v_late_fee_total numeric(12, 2);
  v_paymongo_admin numeric(12, 2);
  v_paymongo_due numeric(12, 2);
  v_paymongo_owner numeric(12, 2);
begin
  select *
  into v_booking
  from public.bookings booking
  where booking.id = p_booking_id
  for update;

  if not found then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;

  if v_caller_id is not null
     and v_caller_id <> v_booking.borrower_id
     and not exists (
       select 1
       from public.profiles profile
       where profile.id = v_caller_id
         and profile.role = 'admin'
     ) then
    raise exception 'Only the borrower may prepare this late-fee settlement.'
      using errcode = '42501';
  end if;

  if v_booking.status not in ('accepted', 'for_pickup', 'active', 'overdue') then
    raise exception 'This booking is not eligible for late-fee settlement.'
      using errcode = 'P0001';
  end if;

  v_due_at := coalesce(v_booking.approved_end, v_booking.requested_end);
  if v_due_at is null or v_due_at >= now() then
    raise exception 'This booking is not overdue.' using errcode = 'P0001';
  end if;

  v_days_late := greatest(1, ceil(extract(epoch from (now() - v_due_at)) / 86400.0)::integer);
  v_late_fee_total := round(greatest(0, coalesce(v_booking.rental_price_per_day, 0)) * v_days_late, 2);
  v_deposit_applied := least(greatest(0, coalesce(v_booking.security_deposit, 0)), v_late_fee_total);
  v_paymongo_due := greatest(0, v_late_fee_total - v_deposit_applied);

  v_deposit_owner := round(v_deposit_applied * 0.70, 2);
  v_deposit_admin := v_deposit_applied - v_deposit_owner;
  v_paymongo_owner := round(v_paymongo_due * 0.70, 2);
  v_paymongo_admin := v_paymongo_due - v_paymongo_owner;

  select profile.id
  into v_admin_id
  from public.profiles profile
  where profile.role = 'admin'
  order by profile.created_at
  limit 1;

  if v_admin_id is null and (v_deposit_admin > 0 or v_paymongo_admin > 0) then
    raise exception 'An administrator payment account is required for late-fee settlement.';
  end if;

  delete from public.payment_transactions transaction
  where transaction.booking_id = v_booking.id
    and transaction.transaction_type in ('late_fee_owner_share', 'late_fee_admin_share');

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
  select v_booking.id,
         v_booking.borrower_id,
         share.payee_id,
         share.transaction_type,
         share.amount,
         share.payment_method,
         share.status,
         share.reference_number,
         now(),
         share.notes
  from (
    values
      (
        v_booking.owner_id,
        'late_fee_owner_share'::public.transaction_type,
        v_deposit_owner,
        'security_deposit'::public.payment_method,
        'recorded'::public.payment_status,
        format('deposit:late_fee:owner:%s', v_booking.id),
        format('Security deposit applied to late fee: %s day(s) overdue. Owner share 70%%.', v_days_late)
      ),
      (
        v_admin_id,
        'late_fee_admin_share'::public.transaction_type,
        v_deposit_admin,
        'security_deposit'::public.payment_method,
        'recorded'::public.payment_status,
        format('deposit:late_fee:admin:%s', v_booking.id),
        format('Security deposit applied to late fee: %s day(s) overdue. Admin share 30%%.', v_days_late)
      ),
      (
        v_booking.owner_id,
        'late_fee_owner_share'::public.transaction_type,
        v_paymongo_owner,
        'paymongo'::public.payment_method,
        'pending'::public.payment_status,
        format('paymongo:late_fee:owner:%s', v_booking.id),
        format('Late-fee balance after security deposit: %s day(s) overdue. Owner share 70%%.', v_days_late)
      ),
      (
        v_admin_id,
        'late_fee_admin_share'::public.transaction_type,
        v_paymongo_admin,
        'paymongo'::public.payment_method,
        'pending'::public.payment_status,
        format('paymongo:late_fee:admin:%s', v_booking.id),
        format('Late-fee balance after security deposit: %s day(s) overdue. Admin share 30%%.', v_days_late)
      )
  ) as share(payee_id, transaction_type, amount, payment_method, status, reference_number, notes)
  where share.amount > 0;

  if v_paymongo_due <= 0 then
    update public.bookings booking
    set status = 'return_pending',
        updated_at = now()
    where booking.id = v_booking.id;
  end if;

  return jsonb_build_object(
    'booking_id', v_booking.id,
    'days_late', v_days_late,
    'deposit_applied', v_deposit_applied,
    'late_fee_total', v_late_fee_total,
    'paymongo_due', v_paymongo_due,
    'refundable_deposit', greatest(0, coalesce(v_booking.security_deposit, 0) - v_deposit_applied),
    'return_pending', v_paymongo_due <= 0
  );
end;
$$;

revoke all on function public.prepare_late_fee_settlement(uuid) from public;
grant execute on function public.prepare_late_fee_settlement(uuid) to authenticated, service_role;

comment on function public.prepare_late_fee_settlement(uuid) is
  'Applies the security deposit to an overdue booking first, records the allocation, and returns only the remaining PayMongo balance.';

-- Normalize the explicitly requested Villanueva demo record to the new
-- deposit-first calculation without touching any other booking.
do $$
declare
  v_booking_id uuid;
begin
  select booking.id
  into v_booking_id
  from public.bookings booking
  join public.nub_student_registry registry
    on registry.auth_user_id = booking.borrower_id
  where lower(btrim(registry.email)) = 'villanuevacam@students.nu-baliwag.edu.ph'
    and booking.borrower_message = '[Borrow Ko ''To demo late-fee seed for villanuevacam]'
  limit 1;

  if v_booking_id is not null then
    perform public.prepare_late_fee_settlement(v_booking_id);
  end if;
end;
$$;

commit;
