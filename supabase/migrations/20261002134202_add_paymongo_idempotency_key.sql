alter table public.earnings_withdrawals
  add column if not exists paymongo_idempotency_key text;
