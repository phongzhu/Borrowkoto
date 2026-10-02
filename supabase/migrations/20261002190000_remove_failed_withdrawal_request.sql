-- Remove the failed, unprocessed withdrawal request identified by the owner
-- and request ID. Its reserved amount becomes available again automatically.
delete from public.earnings_withdrawals
where id = 'f6e55530-75e2-410f-b815-ccc42356b203'::uuid
  and owner_id = 'aaa28571-7ee1-4730-936f-01d60f382dd7'::uuid
  and amount = 8487.50
  and status = 'requested'
  and paymongo_transfer_id is null;
