create or replace function private.admin_withdrawable_platform_commission(p_admin_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(round(sum(transaction.amount), 2), 0)::numeric
  from public.payment_transactions transaction
  where transaction.payee_id = p_admin_id
    and lower(transaction.status::text) in ('recorded', 'paid', 'completed', 'succeeded', 'settled')
    and (
      lower(transaction.transaction_type::text) in ('platform_fee', 'commission_fee', 'service_fee')
      or lower(coalesce(transaction.notes, '')) like '%platform commission fee%'
    );
$$;

create or replace function public.get_admin_platform_withdrawal_balance()
returns table(gross_earned numeric, reserved numeric, paid_out numeric, available numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Sign in to view platform earnings.';
  end if;
  if not exists (
    select 1 from public.profiles profile
    where profile.id = current_user_id and lower(profile.role::text) = 'admin'
  ) then
    raise exception 'Only admins can view platform earnings.';
  end if;

  gross_earned := private.admin_withdrawable_platform_commission(current_user_id);
  select coalesce(round(sum(withdrawal.amount), 2), 0)::numeric
  into reserved
  from public.earnings_withdrawals withdrawal
  where withdrawal.owner_id = current_user_id
    and withdrawal.status in ('requested', 'processing');
  select coalesce(round(sum(withdrawal.amount), 2), 0)::numeric
  into paid_out
  from public.earnings_withdrawals withdrawal
  where withdrawal.owner_id = current_user_id
    and withdrawal.status = 'paid';
  available := greatest(0, gross_earned - reserved - paid_out);
  return next;
end;
$$;

create or replace function public.request_admin_platform_withdrawal(
  p_amount numeric,
  p_destination_account_name text,
  p_destination_account_number text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_amount numeric(12, 2) := round(p_amount, 2);
  available_amount numeric(12, 2);
  withdrawal_id uuid;
  normalized_account_number text := regexp_replace(coalesce(p_destination_account_number, ''), '[\s-]', '', 'g');
begin
  if current_user_id is null then
    raise exception 'Sign in to request a platform earnings withdrawal.';
  end if;
  if not exists (
    select 1 from public.profiles profile
    where profile.id = current_user_id and lower(profile.role::text) = 'admin'
  ) then
    raise exception 'Only admins can withdraw platform earnings.';
  end if;
  if requested_amount is null or requested_amount < 100 then
    raise exception 'The minimum withdrawal is PHP 100.00.';
  end if;
  if requested_amount > 50000 then
    raise exception 'The maximum withdrawal per InstaPay request is PHP 50,000.00.';
  end if;
  if nullif(btrim(p_destination_account_name), '') is null
    or normalized_account_number !~ '^(\+?63|0)?9[0-9]{9}$' then
    raise exception 'Enter a valid GCash account name and mobile number.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));
  available_amount := private.admin_withdrawable_platform_commission(current_user_id) - coalesce((
    select sum(withdrawal.amount)
    from public.earnings_withdrawals withdrawal
    where withdrawal.owner_id = current_user_id
      and withdrawal.status in ('requested', 'processing', 'paid')
  ), 0);
  if requested_amount > available_amount then
    raise exception 'Requested amount exceeds your available platform earnings of PHP %.',
      to_char(greatest(available_amount, 0), 'FM999999990.00');
  end if;

  insert into public.earnings_withdrawals (
    owner_id, amount, destination_bank_name, destination_bic,
    destination_account_name, destination_account_number
  ) values (
    current_user_id, requested_amount, 'GCash', 'GXCHPHM2XXX',
    btrim(p_destination_account_name), normalized_account_number
  ) returning id into withdrawal_id;
  return withdrawal_id;
end;
$$;

revoke all on function private.admin_withdrawable_platform_commission(uuid) from public, anon, authenticated;
revoke all on function public.get_admin_platform_withdrawal_balance() from public, anon;
revoke all on function public.request_admin_platform_withdrawal(numeric, text, text) from public, anon;
grant execute on function public.get_admin_platform_withdrawal_balance() to authenticated;
grant execute on function public.request_admin_platform_withdrawal(numeric, text, text) to authenticated;

notify pgrst, 'reload schema';
