alter table public.item_purchase_requests
  add column if not exists addon_total_amount_snapshot numeric(12, 2) not null default 0;

create table if not exists public.item_purchase_request_addons (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.item_purchase_requests(id) on delete cascade,
  item_addon_id uuid references public.item_addons(id) on delete set null,
  addon_name_snapshot text not null,
  description_snapshot text,
  image_url_snapshot text,
  price_snapshot numeric(12, 2) not null check (price_snapshot >= 0),
  quantity integer not null check (quantity >= 1),
  total_amount numeric(12, 2) not null check (total_amount >= 0),
  is_required boolean not null default false,
  created_at timestamptz not null default now(),
  unique (purchase_request_id, item_addon_id)
);

create index if not exists item_purchase_request_addons_request_idx
  on public.item_purchase_request_addons (purchase_request_id);

alter table public.item_purchase_request_addons enable row level security;

drop policy if exists "Purchase participants read request add-ons" on public.item_purchase_request_addons;
create policy "Purchase participants read request add-ons"
on public.item_purchase_request_addons for select
to authenticated
using (
  exists (
    select 1
    from public.item_purchase_requests request
    where request.id = purchase_request_id
      and auth.uid() in (request.buyer_id, request.seller_id)
  )
  or exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and lower(profile.role::text) = 'admin'
  )
);

drop policy if exists "Admins manage purchase request add-ons" on public.item_purchase_request_addons;
create policy "Admins manage purchase request add-ons"
on public.item_purchase_request_addons for all
to authenticated
using (
  exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and lower(profile.role::text) = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and lower(profile.role::text) = 'admin'
  )
);

alter table public.terms_acceptances
  add column if not exists purchase_request_id uuid references public.item_purchase_requests(id) on delete set null;

create index if not exists terms_acceptances_purchase_request_idx
  on public.terms_acceptances (purchase_request_id);

