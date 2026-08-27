-- Replace the generalized marketplace taxonomy with the NU Baliwag-focused
-- parent category -> subcategory -> listing -> applicable program structure.

alter table public.items
  add column if not exists subcategory_id uuid references public.categories(id),
  add column if not exists applies_to_all_programs boolean not null default false;

create table if not exists public.item_programs (
  item_id uuid not null references public.items(id) on delete cascade,
  program_code text not null references public.nub_programs(code) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, program_code)
);

create index if not exists items_subcategory_id_idx on public.items(subcategory_id);
create index if not exists item_programs_program_code_idx on public.item_programs(program_code, item_id);

-- Subcategory names only need to be unique within their parent. This permits
-- valid paths such as Business -> Presentation Equipment and Media ->
-- Presentation Equipment without weakening root-category uniqueness.
alter table public.categories drop constraint if exists categories_name_key;
create unique index if not exists categories_root_name_unique
  on public.categories(lower(btrim(name)))
  where parent_category_id is null;
create unique index if not exists categories_child_name_per_parent_unique
  on public.categories(parent_category_id, lower(btrim(name)))
  where parent_category_id is not null;

-- Retain legacy category records for history, but remove them from all active
-- listing forms and marketplace filters.
update public.categories set is_active = false where is_active = true;

with parent_seed(name, description, icon_key) as (
  values
    ('Academic Projects', 'Customizable templates, components, prototypes, models, and references for student work—not ready-to-submit graded requirements.', 'office'),
    ('Computers and Digital Devices', 'Reusable computers, mobile devices, displays, peripherals, storage, power accessories, printers, scanners, and projectors.', 'laptop'),
    ('Networking and Computer Tools', 'Networking hardware, cabling, adapters, testers, and reusable computer repair equipment.', 'electronics'),
    ('Electronics and Robotics', 'Reusable electronic prototyping, robotics, measurement, soldering, and testing equipment.', 'electronics'),
    ('Drafting and Architecture', 'Drafting, drawing, model-making, cutting, scaling, and measuring equipment for design work.', 'tools'),
    ('Civil Engineering and Construction', 'Surveying, construction, testing, measurement, drafting, hand, and safety equipment.', 'tools'),
    ('Business and Accounting Tools', 'Reusable calculation, document, presentation, receipt-printing, and marketing equipment.', 'office'),
    ('Media and Content-Creation Equipment', 'Camera, audio, lighting, recording, presentation, and stabilization equipment for student productions.', 'camera'),
    ('Hospitality and Food-Preparation Equipment', 'Reusable kitchen, baking, food preparation, measuring, dining, and serving equipment.', 'appliance'),
    ('Psychology and Research Equipment', 'Authorized reusable testing, timing, recording, interview, survey, and experimental equipment.', 'health'),
    ('Sports and Physical Education Equipment', 'Reusable sports, exercise, training, protective, timing, and first-aid equipment.', 'sports'),
    ('Teaching and Learning Materials', 'Reusable teaching aids, educational games, visual resources, manipulatives, and assessment tools.', 'office')
)
insert into public.categories(name, description, parent_category_id, is_active, icon_key)
select seed.name, seed.description, null, true, seed.icon_key
from parent_seed seed
where not exists (
  select 1 from public.categories category
  where category.parent_category_id is null and lower(btrim(category.name)) = lower(seed.name)
);

