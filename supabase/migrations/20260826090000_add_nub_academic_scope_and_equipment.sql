-- Restrict the marketplace catalog and membership model to NU Baliwag students.

create table if not exists public.nub_schools (
  code text primary key,
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.nub_programs (
  code text primary key,
  display_code text not null,
  school_code text not null references public.nub_schools(code),
  name text not null unique,
  specializations text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.nub_schools(code, name) values
  ('SET', 'School of Engineering and Technology'),
  ('SBA', 'School of Business and Accountancy'),
  ('SEAS', 'School of Education, Arts and Sciences'),
  ('STHM', 'School of Tourism and Hospitality Management'),
  ('SOA', 'School of Architecture')
on conflict (code) do update set name = excluded.name, is_active = true;

insert into public.nub_programs(code, display_code, school_code, name, specializations) values
  ('BSCE', 'BSCE', 'SET', 'Bachelor of Science in Civil Engineering', '{}'),
  ('BSIT', 'BSIT', 'SET', 'Bachelor of Science in Information Technology', array['Mobile and Web Applications']),
  ('BSCPE', 'BSCpE', 'SET', 'Bachelor of Science in Computer Engineering', '{}'),
  ('BSA', 'BSA', 'SBA', 'Bachelor of Science in Accountancy', '{}'),
  ('BSMA', 'BSMA', 'SBA', 'Bachelor of Science in Management Accounting', '{}'),
  ('BSBA-FM', 'BSBA-FM', 'SBA', 'Bachelor of Science in Business Administration, Major in Financial Management', '{}'),
  ('BSBA-MM', 'BSBA-MM', 'SBA', 'Bachelor of Science in Business Administration, Major in Marketing Management', '{}'),
  ('BPED', 'BPEd', 'SEAS', 'Bachelor of Physical Education', '{}'),
  ('BSPSYCH', 'BSPsych', 'SEAS', 'Bachelor of Science in Psychology', '{}'),
  ('ABELS', 'ABELS', 'SEAS', 'Bachelor of Arts in English Language Studies', '{}'),
  ('BSHM', 'BSHM', 'STHM', 'Bachelor of Science in Hospitality Management', '{}'),
  ('BSTM', 'BSTM', 'STHM', 'Bachelor of Science in Tourism Management', '{}'),
  ('BSARCH', 'BSArch', 'SOA', 'Bachelor of Science in Architecture', '{}')
on conflict (code) do update set
  display_code = excluded.display_code,
  school_code = excluded.school_code,
  name = excluded.name,
  specializations = excluded.specializations,
  is_active = true;

create table if not exists public.equipment_catalog (
  slug text primary key,
  name text not null unique,
  is_universal boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.equipment_school_access (
  equipment_slug text not null references public.equipment_catalog(slug) on delete cascade,
  school_code text not null references public.nub_schools(code) on delete cascade,
  primary key (equipment_slug, school_code)
);

create table if not exists public.equipment_program_access (
  equipment_slug text not null references public.equipment_catalog(slug) on delete cascade,
  program_code text not null references public.nub_programs(code) on delete cascade,
  primary key (equipment_slug, program_code)
);

insert into public.equipment_catalog(slug, name, is_universal) values
  ('laptop', 'Laptop', true),
  ('tablet', 'Tablet', true),
  ('projector', 'Projector', true),
  ('portable-projector-screen', 'Portable projector screen', true),
  ('hdmi-cable', 'HDMI cable', true),
  ('vga-cable', 'VGA cable', true),
  ('usb-c-display-adapter', 'USB-C display adapter', true),
  ('extension-cord', 'Extension cord', true),
  ('power-strip', 'Power strip', true),
  ('flash-drive', 'Flash drive', true),
  ('external-hard-drive', 'External hard drive', true),
  ('printer', 'Printer', true),
  ('scanner', 'Scanner', true),
  ('webcam', 'Webcam', true),
  ('digital-camera', 'Digital camera', true),
  ('tripod', 'Tripod', true),
  ('ring-light', 'Ring light', true),
  ('microphone', 'Microphone', true),
  ('portable-speaker', 'Portable speaker', true),
  ('scientific-calculator', 'Scientific calculator', true),
  ('lan-cable', 'LAN cable', false),
  ('crimping-tool', 'Crimping tool', false),
  ('lan-cable-tester', 'LAN cable tester', false),
  ('router', 'Router', false),
  ('network-switch', 'Network switch', false),
  ('screwdriver-set', 'Screwdriver set', false),
  ('computer-repair-toolkit', 'Computer repair toolkit', false),
  ('multimeter', 'Multimeter', false),
  ('soldering-iron', 'Soldering iron', false),
  ('breadboard', 'Breadboard', false),
  ('jumper-wires', 'Jumper wires', false),
  ('microcontroller-board', 'Microcontroller board', false),
  ('electronic-sensors', 'Electronic sensors', false),
  ('motors', 'Motors', false),
  ('surveying-equipment', 'Surveying equipment', false),
  ('concrete-testing-equipment', 'Concrete-testing equipment', false),
  ('soil-testing-equipment', 'Soil-testing equipment', false),
  ('safety-helmet', 'Safety helmet', false),
  ('safety-vest', 'Safety vest', false),
  ('basic-calculator', 'Basic calculator', false),
  ('financial-calculator', 'Financial calculator', false),
  ('voice-recorder', 'Voice recorder', false),
  ('stopwatch', 'Stopwatch', false),
  ('psychological-testing-kit', 'Psychological testing kit', false),
  ('sports-balls', 'Sports balls', false),
  ('rackets-and-paddles', 'Rackets and paddles', false),
  ('cones', 'Cones', false),
  ('hurdles', 'Hurdles', false),
  ('whistle', 'Whistle', false),
  ('exercise-equipment', 'Exercise equipment', false),
  ('first-aid-kit', 'First-aid kit', false),
  ('kitchen-knife-set', 'Kitchen knife set', false),
  ('cookware', 'Cookware', false),
  ('baking-tools', 'Baking tools', false),
  ('measuring-cups-and-spoons', 'Measuring cups and spoons', false),
  ('food-weighing-scale', 'Food-weighing scale', false),
  ('plates', 'Plates', false),
  ('glassware', 'Glassware', false),
  ('serving-utensils', 'Serving utensils', false),
  ('portable-stove', 'Portable stove', false),
  ('camera', 'Camera', false),
  ('t-square', 'T-square', false),
  ('triangular-ruler', 'Triangular ruler', false),
  ('architects-scale', 'Architect''s scale', false),
  ('compass', 'Compass', false),
  ('protractor', 'Protractor', false),
  ('drafting-board', 'Drafting board', false),
  ('technical-pen-set', 'Technical pen set', false),
  ('cutting-mat', 'Cutting mat', false),
  ('utility-knife', 'Utility knife', false),
  ('measuring-tape', 'Measuring tape', false)
on conflict (slug) do update set name = excluded.name, is_universal = excluded.is_universal, is_active = true, updated_at = now();

-- Universal equipment is explicitly associated with every school.
insert into public.equipment_school_access(equipment_slug, school_code)
select equipment.slug, school.code
from public.equipment_catalog equipment
cross join public.nub_schools school
where equipment.is_universal
on conflict do nothing;

insert into public.equipment_school_access(equipment_slug, school_code) values
  ('lan-cable', 'SET'), ('crimping-tool', 'SET'), ('lan-cable-tester', 'SET'),
  ('router', 'SET'), ('network-switch', 'SET'), ('screwdriver-set', 'SET'),
  ('computer-repair-toolkit', 'SET'), ('multimeter', 'SET'), ('soldering-iron', 'SET'),
  ('breadboard', 'SET'), ('jumper-wires', 'SET'), ('microcontroller-board', 'SET'),
  ('electronic-sensors', 'SET'), ('motors', 'SET'), ('surveying-equipment', 'SET'),
  ('concrete-testing-equipment', 'SET'), ('soil-testing-equipment', 'SET'),
  ('safety-helmet', 'SET'), ('safety-vest', 'SET'),
  ('basic-calculator', 'SBA'), ('financial-calculator', 'SBA'),
  ('voice-recorder', 'SEAS'), ('stopwatch', 'SEAS'), ('psychological-testing-kit', 'SEAS'),
  ('sports-balls', 'SEAS'), ('rackets-and-paddles', 'SEAS'), ('cones', 'SEAS'),
  ('hurdles', 'SEAS'), ('whistle', 'SEAS'), ('exercise-equipment', 'SEAS'),
  ('first-aid-kit', 'SEAS'),
  ('kitchen-knife-set', 'STHM'), ('cookware', 'STHM'), ('baking-tools', 'STHM'),
  ('measuring-cups-and-spoons', 'STHM'), ('food-weighing-scale', 'STHM'),
  ('plates', 'STHM'), ('glassware', 'STHM'), ('serving-utensils', 'STHM'),
  ('portable-stove', 'STHM'), ('camera', 'STHM'),
  ('t-square', 'SOA'), ('triangular-ruler', 'SOA'), ('architects-scale', 'SOA'),
  ('compass', 'SOA'), ('protractor', 'SOA'), ('drafting-board', 'SOA'),
  ('technical-pen-set', 'SOA'), ('cutting-mat', 'SOA'), ('utility-knife', 'SOA'),
  ('measuring-tape', 'SOA'), ('safety-helmet', 'SOA'), ('safety-vest', 'SOA')
on conflict do nothing;

alter table public.profiles add column if not exists campus_name text;
alter table public.profiles add column if not exists school_code text references public.nub_schools(code);
alter table public.profiles add column if not exists program_code text references public.nub_programs(code);
alter table public.profiles add column if not exists student_number text;
alter table public.items add column if not exists equipment_id text references public.equipment_catalog(slug);

-- Preserve approved legacy listings without guessing at near matches. Listings
-- outside the NUB equipment catalog intentionally keep a null equipment_id.
update public.items item
set equipment_id = equipment.slug
from public.equipment_catalog equipment
where item.equipment_id is null
  and lower(btrim(item.title)) = lower(equipment.name);

create unique index if not exists profiles_student_number_unique
  on public.profiles(student_number)
  where student_number is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_student_number_format') then
    alter table public.profiles add constraint profiles_student_number_format
      check (student_number is null or student_number ~ '^\d{4}-\d{6}$');
  end if;
end $$;

create or replace function public.enforce_nub_profile_program_school()
returns trigger
language plpgsql
as $$
declare
  expected_school text;
begin
  if new.program_code is null then
    return new;
  end if;

  select school_code into expected_school from public.nub_programs where code = new.program_code and is_active;
  if expected_school is null or new.school_code is distinct from expected_school then
    raise exception 'The selected NU Baliwag program does not belong to the selected school.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_nub_program_school_check on public.profiles;
create trigger profiles_nub_program_school_check
before insert or update of school_code, program_code on public.profiles
for each row execute function public.enforce_nub_profile_program_school();

alter table public.nub_schools enable row level security;
alter table public.nub_programs enable row level security;
alter table public.equipment_catalog enable row level security;
alter table public.equipment_school_access enable row level security;
alter table public.equipment_program_access enable row level security;

drop policy if exists "Public reads active NUB schools" on public.nub_schools;
create policy "Public reads active NUB schools" on public.nub_schools for select using (is_active);
drop policy if exists "Public reads active NUB programs" on public.nub_programs;
create policy "Public reads active NUB programs" on public.nub_programs for select using (is_active);
drop policy if exists "Public reads active equipment" on public.equipment_catalog;
create policy "Public reads active equipment" on public.equipment_catalog for select using (is_active);
drop policy if exists "Public reads equipment school access" on public.equipment_school_access;
create policy "Public reads equipment school access" on public.equipment_school_access for select using (true);
drop policy if exists "Public reads equipment program access" on public.equipment_program_access;
create policy "Public reads equipment program access" on public.equipment_program_access for select using (true);

grant select on public.nub_schools, public.nub_programs, public.equipment_catalog,
  public.equipment_school_access, public.equipment_program_access to anon, authenticated;

comment on column public.items.equipment_id is 'Approved reusable/lendable NUB equipment type; replaces free-form generic/consumable item types.';
comment on column public.profiles.student_number is 'Official NU Baliwag student number supplied by the admin registry in YYYY-NNNNNN format.';
