alter table public.categories
  add column if not exists icon_key text;

update public.categories
set icon_key = case
  when lower(name) ~ 'appliance' then 'appliance'
  when lower(name) ~ 'baby|kid|child' then 'baby'
  when lower(name) ~ 'photo|camera|video' then 'camera'
  when lower(name) ~ 'electronic|tech' then 'electronics'
  when lower(name) ~ 'fashion|costume|clothing' then 'fashion'
  when lower(name) ~ 'game|entertainment' then 'game'
  when lower(name) ~ 'health|wellness|medical' then 'health'
  when lower(name) ~ 'home|living|furniture' then 'home'
  when lower(name) ~ 'laptop|computer' then 'laptop'
  when lower(name) ~ 'music|instrument' then 'music'
  when lower(name) ~ 'office|school|supply' then 'office'
  when lower(name) ~ 'sport|outdoor' then 'sports'
  when lower(name) ~ 'tool|hardware' then 'tools'
  else 'box'
end
where icon_key is null;

alter table public.categories
  alter column icon_key set default 'box';
