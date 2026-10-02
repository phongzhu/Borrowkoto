alter table public.payment_transactions
  alter column booking_id drop not null,
  add column if not exists purchase_request_id uuid
    references public.item_purchase_requests(id) on delete set null;

create index if not exists payment_transactions_purchase_request_idx
  on public.payment_transactions (purchase_request_id)
  where purchase_request_id is not null;

create unique index if not exists payment_transactions_purchase_type_uidx
  on public.payment_transactions (purchase_request_id, transaction_type);

alter table public.item_purchase_requests
  add column if not exists paymongo_checkout_session_id text;

create or replace function public.set_item_purchase_checkout_session(
  p_request_id uuid,
  p_checkout_session_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if nullif(btrim(p_checkout_session_id), '') is null then
    raise exception 'A PayMongo checkout session ID is required.';
  end if;

  update public.item_purchase_requests
  set paymongo_checkout_session_id = btrim(p_checkout_session_id),
      updated_at = now()
  where id = p_request_id
    and buyer_id = auth.uid()
    and status in ('pending', 'approved', 'awaiting_payment')
    and (paymongo_checkout_session_id is null or paymongo_checkout_session_id = btrim(p_checkout_session_id));

  if not found then
    raise exception 'The purchase request cannot be linked to this checkout session.';
  end if;
end;
$$;

revoke all on function public.set_item_purchase_checkout_session(uuid, text) from public, anon;
grant execute on function public.set_item_purchase_checkout_session(uuid, text) to authenticated;

notify pgrst, 'reload schema';
