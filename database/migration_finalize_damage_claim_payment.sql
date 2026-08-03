-- ============================================================================
-- Finalize Damage Claim Payment (Borrower-safe RPC)
-- ============================================================================
-- Why:
-- - Borrowers can insert payment_transactions, but many deployments keep
--   damage_claims UPDATE as admin-only via RLS.
-- - This RPC lets the borrower complete their own paid damage claim safely,
--   then the existing trigger lifts the active damage_hold restriction.
-- ============================================================================

create or replace function public.finalize_damage_claim_payment(
  p_damage_claim_id uuid,
  p_payment_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.damage_claims%rowtype;
  v_payment_id uuid;
begin
  if p_damage_claim_id is null then
    raise exception 'Damage claim ID is required.';
  end if;

  select *
    into v_claim
  from public.damage_claims
  where id = p_damage_claim_id
  for update;

  if not found then
    raise exception 'Damage claim not found.';
  end if;

  if v_claim.borrower_id <> auth.uid() then
    raise exception 'You are not allowed to finalize this damage claim.';
  end if;

  if v_claim.status in ('paid', 'waived', 'resolved', 'rejected') then
    return jsonb_build_object(
      'already_settled', true,
      'damage_claim_id', v_claim.id,
      'status', v_claim.status
    );
  end if;

  if v_claim.status not in ('approved', 'awaiting_payment') then
    raise exception 'Damage claim is not in a payable state.';
  end if;

  select pt.id
    into v_payment_id
  from public.payment_transactions pt
  where pt.damage_claim_id = p_damage_claim_id
    and pt.payer_id = auth.uid()
    and (p_payment_reference is null or pt.reference_number = p_payment_reference)
  order by pt.transaction_at desc nulls last
  limit 1
  for update;

  if not found then
    raise exception 'No matching damage payment transaction was found.';
  end if;

  update public.payment_transactions
  set
    status = 'recorded',
    transaction_at = now()
  where id = v_payment_id;

  update public.damage_claims
  set
    amount_due = 0,
    status = 'paid',
    resolved_at = now(),
    resolved_by = auth.uid(),
    resolution_notes = coalesce(resolution_notes, 'Paid by borrower via checkout.')
  where id = p_damage_claim_id;

  return jsonb_build_object(
    'already_settled', false,
    'damage_claim_id', p_damage_claim_id,
    'payment_transaction_id', v_payment_id,
    'status', 'paid'
  );
end;
$$;

grant execute on function public.finalize_damage_claim_payment(uuid, text) to authenticated;