with parent_seed(name, description, icon_key) as (
  values
    ('Academic Projects', 'Customizable templates, components, prototypes, models, and references for student work—not ready-to-submit graded requirements.', 'office'),
    ('Computers and Digital Devices', 'Reusable computers, mobile devices, displays, peripherals, storage, power accessories, printers, scanners, and projectors.', 'laptop'),
    ('Networking and Computer Tools', 'Networking hardware, cabling, adapters, testers, and reusable computer repair equipment.', 'electronics'),
    ('Electronics and Robotics', 'Reusable electronic prototyping, robotics, measurement, soldering, and testing equipment.', 'electronics'),
    ('Drafting and Architecture', 'Drafting, drawing, model-making, cutting, scaling, and measuring equipment for design work.', 'tools'),
    ('Civil Engineering and Construction', 'Surveying, construction, testing, measurement, drafting, hand, and safety equipment.', 'tools'),
    ('Business and Accounting Tools', 'Reusable calculation, document, presentation, receipt-printing, and marketing equipment.', 'office'),
    ('Media and Content-Creation Equipment', 'Camera, audio, lighting, recording, presentation, and stabilization equipment for student productions.', 'camera'),
    ('Hospitality and Food-Preparation Equipment', 'Reusable kitchen, baking, food preparation, measuring, dining, and serving equipment.', 'appliance'),
    ('Psychology and Research Equipment', 'Authorized reusable testing, timing, recording, interview, survey, and experimental equipment.', 'health'),
    ('Sports and Physical Education Equipment', 'Reusable sports, exercise, training, protective, timing, and first-aid equipment.', 'sports'),
    ('Teaching and Learning Materials', 'Reusable teaching aids, educational games, visual resources, manipulatives, and assessment tools.', 'office')
)
update public.categories category
set description = seed.description, icon_key = seed.icon_key, is_active = true
from parent_seed seed
where category.parent_category_id is null and lower(btrim(category.name)) = lower(seed.name);

