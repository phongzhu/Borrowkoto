alter table public.item_purchase_requests
  add column if not exists paymongo_livemode boolean;

create or replace function public.set_item_purchase_checkout_session(
  p_request_id uuid,
  p_checkout_session_id text,
  p_livemode boolean
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
      paymongo_livemode = p_livemode,
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

revoke all on function public.set_item_purchase_checkout_session(uuid, text, boolean) from public, anon;
grant execute on function public.set_item_purchase_checkout_session(uuid, text, boolean) to authenticated;

notify pgrst, 'reload schema';
