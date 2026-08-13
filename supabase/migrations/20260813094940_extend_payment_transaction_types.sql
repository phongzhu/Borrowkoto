alter type public.transaction_type add value if not exists 'rental_fee_payment';
alter type public.transaction_type add value if not exists 'security_deposit_payment';
alter type public.transaction_type add value if not exists 'platform_fee';
alter type public.transaction_type add value if not exists 'purchase_payment';
alter type public.transaction_type add value if not exists 'deposit_return';
alter type public.transaction_type add value if not exists 'damage_payment';
alter type public.transaction_type add value if not exists 'late_fee_owner_share';
alter type public.transaction_type add value if not exists 'late_fee_admin_share';