with subcategory_seed(parent_name, child_name) as (
  values
    ('Academic Projects', 'System Projects'),
    ('Academic Projects', 'Mobile Application Projects'),
    ('Academic Projects', 'Web Application Projects'),
    ('Academic Projects', 'Desktop Application Projects'),
    ('Academic Projects', 'IoT Projects'),
    ('Academic Projects', 'Robotics Projects'),
    ('Academic Projects', 'Electronics Projects'),
    ('Academic Projects', 'Architectural Models'),
    ('Academic Projects', 'Engineering Models'),
    ('Academic Projects', 'Business Plans'),
    ('Academic Projects', 'Marketing Campaign Materials'),
    ('Academic Projects', 'Research Instruments'),
    ('Academic Projects', 'Teaching Materials'),
    ('Computers and Digital Devices', 'Laptops'),
    ('Computers and Digital Devices', 'Desktop Computers'),
    ('Computers and Digital Devices', 'Smartphones'),
    ('Computers and Digital Devices', 'Tablets'),
    ('Computers and Digital Devices', 'Monitors'),
    ('Computers and Digital Devices', 'Computer Peripherals'),
    ('Computers and Digital Devices', 'Storage Devices'),
    ('Computers and Digital Devices', 'Chargers and Adapters'),
    ('Computers and Digital Devices', 'Printers and Scanners'),
    ('Computers and Digital Devices', 'Projectors'),
    ('Networking and Computer Tools', 'Network Cables'),
    ('Networking and Computer Tools', 'Crimping Tools'),
    ('Networking and Computer Tools', 'LAN Testers'),
    ('Networking and Computer Tools', 'Routers'),
    ('Networking and Computer Tools', 'Network Switches'),
    ('Networking and Computer Tools', 'Computer Repair Tools'),
    ('Networking and Computer Tools', 'USB and Network Adapters'),
    ('Networking and Computer Tools', 'Testing Devices'),
    ('Electronics and Robotics', 'Electronic Components'),
    ('Electronics and Robotics', 'Breadboards'),
    ('Electronics and Robotics', 'Jumper Wires'),
    ('Electronics and Robotics', 'Microcontroller Boards'),
    ('Electronics and Robotics', 'Sensors'),
    ('Electronics and Robotics', 'Motors'),
    ('Electronics and Robotics', 'Robotics Components'),
    ('Electronics and Robotics', 'Multimeters'),
    ('Electronics and Robotics', 'Soldering Tools'),
    ('Electronics and Robotics', 'Electronic Testing Equipment'),
    ('Drafting and Architecture', 'Drafting Boards'),
    ('Drafting and Architecture', 'T-Squares'),
    ('Drafting and Architecture', 'Drafting Rulers'),
    ('Drafting and Architecture', 'Architectural Scales'),
    ('Drafting and Architecture', 'Compasses and Protractors'),
    ('Drafting and Architecture', 'Technical Pens'),
    ('Drafting and Architecture', 'Drawing Tools'),
    ('Drafting and Architecture', 'Cutting Tools'),
    ('Drafting and Architecture', 'Model-Making Tools'),
    ('Drafting and Architecture', 'Measuring Tools'),
    ('Civil Engineering and Construction', 'Surveying Equipment'),
    ('Civil Engineering and Construction', 'Construction Tools'),
    ('Civil Engineering and Construction', 'Concrete-Testing Equipment'),
    ('Civil Engineering and Construction', 'Soil-Testing Equipment'),
    ('Civil Engineering and Construction', 'Measuring Equipment'),
    ('Civil Engineering and Construction', 'Hand Tools'),
    ('Civil Engineering and Construction', 'Safety Equipment'),
    ('Civil Engineering and Construction', 'Drafting Equipment'),
    ('Business and Accounting Tools', 'Basic Calculators'),
    ('Business and Accounting Tools', 'Financial Calculators'),
    ('Business and Accounting Tools', 'Accounting Calculators'),
    ('Business and Accounting Tools', 'Receipt Printers'),
    ('Business and Accounting Tools', 'Document Scanners'),
    ('Business and Accounting Tools', 'Presentation Equipment'),
    ('Business and Accounting Tools', 'Marketing Equipment'),
    ('Media and Content-Creation Equipment', 'Cameras'),
    ('Media and Content-Creation Equipment', 'Tripods'),
    ('Media and Content-Creation Equipment', 'Ring Lights'),
    ('Media and Content-Creation Equipment', 'Microphones'),
    ('Media and Content-Creation Equipment', 'Audio Recorders'),
    ('Media and Content-Creation Equipment', 'Portable Speakers'),
    ('Media and Content-Creation Equipment', 'Lighting Equipment'),
    ('Media and Content-Creation Equipment', 'Presentation Equipment'),
    ('Hospitality and Food-Preparation Equipment', 'Kitchen Knives'),
    ('Hospitality and Food-Preparation Equipment', 'Cookware'),
    ('Hospitality and Food-Preparation Equipment', 'Bakeware'),
    ('Hospitality and Food-Preparation Equipment', 'Food-Preparation Tools'),
    ('Hospitality and Food-Preparation Equipment', 'Measuring Tools'),
    ('Hospitality and Food-Preparation Equipment', 'Plates and Tableware'),
    ('Hospitality and Food-Preparation Equipment', 'Glassware'),
    ('Hospitality and Food-Preparation Equipment', 'Serving Equipment'),
    ('Hospitality and Food-Preparation Equipment', 'Food-Weighing Scales'),
    ('Psychology and Research Equipment', 'Psychological Testing Materials'),
    ('Psychology and Research Equipment', 'Stopwatches and Timers'),
    ('Psychology and Research Equipment', 'Recording Equipment'),
    ('Psychology and Research Equipment', 'Survey Materials'),
    ('Psychology and Research Equipment', 'Interview Equipment'),
    ('Psychology and Research Equipment', 'Experimental Equipment'),
    ('Sports and Physical Education Equipment', 'Sports Balls'),
    ('Sports and Physical Education Equipment', 'Rackets and Paddles'),
    ('Sports and Physical Education Equipment', 'Nets and Goals'),
    ('Sports and Physical Education Equipment', 'Exercise Equipment'),
    ('Sports and Physical Education Equipment', 'Cones and Hurdles'),
    ('Sports and Physical Education Equipment', 'Stopwatches'),
    ('Sports and Physical Education Equipment', 'Whistles'),
    ('Sports and Physical Education Equipment', 'Protective Equipment'),
    ('Sports and Physical Education Equipment', 'First-Aid Kits'),
    ('Teaching and Learning Materials', 'Flashcards'),
    ('Teaching and Learning Materials', 'Posters and Charts'),
    ('Teaching and Learning Materials', 'Teaching Aids'),
    ('Teaching and Learning Materials', 'Educational Games'),
    ('Teaching and Learning Materials', 'Visual Materials'),
    ('Teaching and Learning Materials', 'Sensory Materials'),
    ('Teaching and Learning Materials', 'Puzzles and Blocks'),
    ('Teaching and Learning Materials', 'Learning Manipulatives'),
    ('Teaching and Learning Materials', 'Assessment Materials')
)
insert into public.categories(name, description, parent_category_id, is_active, icon_key)
select seed.child_name,
       'NU Baliwag marketplace classification under ' || seed.parent_name || '.',
       parent.id,
       true,
       parent.icon_key
from subcategory_seed seed
join public.categories parent
  on parent.parent_category_id is null and lower(btrim(parent.name)) = lower(seed.parent_name)
