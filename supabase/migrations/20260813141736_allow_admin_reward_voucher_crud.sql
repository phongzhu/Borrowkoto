-- RLS still limits these operations to profiles with the admin role.
grant insert, update, delete on table public.reward_voucher_catalog to authenticated;
