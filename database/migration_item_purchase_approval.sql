create or replace function public.approve_item_purchase_request(
  p_request_id uuid,
  p_approved_quantity integer,
  p_agreed_pickup_at timestamp with time zone default null,
  p_pickup_location_text text default null,
  p_seller_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.item_purchase_requests%rowtype;
  v_item public.items%rowtype;
  v_remaining_quantity integer;
begin
  if p_approved_quantity < 1 then
    raise exception 'Approved quantity must be at least 1.';
  end if;

  select *
    into v_request
  from public.item_purchase_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Purchase request not found.';
  end if;

  if v_request.seller_id <> auth.uid() then
    raise exception 'You are not allowed to approve this purchase request.';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Only pending purchase requests can be approved.';
  end if;

  if p_approved_quantity > v_request.buyer_requested_quantity then
    raise exception 'Approved quantity cannot be greater than requested quantity.';
  end if;

  select *
    into v_item
  from public.items
  where id = v_request.item_id
  for update;

  if not found then
    raise exception 'Item not found.';
  end if;

  if v_item.owner_id <> auth.uid() then
    raise exception 'You are not the owner of this item.';
  end if;

  if v_item.is_for_sale is not true then
    raise exception 'This item is no longer for sale.';
  end if;

  if coalesce(v_item.quantity, 0) < p_approved_quantity then
    raise exception 'Not enough available quantity.';
  end if;

  v_remaining_quantity := v_item.quantity - p_approved_quantity;

  update public.items
  set
    quantity = v_remaining_quantity,
    is_for_sale = case when v_remaining_quantity > 0 then true else false end,
    status = case when v_remaining_quantity > 0 then status else 'unavailable' end,
    is_active = case when v_remaining_quantity > 0 then is_active else false end,
    updated_at = now()
  where id = v_item.id;

  update public.item_purchase_requests
  set
    seller_approved_quantity = p_approved_quantity,
    sale_total_amount_snapshot = sale_price_snapshot * p_approved_quantity,
    agreed_pickup_at = p_agreed_pickup_at,
    pickup_location_text = p_pickup_location_text,
    seller_notes = p_seller_notes,
    status = 'awaiting_payment',
    reviewed_at = now(),
    updated_at = now()
  where id = p_request_id;
end;
$$;

grant execute on function public.approve_item_purchase_request(
  uuid,
  integer,
  timestamp with time zone,
  text,
  text
) to authenticated;