where not exists (
  select 1 from public.categories child
  where child.parent_category_id = parent.id and lower(btrim(child.name)) = lower(seed.child_name)
);

with desired_children(parent_name, child_name) as (
  values
    ('Academic Projects', 'System Projects'), ('Academic Projects', 'Mobile Application Projects'),
    ('Academic Projects', 'Web Application Projects'), ('Academic Projects', 'Desktop Application Projects'),
    ('Academic Projects', 'IoT Projects'), ('Academic Projects', 'Robotics Projects'),
    ('Academic Projects', 'Electronics Projects'), ('Academic Projects', 'Architectural Models'),
    ('Academic Projects', 'Engineering Models'), ('Academic Projects', 'Business Plans'),
    ('Academic Projects', 'Marketing Campaign Materials'), ('Academic Projects', 'Research Instruments'),
    ('Academic Projects', 'Teaching Materials'),
    ('Computers and Digital Devices', 'Laptops'), ('Computers and Digital Devices', 'Desktop Computers'),
    ('Computers and Digital Devices', 'Smartphones'), ('Computers and Digital Devices', 'Tablets'),
    ('Computers and Digital Devices', 'Monitors'), ('Computers and Digital Devices', 'Computer Peripherals'),
    ('Computers and Digital Devices', 'Storage Devices'), ('Computers and Digital Devices', 'Chargers and Adapters'),
    ('Computers and Digital Devices', 'Printers and Scanners'), ('Computers and Digital Devices', 'Projectors'),
    ('Networking and Computer Tools', 'Network Cables'), ('Networking and Computer Tools', 'Crimping Tools'),
    ('Networking and Computer Tools', 'LAN Testers'), ('Networking and Computer Tools', 'Routers'),
    ('Networking and Computer Tools', 'Network Switches'), ('Networking and Computer Tools', 'Computer Repair Tools'),
    ('Networking and Computer Tools', 'USB and Network Adapters'), ('Networking and Computer Tools', 'Testing Devices'),
    ('Electronics and Robotics', 'Electronic Components'), ('Electronics and Robotics', 'Breadboards'),
    ('Electronics and Robotics', 'Jumper Wires'), ('Electronics and Robotics', 'Microcontroller Boards'),
    ('Electronics and Robotics', 'Sensors'), ('Electronics and Robotics', 'Motors'),
    ('Electronics and Robotics', 'Robotics Components'), ('Electronics and Robotics', 'Multimeters'),
    ('Electronics and Robotics', 'Soldering Tools'), ('Electronics and Robotics', 'Electronic Testing Equipment'),
    ('Drafting and Architecture', 'Drafting Boards'), ('Drafting and Architecture', 'T-Squares'),
    ('Drafting and Architecture', 'Drafting Rulers'), ('Drafting and Architecture', 'Architectural Scales'),
    ('Drafting and Architecture', 'Compasses and Protractors'), ('Drafting and Architecture', 'Technical Pens'),
    ('Drafting and Architecture', 'Drawing Tools'), ('Drafting and Architecture', 'Cutting Tools'),
    ('Drafting and Architecture', 'Model-Making Tools'), ('Drafting and Architecture', 'Measuring Tools'),
    ('Civil Engineering and Construction', 'Surveying Equipment'), ('Civil Engineering and Construction', 'Construction Tools'),
    ('Civil Engineering and Construction', 'Concrete-Testing Equipment'), ('Civil Engineering and Construction', 'Soil-Testing Equipment'),
    ('Civil Engineering and Construction', 'Measuring Equipment'), ('Civil Engineering and Construction', 'Hand Tools'),
    ('Civil Engineering and Construction', 'Safety Equipment'), ('Civil Engineering and Construction', 'Drafting Equipment'),
    ('Business and Accounting Tools', 'Basic Calculators'), ('Business and Accounting Tools', 'Financial Calculators'),
    ('Business and Accounting Tools', 'Accounting Calculators'), ('Business and Accounting Tools', 'Receipt Printers'),
    ('Business and Accounting Tools', 'Document Scanners'), ('Business and Accounting Tools', 'Presentation Equipment'),
    ('Business and Accounting Tools', 'Marketing Equipment'),
    ('Media and Content-Creation Equipment', 'Cameras'), ('Media and Content-Creation Equipment', 'Tripods'),
    ('Media and Content-Creation Equipment', 'Ring Lights'), ('Media and Content-Creation Equipment', 'Microphones'),
    ('Media and Content-Creation Equipment', 'Audio Recorders'), ('Media and Content-Creation Equipment', 'Portable Speakers'),
    ('Media and Content-Creation Equipment', 'Lighting Equipment'), ('Media and Content-Creation Equipment', 'Presentation Equipment'),
    ('Hospitality and Food-Preparation Equipment', 'Kitchen Knives'), ('Hospitality and Food-Preparation Equipment', 'Cookware'),
    ('Hospitality and Food-Preparation Equipment', 'Bakeware'), ('Hospitality and Food-Preparation Equipment', 'Food-Preparation Tools'),
    ('Hospitality and Food-Preparation Equipment', 'Measuring Tools'), ('Hospitality and Food-Preparation Equipment', 'Plates and Tableware'),
    ('Hospitality and Food-Preparation Equipment', 'Glassware'), ('Hospitality and Food-Preparation Equipment', 'Serving Equipment'),
    ('Hospitality and Food-Preparation Equipment', 'Food-Weighing Scales'),
    ('Psychology and Research Equipment', 'Psychological Testing Materials'), ('Psychology and Research Equipment', 'Stopwatches and Timers'),
    ('Psychology and Research Equipment', 'Recording Equipment'), ('Psychology and Research Equipment', 'Survey Materials'),
    ('Psychology and Research Equipment', 'Interview Equipment'), ('Psychology and Research Equipment', 'Experimental Equipment'),
    ('Sports and Physical Education Equipment', 'Sports Balls'), ('Sports and Physical Education Equipment', 'Rackets and Paddles'),
    ('Sports and Physical Education Equipment', 'Nets and Goals'), ('Sports and Physical Education Equipment', 'Exercise Equipment'),
    ('Sports and Physical Education Equipment', 'Cones and Hurdles'), ('Sports and Physical Education Equipment', 'Stopwatches'),
    ('Sports and Physical Education Equipment', 'Whistles'), ('Sports and Physical Education Equipment', 'Protective Equipment'),
    ('Sports and Physical Education Equipment', 'First-Aid Kits'),
    ('Teaching and Learning Materials', 'Flashcards'), ('Teaching and Learning Materials', 'Posters and Charts'),
    ('Teaching and Learning Materials', 'Teaching Aids'), ('Teaching and Learning Materials', 'Educational Games'),
    ('Teaching and Learning Materials', 'Visual Materials'), ('Teaching and Learning Materials', 'Sensory Materials'),
    ('Teaching and Learning Materials', 'Puzzles and Blocks'), ('Teaching and Learning Materials', 'Learning Manipulatives'),
    ('Teaching and Learning Materials', 'Assessment Materials')
)
update public.categories child
set is_active = true
from desired_children desired
join public.categories parent
  on parent.parent_category_id is null and lower(btrim(parent.name)) = lower(desired.parent_name)
