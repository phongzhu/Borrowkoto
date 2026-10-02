begin;

-- A booking may have multiple rejected damage claim attempts, but only one
-- claim that has not been rejected at a time.
alter table public.damage_claims
  drop constraint if exists uq_damage_claims_booking_id;

drop index if exists public.uq_damage_claims_booking_id;

create unique index if not exists uq_damage_claims_booking_id
  on public.damage_claims (booking_id)
  where status <> 'rejected';

commit;
