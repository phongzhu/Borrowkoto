-- Promotions must follow the same NUB category and program eligibility rules
-- as the regular marketplace.

-- Preserve the useful legacy laptop by migrating it into the current catalog.
with laptop_path as (
  select parent.id as category_id, child.id as subcategory_id
  from public.categories parent
  join public.categories child on child.parent_category_id = parent.id
  where parent.parent_category_id is null
    and parent.name = 'Computers and Digital Devices'
    and child.name = 'Laptops'
    and parent.is_active
    and child.is_active
  limit 1
)
update public.items item
set category_id = path.category_id,
    subcategory_id = path.subcategory_id,
    equipment_id = 'laptop',
    applies_to_all_programs = true,
    updated_at = now()
from laptop_path path
where item.id = 'fc1f2431-ad87-4f61-ad78-43f872b94e41'
  and item.title = 'ROG Laptop Strix G15';

delete from public.item_subcategories
where item_id = 'fc1f2431-ad87-4f61-ad78-43f872b94e41';

insert into public.item_subcategories(item_id, subcategory_id)
select item.id, item.subcategory_id
from public.items item
where item.id = 'fc1f2431-ad87-4f61-ad78-43f872b94e41'
  and item.subcategory_id is not null
on conflict do nothing;

-- Butane cassette gas is a consumable outside the approved reusable/lendable
-- catalog. Archive it rather than hard-deleting transaction history.
update public.items
set is_active = false, updated_at = now()
where id = '54aa4a39-0888-4aa5-bc0c-e7fe6b55831e'
  and lower(btrim(title)) = 'can';

create or replace function public.is_item_course_scoped(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.items item
    join public.categories parent
      on parent.id = item.category_id
      and parent.parent_category_id is null
      and parent.is_active
    join public.categories subcategory
      on subcategory.id = item.subcategory_id
      and subcategory.parent_category_id = parent.id
      and subcategory.is_active
    where item.id = p_item_id
      and item.is_active
      and item.status = 'available'
      and (
        item.applies_to_all_programs
        or exists (
          select 1 from public.item_programs item_program
          where item_program.item_id = item.id
        )
      )
  );
$$;

-- Stop any existing open promotion whose listing still lacks valid NUB scope.
update public.item_promotions promotion
set status = 'cancelled', updated_at = now()
where promotion.status in ('pending_payment', 'payment_review', 'active')
  and not public.is_item_course_scoped(promotion.item_id);

create or replace function public.enforce_course_scoped_promotion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('pending_payment', 'payment_review', 'active')
     and not public.is_item_course_scoped(new.item_id) then
    raise exception 'Only active listings with a valid NUB category, subcategory, and applicable program scope can be promoted.';
  end if;
  return new;
end;
$$;

drop trigger if exists item_promotions_course_scope_check on public.item_promotions;
create trigger item_promotions_course_scope_check
before insert or update of item_id, status on public.item_promotions
for each row execute function public.enforce_course_scoped_promotion();

drop policy if exists "Lenders request promotions for own items" on public.item_promotions;
create policy "Lenders request promotions for own items" on public.item_promotions
for insert to authenticated
with check (
  (select auth.uid()) = lender_id
  and public.is_item_course_scoped(item_id)
  and exists (
    select 1 from public.items item
    where item.id = item_id and item.owner_id = (select auth.uid())
  )
  and exists (
    select 1 from public.promotion_plans plan
    where plan.id = plan_id
      and plan.is_active
      and plan.duration_days = duration_days_snapshot
      and plan.fee = fee_snapshot
  )
  and status = 'pending_payment'
);

create or replace view public.active_item_promotions
with (security_invoker = true)
as
select promotion.id,
       promotion.item_id,
       promotion.lender_id,
       promotion.starts_at,
       promotion.ends_at,
       promotion.last_displayed_at
from public.item_promotions promotion
where promotion.status = 'active'
  and promotion.starts_at <= now()
  and promotion.ends_at > now()
  and public.is_item_course_scoped(promotion.item_id);

grant select on public.active_item_promotions to anon, authenticated;

comment on function public.is_item_course_scoped(uuid) is
  'Returns true only for an active, available listing with an active NUB category/subcategory path and explicit program scope.';

notify pgrst, 'reload schema';