where child.parent_category_id = parent.id and lower(btrim(child.name)) = lower(desired.child_name);

-- Backfill approved legacy equipment into the closest NUB category path.
with equipment_category_map(equipment_slug, parent_name, child_name) as (
  values
    ('laptop', 'Computers and Digital Devices', 'Laptops'),
    ('tablet', 'Computers and Digital Devices', 'Tablets'),
    ('projector', 'Computers and Digital Devices', 'Projectors'),
    ('portable-projector-screen', 'Media and Content-Creation Equipment', 'Presentation Equipment'),
    ('hdmi-cable', 'Computers and Digital Devices', 'Chargers and Adapters'),
    ('vga-cable', 'Computers and Digital Devices', 'Chargers and Adapters'),
    ('usb-c-display-adapter', 'Computers and Digital Devices', 'Chargers and Adapters'),
    ('extension-cord', 'Computers and Digital Devices', 'Chargers and Adapters'),
    ('power-strip', 'Computers and Digital Devices', 'Chargers and Adapters'),
    ('flash-drive', 'Computers and Digital Devices', 'Storage Devices'),
    ('external-hard-drive', 'Computers and Digital Devices', 'Storage Devices'),
    ('printer', 'Computers and Digital Devices', 'Printers and Scanners'),
    ('scanner', 'Computers and Digital Devices', 'Printers and Scanners'),
    ('webcam', 'Computers and Digital Devices', 'Computer Peripherals'),
    ('digital-camera', 'Media and Content-Creation Equipment', 'Cameras'),
    ('camera', 'Media and Content-Creation Equipment', 'Cameras'),
    ('tripod', 'Media and Content-Creation Equipment', 'Tripods'),
    ('ring-light', 'Media and Content-Creation Equipment', 'Ring Lights'),
    ('microphone', 'Media and Content-Creation Equipment', 'Microphones'),
    ('portable-speaker', 'Media and Content-Creation Equipment', 'Portable Speakers'),
    ('scientific-calculator', 'Business and Accounting Tools', 'Accounting Calculators'),
    ('lan-cable', 'Networking and Computer Tools', 'Network Cables'),
    ('crimping-tool', 'Networking and Computer Tools', 'Crimping Tools'),
    ('lan-cable-tester', 'Networking and Computer Tools', 'LAN Testers'),
    ('router', 'Networking and Computer Tools', 'Routers'),
    ('network-switch', 'Networking and Computer Tools', 'Network Switches'),
    ('screwdriver-set', 'Networking and Computer Tools', 'Computer Repair Tools'),
    ('computer-repair-toolkit', 'Networking and Computer Tools', 'Computer Repair Tools'),
    ('multimeter', 'Electronics and Robotics', 'Multimeters'),
    ('soldering-iron', 'Electronics and Robotics', 'Soldering Tools'),
    ('breadboard', 'Electronics and Robotics', 'Breadboards'),
    ('jumper-wires', 'Electronics and Robotics', 'Jumper Wires'),
    ('microcontroller-board', 'Electronics and Robotics', 'Microcontroller Boards'),
    ('electronic-sensors', 'Electronics and Robotics', 'Sensors'),
    ('motors', 'Electronics and Robotics', 'Motors'),
    ('surveying-equipment', 'Civil Engineering and Construction', 'Surveying Equipment'),
    ('concrete-testing-equipment', 'Civil Engineering and Construction', 'Concrete-Testing Equipment'),
    ('soil-testing-equipment', 'Civil Engineering and Construction', 'Soil-Testing Equipment'),
    ('safety-helmet', 'Civil Engineering and Construction', 'Safety Equipment'),
    ('safety-vest', 'Civil Engineering and Construction', 'Safety Equipment'),
    ('basic-calculator', 'Business and Accounting Tools', 'Basic Calculators'),
    ('financial-calculator', 'Business and Accounting Tools', 'Financial Calculators'),
    ('voice-recorder', 'Psychology and Research Equipment', 'Recording Equipment'),
    ('stopwatch', 'Sports and Physical Education Equipment', 'Stopwatches'),
    ('psychological-testing-kit', 'Psychology and Research Equipment', 'Psychological Testing Materials'),
    ('sports-balls', 'Sports and Physical Education Equipment', 'Sports Balls'),
    ('rackets-and-paddles', 'Sports and Physical Education Equipment', 'Rackets and Paddles'),
    ('cones', 'Sports and Physical Education Equipment', 'Cones and Hurdles'),
    ('hurdles', 'Sports and Physical Education Equipment', 'Cones and Hurdles'),
    ('whistle', 'Sports and Physical Education Equipment', 'Whistles'),
    ('exercise-equipment', 'Sports and Physical Education Equipment', 'Exercise Equipment'),
    ('first-aid-kit', 'Sports and Physical Education Equipment', 'First-Aid Kits'),
    ('kitchen-knife-set', 'Hospitality and Food-Preparation Equipment', 'Kitchen Knives'),
    ('cookware', 'Hospitality and Food-Preparation Equipment', 'Cookware'),
    ('baking-tools', 'Hospitality and Food-Preparation Equipment', 'Bakeware'),
    ('measuring-cups-and-spoons', 'Hospitality and Food-Preparation Equipment', 'Measuring Tools'),
    ('food-weighing-scale', 'Hospitality and Food-Preparation Equipment', 'Food-Weighing Scales'),
    ('plates', 'Hospitality and Food-Preparation Equipment', 'Plates and Tableware'),
    ('glassware', 'Hospitality and Food-Preparation Equipment', 'Glassware'),
    ('serving-utensils', 'Hospitality and Food-Preparation Equipment', 'Serving Equipment'),
    ('portable-stove', 'Hospitality and Food-Preparation Equipment', 'Food-Preparation Tools'),
    ('t-square', 'Drafting and Architecture', 'T-Squares'),
    ('triangular-ruler', 'Drafting and Architecture', 'Drafting Rulers'),
    ('architects-scale', 'Drafting and Architecture', 'Architectural Scales'),
    ('compass', 'Drafting and Architecture', 'Compasses and Protractors'),
    ('protractor', 'Drafting and Architecture', 'Compasses and Protractors'),
    ('drafting-board', 'Drafting and Architecture', 'Drafting Boards'),
    ('technical-pen-set', 'Drafting and Architecture', 'Technical Pens'),
    ('cutting-mat', 'Drafting and Architecture', 'Cutting Tools'),
    ('utility-knife', 'Drafting and Architecture', 'Cutting Tools'),
    ('measuring-tape', 'Drafting and Architecture', 'Measuring Tools')
)
update public.items item
set category_id = parent.id,
    subcategory_id = child.id
