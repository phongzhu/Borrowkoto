alter table public.item_purchase_requests
  add column if not exists commission_fee_snapshot numeric(12, 2) not null default 0;

comment on column public.item_purchase_requests.commission_fee_snapshot is
  'The 15 percent marketplace commission captured when the purchase amount is calculated.';

create or replace function public.set_item_purchase_request_totals()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_quantity integer;
  v_subtotal numeric(12, 2);
begin
  v_quantity := greatest(1, coalesce(new.seller_approved_quantity, new.buyer_requested_quantity, 1));
  v_subtotal := round(
    coalesce(new.sale_price_snapshot, 0) * v_quantity
      + coalesce(new.addon_total_amount_snapshot, 0),
    2
  );

  new.commission_fee_snapshot := round(v_subtotal * 0.15, 2);
  new.sale_total_amount_snapshot := round(v_subtotal + new.commission_fee_snapshot, 2);
  return new;
end;
$$;

drop trigger if exists set_item_purchase_request_totals_trigger
  on public.item_purchase_requests;

create trigger set_item_purchase_request_totals_trigger
before insert or update of
  sale_price_snapshot,
  seller_approved_quantity,
  buyer_requested_quantity,
  addon_total_amount_snapshot
on public.item_purchase_requests
for each row
execute function public.set_item_purchase_request_totals();

-- Recalculate only unpaid requests. Completed payments retain their historical amount.
update public.item_purchase_requests
set addon_total_amount_snapshot = coalesce(addon_total_amount_snapshot, 0)
where lower(status::text) in ('pending', 'approved', 'awaiting_payment');
