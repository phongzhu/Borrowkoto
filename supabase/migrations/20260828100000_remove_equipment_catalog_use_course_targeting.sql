begin;

-- Listing visibility is now defined only by applies_to_all_programs and
-- item_programs. The target school is derived from nub_programs.school_code,
-- so a second school-access table would duplicate the same relationship.
create schema if not exists archive;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'items'
      and column_name = 'equipment_id'
  ) then
    alter table public.items rename column equipment_id to legacy_equipment_id;
  end if;
end $$;

alter table if exists public.equipment_program_access set schema archive;
alter table if exists public.equipment_school_access set schema archive;
alter table if exists public.equipment_catalog set schema archive;

comment on schema archive is
  'Retired application structures retained temporarily for reversible migrations and historical reference.';

comment on column public.items.legacy_equipment_id is
  'Deprecated equipment classification retained for historical listings; new code uses item_programs and nub_programs.school_code.';

comment on table archive.equipment_catalog is
  'Deprecated equipment catalog. Listing classification now uses category, subcategory, and course targets.';

comment on table archive.equipment_school_access is
  'Deprecated school-access mapping retained for historical reference.';

comment on table archive.equipment_program_access is
  'Deprecated course-access mapping retained for historical reference.';

comment on table public.item_programs is
  'Official course targets for a listing. Its target schools are derived through nub_programs.school_code.';

comment on column public.items.applies_to_all_programs is
  'True when a listing targets every NU Baliwag school and undergraduate program.';

commit;