from equipment_category_map mapping
join public.categories parent
  on parent.parent_category_id is null and lower(btrim(parent.name)) = lower(mapping.parent_name)
join public.categories child
  on child.parent_category_id = parent.id and lower(btrim(child.name)) = lower(mapping.child_name)
where item.equipment_id = mapping.equipment_slug;

-- Existing approved equipment keeps its established school/program scope.
update public.items item
set applies_to_all_programs = equipment.is_universal
from public.equipment_catalog equipment
where item.equipment_id = equipment.slug;

insert into public.item_programs(item_id, program_code)
select item.id, access.program_code
from public.items item
join public.equipment_program_access access on access.equipment_slug = item.equipment_id
on conflict do nothing;

insert into public.item_programs(item_id, program_code)
select item.id, program.code
from public.items item
join public.equipment_school_access access on access.equipment_slug = item.equipment_id
join public.nub_programs program on program.school_code = access.school_code and program.is_active
on conflict do nothing;

create or replace function public.enforce_item_category_path()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  subcategory_parent uuid;
  subcategory_active boolean;
begin
  if new.subcategory_id is null then
    return new;
  end if;

  select parent_category_id, is_active
    into subcategory_parent, subcategory_active
  from public.categories
  where id = new.subcategory_id;

  if subcategory_parent is null or subcategory_parent is distinct from new.category_id then
    raise exception 'The selected subcategory must belong to the selected parent category.';
  end if;

  if not subcategory_active then
    raise exception 'The selected subcategory is not active.';
  end if;

  return new;
