create table if not exists public.earnings_withdrawals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  destination_bank_name text not null,
  destination_bic text not null,
  destination_account_name text not null,
  destination_account_number text not null,
  status text not null default 'requested'
    check (status in ('requested', 'processing', 'paid', 'failed', 'rejected')),
  paymongo_batch_transfer_id text,
  paymongo_transfer_id text,
  paymongo_status text,
  admin_note text,
  processed_by uuid references public.profiles(id) on delete set null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists earnings_withdrawals_owner_created_idx
  on public.earnings_withdrawals(owner_id, created_at desc);
create index if not exists earnings_withdrawals_status_created_idx
  on public.earnings_withdrawals(status, created_at asc);

alter table public.earnings_withdrawals enable row level security;

drop policy if exists "Owners read own earnings withdrawals" on public.earnings_withdrawals;
create policy "Owners read own earnings withdrawals"
  on public.earnings_withdrawals for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Admins read earnings withdrawals" on public.earnings_withdrawals;
create policy "Admins read earnings withdrawals"
  on public.earnings_withdrawals for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and lower(p.role::text) = 'admin'
    )
  );

drop policy if exists "Admins update earnings withdrawals" on public.earnings_withdrawals;
create policy "Admins update earnings withdrawals"
  on public.earnings_withdrawals for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and lower(p.role::text) = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and lower(p.role::text) = 'admin'
    )
  );

revoke all on table public.earnings_withdrawals from public, anon, authenticated, service_role;
grant select, update on table public.earnings_withdrawals to authenticated, service_role;

create or replace function private.owner_withdrawable_rental_earnings(p_owner_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(round(sum(transaction.amount), 2), 0)::numeric
  from public.payment_transactions transaction
  join public.bookings booking on booking.id = transaction.booking_id
  where transaction.payee_id = p_owner_id
    and booking.owner_id = p_owner_id
    and lower(booking.status::text) in ('completed', 'returned', 'done', 'closed')
    and lower(transaction.status::text) in ('recorded', 'paid', 'completed', 'succeeded', 'settled')
    and (
      lower(transaction.transaction_type::text) in ('rental_fee_payment', 'rental_payment', 'rent_payment')
      or (
        lower(transaction.transaction_type::text) = 'payment'
        and lower(coalesce(transaction.notes, '')) like 'rental fee payment for %'
      )
    );
$$;

create or replace function public.get_earnings_withdrawal_balance()
returns table(gross_earned numeric, reserved numeric, paid_out numeric, available numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Sign in to view withdrawable earnings.';
  end if;

  gross_earned := private.owner_withdrawable_rental_earnings(current_user_id);
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

create or replace function public.request_earnings_withdrawal(
  p_amount numeric,
  p_destination_bank_name text,
  p_destination_bic text,
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
begin
  if current_user_id is null then
    raise exception 'Sign in to request a withdrawal.';
  end if;
  if requested_amount is null or requested_amount < 100 then
    raise exception 'The minimum withdrawal is PHP 100.00.';
  end if;
  if requested_amount > 50000 then
    raise exception 'The maximum withdrawal per InstaPay request is PHP 50,000.00.';
  end if;
  if nullif(btrim(p_destination_bank_name), '') is null
    or nullif(btrim(p_destination_bic), '') is null
    or nullif(btrim(p_destination_account_name), '') is null
    or nullif(regexp_replace(coalesce(p_destination_account_number, ''), '\s', '', 'g'), '') is null then
    raise exception 'Enter your GCash account name and mobile number.';
  end if;
  if upper(btrim(p_destination_bank_name)) <> 'GCASH'
    or upper(btrim(p_destination_bic)) <> 'GXCHPHM2XXX' then
    raise exception 'Withdrawals are currently available to GCash accounts only.';
  end if;
  if regexp_replace(p_destination_account_number, '[\s-]', '', 'g') !~ '^(\+?63|0)?9[0-9]{9}$' then
    raise exception 'Enter a valid GCash mobile number.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));

  available_amount := private.owner_withdrawable_rental_earnings(current_user_id) - coalesce((
    select sum(withdrawal.amount)
    from public.earnings_withdrawals withdrawal
    where withdrawal.owner_id = current_user_id
      and withdrawal.status in ('requested', 'processing', 'paid')
  ), 0);

  if requested_amount > available_amount then
    raise exception 'Requested amount exceeds your available balance of PHP %.', to_char(greatest(available_amount, 0), 'FM999999990.00');
  end if;

  insert into public.earnings_withdrawals (
    amount,
    destination_account_name,
    destination_account_number,
    destination_bank_name,
    destination_bic,
    owner_id
  ) values (
    requested_amount,
    btrim(p_destination_account_name),
    regexp_replace(p_destination_account_number, '[\s-]', '', 'g'),
    'GCash',
    'GXCHPHM2XXX',
    current_user_id
  ) returning id into withdrawal_id;

  return withdrawal_id;
end;
$$;

revoke all on function private.owner_withdrawable_rental_earnings(uuid) from public, anon, authenticated;
revoke all on function public.get_earnings_withdrawal_balance() from public, anon;
revoke all on function public.request_earnings_withdrawal(numeric, text, text, text, text) from public, anon;
grant execute on function public.get_earnings_withdrawal_balance() to authenticated;
grant execute on function public.request_earnings_withdrawal(numeric, text, text, text, text) to authenticated;
grant select, update on table public.earnings_withdrawals to authenticated;

comment on table public.earnings_withdrawals is
  'Owner withdrawal requests. The borrower starts a test-mode PayMongo transfer immediately; pending transfers reserve available earnings.';
comment on column public.earnings_withdrawals.destination_account_number is
  'Sensitive payout destination; visible only to the owner and admins under row-level security.';
