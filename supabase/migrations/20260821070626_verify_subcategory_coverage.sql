do $$
declare
  uncovered_categories text;
begin
  select string_agg(parent.name, ', ' order by parent.name)
  into uncovered_categories
  from public.categories parent
  where parent.parent_category_id is null
    and parent.is_active = true
    and not exists (
      select 1
      from public.categories child
      where child.parent_category_id = parent.id
        and child.is_active = true
    );

  if uncovered_categories is not null then
    raise exception 'Active main categories without active subcategories: %', uncovered_categories;
  end if;
end
$$;