end;
$$;

drop trigger if exists items_category_path_check on public.items;
create trigger items_category_path_check
before insert or update of category_id, subcategory_id on public.items
for each row execute function public.enforce_item_category_path();

alter table public.item_programs enable row level security;

drop policy if exists "Public reads item programs" on public.item_programs;
create policy "Public reads item programs" on public.item_programs
for select using (true);

drop policy if exists "Owners add item programs" on public.item_programs;
create policy "Owners add item programs" on public.item_programs
for insert to authenticated
with check (exists (
  select 1 from public.items item
  where item.id = item_id and item.owner_id = (select auth.uid())
));

drop policy if exists "Owners remove item programs" on public.item_programs;
create policy "Owners remove item programs" on public.item_programs
for delete to authenticated
using (exists (
  select 1 from public.items item
  where item.id = item_id and item.owner_id = (select auth.uid())
));

drop policy if exists "Admins manage item programs" on public.item_programs;
create policy "Admins manage item programs" on public.item_programs
for all to authenticated
using (exists (
  select 1 from public.profiles profile
  where profile.id = (select auth.uid()) and lower(profile.role::text) = 'admin'
))
with check (exists (
  select 1 from public.profiles profile
  where profile.id = (select auth.uid()) and lower(profile.role::text) = 'admin'
));

grant select on public.item_programs to anon, authenticated;
grant insert, delete on public.item_programs to authenticated;

comment on column public.items.subcategory_id is 'Single active NUB marketplace subcategory under items.category_id.';
comment on column public.items.applies_to_all_programs is 'True when the listing is applicable to every official NU Baliwag undergraduate program.';
comment on table public.item_programs is 'Normalized many-to-many relationship between listings and official NU Baliwag programs.';

notify pgrst, 'reload schema';
