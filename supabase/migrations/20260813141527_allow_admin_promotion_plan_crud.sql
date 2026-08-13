-- RLS still limits these operations to profiles with the admin role.
grant insert, update, delete on table public.promotion_plans to authenticated;
