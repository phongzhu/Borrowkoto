begin;

-- Tourism gear is distinct from hospitality and food-preparation equipment.
-- Keep this migration idempotent so it can safely reactivate a previously
-- created category instead of producing a duplicate root category.
with category_seed(name, description, icon_key) as (
  values (
    'Tourism and Travel Equipment',
    'Reusable luggage, travel bags, organizers, tour-guiding gear, adapters, scales, and other tourism equipment.',
    'travel'
  )
)
insert into public.categories(name, description, parent_category_id, is_active, icon_key)
select seed.name, seed.description, null, true, seed.icon_key
from category_seed seed
where not exists (
  select 1
  from public.categories category
  where category.parent_category_id is null
    and lower(btrim(category.name)) = lower(seed.name)
);

with category_seed(name, description, icon_key) as (
  values (
    'Tourism and Travel Equipment',
    'Reusable luggage, travel bags, organizers, tour-guiding gear, adapters, scales, and other tourism equipment.',
    'travel'
  )
)
update public.categories category
set description = seed.description,
    icon_key = seed.icon_key,
    is_active = true
from category_seed seed
where category.parent_category_id is null
  and lower(btrim(category.name)) = lower(seed.name);

with subcategory_seed(name) as (
  values
    ('Suitcases and Luggage'),
    ('Travel Bags and Duffel Bags'),
    ('Backpacks and Daypacks'),
    ('Garment Bags'),
    ('Packing Organizers'),
    ('Travel Adapters'),
    ('Luggage Scales'),
    ('Travel Comfort Accessories'),
    ('Tour-Guiding Equipment'),
    ('Travel Safety Accessories')
), tourism_category as (
  select id, icon_key
  from public.categories
  where parent_category_id is null
    and lower(btrim(name)) = lower('Tourism and Travel Equipment')
  limit 1
)
insert into public.categories(name, description, parent_category_id, is_active, icon_key)
select seed.name,
       'NU Baliwag marketplace classification under Tourism and Travel Equipment.',
       parent.id,
       true,
       parent.icon_key
from subcategory_seed seed
cross join tourism_category parent
where not exists (
  select 1
  from public.categories child
  where child.parent_category_id = parent.id
    and lower(btrim(child.name)) = lower(seed.name)
);

with desired_subcategories(name) as (
  values
    ('Suitcases and Luggage'),
    ('Travel Bags and Duffel Bags'),
    ('Backpacks and Daypacks'),
    ('Garment Bags'),
    ('Packing Organizers'),
    ('Travel Adapters'),
    ('Luggage Scales'),
    ('Travel Comfort Accessories'),
    ('Tour-Guiding Equipment'),
    ('Travel Safety Accessories')
), tourism_category as (
  select id, icon_key
  from public.categories
  where parent_category_id is null
    and lower(btrim(name)) = lower('Tourism and Travel Equipment')
  limit 1
)
update public.categories child
set is_active = true,
    icon_key = parent.icon_key
from desired_subcategories desired
cross join tourism_category parent
where child.parent_category_id = parent.id
  and lower(btrim(child.name)) = lower(desired.name);

do $$
begin
  if not exists (
    select 1
    from public.categories parent
    join public.categories child
      on child.parent_category_id = parent.id
     and child.is_active = true
    where parent.parent_category_id is null
      and parent.is_active = true
      and lower(btrim(parent.name)) = lower('Tourism and Travel Equipment')
  ) then
    raise exception 'Tourism and Travel Equipment must have active subcategories.';
  end if;
end
$$;

commit;
