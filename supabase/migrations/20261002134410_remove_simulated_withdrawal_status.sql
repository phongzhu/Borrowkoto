alter table public.earnings_withdrawals
  drop constraint if exists earnings_withdrawals_status_check;

alter table public.earnings_withdrawals
  add constraint earnings_withdrawals_status_check
  check (status in ('requested', 'processing', 'paid', 'failed', 'rejected'));