create or replace function public.create_item_purchase_checkout(
  p_item_id uuid,
  p_quantity integer,
  p_preferred_pickup_at timestamptz,
  p_terms_document_id uuid,
  p_buyer_message text default null,
  p_addons jsonb default '[]'::jsonb
)
returns table (
  request_id uuid,
  sale_price numeric,
  main_total numeric,
  addon_total numeric,
  total_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_addon public.item_addons%rowtype;
  v_addon_entry jsonb;
  v_addon_quantity integer;
  v_addon_total numeric(12, 2) := 0;
  v_buyer_id uuid := auth.uid();
  v_item public.items%rowtype;
  v_main_total numeric(12, 2);
  v_remaining integer;
  v_request_id uuid;
  v_total numeric(12, 2);
begin
  if v_buyer_id is null then
    raise exception 'Sign in before purchasing an item.';
  end if;

  if p_quantity is null or p_quantity < 1 then
    raise exception 'Purchase quantity must be at least 1.';
  end if;

  if p_preferred_pickup_at is null or p_preferred_pickup_at <= now() then
    raise exception 'Choose a preferred pickup date and time in the future.';
  end if;

  if p_addons is null then
    p_addons := '[]'::jsonb;
  end if;

  if jsonb_typeof(p_addons) <> 'array' then
    raise exception 'Purchase add-ons must be an array.';
  end if;

  if exists (
    select 1
    from (
      select entry ->> 'addon_id' as addon_id
      from jsonb_array_elements(p_addons) entry
      group by entry ->> 'addon_id'
      having count(*) > 1
    ) duplicate_addon
  ) then
    raise exception 'The same add-on cannot be selected more than once.';
  end if;

  if not exists (
    select 1 from public.terms_documents document
    where document.id = p_terms_document_id and document.is_active
  ) then
    raise exception 'Review and accept the current Terms and Conditions.';
  end if;

  select * into v_item
  from public.items
  where id = p_item_id
  for update;

  if not found then
    raise exception 'The item could not be found.';
  end if;

  if v_item.owner_id = v_buyer_id then
    raise exception 'You cannot purchase your own listing.';
  end if;

  if v_item.is_active is not true
     or v_item.is_for_sale is not true
     or coalesce(v_item.sale_price, 0) <= 0 then
    raise exception 'This listing is not available for purchase.';
  end if;

  if not exists (
    select 1 from public.profiles owner_profile
    where owner_profile.id = v_item.owner_id
      and lower(coalesce(owner_profile.account_status::text, 'inactive')) = 'active'
  ) then
    raise exception 'This seller account is not active.';
  end if;

  if coalesce(v_item.quantity, 0) < p_quantity then
    raise exception 'The requested quantity is no longer available.';
  end if;

  if exists (
    select 1 from public.item_purchase_requests active_request
    where active_request.item_id = p_item_id
      and active_request.buyer_id = v_buyer_id
      and lower(active_request.status::text) in ('pending', 'approved', 'awaiting_payment', 'paid', 'ready_for_pickup')
  ) then
    raise exception 'You already have an active purchase request for this item.';
  end if;

  if exists (
    select 1
    from public.item_addons required_addon
    where required_addon.item_id = p_item_id
      and required_addon.is_active
      and required_addon.is_required
      and not exists (
        select 1 from jsonb_array_elements(p_addons) selected_addon
        where selected_addon ->> 'addon_id' = required_addon.id::text
      )
  ) then
    raise exception 'Every required add-on must be included.';
  end if;

  v_main_total := round(v_item.sale_price * p_quantity, 2);

  insert into public.item_purchase_requests (
    buyer_id,
    buyer_message,
    buyer_preferred_pickup_at,
    buyer_requested_quantity,
    agreed_pickup_at,
    item_id,
    pickup_location_text,
    sale_inclusions_snapshot,
    sale_price_snapshot,
    seller_approved_quantity,
    sale_total_amount_snapshot,
    seller_id,
    status
  ) values (
    v_buyer_id,
    nullif(trim(coalesce(p_buyer_message, '')), ''),
    p_preferred_pickup_at,
    p_quantity,
    p_preferred_pickup_at,
    v_item.id,
    nullif(concat_ws(', ', v_item.pickup_street, v_item.pickup_barangay, v_item.pickup_city, v_item.pickup_province, v_item.pickup_region, v_item.pickup_country), ''),
    v_item.sale_inclusions,
    v_item.sale_price,
    p_quantity,
    v_main_total,
    v_item.owner_id,
    'awaiting_payment'
  ) returning id into v_request_id;

  for v_addon_entry in select value from jsonb_array_elements(p_addons)
  loop
    begin
      v_addon_quantity := (v_addon_entry ->> 'quantity')::integer;
    exception when others then
      raise exception 'Every add-on quantity must be a whole number.';
    end;

    if v_addon_quantity < 1 then
      raise exception 'Every add-on quantity must be at least 1.';
    end if;

    select * into v_addon
    from public.item_addons
    where id = (v_addon_entry ->> 'addon_id')::uuid
      and item_id = p_item_id
    for update;

    if not found or v_addon.is_active is not true then
      raise exception 'A selected add-on is no longer available.';
    end if;

    if coalesce(v_addon.quantity, 0) < v_addon_quantity then
      raise exception '% only has % available.', v_addon.addon_name, coalesce(v_addon.quantity, 0);
    end if;

    v_addon_total := v_addon_total + round(v_addon.price * v_addon_quantity, 2);

    insert into public.item_purchase_request_addons (
      purchase_request_id,
      item_addon_id,
      addon_name_snapshot,
      description_snapshot,
      image_url_snapshot,
      price_snapshot,
      quantity,
      total_amount,
      is_required
    ) values (
      v_request_id,
      v_addon.id,
      v_addon.addon_name,
      v_addon.description,
      v_addon.image_url,
      v_addon.price,
      v_addon_quantity,
      round(v_addon.price * v_addon_quantity, 2),
      v_addon.is_required
    );

    update public.item_addons
    set
      quantity = quantity - v_addon_quantity,
      is_active = (quantity - v_addon_quantity) > 0,
      updated_at = now()
    where id = v_addon.id;
  end loop;

  v_addon_total := round(v_addon_total, 2);
  v_total := round(v_main_total + v_addon_total, 2);
  v_remaining := v_item.quantity - p_quantity;

  update public.item_purchase_requests
  set
    addon_total_amount_snapshot = v_addon_total,
    sale_total_amount_snapshot = v_total,
    updated_at = now()
  where id = v_request_id;

  update public.items
  set
    quantity = v_remaining,
    is_for_sale = case when v_remaining > 0 then is_for_sale else false end,
    status = case when v_remaining > 0 then status else 'unavailable' end,
    is_active = case when v_remaining > 0 then is_active else false end,
    updated_at = now()
  where id = v_item.id;

  insert into public.terms_acceptances (
    terms_document_id,
    user_id,
    acceptance_context,
    item_id,
    purchase_request_id,
    user_agent
  ) values (
    p_terms_document_id,
    v_buyer_id,
    'checkout',
    v_item.id,
    v_request_id,
    null
  );

  return query select v_request_id, v_item.sale_price, v_main_total, v_addon_total, v_total;
end;
$$;

revoke all on function public.create_item_purchase_checkout(uuid, integer, timestamptz, uuid, text, jsonb) from public;
grant execute on function public.create_item_purchase_checkout(uuid, integer, timestamptz, uuid, text, jsonb) to authenticated;

create or replace function public.cancel_item_purchase_checkout(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_addon_record record;
  v_item public.items%rowtype;
  v_request public.item_purchase_requests%rowtype;
begin
  select * into v_request
  from public.item_purchase_requests
  where id = p_request_id
  for update;

  if not found then
    return;
  end if;

  if v_request.buyer_id <> auth.uid() then
    raise exception 'You cannot cancel this purchase checkout.';
  end if;

  if lower(v_request.status::text) <> 'awaiting_payment' then
    return;
  end if;

  select * into v_item
  from public.items
  where id = v_request.item_id
  for update;

  if found then
    update public.items
    set
      quantity = coalesce(quantity, 0) + coalesce(v_request.seller_approved_quantity, v_request.buyer_requested_quantity, 0),
      is_for_sale = true,
      status = case when lower(status::text) = 'unavailable' then 'available' else status end,
      is_active = true,
      updated_at = now()
    where id = v_item.id;
  end if;

  for v_addon_record in
    select item_addon_id, quantity
    from public.item_purchase_request_addons
    where purchase_request_id = p_request_id and item_addon_id is not null
  loop
    update public.item_addons
    set
      quantity = coalesce(quantity, 0) + v_addon_record.quantity,
      is_active = true,
      updated_at = now()
    where id = v_addon_record.item_addon_id;
  end loop;

  update public.item_purchase_requests
  set status = 'cancelled', updated_at = now()
  where id = p_request_id;
end;
$$;

revoke all on function public.cancel_item_purchase_checkout(uuid) from public;
grant execute on function public.cancel_item_purchase_checkout(uuid) to authenticated;

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
  if p_approved_quantity < 1 then raise exception 'Approved quantity must be at least 1.'; end if;

  select * into v_request from public.item_purchase_requests where id = p_request_id for update;
  if not found then raise exception 'Purchase request not found.'; end if;
  if v_request.seller_id <> auth.uid() then raise exception 'You are not allowed to approve this purchase request.'; end if;
  if lower(v_request.status::text) <> 'pending' then raise exception 'Only pending purchase requests can be approved.'; end if;
  if p_approved_quantity > v_request.buyer_requested_quantity then raise exception 'Approved quantity cannot be greater than requested quantity.'; end if;

  select * into v_item from public.items where id = v_request.item_id for update;
  if not found then raise exception 'Item not found.'; end if;
  if v_item.owner_id <> auth.uid() then raise exception 'You are not the owner of this item.'; end if;
  if v_item.is_for_sale is not true then raise exception 'This item is no longer for sale.'; end if;
  if coalesce(v_item.quantity, 0) < p_approved_quantity then raise exception 'Not enough available quantity.'; end if;

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
    sale_total_amount_snapshot = round(sale_price_snapshot * p_approved_quantity + coalesce(addon_total_amount_snapshot, 0), 2),
    agreed_pickup_at = p_agreed_pickup_at,
    pickup_location_text = p_pickup_location_text,
    seller_notes = p_seller_notes,
    status = 'awaiting_payment',
    reviewed_at = now(),
    updated_at = now()
  where id = p_request_id;
end;
$$;

grant execute on function public.approve_item_purchase_request(uuid, integer, timestamptz, text, text) to authenticated;
