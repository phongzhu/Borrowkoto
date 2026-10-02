create or replace function public.claim_item_purchase_request(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required.';
  end if;

  update public.item_purchase_requests
  set status = 'completed',
      completed_at = coalesce(completed_at, now()),
      updated_at = now()
  where id = p_request_id
    and buyer_id = (select auth.uid())
    and status in ('paid', 'ready_for_pickup');

  if found then
    return true;
  end if;

  if exists (
    select 1
    from public.item_purchase_requests
    where id = p_request_id
      and buyer_id = (select auth.uid())
      and status = 'completed'
  ) then
    return true;
  end if;

  raise exception 'This purchase cannot be marked as claimed.';
end;
$$;

revoke all on function public.claim_item_purchase_request(uuid) from public, anon;
grant execute on function public.claim_item_purchase_request(uuid) to authenticated;

notify pgrst, 'reload schema';
