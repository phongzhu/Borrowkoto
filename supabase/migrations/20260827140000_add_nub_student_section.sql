-- Add the Registrar-managed class section to registry and student profiles.

alter table public.nub_student_registry
  add column if not exists section text;

alter table public.profiles
  add column if not exists section text;

update public.nub_student_registry
set section = upper(nullif(btrim(section), ''))
where section is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'nub_student_registry_section_format_check'
  ) then
    alter table public.nub_student_registry
      add constraint nub_student_registry_section_format_check
      check (section is null or section ~ '^[A-Z0-9-]{2,20}$');
  end if;
end $$;

create or replace function public.validate_nub_student_registry_program()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.nub_programs program
    where program.code = new.program_code
      and program.school_code = new.school_code
  ) then
    raise exception 'Program % does not belong to school %.', new.program_code, new.school_code;
  end if;

  new.email := lower(btrim(new.email));
  new.section := upper(nullif(btrim(new.section), ''));
  if new.section is not null and new.section !~ '^[A-Z0-9-]{2,20}$' then
    raise exception 'section must contain 2 to 20 letters, numbers, or hyphens.';
  end if;

  new.school_status := initcap(lower(btrim(new.school_status)));
  if new.school_status not in ('Enrolled', 'Dropped', 'Graduated') then
    raise exception 'school_status must be Enrolled, Dropped, or Graduated.';
  end if;

  new.status := case
    when new.school_status = 'Enrolled' then 'active'
    when new.school_status = 'Graduated' then 'graduated'
    else 'inactive'
  end;
  new.country := coalesce(nullif(btrim(new.country), ''), 'Philippines');
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.sync_nub_student_registry_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.auth_user_id is null then
    return new;
  end if;

  insert into public.profiles (
    id,
    first_name,
    middle_name,
    last_name,
    suffix,
    role,
    campus_name,
    school_code,
    program_code,
    section,
    student_number,
    year_level,
    phone_number,
    date_of_birth,
    street,
    barangay,
    city,
    province,
    region,
    country,
    nub_registry_managed,
    is_verified,
    verification_status,
    account_status
  ) values (
    new.auth_user_id,
    new.first_name,
    nullif(new.middle_name, ''),
    new.last_name,
    nullif(new.suffix, ''),
    'user',
    'NU BALIWAG',
    new.school_code,
    new.program_code,
    new.section,
    new.student_number,
    new.year_level,
    nullif(new.phone_number, ''),
    new.date_of_birth,
    nullif(new.street, ''),
    nullif(new.barangay, ''),
    nullif(new.city, ''),
    nullif(new.province, ''),
    nullif(new.region, ''),
    coalesce(nullif(new.country, ''), 'Philippines'),
    true,
    true,
    'verified',
    case when new.school_status = 'Enrolled' then 'active' else 'inactive' end
  )
  on conflict (id) do update set
    first_name = excluded.first_name,
    middle_name = excluded.middle_name,
    last_name = excluded.last_name,
    suffix = excluded.suffix,
    campus_name = excluded.campus_name,
    school_code = excluded.school_code,
    program_code = excluded.program_code,
    section = excluded.section,
    student_number = excluded.student_number,
    year_level = excluded.year_level,
    phone_number = coalesce(public.profiles.phone_number, excluded.phone_number),
    date_of_birth = coalesce(public.profiles.date_of_birth, excluded.date_of_birth),
    street = coalesce(public.profiles.street, excluded.street),
    barangay = coalesce(public.profiles.barangay, excluded.barangay),
    city = coalesce(public.profiles.city, excluded.city),
    province = coalesce(public.profiles.province, excluded.province),
    region = coalesce(public.profiles.region, excluded.region),
    country = coalesce(public.profiles.country, excluded.country),
    nub_registry_managed = true,
    is_verified = true,
    verification_status = 'verified',
    account_status = excluded.account_status;

  return new;
end;
$$;

create or replace function public.preserve_nub_registry_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  registry public.nub_student_registry%rowtype;
begin
  if auth.uid() is distinct from old.id then
    return new;
  end if;

  select * into registry
  from public.nub_student_registry
  where auth_user_id = old.id;

  if not found then
    return new;
  end if;

  new.first_name := registry.first_name;
  new.middle_name := nullif(registry.middle_name, '');
  new.last_name := registry.last_name;
  new.suffix := nullif(registry.suffix, '');
  new.campus_name := 'NU BALIWAG';
  new.school_code := registry.school_code;
  new.program_code := registry.program_code;
  new.section := registry.section;
  new.student_number := registry.student_number;
  new.year_level := registry.year_level;
  new.nub_registry_managed := true;
  new.is_verified := true;
  new.verification_status := 'verified';
  return new;
end;
$$;

update public.nub_student_registry
set updated_at = now()
where auth_user_id is not null;

comment on column public.nub_student_registry.section is
  'Registrar-managed class section, for example ITE231.';

comment on column public.profiles.section is
  'Class section synchronized from the official NUB student registry.';
